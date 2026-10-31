// All GLSL lives here. Pipeline, in order:
//   sRGB decode -> white balance -> dehaze -> exposure -> sRGB encode ->
//   tone (highlights/shadows/whites/blacks) -> local detail (texture/clarity/
//   sharpen) -> contrast -> tone curve LUT -> HSL mixer -> vibrance/saturation ->
//   color grading -> vignette -> grain -> dither.
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

uniform vec4 uTileRect;         // xy offset, zw scale: vUv -> whole-image uv
uniform vec4 uSourceRect;       // xy offset, zw scale: whole-image uv -> uSource uv
uniform vec2 uImageSize;        // whole image size in pixels
uniform vec2 uSharpenStep;      // sharpen kernel radius, whole-image uv

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

void main() {
  vec2 uv = uTileRect.xy + vUv * uTileRect.zw;
  vec4 texel = texture(uSource, uSourceRect.xy + uv * uSourceRect.zw);
  vec3 srcGamma = texel.rgb;
  vec3 fine = texture(uBlurFine, uv).rgb;
  vec3 wide = texture(uBlurWide, uv).rgb;
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
    vec2 s = uSharpenStep;
    vec2 m = uSourceRect.zw;
    vec2 o = uSourceRect.xy;
    vec3 n = texture(uSource, o + (uv + vec2( s.x, 0.0)) * m).rgb
           + texture(uSource, o + (uv + vec2(-s.x, 0.0)) * m).rgb
           + texture(uSource, o + (uv + vec2(0.0,  s.y)) * m).rgb
           + texture(uSource, o + (uv + vec2(0.0, -s.y)) * m).rgb;
    vec3 d = texture(uSource, o + (uv + s) * m).rgb
           + texture(uSource, o + (uv - s) * m).rgb
           + texture(uSource, o + (uv + vec2(s.x, -s.y)) * m).rgb
           + texture(uSource, o + (uv + vec2(-s.x, s.y)) * m).rgb;
    float edge = srcLuma - dot((srcGamma * 4.0 + n * 2.0 + d) / 16.0, LUMA);
    toned += uSharpen * 1.6 * (edge / (1.0 + 10.0 * abs(edge)));
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
    float d = length((uv - 0.5) * 2.0) / 1.41421356;
    float inner = uVigMid * (1.0 - uVigFeather);
    float outer = uVigMid + (1.05 - uVigMid) * uVigFeather + 0.001;
    float v = smoothstep(inner, outer, d);
    c = uVigAmount < 0.0 ? c * (1.0 + uVigAmount * v) : mix(c, vec3(1.0), uVigAmount * v);
  }

  // --- Grain: anchored to image coordinates, so export matches preview.
  if (uGrain > 0.0) {
    vec2 p = uv * vec2(uImageSize.x / max(uImageSize.x, uImageSize.y),
                       uImageSize.y / max(uImageSize.x, uImageSize.y)) * 1400.0;
    float g = valueNoise(p) * 0.65 + valueNoise(p * 2.13 + 17.0) * 0.35 - 0.5;
    float l = clamp(dot(c, LUMA), 0.0, 1.0);
    c += g * uGrain * 0.42 * (0.35 + 0.65 * (1.0 - abs(2.0 * l - 1.0)));
  }

  // Sub-LSB dither hides banding from 8-bit output without changing exact values.
  c = clamp(c, 0.0, 1.0);
  c += (hash(gl_FragCoord.xy + uDitherSeed) - 0.5) * (0.98 / 255.0);
  outColor = vec4(c, texel.a);
}`;
