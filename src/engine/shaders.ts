// All GLSL lives here. Pipeline, in order:
//   noise reduction -> sRGB decode -> white balance -> dehaze -> exposure -> sRGB encode ->
//   tone (highlights/shadows/whites/blacks) -> local detail (texture/clarity/
//   sharpen) -> contrast -> tone curve LUT -> HSL mixer -> vibrance/saturation ->
//   black & white -> color grading -> vignette -> grain -> dither.
//
// Coordinates: vUv covers the viewport. uTileRect maps it to output uv (the cropped
// picture). uOutToSrc maps output uv to source uv (the whole original). uSourceRect
// maps source uv to whichever texture currently holds those pixels.
//
// Local-contrast tools compare the *source* pixel with blurred copies of the
// *source*. The blurs are built once per photo at fixed sizes, so slider drags
// only ever re-run the single main pass, and preview and full-resolution export
// use exactly the same blur textures.

export const VERTEX_SHADER = /* glsl */ `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/** Separable gaussian used to build the blur textures. */
export const BLUR_SHADER = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uStep;
void main() {
  // 9-tap gaussian folded into 5 bilinear fetches.
  vec4 c = texture(uTex, vUv) * 0.2270270;
  c += (texture(uTex, vUv + uStep * 1.3846154) + texture(uTex, vUv - uStep * 1.3846154)) * 0.3162162;
  c += (texture(uTex, vUv + uStep * 3.2307692) + texture(uTex, vUv - uStep * 3.2307692)) * 0.0702703;
  outColor = c;
}`;

export const MAIN_SHADER = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uSource;      // current source pixels (preview proxy or export tile)
uniform sampler2D uBlurFine;    // source blurred ~0.3% of the long edge
uniform sampler2D uBlurWide;    // source blurred ~2% of the long edge
uniform sampler2D uCurveLut;    // baked tone curves, 1024 x 1

uniform vec4 uTileRect;         // xy offset, zw scale: vUv -> output uv
uniform vec3 uOutToSrcX;        // output uv -> source uv, first row
uniform vec3 uOutToSrcY;        // output uv -> source uv, second row
uniform vec4 uSourceRect;       // xy offset, zw scale: source uv -> uSource uv
uniform vec2 uImageSize;        // output size in pixels
uniform vec2 uTexelStep;        // one source pixel in source uv, or one texel if coarser
uniform bool uHighQuality;      // texels do not align with output pixels: use a cubic filter
uniform bool uCheckBounds;      // straightened: pixels may fall outside the photo
uniform bool uShowClipping;
uniform float uDither;

uniform vec3  uWbGain;
uniform float uExposureGain;
uniform float uDehaze;
uniform vec3  uAirlight;
uniform float uContrast;
uniform float uHighlights;
uniform float uShadows;
uniform float uWhites;
uniform float uBlacks;
uniform float uTexture;
uniform float uClarity;
uniform float uSharpen;
uniform float uSharpenRadius;
uniform float uSharpenDetail;
uniform float uSharpenMasking;
uniform float uNoiseLuma;
uniform float uNoiseColor;
uniform bool  uMono;
uniform bool  uCurveOn;
uniform bool  uHslOn;
uniform vec3  uHsl[8];          // hue shift (degrees), sat factor, lum factor
uniform float uVibrance;
uniform float uSaturation;
uniform bool  uGradeOn;
uniform vec3  uGradeTint[3];    // shadows, midtones, highlights chroma offsets
uniform vec3  uGradeLum;
uniform float uBlending;
uniform float uBalance;
uniform float uVigAmount;
uniform float uVigMid;
uniform float uVigFeather;
uniform float uGrain;
uniform float uGrainSize;
uniform float uGrainRoughness;
uniform float uDitherSeed;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
// Hue anchors of the 8 mixer channels in degrees; the 9th closes the circle.
const float HUE_ANCHOR[9] = float[9](0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 270.0, 300.0, 360.0);

