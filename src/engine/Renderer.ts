import { LUT_SIZE, buildCurveLut } from './curves';
import { whiteBalanceGains } from './auto';
import {
  affineToGl,
  applyAffine,
  isPixelAligned,
  outputSize,
  outputToSource,
  type Geometry,
} from './geometry';
import { insertExif } from './metadata';
import {
  HSL_CHANNELS,
  GRADE_ZONES,
  defaultParams,
  isToneNeutral,
  type EditParams,
  type GradeValue,
} from './params';
import { BLUR_SHADER, MAIN_SHADER, VERTEX_SHADER } from './shaders';
import { FIT_VIEW, imageRect, intersect, panes, type Rect, type ViewState } from './view';

// Blur textures have a fixed size whatever the photo size. That keeps them cheap
// and makes clarity, texture and dehaze look identical in preview and in export.
const BLUR_FINE_EDGE = 640;
const BLUR_WIDE_EDGE = 160;
const EXPORT_TILE = 2048;
/** Source pixels around each export tile: largest sampling radius plus the cubic filter. */
const EXPORT_PADDING = 12;
/** Largest image kept as a resampled fit-view texture, in pixels. */
const MAX_RESAMPLED_PIXELS = 64_000_000;
const DETAIL_DELAY_MS = 90;
const ANALYSIS_EDGE = 320;
const ANALYSIS_DELAY_MS = 80;
const FIT_MARGIN_CSS = 14;
const DITHER = 0.98 / 255;

export type ImageSource = ImageBitmap | HTMLCanvasElement;

export interface ExportOptions {
  type: 'image/jpeg' | 'image/png' | 'image/webp';
  /** 0-1. */
  quality: number;
  /** Resize so the long edge is at most this; never enlarges. */
  longEdge?: number;
  /** Builds the EXIF payload for the file, given the final pixel size. */
  exif?: (width: number, height: number) => Uint8Array | null;
  onProgress?: (fraction: number) => void;
}

export interface Analysis {
  red: Uint32Array;
  green: Uint32Array;
  blue: Uint32Array;
  luma: Uint32Array;
  /** Share of pixels clipped to black / to white. */
  clipLow: number;
  clipHigh: number;
}

export interface DisplayState {
  params: EditParams;
  view: ViewState;
  split: boolean;
  peek: boolean;
  /** Crop tool open: show the whole straightened frame, not the crop. */
  framing: boolean;
  showClipping: boolean;
}

interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  width: number;
  height: number;
}

interface ActiveTexture {
  tex: WebGLTexture;
  /** The part of the source it holds, in source pixels. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Texture size in texels. */
  width: number;
  height: number;
  /** Device pixels per source pixel this was made for. */
  scale: number;
}

type Uniforms = Record<string, WebGLUniformLocation | null>;

const NEUTRAL = defaultParams();

function hueToChroma(hue: number): [number, number, number] {
  const h = (((hue % 360) + 360) % 360) / 60;
  const f = (n: number) => {
    const k = (n + h) % 6;
    return 1 - Math.max(0, Math.min(k, 4 - k, 1));
  };
  const r = f(5);
  const g = f(3);
  const b = f(1);
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [r - luma, g - luma, b - luma];
}

/**
 * Reduces an image without aliasing, by halving until within a factor of two of the
 * target and then finishing with a high-quality draw. Do not replace this with
 * createImageBitmap's resizeQuality: Chrome's result aliases badly on large reductions.
 */
function downscale(source: CanvasImageSource, fromW: number, fromH: number, width: number, height: number): HTMLCanvasElement {
  let step = source;
  let sw = fromW;
  let sh = fromH;
  const draw = (w: number, h: number) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: false });
    if (!ctx) throw new Error('Could not allocate a canvas.');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(step, 0, 0, w, h);
    return c;
  };
  while (sw > width * 2 || sh > height * 2) {
    sw = Math.max(width, Math.ceil(sw / 2));
    sh = Math.max(height, Math.ceil(sh / 2));
    step = draw(sw, sh);
  }
  return draw(width, height);
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The browser could not encode this image.'))),
      type,
      quality,
    );
  });
}

function encodeJpeg(image: ImageData, quality: number): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./encodeWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{ jpeg?: ArrayBuffer; error?: string }>) => {
      worker.terminate();
      if (event.data.jpeg) resolve(event.data.jpeg);
      else reject(new Error(event.data.error ?? 'JPEG encoding failed.'));
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error('The JPEG encoder could not start.'));
    };
    // Transferred, not copied: a phone may not have room for two full-size buffers.
    const rgba = image.data.buffer as ArrayBuffer;
    worker.postMessage({ rgba, width: image.width, height: image.height, quality }, [rgba]);
  });
}

/**
 * Owns the WebGL2 context. Source pixels are only ever read: the original stays
 * in `source` untouched, and every edit is a re-run of the fragment shader.
 *
 * The canvas matches the stage in device pixels and the shader draws straight to it,
 * so the browser never rescales the picture. A mipmapped proxy gives instant response;
 * once the view settles a texture made for that exact scale replaces it: a high-quality
 * resample when zoomed out, the original pixels at 1:1 and beyond.
 */
