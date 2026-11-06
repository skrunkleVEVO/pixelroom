// Runs the colour adjustments on the GPU (WebGL 1, for the widest phone support).
// Geometry, backgrounds, vignette, grain and text are drawn afterwards in 2D by compose.ts.
import type { Look } from './adjust';
import { isPixelNeutral } from './adjust';
import { createCanvas, releaseCanvas, resizeTo } from './image';

const VERTEX = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  // Texture row 0 is the top of the image, so no flipY is needed (ImageBitmap ignores it).
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uBrightness, uContrast, uSaturation, uVibrance, uWarmth, uTint;
uniform float uHighlights, uShadows, uFade, uSharpen, uMono;
uniform vec3 uShadowTint, uHighlightTint;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec4 src = texture2D(uTex, vUv);
  vec3 c = src.rgb;

  if (uSharpen > 0.0) {
    vec3 n = texture2D(uTex, vUv + vec2(uTexel.x, 0.0)).rgb
           + texture2D(uTex, vUv - vec2(uTexel.x, 0.0)).rgb
           + texture2D(uTex, vUv + vec2(0.0, uTexel.y)).rgb
           + texture2D(uTex, vUv - vec2(0.0, uTexel.y)).rgb;
    c = clamp(c + (c - n * 0.25) * uSharpen * 1.6, 0.0, 1.0);
  }

  // White balance.
  c *= vec3(1.0 + uWarmth * 0.12, 1.0 - uTint * 0.1, 1.0 - uWarmth * 0.12);
  c = clamp(c, 0.0, 1.0);

  // Brightness as a midtone gamma, so it never clips.
  c = pow(c, vec3(exp2(-uBrightness * 0.85)));

  // Highlights and shadows on luminance.
  float L = luma(c);
  float sh = 1.0 - smoothstep(0.0, 0.6, L);
  float hi = smoothstep(0.4, 1.0, L);
  c += uShadows * 0.32 * sh + uHighlights * 0.28 * hi;
  c = clamp(c, 0.0, 1.0);

  // Contrast: an S-curve when positive, flattening toward grey when negative.
  if (uContrast > 0.0) c = mix(c, c * c * (3.0 - 2.0 * c), uContrast);
  else c = mix(c, vec3(0.5), -uContrast * 0.45);

  // Saturation, then vibrance (which spares already-saturated colours).
  L = luma(c);
  c = mix(vec3(L), c, 1.0 + uSaturation);
  float sat = max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
  c = mix(vec3(L), c, 1.0 + uVibrance * (1.0 - clamp(sat, 0.0, 1.0)));
  c = clamp(c, 0.0, 1.0);

  c = mix(c, vec3(luma(c)), uMono);

  // Split toning.
  L = luma(c);
  c += uShadowTint * (1.0 - L) * (1.0 - L) + uHighlightTint * L * L;

  // Fade lifts the blacks and softens the whites.
  c = c * (1.0 - uFade * 0.22) + uFade * 0.1;

  gl_FragColor = vec4(clamp(c, 0.0, 1.0), src.a);
}`;

const UNIFORMS = [
  'uTexel',
  'uBrightness',
  'uContrast',
  'uSaturation',
  'uVibrance',
  'uWarmth',
  'uTint',
  'uHighlights',
  'uShadows',
  'uFade',
  'uSharpen',
  'uMono',
  'uShadowTint',
  'uHighlightTint',
] as const;

type Source = ImageBitmap | HTMLCanvasElement;

class Processor {
  readonly canvas = createCanvas(1, 1);
  private gl: WebGLRenderingContext | null = null;
  private loc = {} as Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;
  private texture: WebGLTexture | null = null;
  private uploaded: Source | null = null;
  private failed = false;
  maxSize = 4096;

  constructor() {
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.gl = null;
      this.uploaded = null;
    });
    this.canvas.addEventListener('webglcontextrestored', () => this.init());
    this.init();
  }

  get available(): boolean {
    return !this.failed;
  }

  private init(): void {
    const gl = this.canvas.getContext('webgl', {
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      antialias: false,
    });
    if (!gl) {
      this.failed = true;
      return;
    }
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    try {
      const program = gl.createProgram()!;
      gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link');
      gl.useProgram(program);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const aPos = gl.getAttribLocation(program, 'aPos');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
      for (const name of UNIFORMS) this.loc[name] = gl.getUniformLocation(program, name);
      this.texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      const dims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
      this.maxSize = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE) as number, dims[0], dims[1], 8192);
      this.gl = gl;
      this.uploaded = null;
    } catch (error) {
      console.warn('WebGL setup failed; adjustments are off.', error);
      this.failed = true;
    }
  }

  /**
   * Draws `source` with `look` applied at width x height. Returns a canvas holding the
   * result, valid until the next call. `source` is resized first when it differs.
   */
  process(source: Source, width: number, height: number, look: Look): HTMLCanvasElement {
    width = Math.max(1, Math.min(Math.round(width), this.maxSize));
    height = Math.max(1, Math.min(Math.round(height), this.maxSize));
    let input: Source = source;
    if (source.width !== width || source.height !== height) input = resizeTo(source, width, height);

    if (!this.gl && !this.failed) this.init();
    const gl = this.gl;
    if (!gl || isPixelNeutral(look)) {
      if (input instanceof HTMLCanvasElement && input !== source) return input;
      const out = createCanvas(width, height);
      out.getContext('2d')!.drawImage(input, 0, 0, width, height);
      return out;
    }

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    if (this.uploaded !== input) {
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, input);
      this.uploaded = input;
    }
    const l = this.loc;
    gl.uniform2f(l.uTexel, 1 / width, 1 / height);
    gl.uniform1f(l.uBrightness, look.brightness);
    gl.uniform1f(l.uContrast, look.contrast);
    gl.uniform1f(l.uSaturation, look.saturation);
    gl.uniform1f(l.uVibrance, look.vibrance);
    gl.uniform1f(l.uWarmth, look.warmth);
    gl.uniform1f(l.uTint, look.tint);
    gl.uniform1f(l.uHighlights, look.highlights);
    gl.uniform1f(l.uShadows, look.shadows);
    gl.uniform1f(l.uFade, look.fade);
    gl.uniform1f(l.uSharpen, look.sharpen);
    gl.uniform1f(l.uMono, look.mono);
    gl.uniform3fv(l.uShadowTint, look.shadowTint);
    gl.uniform3fv(l.uHighlightTint, look.highlightTint);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (input !== source && input instanceof HTMLCanvasElement) {
      // A temporary resize: free it now rather than whenever the GC gets to it.
      releaseCanvas(input);
      this.uploaded = null;
    }
    return this.canvas;
  }

  /** Forget the uploaded texture, e.g. after the source it came from is released. */
  release(): void {
    this.uploaded = null;
  }
}

let instance: Processor | null = null;

export function processor(): Processor {
  instance ??= new Processor();
  return instance;
}