vec3 srgbToLinear(vec3 c) {
  vec3 lo = c / 12.92;
  vec3 hi = pow((c + 0.055) / 1.055, vec3(2.4));
  return mix(lo, hi, step(0.04045, c));
}

vec3 linearToSrgb(vec3 c) {
  c = max(c, vec3(0.0));
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(0.0031308, c));
}

vec3 rgbToHsl(vec3 c) {
  float hi = max(c.r, max(c.g, c.b));
  float lo = min(c.r, min(c.g, c.b));
  float l = (hi + lo) * 0.5;
  float d = hi - lo;
  if (d < 1e-5) return vec3(0.0, 0.0, l);
  float s = d / max(1.0 - abs(2.0 * l - 1.0), 1e-5);
  float h;
  if (hi == c.r) h = mod((c.g - c.b) / d, 6.0);
  else if (hi == c.g) h = (c.b - c.r) / d + 2.0;
  else h = (c.r - c.g) / d + 4.0;
  return vec3(h * 60.0, s, l);
}

vec3 hslToRgb(vec3 hsl) {
  float h = mod(hsl.x, 360.0) / 60.0;
  float c = (1.0 - abs(2.0 * hsl.z - 1.0)) * hsl.y;
  vec3 k = clamp(abs(mod(h + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return hsl.z + c * (k - 0.5);
}

vec3 applyMixer(vec3 c) {
  vec3 hsl = rgbToHsl(c);
  if (hsl.y <= 0.0) return c;
  int i = 0;
  while (i < 7 && hsl.x >= HUE_ANCHOR[i + 1]) i++;
  float t = (hsl.x - HUE_ANCHOR[i]) / (HUE_ANCHOR[i + 1] - HUE_ANCHOR[i]);
  vec3 p = mix(uHsl[i], uHsl[(i + 1) % 8], t);
  // Near-neutral pixels have an unstable hue, so fade the adjustment in.
  float chroma = smoothstep(0.0, 0.08, hsl.y * (1.0 - abs(2.0 * hsl.z - 1.0)));
  hsl.x += p.x * chroma;
  hsl.y = clamp(hsl.y * (1.0 + p.y * chroma), 0.0, 1.0);
  hsl.z = clamp(hsl.z * (1.0 + p.z * chroma * hsl.y), 0.0, 1.0);
  return hslToRgb(hsl);
}

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

// Catmull-Rom in 9 bilinear fetches: stays sharp when magnifying or rotating, and
// reproduces texel values exactly when it lands on texel centres.
vec4 sampleCubic(sampler2D tex, vec2 uv) {
  vec2 size = vec2(textureSize(tex, 0));
  vec2 pos = uv * size;
  vec2 base = floor(pos - 0.5) + 0.5;
  vec2 f = pos - base;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 t0 = (base - 1.0) / size;
  vec2 t3 = (base + 2.0) / size;
  vec2 t12 = (base + w2 / w12) / size;
  vec4 c = texture(tex, vec2(t0.x, t0.y)) * w0.x * w0.y
         + texture(tex, vec2(t12.x, t0.y)) * w12.x * w0.y
         + texture(tex, vec2(t3.x, t0.y)) * w3.x * w0.y
         + texture(tex, vec2(t0.x, t12.y)) * w0.x * w12.y
         + texture(tex, vec2(t12.x, t12.y)) * w12.x * w12.y
         + texture(tex, vec2(t3.x, t12.y)) * w3.x * w12.y
         + texture(tex, vec2(t0.x, t3.y)) * w0.x * w3.y
         + texture(tex, vec2(t12.x, t3.y)) * w12.x * w3.y
         + texture(tex, vec2(t3.x, t3.y)) * w3.x * w3.y;
  return clamp(c, 0.0, 1.0);
}

// Cubic B-spline in 4 bilinear fetches. The blur textures are small, and plain bilinear
// upscaling of them leaves a visible grid in anything derived from them.
vec4 sampleSmooth(sampler2D tex, vec2 uv) {
  vec2 size = vec2(textureSize(tex, 0));
  vec2 pos = uv * size - 0.5;
  vec2 i = floor(pos);
  vec2 f = pos - i;
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 g0 = w0 + w1;
  vec2 g1 = w2 + w3;
  vec2 h0 = (i - 0.5 + w1 / g0) / size;
  vec2 h1 = (i + 1.5 + w3 / g1) / size;
  return (texture(tex, vec2(h0.x, h0.y)) * g0.x + texture(tex, vec2(h1.x, h0.y)) * g1.x) * g0.y
       + (texture(tex, vec2(h0.x, h1.y)) * g0.x + texture(tex, vec2(h1.x, h1.y)) * g1.x) * g1.y;
}

vec3 tap(vec2 srcUv) {
  return texture(uSource, uSourceRect.xy + srcUv * uSourceRect.zw).rgb;
}

// Edge-preserving smoothing: nearby pixels count only if their tone is close.
vec3 reduceLumaNoise(vec3 center, vec2 uv) {
  float sigma = 0.012 + 0.1 * uNoiseLuma;
  float centerLuma = dot(center, LUMA);
  vec3 sum = center;
  float total = 1.0;
  for (int ring = 1; ring <= 2; ring++) {
    float radius = float(ring) * (1.0 + uNoiseLuma);
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.78539816 + float(ring) * 0.39269908;
      vec3 s = tap(uv + vec2(cos(a), sin(a)) * radius * uTexelStep);
      float d = (dot(s, LUMA) - centerLuma) / sigma;
      float weight = exp(-d * d) * (ring == 1 ? 1.0 : 0.6);
      sum += s * weight;
      total += weight;
    }
  }
  vec3 smoothed = sum / total;
  // Replaces only tone, so the colour of the pixel survives.
  return center + (dot(smoothed, LUMA) - centerLuma) * min(uNoiseLuma * 1.4, 1.0);
}

void main() {
  vec2 outUv = uTileRect.xy + vUv * uTileRect.zw;
  vec2 uv = vec2(dot(uOutToSrcX, vec3(outUv, 1.0)), dot(uOutToSrcY, vec3(outUv, 1.0)));
  if (uCheckBounds && (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0)) {
    outColor = vec4(0.0);
    return;
  }
  vec2 sourceUv = uSourceRect.xy + uv * uSourceRect.zw;
  vec4 texel = uHighQuality ? sampleCubic(uSource, sourceUv) : texture(uSource, sourceUv);
  vec3 srcGamma = texel.rgb;
  vec3 fine = sampleSmooth(uBlurFine, uv).rgb;
  vec3 wide = sampleSmooth(uBlurWide, uv).rgb;

  // --- Noise reduction runs first, so later stages do not amplify what it removes.
  if (uNoiseColor > 0.0) {
    // Takes colour from the blur except across a real edge in tone.
    float edge = abs(dot(srcGamma, LUMA) - dot(fine, LUMA));
    float keep = smoothstep(0.02, 0.14, edge);
    vec3 chroma = fine - dot(fine, LUMA);
    vec3 smoothed = dot(srcGamma, LUMA) + chroma;
    srcGamma = mix(srcGamma, clamp(smoothed, 0.0, 1.0), uNoiseColor * (1.0 - keep));
  }
  if (uNoiseLuma > 0.0) srcGamma = reduceLumaNoise(srcGamma, uv);

  float srcLuma = dot(srcGamma, LUMA);
  float wideLuma = dot(wide, LUMA);

  // --- Linear light: white balance, dehaze, exposure.
  vec3 c = srgbToLinear(srcGamma) * uWbGain;

  if (uDehaze != 0.0) {
    vec3 hazeSrc = srgbToLinear(wide) / max(uAirlight, vec3(0.05));
    float dark = clamp(min(hazeSrc.r, min(hazeSrc.g, hazeSrc.b)), 0.0, 1.0);
    if (uDehaze > 0.0) {
      float t = max(1.0 - uDehaze * 0.75 * dark, 0.15);
      c = (c - uAirlight) / t + uAirlight;
    } else {
      c = mix(c, uAirlight, -uDehaze * 0.4 * (1.0 - 0.5 * dark));
    }
  }
  c = max(c, vec3(0.0)) * uExposureGain;

  // --- Display-referred from here on.
  c = linearToSrgb(c);

  // Tone: masks mix pixel and wide-blur luma, keeping edges while limiting halos.
  float luma = dot(c, LUMA);
  float mask = mix(luma, wideLuma + (luma - srcLuma), 0.5);
  float toned = luma;
  toned += uHighlights * 0.34 * smoothstep(0.45, 0.95, mask);
  toned += uShadows * 0.32 * (1.0 - smoothstep(0.04, 0.55, mask)) * smoothstep(0.0, 0.08, luma);
  float whiteMask = smoothstep(0.55, 1.0, luma);
  toned += uWhites * 0.22 * whiteMask * whiteMask;
  float blackMask = 1.0 - smoothstep(0.0, 0.35, luma);
  toned += uBlacks * 0.16 * blackMask * blackMask;

  // Local detail bands measured on the untouched source.
  float mid = 1.0 - pow(abs(2.0 * clamp(toned, 0.0, 1.0) - 1.0), 2.0);
  float clarity = srcLuma - wideLuma;
  toned += uClarity * 0.9 * (clarity / (1.0 + 3.0 * abs(clarity))) * (0.25 + 0.75 * mid);
  float texBand = srcLuma - dot(fine, LUMA);
  toned += uTexture * 1.1 * (texBand / (1.0 + 6.0 * abs(texBand)));
  if (uSharpen > 0.0) {
    // Unsharp mask on luma with a radius in source pixels, so 1:1 preview matches export.
    vec2 s = uTexelStep * uSharpenRadius;
    vec3 n = tap(uv + vec2(s.x, 0.0)) + tap(uv - vec2(s.x, 0.0))
           + tap(uv + vec2(0.0, s.y)) + tap(uv - vec2(0.0, s.y));
    vec3 d = tap(uv + s) + tap(uv - s) + tap(uv + vec2(s.x, -s.y)) + tap(uv + vec2(-s.x, s.y));
    float edge = srcLuma - dot((srcGamma * 4.0 + n * 2.0 + d) / 16.0, LUMA);
    // Detail: low values suppress halos by limiting strong edges; high values let them through.
    float limit = mix(16.0, 1.5, uSharpenDetail);
    float amount = uSharpen * 1.6 * (edge / (1.0 + limit * abs(edge)));
    // Masking: protects smooth areas (skies, skin) by sharpening only real edges.
    if (uSharpenMasking > 0.0) {
      float grad = length(vec2(
        dot(tap(uv + vec2(s.x, 0.0)) - tap(uv - vec2(s.x, 0.0)), LUMA),
        dot(tap(uv + vec2(0.0, s.y)) - tap(uv - vec2(0.0, s.y)), LUMA)));
      amount *= smoothstep(0.0, uSharpenMasking * 0.22 + 1e-4, grad);
    }
    toned += amount;
  }

  // Half additive, half ratio: keeps colour in lifted shadows without hue shifts
  // in pulled highlights.
  float deltaLuma = toned - luma;
  vec3 ratio = luma > 0.002 ? c * (max(toned, 0.0) / luma) : c + deltaLuma;
  c = mix(c + deltaLuma, ratio, 0.5);

  // Contrast: S-curve around mid grey, per channel like a real tone curve.
  if (uContrast != 0.0) {
    vec3 x = clamp(c, 0.0, 1.0);
    if (uContrast > 0.0) {
      vec3 s = x * x * (3.0 - 2.0 * x);
      c = mix(c, s, uContrast);
    } else {
      c = mix(c, 0.5 + (x - 0.5) * 0.5, -uContrast);
    }
  }
  c = clamp(c, 0.0, 1.0);

  // --- Tone curve. Half-texel inset so 0 and 1 land on the first and last entries.
  if (uCurveOn) {
    const float scale = 1023.0 / 1024.0;
    const float offset = 0.5 / 1024.0;
    c = vec3(
      texture(uCurveLut, vec2(c.r * scale + offset, 0.5)).r,
      texture(uCurveLut, vec2(c.g * scale + offset, 0.5)).g,
      texture(uCurveLut, vec2(c.b * scale + offset, 0.5)).b
    );
  }

  // --- Colour.
  if (uHslOn) c = applyMixer(c);

  if (uVibrance != 0.0) {
    float hi = max(c.r, max(c.g, c.b));
    float lo = min(c.r, min(c.g, c.b));
    float sat = hi - lo;
    // Protect skin: orange-ish hues (R > G > B) get half the boost.
    float skin = step(c.b, c.g) * step(c.g, c.r) * smoothstep(0.0, 0.2, sat) * (1.0 - smoothstep(0.35, 0.7, sat));
    float amount = uVibrance * (1.0 - sat) * (1.0 - sat) * (uVibrance > 0.0 ? 1.0 - 0.5 * skin : 1.0);
    c = mix(vec3(dot(c, LUMA)), c, 1.0 + amount);
  }
  if (uSaturation != 0.0) c = mix(vec3(dot(c, LUMA)), c, 1.0 + uSaturation);
  c = clamp(c, 0.0, 1.0);
  if (uMono) c = vec3(dot(c, LUMA));

  // --- Colour grading: three overlapping luminance zones.
  if (uGradeOn) {
    float x = pow(clamp(dot(c, LUMA), 0.0, 1.0), uBalance);
    float sh = 1.0 - smoothstep(0.2 - 0.2 * uBlending, 0.3 + 0.45 * uBlending, x);
    float hl = smoothstep(0.7 - 0.45 * uBlending, 0.8 + 0.2 * uBlending, x);
    float md = max(1.0 - sh - hl, 0.0);
    c += uGradeTint[0] * sh + uGradeTint[1] * md + uGradeTint[2] * hl;
    c += uGradeLum.x * sh + uGradeLum.y * md + uGradeLum.z * hl;
  }

  // --- Vignette: elliptical, follows the frame; radius 1 reaches the corners.
  if (uVigAmount != 0.0) {
    float d = length((outUv - 0.5) * 2.0) / 1.41421356;
    float inner = uVigMid * (1.0 - uVigFeather);
    float outer = uVigMid + (1.05 - uVigMid) * uVigFeather + 0.001;
    float v = smoothstep(inner, outer, d);
    c = uVigAmount < 0.0 ? c * (1.0 + uVigAmount * v) : mix(c, vec3(1.0), uVigAmount * v);
  }

  // --- Grain: anchored to image coordinates, so export matches preview.
  if (uGrain > 0.0) {
    vec2 p = outUv * vec2(uImageSize.x / max(uImageSize.x, uImageSize.y),
                          uImageSize.y / max(uImageSize.x, uImageSize.y)) * (2400.0 / (1.0 + 3.0 * uGrainSize));
    float rough = 0.15 + 0.5 * uGrainRoughness;
    float g = valueNoise(p) * (1.0 - rough) + valueNoise(p * 2.13 + 17.0) * rough - 0.5;
    float l = clamp(dot(c, LUMA), 0.0, 1.0);
    c += g * uGrain * 0.42 * (0.35 + 0.65 * (1.0 - abs(2.0 * l - 1.0)));
  }

  c = clamp(c, 0.0, 1.0);
  if (uShowClipping) {
    if (max(c.r, max(c.g, c.b)) > 254.5 / 255.0) c = vec3(1.0, 0.1, 0.1);
    else if (max(c.r, max(c.g, c.b)) < 0.5 / 255.0) c = vec3(0.1, 0.35, 1.0);
  }
  // Sub-LSB dither hides banding from 8-bit output. An unedited photo skips it, so its
  // pixels come out bit-exact.
  c += (hash(gl_FragCoord.xy + uDitherSeed) - 0.5) * uDither;
  outColor = vec4(c, texel.a);
}`;