export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private gl!: WebGL2RenderingContext;
  private mainProgram!: WebGLProgram;
  private blurProgram!: WebGLProgram;
  private main: Uniforms = {};
  private blur: Uniforms = {};
  private vao!: WebGLVertexArrayObject;
  private lutTex!: WebGLTexture;
  private proxy: ActiveTexture | null = null;
  private detail: ActiveTexture | null = null;
  private blurFine: Target | null = null;
  private blurWide: Target | null = null;
  private analysisTarget: Target | null = null;
  private lut = new Float32Array(LUT_SIZE * 4);
  private lutKey = '';
  private blurFormat: { internal: number; type: number } = { internal: 0, type: 0 };
  private airlight: [number, number, number] = [1, 1, 1];

  private source: ImageSource | null = null;
  private proxyCanvas: HTMLCanvasElement | null = null;
  private dpr = 1;
  private display: DisplayState = {
    params: defaultParams(),
    view: FIT_VIEW,
    split: false,
    peek: false,
    framing: false,
    showClipping: false,
  };
  private frame = 0;
  private lost = false;
  private exporting = false;
  private readonly maxProxyEdge: number;
  private detailTimer = 0;
  private detailJob = 0;
  private analysisTimer = 0;
  private analysisPixels: Uint8Array | null = null;
  private analysisSize: [number, number] = [0, 0];

  /** Called with fresh histogram data after edits settle. */
  onAnalysis: ((analysis: Analysis) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.maxProxyEdge = matchMedia('(pointer: coarse)').matches ? 1600 : 2560;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      this.initGl();
      if (this.source) this.setImage(this.source);
    });
    this.initGl();
  }

  private initGl(): void {
    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      // Lets the histogram readout sample the visible picture at any time.
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;

    // Half-float blur targets avoid banding in the detail bands; RGBA8 still works.
    const canRenderFloat =
      gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float');
    this.blurFormat = canRenderFloat
      ? { internal: gl.RGBA16F, type: gl.HALF_FLOAT }
      : { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE };

    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);

    this.mainProgram = this.link(VERTEX_SHADER, MAIN_SHADER);
    this.blurProgram = this.link(VERTEX_SHADER, BLUR_SHADER);
    this.main = this.locations(this.mainProgram);
    this.blur = this.locations(this.blurProgram);

    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    if (!vao || !vbo) throw new Error('Could not allocate WebGL buffers.');
    this.vao = vao;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.lutTex = this.createTexture(gl.LINEAR);
    this.lutKey = '';
    this.proxy = null;
    this.detail = null;
    this.blurFine = null;
    this.blurWide = null;
    this.analysisTarget = null;
  }

  private link(vsSource: string, fsSource: string): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('Could not create shader.');
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(shader)}`);
      }
      return shader;
    };
    const program = gl.createProgram();
    if (!program) throw new Error('Could not create program.');
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vsSource));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fsSource));
    gl.bindAttribLocation(program, 0, 'aPos');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error(`Shader link failed: ${gl.getProgramInfoLog(program)}`);
    }
    return program;
  }

  private locations(program: WebGLProgram): Uniforms {
    const gl = this.gl;
    const out: Uniforms = {};
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(program, i);
      if (!info) continue;
      const name = info.name.replace(/\[0\]$/, '');
      out[name] = gl.getUniformLocation(program, info.name);
    }
    return out;
  }

  private createTexture(filter: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) throw new Error('Could not allocate a texture.');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private createTarget(width: number, height: number, internal: number, type: number): Target {
    const gl = this.gl;
    const tex = this.createTexture(gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, gl.RGBA, type, null);
    const fbo = gl.createFramebuffer();
    if (!fbo) throw new Error('Could not allocate a framebuffer.');
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, width, height };
  }

  private deleteTarget(target: Target | null): void {
    if (!target) return;
    this.gl.deleteTexture(target.tex);
    this.gl.deleteFramebuffer(target.fbo);
  }

  /** Dimensions of a photo scaled so its long edge is at most `edge`. */
  private fit(width: number, height: number, edge: number): [number, number] {
    const scale = Math.min(1, edge / Math.max(width, height));
    return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
  }

  /** Sizes the canvas to the stage. Sizes are CSS pixels; the buffer uses device pixels. */
  setLayout(cssWidth: number, cssHeight: number, dpr: number): void {
    const width = Math.max(1, Math.round(cssWidth * dpr));
    const height = Math.max(1, Math.round(cssHeight * dpr));
    this.dpr = dpr;
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.requestRender();
  }

  setDisplay(display: Partial<DisplayState>): void {
    const paramsChanged = display.params !== undefined && display.params !== this.display.params;
    this.display = { ...this.display, ...display };
    this.requestRender();
    if (paramsChanged) this.scheduleAnalysis();
  }

  /** Stores the original and builds the proxy texture and fixed-size blurs. */
  setImage(source: ImageSource): void {
    const gl = this.gl;
    this.source = source;
    this.detailJob++;
    const maxEdge = Math.min(this.maxProxyEdge, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
    const [w, h] = this.fit(source.width, source.height, maxEdge);

    const proxy = downscale(source, source.width, source.height, w, h);
    this.proxyCanvas = proxy;

    if (this.proxy) gl.deleteTexture(this.proxy.tex);
    this.clearDetail();
    const tex = this.createTexture(gl.LINEAR_MIPMAP_LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, proxy);
    gl.generateMipmap(gl.TEXTURE_2D); // the blur passes downsample through these
    this.proxy = {
      tex,
      sx: 0,
      sy: 0,
      sw: source.width,
      sh: source.height,
      width: w,
      height: h,
      scale: w / source.width,
    };

    this.buildBlurs(w, h);
    this.estimateAirlight(proxy);
    this.requestRender();
    this.scheduleAnalysis();
  }

  private clearDetail(): void {
    if (this.detail) this.gl.deleteTexture(this.detail.tex);
    this.detail = null;
  }

  private buildBlurs(w: number, h: number): void {
    const gl = this.gl;
    const { internal, type } = this.blurFormat;
    this.deleteTarget(this.blurFine);
    this.deleteTarget(this.blurWide);

    const make = (edge: number, passes: number, input: WebGLTexture): Target => {
      const [tw, th] = this.fit(w, h, edge);
      const a = this.createTarget(tw, th, internal, type);
      const b = this.createTarget(tw, th, internal, type);
      gl.useProgram(this.blurProgram);
      gl.bindVertexArray(this.vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(this.blur.uTex, 0);
      gl.viewport(0, 0, tw, th);
      let from = input;
      for (let i = 0; i < passes; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, a.fbo);
        gl.bindTexture(gl.TEXTURE_2D, from);
        gl.uniform2f(this.blur.uStep, 1 / tw, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.FRAMEBUFFER, b.fbo);
        gl.bindTexture(gl.TEXTURE_2D, a.tex);
        gl.uniform2f(this.blur.uStep, 0, 1 / th);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        from = b.tex;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.deleteTarget(a);
      gl.bindTexture(gl.TEXTURE_2D, b.tex);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      return b;
    };

    if (!this.proxy) return;
    this.blurFine = make(BLUR_FINE_EDGE, 1, this.proxy.tex);
    this.blurWide = make(BLUR_WIDE_EDGE, 3, this.blurFine.tex);
  }

  /** Haze colour for dehaze: the bright end of each channel on a tiny thumbnail. */
  private estimateAirlight(proxy: HTMLCanvasElement): void {
    const size = 48;
    const thumb = document.createElement('canvas');
    thumb.width = size;
    thumb.height = size;
    const ctx = thumb.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(proxy, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);
    const channels: number[][] = [[], [], []];
    for (let i = 0; i < data.length; i += 4) {
      channels[0].push(data[i]);
      channels[1].push(data[i + 1]);
      channels[2].push(data[i + 2]);
    }
    const toLinear = (v: number) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const pick = (values: number[]) => {
      values.sort((a, b) => a - b);
      return Math.max(0.2, toLinear(values[Math.floor(values.length * 0.97)]));
    };
    this.airlight = [pick(channels[0]), pick(channels[1]), pick(channels[2])];
  }

  private uploadUniforms(p: EditParams): void {
    const gl = this.gl;
    const u = this.main;

    const key = JSON.stringify(p.curve);
    if (key !== this.lutKey) {
      buildCurveLut(p.curve, this.lut);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, LUT_SIZE, 1, 0, gl.RGBA, gl.FLOAT, this.lut);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      this.lutKey = key;
    }
    const isIdentity = (pts: EditParams['curve']['rgb']) =>
      pts[0][0] === 0 && pts[pts.length - 1][0] === 255 && pts.every(([x, y]) => x === y);
    gl.uniform1i(
      u.uCurveOn,
      [p.curve.rgb, p.curve.red, p.curve.green, p.curve.blue].every(isIdentity) ? 0 : 1,
    );

    // White balance gains, normalised to roughly hold luminance.
    const [gainR, gainG, gainB] = whiteBalanceGains(p.color.temperature, p.color.tint);
    gl.uniform3f(u.uWbGain, gainR, gainG, gainB);

    gl.uniform1f(u.uExposureGain, Math.pow(2, p.light.exposure));
    gl.uniform1f(u.uDehaze, p.presence.dehaze / 100);
    gl.uniform3fv(u.uAirlight, this.airlight);
    gl.uniform1f(u.uContrast, p.light.contrast / 100);
    gl.uniform1f(u.uHighlights, p.light.highlights / 100);
    gl.uniform1f(u.uShadows, p.light.shadows / 100);
    gl.uniform1f(u.uWhites, p.light.whites / 100);
    gl.uniform1f(u.uBlacks, p.light.blacks / 100);
    gl.uniform1f(u.uTexture, p.presence.texture / 100);
    gl.uniform1f(u.uClarity, p.presence.clarity / 100);
    gl.uniform1f(u.uSharpen, p.effects.sharpening / 100);
    gl.uniform1f(u.uSharpenRadius, p.detail.sharpenRadius);
    gl.uniform1f(u.uSharpenDetail, p.detail.sharpenDetail / 100);
    gl.uniform1f(u.uSharpenMasking, p.detail.sharpenMasking / 100);
    gl.uniform1f(u.uNoiseLuma, p.detail.noiseLuma / 100);
    gl.uniform1f(u.uNoiseColor, p.detail.noiseColor / 100);
    gl.uniform1i(u.uMono, p.mono ? 1 : 0);

    const hsl = new Float32Array(8 * 3);
    let hslOn = false;
    HSL_CHANNELS.forEach((ch, i) => {
      const v = p.hsl[ch];
      if (v.hue || v.sat || v.lum) hslOn = true;
      hsl[i * 3] = (v.hue / 100) * 30; // +-100 moves +-30 degrees
      hsl[i * 3 + 1] = v.sat / 100;
      hsl[i * 3 + 2] = (v.lum / 100) * 0.6;
    });
    gl.uniform1i(u.uHslOn, hslOn ? 1 : 0);
    gl.uniform3fv(u.uHsl, hsl);

    gl.uniform1f(u.uVibrance, p.color.vibrance / 100);
    gl.uniform1f(u.uSaturation, p.color.saturation / 100);

    const zones: GradeValue[] = GRADE_ZONES.map((zone) => p.grading[zone]);
    const tints = new Float32Array(9);
    zones.forEach((zone, i) => {
      const [r, g, b] = hueToChroma(zone.hue);
      const strength = (zone.sat / 100) * 0.35;
      tints[i * 3] = r * strength;
      tints[i * 3 + 1] = g * strength;
      tints[i * 3 + 2] = b * strength;
    });
    gl.uniform1i(u.uGradeOn, zones.some((z) => z.sat !== 0 || z.lum !== 0) ? 1 : 0);
    gl.uniform3fv(u.uGradeTint, tints);
    gl.uniform3f(u.uGradeLum, (zones[0].lum / 100) * 0.3, (zones[1].lum / 100) * 0.3, (zones[2].lum / 100) * 0.3);
    gl.uniform1f(u.uBlending, p.grading.blending / 100);
    gl.uniform1f(u.uBalance, Math.pow(2, -p.grading.balance / 100));

    gl.uniform1f(u.uVigAmount, p.effects.vignetteAmount / 100);
    gl.uniform1f(u.uVigMid, 0.1 + 0.85 * (p.effects.vignetteMidpoint / 100));
    gl.uniform1f(u.uVigFeather, Math.max(p.effects.vignetteFeather / 100, 0.02));
    gl.uniform1f(u.uGrain, p.effects.grain / 100);
    gl.uniform1f(u.uGrainSize, p.effects.grainSize / 100);
    gl.uniform1f(u.uGrainRoughness, p.effects.grainRoughness / 100);
    gl.uniform1f(u.uDither, isToneNeutral(p) ? 0 : DITHER);
  }

  private bindForMain(sourceTex: WebGLTexture): void {
    const gl = this.gl;
    gl.useProgram(this.mainProgram);
    gl.bindVertexArray(this.vao);
    const bind = (unit: number, tex: WebGLTexture, loc: WebGLUniformLocation | null) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(loc, unit);
    };
    bind(1, this.blurFine?.tex ?? sourceTex, this.main.uBlurFine);
    bind(2, this.blurWide?.tex ?? sourceTex, this.main.uBlurWide);
    bind(3, this.lutTex, this.main.uCurveLut);
    bind(0, sourceTex, this.main.uSource);
  }

  /** The geometry drawn on screen: while cropping, the whole frame instead of the crop. */
  private shownGeometry(): Geometry {
    const g = this.display.params.geometry;
    return this.display.framing ? { ...g, x: 0, y: 0, w: 1, h: 1 } : g;
  }

  private setGeometryUniforms(g: Geometry, outW: number, outH: number): void {
    if (!this.source) return;
    const gl = this.gl;
    const [rowX, rowY] = affineToGl(outputToSource(g, this.source.width, this.source.height));
    gl.uniform3fv(this.main.uOutToSrcX, rowX);
    gl.uniform3fv(this.main.uOutToSrcY, rowY);
    gl.uniform2f(this.main.uImageSize, outW, outH);
    gl.uniform1i(this.main.uCheckBounds, g.angle !== 0 ? 1 : 0);
  }

  /** Points the shader at a texture holding a sub-rectangle of the source. */
  private setSourceTexture(t: ActiveTexture, highQuality: boolean): void {
    if (!this.source) return;
    const gl = this.gl;
    const { width, height } = this.source;
    const sx = width / t.sw;
    const sy = height / t.sh;
    // Texture rows are flipped on upload, so its origin is the rectangle's bottom edge.
    gl.uniform4f(this.main.uSourceRect, -(t.sx / width) * sx, -((height - t.sy - t.sh) / height) * sy, sx, sy);
    gl.uniform2f(this.main.uTexelStep, Math.max(1, t.sw / t.width) / width, Math.max(1, t.sh / t.height) / height);
    gl.uniform1i(this.main.uHighQuality, highQuality ? 1 : 0);
  }

  /** Schedules a repaint; many slider events per frame collapse into one draw. */
  private requestRender(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  /** Source pixels covered by part of the output, as [x, y, width, height], clamped and padded. */
  private sourceBounds(g: Geometry, u: number, v: number, du: number, dv: number, padding: number): [number, number, number, number] {
    const { width, height } = this.source as ImageSource;
    const m = outputToSource(g, width, height);
    const corners = [applyAffine(m, u, v), applyAffine(m, u + du, v), applyAffine(m, u, v + dv), applyAffine(m, u + du, v + dv)];
    const xs = corners.map((c) => c[0] * width);
    const ys = corners.map((c) => c[1] * height);
    const x0 = Math.max(0, Math.floor(Math.min(...xs)) - padding);
    const y0 = Math.max(0, Math.floor(Math.min(...ys)) - padding);
    const x1 = Math.min(width, Math.ceil(Math.max(...xs)) + padding);
    const y1 = Math.min(height, Math.ceil(Math.max(...ys)) + padding);
    return [x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)];
  }

  /** Immediate draw of the live preview. */
  private draw(): void {
    if (this.lost || this.exporting || !this.proxy || !this.source) return;
    const gl = this.gl;
    const d = this.display;
    const margin = Math.round(FIT_MARGIN_CSS * this.dpr);
    const g = this.shownGeometry();
    const out = outputSize(g, this.source.width, this.source.height);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const layout = panes(this.canvas.width, this.canvas.height, d.split);
    let settled = true;
    layout.forEach((pane, index) => {
      const before = d.split ? index === 0 : d.peek;
      const params = before ? NEUTRAL : d.params;
      const rect = imageRect(d.view, out.width, out.height, pane, margin);
      const visible = intersect(rect, pane);
      if (!visible) return;

      const u = (visible.x - rect.x) / rect.w;
      const v = (visible.y - rect.y) / rect.h;
      const du = visible.w / rect.w;
      const dv = visible.h / rect.h;

      const needed = this.sourceBounds(g, u, v, du, dv, 2);
      const texture = this.pickTexture(rect.scale, needed);
      if (texture === this.proxy) settled = false;

      gl.useProgram(this.mainProgram);
      this.uploadUniforms(params);
      this.bindForMain(texture.tex);
      this.setGeometryUniforms(g, out.width, out.height);
      // A proxy is only a stand-in during interaction: its mipmaps do the filtering.
      const exact = texture !== this.proxy && isPixelAligned(g) && rect.scale <= 1;
      this.setSourceTexture(texture, texture !== this.proxy && !exact);
      gl.uniform4f(this.main.uTileRect, u, 1 - v - dv, du, dv);
      gl.uniform1f(this.main.uDitherSeed, 0);
      gl.uniform1i(this.main.uShowClipping, d.showClipping && !before ? 1 : 0);
      gl.viewport(visible.x, this.canvas.height - visible.y - visible.h, visible.w, visible.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    });

    if (!settled) this.scheduleDetail();
  }

  private pickTexture(scale: number, needed: [number, number, number, number]): ActiveTexture {
    const t = this.detail;
    const proxy = this.proxy as ActiveTexture;
    if (!t) return proxy;
    if (Math.abs(t.scale - Math.min(scale, 1)) > 1e-6) return proxy;
    const [x, y, w, h] = needed;
    const covers = x >= t.sx && y >= t.sy && x + w <= t.sx + t.sw && y + h <= t.sy + t.sh;
    return covers ? t : proxy;
  }

  private scheduleDetail(): void {
    window.clearTimeout(this.detailTimer);
    this.detailTimer = window.setTimeout(() => this.buildDetail(), DETAIL_DELAY_MS);
  }

  /** Makes the texture for the settled view; see the class comment. */
  private buildDetail(): void {
    const source = this.source;
    if (!source || !this.proxy || this.lost) return;
    const job = ++this.detailJob;
    const g = this.shownGeometry();
    const out = outputSize(g, source.width, source.height);
    const margin = Math.round(FIT_MARGIN_CSS * this.dpr);
    const layout = panes(this.canvas.width, this.canvas.height, this.display.split);
    const pane = layout[layout.length - 1];
    const rect = imageRect(this.display.view, out.width, out.height, pane, margin);
    const scale = Math.min(rect.scale, 1);

    let canvas: HTMLCanvasElement;
    let sx = 0;
    let sy = 0;
    let sw = source.width;
    let sh = source.height;
    try {
      if (scale < 1) {
        const width = Math.max(1, Math.round(source.width * scale));
        const height = Math.max(1, Math.round(source.height * scale));
        if (width * height > MAX_RESAMPLED_PIXELS) return;
        // Start from the proxy whenever it is still sharper than the target: far quicker.
        const proxy = this.proxyCanvas;
        canvas =
          proxy && proxy.width >= width * 2
            ? downscale(proxy, proxy.width, proxy.height, width, height)
            : downscale(source, source.width, source.height, width, height);
      } else {
        // At 1:1 and beyond, the original pixels of the visible area plus room to pan.
        const visible = intersect(rect, pane) as Rect;
        const u = (visible.x - rect.x) / rect.w;
        const v = (visible.y - rect.y) / rect.h;
        const extra = Math.round(Math.max(visible.w, visible.h) / rect.scale / 2);
        [sx, sy, sw, sh] = this.sourceBounds(g, u, v, visible.w / rect.w, visible.h / rect.h, extra + 2);
        canvas = document.createElement('canvas');
        canvas.width = sw;
        canvas.height = sh;
        canvas.getContext('2d')?.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
      }
    } catch (error) {
      console.warn('Keeping the proxy: could not resample.', error);
      return;
    }

    if (job !== this.detailJob || this.source !== source || this.lost || this.exporting) return;
    const gl = this.gl;
    this.clearDetail();
    const tex = this.createTexture(gl.LINEAR);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    this.detail = { tex, sx, sy, sw, sh, width: canvas.width, height: canvas.height, scale };
    this.requestRender();
  }

  // ------------------------------------------------------------------ analysis

  private scheduleAnalysis(): void {
    window.clearTimeout(this.analysisTimer);
    this.analysisTimer = window.setTimeout(() => this.analyze(), ANALYSIS_DELAY_MS);
  }

  /** Renders the edit small and counts it, so the histogram always shows the output. */
  private analyze(): void {
    if (this.lost || this.exporting || !this.proxy || !this.source) return;
    const gl = this.gl;
    const g = this.display.params.geometry;
    const out = outputSize(g, this.source.width, this.source.height);
    const [w, h] = this.fit(out.width, out.height, ANALYSIS_EDGE);
    if (!this.analysisTarget || this.analysisTarget.width !== w || this.analysisTarget.height !== h) {
      this.deleteTarget(this.analysisTarget);
      this.analysisTarget = this.createTarget(w, h, gl.RGBA8, gl.UNSIGNED_BYTE);
    }
    gl.useProgram(this.mainProgram);
    this.uploadUniforms(this.display.params);
    this.bindForMain(this.proxy.tex);
    this.setGeometryUniforms(g, out.width, out.height);
    this.setSourceTexture(this.proxy, false);
    gl.uniform4f(this.main.uTileRect, 0, 0, 1, 1);
    gl.uniform1f(this.main.uDitherSeed, 0);
    gl.uniform1i(this.main.uShowClipping, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.analysisTarget.fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!this.analysisPixels || this.analysisPixels.length !== w * h * 4) {
      this.analysisPixels = new Uint8Array(w * h * 4);
    }
    const pixels = this.analysisPixels;
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.analysisSize = [w, h];

    const red = new Uint32Array(256);
    const green = new Uint32Array(256);
    const blue = new Uint32Array(256);
    const luma = new Uint32Array(256);
    let total = 0;
    let low = 0;
    let high = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] === 0) continue;
      const r = pixels[i];
      const gr = pixels[i + 1];
      const b = pixels[i + 2];
      red[r]++;
      green[gr]++;
      blue[b]++;
      luma[Math.round(0.2126 * r + 0.7152 * gr + 0.0722 * b)]++;
      total++;
      if (r === 255 || gr === 255 || b === 255) high++;
      if (r === 0 && gr === 0 && b === 0) low++;
    }
    this.onAnalysis?.({
      red,
      green,
      blue,
      luma,
      clipLow: total ? low / total : 0,
      clipHigh: total ? high / total : 0,
    });
  }

  /** Any edit of the open photo as a small JPEG data URL, without touching the display. */
  renderThumbnail(params: EditParams, edge = 144): string | null {
    if (this.lost || this.exporting || !this.proxy || !this.source) return null;
    const gl = this.gl;
    const g = params.geometry;
    const out = outputSize(g, this.source.width, this.source.height);
    const [w, h] = this.fit(out.width, out.height, edge);
    const target = this.createTarget(w, h, gl.RGBA8, gl.UNSIGNED_BYTE);
    gl.useProgram(this.mainProgram);
    this.uploadUniforms(params);
    this.bindForMain(this.proxy.tex);
    this.setGeometryUniforms(g, out.width, out.height);
    this.setSourceTexture(this.proxy, false);
    gl.uniform4f(this.main.uTileRect, 0, 0, 1, 1);
    gl.uniform1f(this.main.uDitherSeed, 0);
    gl.uniform1i(this.main.uShowClipping, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const pixels = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.deleteTarget(target);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const image = new ImageData(w, h);
    for (let y = 0; y < h; y++) {
      const from = (h - 1 - y) * w * 4;
      image.data.set(pixels.subarray(from, from + w * 4), y * w * 4);
    }
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.8);
  }

  /** The current edit as a small JPEG data URL, for thumbnails. */
  captureThumbnail(): string | null {
    const pixels = this.analysisPixels;
    const [w, h] = this.analysisSize;
    if (!pixels || !w || !h) return null;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const image = new ImageData(w, h);
    for (let y = 0; y < h; y++) {
      const from = (h - 1 - y) * w * 4;
      image.data.set(pixels.subarray(from, from + w * 4), y * w * 4);
    }
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.85);
  }

  /** The source thumbnail's pixels, for Auto Tone and Auto White Balance. */
  sourcePixels(edge = 256): Uint8ClampedArray | null {
    const proxy = this.proxyCanvas;
    if (!proxy) return null;
    const [w, h] = this.fit(proxy.width, proxy.height, edge);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(proxy, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
  }

  /** Maps a canvas position (CSS pixels) to the photo: output and source coordinates. */
  private locate(cssX: number, cssY: number): { deviceX: number; deviceY: number; s: number; t: number } | null {
    if (!this.source) return null;
    const x = Math.round(cssX * this.dpr);
    const y = Math.round(cssY * this.dpr);
    const g = this.shownGeometry();
    const out = outputSize(g, this.source.width, this.source.height);
    const margin = Math.round(FIT_MARGIN_CSS * this.dpr);
    const layout = panes(this.canvas.width, this.canvas.height, this.display.split);
    const pane = layout.find((p) => x >= p.x && y >= p.y && x < p.x + p.w && y < p.y + p.h) ?? layout[0];
    const rect = imageRect(this.display.view, out.width, out.height, pane, margin);
    const u = (x + 0.5 - rect.x) / rect.w;
    const v = (y + 0.5 - rect.y) / rect.h;
    if (u < 0 || v < 0 || u > 1 || v > 1) return null;
    const [s, t] = applyAffine(outputToSource(g, this.source.width, this.source.height), u, v);
    if (s < 0 || t < 0 || s > 1 || t > 1) return null;
    return { deviceX: x, deviceY: y, s, t };
  }

  /** The edited colour at a canvas position, 0-255, or null off the photo. */
  readEdited(cssX: number, cssY: number): [number, number, number] | null {
    const at = this.locate(cssX, cssY);
    if (!at || this.exporting) return null;
    const gl = this.gl;
    const px = new Uint8Array(4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(at.deviceX, this.canvas.height - at.deviceY - 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return [px[0], px[1], px[2]];
  }

  /** The unedited average colour around a canvas position, for the white balance picker. */
  readSource(cssX: number, cssY: number): [number, number, number] | null {
    const at = this.locate(cssX, cssY);
    const proxy = this.proxyCanvas;
    const ctx = proxy?.getContext('2d', { willReadFrequently: true });
    if (!at || !proxy || !ctx) return null;
    const x = Math.max(0, Math.min(proxy.width - 5, Math.round(at.s * proxy.width) - 2));
    const y = Math.max(0, Math.min(proxy.height - 5, Math.round(at.t * proxy.height) - 2));
    const { data } = ctx.getImageData(x, y, 5, 5);
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    return [r / 25, g / 25, b / 25];
  }

  // -------------------------------------------------------------------- export

  /**
   * Renders the crop at full resolution. Works tile by tile so photos larger than
   * MAX_TEXTURE_SIZE export correctly and phones are not asked for one huge
   * allocation. Each tile uploads the source pixels it needs, draws to an offscreen
   * target, and reads back into one RGBA buffer.
   */
  async exportFull(params: EditParams, options: ExportOptions): Promise<Blob> {
    if (!this.source || !this.proxy) throw new Error('No photo is open.');
    if (this.lost) throw new Error('The graphics context was lost. Please try again.');
    const gl = this.gl;
    const source = this.source;
    const g = params.geometry;
    const { width, height } = outputSize(g, source.width, source.height);
    const aligned = isPixelAligned(g);

    let rgba: Uint8ClampedArray<ArrayBuffer>;
    try {
      rgba = new Uint8ClampedArray(width * height * 4);
    } catch {
      throw new Error('This photo is too large for this browser to export.');
    }

    const maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const tileSize = Math.min(EXPORT_TILE, maxTexture - 2 * EXPORT_PADDING);
    // A straightened tile needs a larger source rectangle than the tile itself.
    const scratchEdge = Math.min(maxTexture, Math.ceil(tileSize * (aligned ? 1 : Math.SQRT2)) + 2 * EXPORT_PADDING + 2);

    const scratch = document.createElement('canvas');
    scratch.width = scratchEdge;
    scratch.height = scratchEdge;
    const scratchCtx = scratch.getContext('2d', { willReadFrequently: true });
    if (!scratchCtx) throw new Error('Could not allocate a canvas.');

    const target = this.createTarget(tileSize, tileSize, gl.RGBA8, gl.UNSIGNED_BYTE);
    const sourceTex = this.createTexture(gl.LINEAR);
    const pixels = new Uint8Array(tileSize * tileSize * 4);

    this.exporting = true;
    window.clearTimeout(this.detailTimer);
    window.clearTimeout(this.analysisTimer);
    try {
      const cols = Math.ceil(width / tileSize);
      const rows = Math.ceil(height / tileSize);
      const total = cols * rows;
      let done = 0;

      gl.useProgram(this.mainProgram);
      this.uploadUniforms(params);
      this.bindForMain(sourceTex);
      this.setGeometryUniforms(g, width, height);
      gl.uniform1i(this.main.uShowClipping, 0);

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const x = col * tileSize;
          const y = row * tileSize;
          const tw = Math.min(tileSize, width - x);
          const th = Math.min(tileSize, height - y);

          const [px, py, pw, ph] = this.sourceBounds(
            g,
            x / width,
            y / height,
            tw / width,
            th / height,
            EXPORT_PADDING,
          );
          scratchCtx.clearRect(0, 0, scratch.width, scratch.height);
          scratchCtx.drawImage(source, px, py, pw, ph, 0, 0, pw, ph);

          // Upload only the used rectangle, so CLAMP_TO_EDGE sits on real pixels
          // at the photo border.
          const crop =
            pw === scratch.width && ph === scratch.height
              ? scratch
              : scratchCtx.getImageData(0, 0, pw, ph);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, sourceTex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, crop);

          // GL's output uv has its origin at the bottom-left of the crop.
          gl.uniform4f(this.main.uTileRect, x / width, (height - y - th) / height, tw / width, th / height);
          // Any quarter turn or unrotated crop lands on texel centres; only straightening resamples.
          this.setSourceTexture({ tex: sourceTex, sx: px, sy: py, sw: pw, sh: ph, width: pw, height: ph, scale: 1 }, !aligned);

          // A per-tile seed stops the dither pattern repeating across the photo.
          gl.uniform1f(this.main.uDitherSeed, done * 37);
          gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
          gl.viewport(0, 0, tw, th);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          gl.readPixels(0, 0, tw, th, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

          // GL rows run bottom-up; image rows run top-down.
          for (let line = 0; line < th; line++) {
            const from = (th - 1 - line) * tw * 4;
            rgba.set(pixels.subarray(from, from + tw * 4), (y + line) * width * 4 + x * 4);
          }

          done++;
          options.onProgress?.((done / total) * 0.85);
          // Yield so the progress bar can paint and the page stays responsive.
          await nextFrame();
          if (this.lost) throw new Error('The graphics context was lost during export.');
        }
      }
    } finally {
      this.exporting = false;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteTexture(sourceTex);
      this.deleteTarget(target);
      this.requestRender();
    }

    let image = new ImageData(rgba, width, height);
    if (options.type === 'image/jpeg') {
      // JPEG has no alpha: flatten any transparency onto white.
      const d = image.data;
      for (let i = 3; i < d.length; i += 4) {
        const a = d[i];
        if (a === 255) continue;
        const k = a / 255;
        d[i - 3] = d[i - 3] * k + 255 * (1 - k);
        d[i - 2] = d[i - 2] * k + 255 * (1 - k);
        d[i - 1] = d[i - 1] * k + 255 * (1 - k);
        d[i] = 255;
      }
    }

    if (options.longEdge && Math.max(width, height) > options.longEdge) {
      image = this.resizeImage(image, options.longEdge);
    }
    options.onProgress?.(0.9);

    if (options.type === 'image/jpeg') {
      const exif = options.exif?.(image.width, image.height);
      const jpeg = new Uint8Array(await encodeJpeg(image, Math.round(options.quality * 100)));
      options.onProgress?.(1);
      return new Blob([(exif ? insertExif(jpeg, exif) : jpeg) as BlobPart], { type: 'image/jpeg' });
    }

    const output = document.createElement('canvas');
    output.width = image.width;
    output.height = image.height;
    const outCtx = output.getContext('2d');
    if (!outCtx) throw new Error('This photo is too large for this browser to export.');
    outCtx.putImageData(image, 0, 0);
    const blob = await canvasToBlob(output, options.type, options.quality);
    options.onProgress?.(1);
    return blob;
  }

  private resizeImage(image: ImageData, longEdge: number): ImageData {
    const [width, height] = this.fit(image.width, image.height, longEdge);
    const full = document.createElement('canvas');
    full.width = image.width;
    full.height = image.height;
    const fullCtx = full.getContext('2d');
    if (!fullCtx) throw new Error('This photo is too large for this browser to export.');
    fullCtx.putImageData(image, 0, 0);
    const small = downscale(full, full.width, full.height, width, height);
    const ctx = small.getContext('2d');
    if (!ctx) throw new Error('Could not allocate a canvas.');
    return ctx.getImageData(0, 0, width, height);
  }
}
