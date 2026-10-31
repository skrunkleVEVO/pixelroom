import { LUT_SIZE, buildCurveLut } from './curves';
import { HSL_CHANNELS, GRADE_ZONES, type EditParams, type GradeValue } from './params';
import { BLUR_SHADER, MAIN_SHADER, VERTEX_SHADER } from './shaders';

// Blur textures have a fixed size whatever the photo size. That keeps them cheap
// and makes clarity, texture and dehaze look identical in preview and in export.
const BLUR_FINE_EDGE = 640;
const BLUR_WIDE_EDGE = 160;
// Sharpen radius is one texel at this long edge, so the look is stable across sizes.
const SHARPEN_REFERENCE_EDGE = 2048;
const EXPORT_TILE = 2048;

export type ImageSource = ImageBitmap | HTMLCanvasElement;

export interface ExportOptions {
  type: 'image/jpeg' | 'image/png' | 'image/webp';
  quality: number;
  onProgress?: (fraction: number) => void;
}

interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  width: number;
  height: number;
}

type Uniforms = Record<string, WebGLUniformLocation | null>;

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

function nextFrame(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Owns the WebGL2 context. Source pixels are only ever read: the original stays
 * in `source` untouched, and every edit is a re-run of the fragment shader.
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
  private proxyTex: WebGLTexture | null = null;
  private blurFine: Target | null = null;
  private blurWide: Target | null = null;
  private lut = new Float32Array(LUT_SIZE * 4);
  private lutKey = '';
  private blurFormat: { internal: number; type: number } = { internal: 0, type: 0 };
  private airlight: [number, number, number] = [1, 1, 1];

  private source: ImageSource | null = null;
  private proxyCanvas: HTMLCanvasElement | null = null;
  private params: EditParams | null = null;
  private frame = 0;
  private lost = false;
  private exporting = false;
  private readonly maxProxyEdge: number;

  /** The unedited preview-sized image, for the Before view. */
  get previewCanvas(): HTMLCanvasElement | null {
    return this.proxyCanvas;
  }

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
    this.proxyTex = null;
    this.blurFine = null;
    this.blurWide = null;
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

  /** Stores the original and builds the proxy texture and fixed-size blurs. */
  setImage(source: ImageSource): void {
    const gl = this.gl;
    this.source = source;
    const maxEdge = Math.min(this.maxProxyEdge, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
    const [w, h] = this.fit(source.width, source.height, maxEdge);

    // Step down in halves for a clean proxy; a single large drawImage aliases.
    let step: HTMLCanvasElement | ImageSource = source;
    let sw = source.width;
    let sh = source.height;
    while (sw > w * 2 || sh > h * 2) {
      sw = Math.max(w, Math.ceil(sw / 2));
      sh = Math.max(h, Math.ceil(sh / 2));
      const c = document.createElement('canvas');
      c.width = sw;
      c.height = sh;
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('Could not allocate a canvas.');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(step, 0, 0, sw, sh);
      step = c;
    }
    const proxy = document.createElement('canvas');
    proxy.width = w;
    proxy.height = h;
    const proxyCtx = proxy.getContext('2d');
    if (!proxyCtx) throw new Error('Could not allocate a canvas.');
    proxyCtx.imageSmoothingQuality = 'high';
    proxyCtx.drawImage(step, 0, 0, w, h);
    this.proxyCanvas = proxy;

    if (this.proxyTex) gl.deleteTexture(this.proxyTex);
    this.proxyTex = this.createTexture(gl.LINEAR_MIPMAP_LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, proxy);
    gl.generateMipmap(gl.TEXTURE_2D); // the blur passes downsample through these

    this.canvas.width = w;
    this.canvas.height = h;

    this.buildBlurs(w, h);
    this.estimateAirlight(proxy);
    this.requestRender();
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

    if (!this.proxyTex) return;
    this.blurFine = make(BLUR_FINE_EDGE, 1, this.proxyTex);
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
    const temp = p.color.temperature / 100;
    const tint = p.color.tint / 100;
    const gains = [1 + 0.32 * temp, 1 - 0.28 * tint, 1 - 0.42 * temp].map((g, i) =>
      i === 1 ? g : g * (1 + 0.14 * tint),
    );
    const norm = 0.2126 * gains[0] + 0.7152 * gains[1] + 0.0722 * gains[2];
    gl.uniform3f(u.uWbGain, gains[0] / norm, gains[1] / norm, gains[2] / norm);

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
    bind(0, sourceTex, this.main.uSource);
    if (this.blurFine) bind(1, this.blurFine.tex, this.main.uBlurFine);
    if (this.blurWide) bind(2, this.blurWide.tex, this.main.uBlurWide);
    bind(3, this.lutTex, this.main.uCurveLut);
  }

  private setImageGeometry(width: number, height: number): void {
    const gl = this.gl;
    gl.uniform2f(this.main.uImageSize, width, height);
    const edge = Math.min(Math.max(width, height), SHARPEN_REFERENCE_EDGE);
    const long = Math.max(width, height);
    gl.uniform2f(this.main.uSharpenStep, long / edge / width, long / edge / height);
  }

  /** Schedules a repaint; many slider events per frame collapse into one draw. */
  render(params: EditParams): void {
    this.params = params;
    this.requestRender();
  }

  private requestRender(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  /** Immediate draw of the live preview. */
  draw(): void {
    if (this.lost || this.exporting || !this.params || !this.proxyTex || !this.source) return;
    const gl = this.gl;
    gl.useProgram(this.mainProgram);
    this.uploadUniforms(this.params);
    this.bindForMain(this.proxyTex);
    this.setImageGeometry(this.source.width, this.source.height);
    gl.uniform4f(this.main.uTileRect, 0, 0, 1, 1);
    gl.uniform4f(this.main.uSourceRect, 0, 0, 1, 1);
    gl.uniform1f(this.main.uDitherSeed, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /**
   * Renders at the photo's original dimensions. Works tile by tile so photos
   * larger than MAX_TEXTURE_SIZE export correctly and phones are not asked for
   * one huge allocation. Each tile is uploaded with padding for the sharpen
   * kernel, drawn to an offscreen target, read back and pasted into a 2D canvas.
   */
  async exportFull(params: EditParams, options: ExportOptions): Promise<Blob> {
    if (!this.source || !this.proxyTex) throw new Error('No photo is open.');
    if (this.lost) throw new Error('The graphics context was lost. Please try again.');
    const gl = this.gl;
    const source = this.source;
    const { width, height } = source;

    const output = document.createElement('canvas');
    output.width = width;
    output.height = height;
    const outCtx = output.getContext('2d');
    if (!outCtx) throw new Error('This photo is too large for this browser to export.');
    if (options.type === 'image/jpeg') {
      outCtx.fillStyle = '#000';
      outCtx.fillRect(0, 0, width, height);
    }

    const maxTile = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    // Padding must cover the sharpen kernel, whose radius grows with photo size.
    const padding = Math.ceil(Math.max(width, height) / SHARPEN_REFERENCE_EDGE) + 2;
    const tileSize = Math.min(EXPORT_TILE, maxTile - 2 * padding);

    const scratch = document.createElement('canvas');
    scratch.width = tileSize + 2 * padding;
    scratch.height = tileSize + 2 * padding;
    const scratchCtx = scratch.getContext('2d');
    if (!scratchCtx) throw new Error('Could not allocate a canvas.');

    const target = this.createTarget(tileSize, tileSize, gl.RGBA8, gl.UNSIGNED_BYTE);
    const sourceTex = this.createTexture(gl.LINEAR);
    const pixels = new Uint8Array(tileSize * tileSize * 4);

    this.exporting = true;
    try {
      const cols = Math.ceil(width / tileSize);
      const rows = Math.ceil(height / tileSize);
      const total = cols * rows;
      let done = 0;

      gl.useProgram(this.mainProgram);
      this.uploadUniforms(params);
      this.bindForMain(sourceTex);
      this.setImageGeometry(width, height);

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const x = col * tileSize;
          const y = row * tileSize;
          const tw = Math.min(tileSize, width - x);
          const th = Math.min(tileSize, height - y);

          // Source region with padding, clamped to the photo.
          const px = Math.max(0, x - padding);
          const py = Math.max(0, y - padding);
          const pw = Math.min(width, x + tw + padding) - px;
          const ph = Math.min(height, y + th + padding) - py;
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

          // Image uv has its origin bottom-left, matching UNPACK_FLIP_Y.
          const uvX = x / width;
          const uvY = (height - y - th) / height;
          gl.uniform4f(this.main.uTileRect, uvX, uvY, tw / width, th / height);
          // Maps whole-image uv into the uploaded rectangle.
          const sx = width / pw;
          const sy = height / ph;
          gl.uniform4f(
            this.main.uSourceRect,
            -(px / width) * sx,
            -((height - py - ph) / height) * sy,
            sx,
            sy,
          );

          // A per-tile seed stops the dither pattern repeating across the photo.
          gl.uniform1f(this.main.uDitherSeed, done * 37);
          gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
          gl.viewport(0, 0, tw, th);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          gl.readPixels(0, 0, tw, th, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

          // GL rows run bottom-up; ImageData rows run top-down.
          const tile = new ImageData(tw, th);
          for (let line = 0; line < th; line++) {
            const start = (th - 1 - line) * tw * 4;
            tile.data.set(pixels.subarray(start, start + tw * 4), line * tw * 4);
          }
          if (options.type === 'image/jpeg') {
            // putImageData would keep alpha; composite so transparency becomes black.
            for (let i = 3; i < tile.data.length; i += 4) {
              const a = tile.data[i];
              if (a === 255) continue;
              const k = a / 255;
              tile.data[i - 3] *= k;
              tile.data[i - 2] *= k;
              tile.data[i - 1] *= k;
              tile.data[i] = 255;
            }
          }
          outCtx.putImageData(tile, x, y);

          done++;
          options.onProgress?.(done / total);
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

    return new Promise<Blob>((resolve, reject) => {
      output.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('The browser could not encode this image.'))),
        options.type,
        options.quality,
      );
    });
  }
}
