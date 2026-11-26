// WebGL2 コンポジター: プレビューと書き出しで同一の描画処理を使う
import type { AssetMeta, BlendMode, Clip, Ease, Effect, Project, TransitionType } from '../model/types';
import { compile, createFBO, createTexture, deleteFBO, type FBO, type Program } from './gl';
import { FS_BLEND, FS_BLUR, FS_BRIGHT, FS_COMBINE, FS_COPY, FS_FX, FS_LAYER, FS_PRESENT, FS_RAYS, FS_TRANSITION, VS_FULL, VS_LAYER } from './shaders';
import { mvpFor, resolveClipAt } from './evaluate';
import { applyEase, evalNum, parseColor } from '../model/keyframes';
import { clipEnd, sourceTime } from '../model/ops';
import type { FrameSource } from '../media/video';
import { cachedImage, imageFor, blobFor } from '../media/registry';
import { fontString, renderText } from './text';
import { renderChart, renderCounter, renderParticles, renderShape, renderSolid } from './generators';
import { ensureWebFont, webFontReady } from './fonts';
import { buildCurve, parseCube } from './compositor-math';

const BLEND_IDX: Record<BlendMode, number> = { normal: 0, multiply: 1, screen: 2, overlay: 3, add: 4, darken: 5, lighten: 6, softLight: 7, hardLight: 8, difference: 9, exclusion: 10, colorDodge: 11, colorBurn: 12 };
const TRANS_IDX: Record<TransitionType, number> = { crossfade: 0, fadeBlack: 1, fadeWhite: 2, wipeLeft: 3, wipeRight: 4, wipeUp: 5, wipeDown: 6, slideLeft: 7, slideRight: 8, slideUp: 9, slideDown: 10, zoomIn: 11, zoomOut: 12, circle: 13, blur: 14, glitch: 15, flash: 16, spin: 17, pixelize: 18 };

const DIRECT_OK = new Set(['chromaKey', 'echo', 'cameraShake']);

function sameMatrix(a: Float32Array, b: Float32Array) {
  for (let i = 0; i < 16; i++) if (Math.abs(a[i] - b[i]) > 1e-6 * Math.max(1, Math.abs(a[i]))) return false;
  return true;
}

interface PooledFBO extends FBO {
  busy: boolean;
}

interface GenEntry {
  canvas?: HTMLCanvasElement;
  key: string;
  tex: WebGLTexture;
  w: number;
  h: number;
  cx: number;
  cy: number;
  lastUsed: number;
}

export interface LayerInfo {
  w: number;
  h: number;
  cx: number;
  cy: number;
}

export interface RenderOpts {
  /** 出力ピクセル / コンポジション px */
  scale: number;
  /** 画像の最大辺 (プレビュー時は縮小版を使う) */
  imageMaxDim: number;
  frame: number;
  final: boolean;
}

const rgb = (hex: string): [number, number, number] => {
  const c = parseColor(hex);
  return [c[0] / 255, c[1] / 255, c[2] / 255];
};
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

export class Compositor {
  gl: WebGL2RenderingContext;
  private progs!: Record<string, Program>;
  private vao!: WebGLVertexArrayObject;
  private pool: PooledFBO[] = [];
  private outW = 1;
  private outH = 1;
  private gen = new Map<string, GenEntry>();
  private videoTex = new Map<string, WebGLTexture>();
  private curveTex = new Map<string, WebGLTexture>();
  private lutTex = new Map<string, { tex: WebGLTexture; size: number } | null>();
  private emptyTex!: WebGLTexture;
  layerInfo = new Map<string, LayerInfo>();
  lost = false;
  onNeedsRedraw: () => void = () => {};
  maxTextureSize = 4096;
  private fontsPending = new Set<string>();

  constructor(
    public canvas: HTMLCanvasElement | OffscreenCanvas,
    opts: { preserve?: boolean } = {},
  ) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: !!opts.preserve,
      powerPreference: 'high-performance',
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('この端末/ブラウザは WebGL2 に対応していないため、プレビューを表示できません');
    this.gl = gl;
    if ('addEventListener' in canvas) {
      (canvas as HTMLCanvasElement).addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        this.lost = true;
      });
      (canvas as HTMLCanvasElement).addEventListener('webglcontextrestored', () => {
        this.lost = false;
        this.init();
        this.onNeedsRedraw();
      });
    }
    this.init();
  }

  private init() {
    const gl = this.gl;
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.progs = {
      copy: compile(gl, VS_FULL, FS_COPY, 'copy'),
      present: compile(gl, VS_FULL, FS_PRESENT, 'present'),
      bright: compile(gl, VS_FULL, FS_BRIGHT, 'bright'),
      rays: compile(gl, VS_FULL, FS_RAYS, 'rays'),
    };
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.disable(gl.DEPTH_TEST);
    this.emptyTex = createTexture(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    this.pool = [];
    this.variants = new Map();
    this.gen.clear();
    this.videoTex.clear();
    this.curveTex.clear();
    this.lutTex.clear();
  }

  setSize(w: number, h: number) {
    w = Math.max(2, Math.round(w));
    h = Math.max(2, Math.round(h));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    if (w !== this.outW || h !== this.outH) {
      for (const f of this.pool) deleteFBO(this.gl, f);
      this.pool = [];
      this.outW = w;
      this.outH = h;
    }
  }

  // ---------- FBO プール ----------
  private acquire(w = this.outW, h = this.outH): PooledFBO {
    let f = this.pool.find((x) => !x.busy && x.w === w && x.h === h);
    if (!f) {
      f = { ...createFBO(this.gl, w, h), busy: false };
      this.pool.push(f);
    }
    f.busy = true;
    return f;
  }
  private release(f: PooledFBO | null | undefined) {
    if (f) f.busy = false;
  }
  private bindTarget(f: FBO | null) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, f ? f.fb : null);
    gl.viewport(0, 0, f ? f.w : this.canvas.width, f ? f.h : this.canvas.height);
  }
  private clear(f: FBO, r = 0, g = 0, b = 0, a = 0) {
    this.bindTarget(f);
    const gl = this.gl;
    gl.clearColor(r, g, b, a);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  private use(name: string): Program {
    const p = this.progs[name];
    this.gl.useProgram(p.prog);
    return p;
  }
  /**
   * 分岐用の int uniform を定数に置き換えた特殊化シェーダーを遅延コンパイルして使う。
   * 不要な分岐がコンパイル時に除去され、モバイル GPU のレジスタ圧迫やソフトウェア GL の全分岐実行を避けられる。
   */
  private variants = new Map<string, Program>();
  private useV(base: 'layer' | 'fx' | 'transition' | 'blend' | 'combine' | 'blur', defs: Record<string, number>): Program {
    const key = base + JSON.stringify(defs);
    let p = this.variants.get(key);
    if (!p) {
      const src = { layer: FS_LAYER, fx: FS_FX, transition: FS_TRANSITION, blend: FS_BLEND, combine: FS_COMBINE, blur: FS_BLUR }[base];
      let fs = src;
      for (const [k, v] of Object.entries(defs)) fs = fs.replace(new RegExp(`uniform int ${k};`), `const int ${k} = ${Math.round(v)};`);
      p = compile(this.gl, base === 'layer' ? VS_LAYER : VS_FULL, fs, key);
      this.variants.set(key, p);
    }
    this.gl.useProgram(p.prog);
    return p;
  }
  private curLayer!: Program;
  private tex(unit: number, t: WebGLTexture, loc: WebGLUniformLocation | null | undefined) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (loc) gl.uniform1i(loc, unit);
  }
  private draw() {
    this.gl.bindVertexArray(this.vao);
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
  }

  // ---------- テクスチャ ----------
  private upload(t: WebGLTexture, src: TexImageSource) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  }

  private curvesTexture(curves: Clip['grade']['curves']): WebGLTexture | null {
    const isId = (pts: [number, number][]) => pts.length === 2 && pts[0][0] === 0 && pts[0][1] === 0 && pts[1][0] === 1 && pts[1][1] === 1;
    if (isId(curves.master) && isId(curves.r) && isId(curves.g) && isId(curves.b)) return null;
    const key = JSON.stringify(curves);
    let t = this.curveTex.get(key);
    if (t) return t;
    const m = buildCurve(curves.master);
    const r = buildCurve(curves.r);
    const g = buildCurve(curves.g);
    const b = buildCurve(curves.b);
    const data = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      const mv = m[i];
      const idx = Math.round(mv * 255);
      data[i * 4] = Math.round(r[idx] * 255);
      data[i * 4 + 1] = Math.round(g[idx] * 255);
      data[i * 4 + 2] = Math.round(b[idx] * 255);
      data[i * 4 + 3] = 255;
    }
    t = createTexture(this.gl);
    this.gl.pixelStorei(this.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, 256, 1, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, data);
    this.gl.pixelStorei(this.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    if (this.curveTex.size > 64) this.curveTex.clear();
    this.curveTex.set(key, t);
    return t;
  }

  private lut(assetId: string): { tex: WebGLTexture; size: number } | null | 'loading' {
    if (this.lutTex.has(assetId)) return this.lutTex.get(assetId)!;
    this.lutTex.set(assetId, null);
    void blobFor(assetId)
      .then((b) => b.text())
      .then((txt) => {
        const parsed = parseCube(txt);
        if (!parsed || this.lost) return;
        const gl = this.gl;
        const n = parsed.size;
        const data = new Uint8Array(n * n * n * 4);
        for (let b = 0; b < n; b++)
          for (let g = 0; g < n; g++)
            for (let r = 0; r < n; r++) {
              const src = (r + g * n + b * n * n) * 3;
              const dst = (g * n * n + (r + b * n)) * 4;
              data[dst] = Math.round(Math.max(0, Math.min(1, parsed.data[src])) * 255);
              data[dst + 1] = Math.round(Math.max(0, Math.min(1, parsed.data[src + 1])) * 255);
              data[dst + 2] = Math.round(Math.max(0, Math.min(1, parsed.data[src + 2])) * 255);
              data[dst + 3] = 255;
            }
        const t = createTexture(gl);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, n * n, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        this.lutTex.set(assetId, { tex: t, size: n });
        this.onNeedsRedraw();
      })
      .catch((e) => console.warn('LUT load failed', e));
    return 'loading';
  }

  /** フォントの読み込みを確認 (未読込ならロードを開始して false) */
  private fontReady(family: string, weight: number, italic: boolean, text: string): boolean {
    if (!webFontReady(family)) {
      void ensureWebFont(family).then(() => this.onNeedsRedraw());
    }
    const f = fontString({ fontFamily: family, fontWeight: weight, italic }, 48);
    try {
      if (document.fonts.check(f, text)) return true;
    } catch {
      return true;
    }
    const key = f + '|' + text.slice(0, 64);
    if (!this.fontsPending.has(key)) {
      this.fontsPending.add(key);
      void document.fonts.load(f, text).finally(() => {
        this.fontsPending.delete(key);
        this.onNeedsRedraw();
      });
    }
    return false;
  }

  /** 生成系レイヤーの画像を取得 (キャッシュ付き) */
  private generated(clip: Clip, rc: Clip, l: number, res: number, frame: number): GenEntry | null {
    const q = Math.pow(2, Math.round(Math.log2(Math.max(0.05, res)) * 2) / 2);
    let key = '';
    let fn: ((c?: HTMLCanvasElement) => { canvas: HTMLCanvasElement; w: number; h: number; cx: number; cy: number }) | null = null;
    switch (rc.type) {
      case 'text': {
        const td = rc.text!;
        const n = Array.from(td.content).length;
        const animating = td.anims.some((a) => {
          if (a.kind === 'none') return false;
          if (a.mode === 'loop') return true;
          const span = a.duration + a.stagger * n + 0.05;
          return a.mode === 'in' ? l < span : rc.duration - l < span;
        });
        key = 'T' + JSON.stringify(td) + q + (animating ? '@' + l.toFixed(4) : '');
        fn = (c) => renderText(c, td.content, td.style, td.anims, l, rc.duration, q);
        break;
      }
      case 'shape':
        key = 'S' + JSON.stringify(rc.shape) + q;
        fn = (c) => renderShape(c, rc.shape!, q);
        break;
      case 'particles':
        key = 'P' + JSON.stringify(rc.particles) + q + '@' + l.toFixed(4);
        fn = (c) => renderParticles(c, rc.particles!, l, q);
        break;
      case 'counter':
        key = 'C' + JSON.stringify(rc.counter) + q;
        fn = (c) => renderCounter(c, rc.counter!, q);
        break;
      case 'chart':
        key = 'G' + JSON.stringify(rc.chart) + q;
        fn = (c) => renderChart(c, rc.chart!, q);
        break;
      case 'solid': {
        const anim = rc.solid!.animated !== 'none';
        // 背景は単色ならテクスチャを小さくして節約
        const sq = anim || rc.solid!.fill.type !== 'solid' ? Math.min(q, 1) : 0.05;
        key = 'B' + JSON.stringify(rc.solid) + sq + (anim ? '@' + l.toFixed(4) : '');
        fn = (c) => renderSolid(c, rc.solid!, l, sq);
        break;
      }
      default:
        return null;
    }
    let e = this.gen.get(clip.id);
    if (e && e.key === key) {
      e.lastUsed = frame;
      return e;
    }
    const out = fn(e?.canvas);
    if (!e) {
      e = { canvas: out.canvas, key, tex: createTexture(this.gl), w: out.w, h: out.h, cx: out.cx, cy: out.cy, lastUsed: frame };
      this.gen.set(clip.id, e);
    }
    e.canvas = out.canvas;
    e.key = key;
    e.w = out.w;
    e.h = out.h;
    e.cx = out.cx;
    e.cy = out.cy;
    e.lastUsed = frame;
    this.upload(e.tex, out.canvas);
    return e;
  }

  /** レイヤー画像 (テクスチャ + 論理サイズ) を取得。準備できていなければ null */
  private layerImage(p: Project, clip: Clip, rc: Clip, t: number, src: FrameSource, opts: RenderOpts): { tex: WebGLTexture; info: LayerInfo } | null | 'skip' {
    const l = t - clip.start;
    if (clip.type === 'video') {
      const asset = p.assets.find((a) => a.id === clip.assetId);
      if (!asset) return 'skip';
      const st = sourceTime(clip, t, asset.duration);
      const d = src.frame(clip, asset, st);
      if (!d) return null;
      let tex = this.videoTex.get(clip.id);
      if (!tex) {
        tex = createTexture(this.gl);
        this.videoTex.set(clip.id, tex);
      }
      try {
        this.upload(tex, d);
      } catch (e) {
        console.warn('video upload failed', e);
        return null;
      }
      const w = asset.width || (d as any).videoWidth || (d as any).width || 1;
      const h = asset.height || (d as any).videoHeight || (d as any).height || 1;
      const info = { w, h, cx: w / 2, cy: h / 2 };
      this.layerInfo.set(clip.id, info);
      return { tex, info };
    }
    if (clip.type === 'image') {
      const asset = p.assets.find((a) => a.id === clip.assetId);
      if (!asset) return 'skip';
      const dim = opts.imageMaxDim;
      const img = cachedImage(asset, dim);
      if (!img) {
        void imageFor(asset, dim).then(() => this.onNeedsRedraw());
        return null;
      }
      const key = 'I' + asset.id + '@' + dim;
      let e = this.gen.get(clip.id);
      if (!e || e.key !== key) {
        if (!e) {
          e = { key, tex: createTexture(this.gl), w: 0, h: 0, cx: 0, cy: 0, lastUsed: opts.frame };
          this.gen.set(clip.id, e);
        }
        e.key = key;
        this.upload(e.tex, img);
      }
      e.lastUsed = opts.frame;
      const w = asset.width || img.width;
      const h = asset.height || img.height;
      const info = { w, h, cx: w / 2, cy: h / 2 };
      this.layerInfo.set(clip.id, info);
      return { tex: e.tex, info };
    }
    // 文字系はフォントの読み込みを待つ
    const st = rc.type === 'text' ? rc.text?.style : rc.type === 'counter' ? rc.counter?.style : null;
    if (st) {
      const txt = rc.type === 'text' ? rc.text!.content : '0123456789,.:' + (rc.counter!.prefix + rc.counter!.suffix);
      if (!this.fontReady(st.fontFamily, st.fontWeight, st.italic, txt || 'あ')) return null;
    }
    const sx = Math.abs(rc.transform.scaleX);
    const sy = Math.abs(rc.transform.scaleY);
    const zf = rc.transform.z < 0 ? this.fixZ(p, rc.transform.z) : 1;
    const res = opts.scale * Math.max(0.25, Math.min(4, (Math.max(sx, sy) / 100) * zf));
    const g = this.generated(clip, rc, l, res, opts.frame);
    if (!g) return 'skip';
    const info = { w: g.w, h: g.h, cx: g.cx, cy: g.cy };
    this.layerInfo.set(clip.id, info);
    return { tex: g.tex, info };
  }

  private fixZ(p: Project, z: number) {
    return p.cameraFocal / Math.max(1, p.cameraFocal + z);
  }

  // ---------- レイヤー描画 ----------
  private setLayerUniforms(rc: Clip, info: LayerInfo, t: number, adjustment = false) {
    const gl = this.gl;
    const ck0 = rc.effects.some((e) => e.enabled && e.type === 'chromaKey');
    const pr = this.useV('layer', { u_ck: ck0 ? 1 : 0, u_mask: rc.mask.enabled ? 1 : 0, u_grade: rc.grade.enabled ? 1 : 0 });
    this.curLayer = pr;
    const u = pr.u;
    gl.uniform2f(u.u_srcSize, info.w, info.h);
    gl.uniform1f(u.u_time, t);
    const ck = rc.effects.find((e) => e.enabled && e.type === 'chromaKey');
    gl.uniform1i(u.u_ck, ck ? 1 : 0);
    if (ck) {
      gl.uniform3fv(u.u_ckColor, rgb(String(ck.params.color)));
      gl.uniform1f(u.u_ckTol, num(ck.params.tolerance, 0.3));
      gl.uniform1f(u.u_ckSoft, num(ck.params.softness, 0.1));
      gl.uniform1f(u.u_ckSpill, num(ck.params.spill, 0.5));
    }
    const m = rc.mask;
    gl.uniform1i(u.u_mask, m.enabled ? 1 : 0);
    if (m.enabled) {
      gl.uniform1i(u.u_maskEllipse, m.shape === 'ellipse' ? 1 : 0);
      gl.uniform1i(u.u_maskInvert, m.invert ? 1 : 0);
      gl.uniform4f(u.u_maskRect, m.cx, adjustment ? 1 - m.cy : m.cy, Math.max(0.001, m.w), Math.max(0.001, m.h));
      gl.uniform1f(u.u_maskRound, m.roundness);
      gl.uniform1f(u.u_maskFeather, m.feather);
    }
    const g = rc.grade;
    gl.uniform1i(u.u_grade, g.enabled ? 1 : 0);
    gl.uniform1i(u.u_useCurves, 0);
    gl.uniform1i(u.u_useLut, 0);
    this.tex(1, this.emptyTex, u.u_curves);
    this.tex(2, this.emptyTex, u.u_lut);
    if (g.enabled) {
      gl.uniform1f(u.u_exposure, g.exposure);
      gl.uniform1f(u.u_brightness, g.brightness);
      gl.uniform1f(u.u_contrast, g.contrast);
      gl.uniform1f(u.u_saturation, g.saturation);
      gl.uniform1f(u.u_vibrance, g.vibrance);
      gl.uniform1f(u.u_temp, g.temperature);
      gl.uniform1f(u.u_tint, g.tint);
      gl.uniform1f(u.u_hue, g.hue);
      gl.uniform1f(u.u_highlights, g.highlights);
      gl.uniform1f(u.u_shadows, g.shadows);
      gl.uniform1f(u.u_whites, g.whites);
      gl.uniform1f(u.u_blacks, g.blacks);
      gl.uniform1f(u.u_fade, g.fade);
      gl.uniform1f(u.u_vignette, g.vignette);
      gl.uniform1f(u.u_vignetteSize, g.vignetteSize);
      gl.uniform1f(u.u_grain, g.grain);
      const ct = this.curvesTexture(g.curves);
      if (ct) {
        gl.uniform1i(u.u_useCurves, 1);
        this.tex(1, ct, u.u_curves);
      }
      if (g.lutAssetId) {
        const l = this.lut(g.lutAssetId);
        if (l && l !== 'loading') {
          gl.uniform1i(u.u_useLut, 1);
          gl.uniform1f(u.u_lutSize, l.size);
          gl.uniform1f(u.u_lutMix, g.lutIntensity);
          this.tex(2, l.tex, u.u_lut);
        }
      }
    }
  }

  private drawInstance(p: Project, clip: Clip, rc: Clip, info: LayerInfo, t: number, alphaMul: number) {
    const gl = this.gl;
    const u = this.curLayer.u;
    const c = rc.crop;
    const x0 = -info.cx + c.left * info.w;
    const x1 = -info.cx + (1 - c.right) * info.w;
    const y0 = -info.cy + c.top * info.h;
    const y1 = -info.cy + (1 - c.bottom) * info.h;
    gl.uniform4f(u.u_rect, x0, y0, x1, y1);
    gl.uniform4f(u.u_uvRect, c.left, c.top, 1 - c.right, 1 - c.bottom);
    gl.uniformMatrix4fv(u.u_mvp, false, mvpFor(p, clip, t));
    gl.uniform1f(u.u_alphaMul, alphaMul);
    this.draw();
  }

  /** クリップを1レイヤーとして描画 (モーションブラー・残像・エフェクト適用後の FBO を返す) */
  /**
   * direct を指定すると、レイヤー用 FBO を使わず蓄積バッファへ直接 (通常ブレンドで) 描画する。
   * 後段エフェクトの無い通常レイヤーで全画面パスを 2 回省けるため、モバイル GPU で効果が大きい。
   */
  private renderClip(p: Project, clip: Clip, t: number, src: FrameSource, opts: RenderOpts, state: { incomplete: boolean }, direct?: { acc: PooledFBO; opacity: number }): PooledFBO | null {
    const l = t - clip.start;
    const rc = resolveClipAt(clip, Math.max(0, Math.min(l, clip.duration)));
    const img = this.layerImage(p, clip, rc, t, src, opts);
    if (img === 'skip') return null;
    if (!img) {
      state.incomplete = true;
      (state as any).missing?.push(`${clip.type}:${clip.name}`);
      return null;
    }
    const gl = this.gl;
    const k0 = direct ? direct.opacity : 1;
    const target = direct ? direct.acc : this.acquire();
    if (direct) this.bindTarget(target);
    else this.clear(target);
    this.setLayerUniforms(rc, img.info, t);
    this.tex(0, img.tex, this.curLayer.u.u_tex);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    // 残像 (エコー)
    const echo = rc.effects.find((e) => e.enabled && e.type === 'echo');
    if (echo) {
      const n = Math.max(1, Math.min(12, Math.round(num(echo.params.count, 5))));
      const delay = num(echo.params.delay, 0.05);
      const decay = num(echo.params.decay, 0.6);
      for (let k = n; k >= 1; k--) this.drawInstance(p, clip, rc, img.info, t - k * delay, Math.pow(decay, k) * k0);
    }
    const mb = rc.motionBlur;
    const span0 = mb.shutterAngle / 360 / p.fps;
    // 動きが無い瞬間はモーションブラーを省略 (結果は同一)
    const moving = mb.enabled && mb.samples > 1 && mb.shutterAngle > 0 && !sameMatrix(mvpFor(p, clip, t - span0 / 2), mvpFor(p, clip, t + span0 / 2));
    if (moving) {
      // モーションブラー: シャッター開角内の複数時刻で変形を評価し加算平均
      const acc = this.acquire();
      this.clear(acc);
      gl.blendFunc(gl.ONE, gl.ONE);
      const n = Math.max(2, Math.min(32, Math.round(mb.samples)));
      const span = mb.shutterAngle / 360 / p.fps;
      for (let i = 0; i < n; i++) this.drawInstance(p, clip, rc, img.info, t + (i / (n - 1) - 0.5) * span, 1 / n);
      this.bindTarget(target);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      this.use('copy');
      this.tex(0, acc.tex, this.progs.copy.u.u_tex);
      gl.uniform1f(this.progs.copy.u.u_mul, k0);
      this.draw();
      this.release(acc);
    } else {
      this.drawInstance(p, clip, rc, img.info, t, k0);
    }
    gl.disable(gl.BLEND);
    if (direct) return null;
    return this.applyEffects(rc.effects, target, t, opts.scale, p);
  }

  // ---------- エフェクト ----------
  /** 解像度 (w,h) での分離ガウシアンブラー */
  private blurCore(src: FBO, sigma: number, w: number, h: number, tilt?: { focus: number; range: number; angle: number; radial: boolean }): PooledFBO {
    const gl = this.gl;
    const a = this.acquire(w, h);
    const b = this.acquire(w, h);
    const pr = this.useV('blur', { u_tilt: tilt ? 1 : 0 });
    gl.uniform2f(pr.u.u_res, w, h);
    gl.uniform1f(pr.u.u_sigma, sigma);
    if (tilt) {
      gl.uniform1f(pr.u.u_focus, tilt.focus);
      gl.uniform1f(pr.u.u_range, tilt.range);
      gl.uniform1f(pr.u.u_angle, tilt.angle);
      gl.uniform1i(pr.u.u_radial, tilt.radial ? 1 : 0);
    }
    this.bindTarget(a);
    gl.uniform2f(pr.u.u_dir, 1, 0);
    this.tex(0, src.tex, pr.u.u_tex);
    this.draw();
    this.bindTarget(b);
    gl.uniform2f(pr.u.u_dir, 0, 1);
    this.tex(0, a.tex, pr.u.u_tex);
    this.draw();
    // 大きな半径は斜め方向の分離パスを追加して滑らかにする
    if (sigma > 12) {
      this.bindTarget(a);
      gl.uniform1f(pr.u.u_sigma, sigma * 0.5);
      gl.uniform2f(pr.u.u_dir, 0.7071, 0.7071);
      this.tex(0, b.tex, pr.u.u_tex);
      this.draw();
      this.bindTarget(b);
      gl.uniform2f(pr.u.u_dir, 0.7071, -0.7071);
      this.tex(0, a.tex, pr.u.u_tex);
      this.draw();
    }
    this.release(a);
    return b;
  }

  private copyTo(src: FBO, dst: FBO) {
    this.bindTarget(dst);
    const pr = this.use('copy');
    this.gl.uniform1f(pr.u.u_mul, 1);
    this.tex(0, src.tex, pr.u.u_tex);
    this.draw();
  }

  /**
   * ぼかし。半径が大きい場合は 1/2・1/4 解像度に縮小してから計算し、拡大して戻す
   * (見た目はほぼ同じで、フィルレートを 1/4〜1/16 に削減できる)。
   */
  private blurPass(src: FBO, sigma: number, tilt?: { focus: number; range: number; angle: number; radial: boolean }): PooledFBO {
    const levels = sigma > 40 ? 2 : sigma > 10 ? 1 : 0;
    if (levels === 0) return this.blurCore(src, sigma, this.outW, this.outH, tilt);
    let cur: FBO = src;
    let w = this.outW;
    let h = this.outH;
    const tmp: PooledFBO[] = [];
    for (let i = 0; i < levels; i++) {
      w = Math.max(1, Math.ceil(w / 2));
      h = Math.max(1, Math.ceil(h / 2));
      const d = this.acquire(w, h);
      this.copyTo(cur, d);
      tmp.push(d);
      cur = d;
    }
    const blurred = this.blurCore(cur, sigma / (1 << levels), w, h, tilt);
    for (const t of tmp) this.release(t);
    const out = this.acquire();
    this.copyTo(blurred, out);
    this.release(blurred);
    return out;
  }

  private fxPass(src: FBO, type: number, set: (u: Program['u']) => void, t: number): PooledFBO {
    const gl = this.gl;
    const out = this.acquire();
    this.bindTarget(out);
    const pr = this.useV('fx', { u_type: type });
    gl.uniform2f(pr.u.u_res, this.outW, this.outH);
    gl.uniform1f(pr.u.u_time, t);
    gl.uniform4f(pr.u.u_p, 0, 0, 0, 0);
    gl.uniform4f(pr.u.u_q, 0, 0, 0, 0);
    set(pr.u);
    this.tex(0, src.tex, pr.u.u_tex);
    this.draw();
    return out;
  }

  private applyEffects(effects: Effect[], input: PooledFBO, t: number, s: number, p: Project): PooledFBO {
    const gl = this.gl;
    let cur = input;
    const swap = (next: PooledFBO) => {
      this.release(cur);
      cur = next;
    };
    for (const e of effects) {
      if (!e.enabled) continue;
      const P = e.params;
      switch (e.type) {
        case 'gaussianBlur': {
          const r = num(P.radius) * s;
          if (r > 0.3) swap(this.blurPass(cur, r));
          break;
        }
        case 'radialBlur':
          swap(this.fxPass(cur, 1, (u) => gl.uniform4f(u.u_p, num(P.amount), num(P.cx, 0.5), num(P.cy, 0.5), 0), t));
          break;
        case 'directionalBlur':
          swap(this.fxPass(cur, 2, (u) => gl.uniform4f(u.u_p, num(P.length) * s, num(P.angle), 0, 0), t));
          break;
        case 'glow': {
          const bright = this.acquire();
          this.bindTarget(bright);
          const pb = this.use('bright');
          gl.uniform1f(pb.u.u_threshold, num(P.threshold, 0.5));
          this.tex(0, cur.tex, pb.u.u_tex);
          this.draw();
          const bl = this.blurPass(bright, Math.max(0.5, num(P.radius, 24) * s));
          this.release(bright);
          const out = this.acquire();
          this.bindTarget(out);
          const pc = this.useV('combine', { u_mode: 0 });
          gl.uniform3fv(pc.u.u_color, rgb(String(P.color ?? '#ffffff')));
          gl.uniform1f(pc.u.u_intensity, num(P.intensity, 1.5));
          gl.uniform1f(pc.u.u_tint, num(P.tint, 0));
          this.tex(0, cur.tex, pc.u.u_tex);
          this.tex(1, bl.tex, pc.u.u_aux);
          this.tex(2, this.emptyTex, pc.u.u_aux2);
          this.draw();
          this.release(bl);
          swap(out);
          break;
        }
        case 'neon': {
          const r = Math.max(0.5, num(P.radius, 30) * s);
          const b1 = this.blurPass(cur, r);
          const b2 = this.blurPass(cur, r * 0.3);
          const out = this.acquire();
          this.bindTarget(out);
          const pc = this.useV('combine', { u_mode: 1 });
          gl.uniform3fv(pc.u.u_color, rgb(String(P.color ?? '#00e5ff')));
          gl.uniform1f(pc.u.u_intensity, num(P.intensity, 2));
          gl.uniform1f(pc.u.u_core, num(P.core, 0.6));
          gl.uniform1f(pc.u.u_flicker, num(P.flicker, 0));
          gl.uniform1f(pc.u.u_time, t);
          this.tex(0, cur.tex, pc.u.u_tex);
          this.tex(1, b1.tex, pc.u.u_aux);
          this.tex(2, b2.tex, pc.u.u_aux2);
          this.draw();
          this.release(b1);
          this.release(b2);
          swap(out);
          break;
        }
        case 'shadow': {
          const bl = this.blurPass(cur, Math.max(0.5, num(P.softness, 20) * s));
          const out = this.acquire();
          this.bindTarget(out);
          const pc = this.useV('combine', { u_mode: 2 });
          const a = (num(P.angle, 45) * Math.PI) / 180;
          const d = num(P.distance, 20) * s;
          gl.uniform3fv(pc.u.u_color, rgb(String(P.color ?? '#000000')));
          gl.uniform1f(pc.u.u_opacity, num(P.opacity, 0.7));
          gl.uniform2f(pc.u.u_offset, (Math.cos(a) * d) / this.outW, (-Math.sin(a) * d) / this.outH);
          this.tex(0, cur.tex, pc.u.u_tex);
          this.tex(1, bl.tex, pc.u.u_aux);
          this.tex(2, this.emptyTex, pc.u.u_aux2);
          this.draw();
          this.release(bl);
          swap(out);
          break;
        }
        case 'tiltShift':
          swap(this.blurPass(cur, num(P.blur, 20) * s, { focus: num(P.focus, 0.5), range: num(P.range, 0.2), angle: num(P.angle, 0), radial: !!P.radial }));
          break;
        case 'lightRays': {
          const out = this.acquire();
          this.bindTarget(out);
          const pr = this.use('rays');
          gl.uniform2f(pr.u.u_light, num(P.x, 0.5), num(P.y, 0.3));
          gl.uniform1f(pr.u.u_length, num(P.length, 0.5));
          gl.uniform1f(pr.u.u_intensity, num(P.intensity, 1));
          gl.uniform1f(pr.u.u_threshold, num(P.threshold, 0.4));
          gl.uniform3fv(pr.u.u_color, rgb(String(P.color ?? '#fff2cc')));
          this.tex(0, cur.tex, pr.u.u_tex);
          this.draw();
          swap(out);
          break;
        }
        case 'lensFlare':
          swap(
            this.fxPass(
              cur,
              18,
              (u) => {
                gl.uniform4f(u.u_p, num(P.x, 0.3), num(P.y, 0.3), num(P.intensity, 1), num(P.size, 1));
                gl.uniform3fv(u.u_c1, rgb(String(P.color ?? '#ffd9a0')));
              },
              t,
            ),
          );
          break;
        case 'rgbSplit':
          swap(this.fxPass(cur, 3, (u) => gl.uniform4f(u.u_p, num(P.amount, 8) * s, num(P.angle), 0, 0), t));
          break;
        case 'chromaticAberration':
          swap(this.fxPass(cur, 4, (u) => gl.uniform4f(u.u_p, num(P.amount, 0.3), 0, 0, 0), t));
          break;
        case 'glitch':
          swap(this.fxPass(cur, 5, (u) => gl.uniform4f(u.u_p, num(P.amount, 0.5), num(P.speed, 10), num(P.blocks, 16), num(P.rgb, 0.5)), t));
          break;
        case 'noise':
          swap(this.fxPass(cur, 6, (u) => gl.uniform4f(u.u_p, num(P.amount, 0.2), P.mono ? 1 : 0, num(P.speed, 24), 0), t));
          break;
        case 'flash':
          swap(
            this.fxPass(
              cur,
              7,
              (u) => {
                gl.uniform4f(u.u_p, num(P.amount, 0.8), 0, 0, 0);
                gl.uniform3fv(u.u_c1, rgb(String(P.color ?? '#ffffff')));
              },
              t,
            ),
          );
          break;
        case 'ripple':
          swap(
            this.fxPass(
              cur,
              8,
              (u) => {
                gl.uniform4f(u.u_p, num(P.amplitude, 12) * s, Math.max(1, num(P.wavelength, 60) * s), num(P.speed, 2), 0);
                gl.uniform4f(u.u_q, num(P.cx, 0.5), num(P.cy, 0.5), 0, 0);
              },
              t,
            ),
          );
          break;
        case 'wave':
          swap(this.fxPass(cur, 9, (u) => gl.uniform4f(u.u_p, num(P.amplitude, 15) * s, Math.max(1, num(P.wavelength, 120) * s), num(P.speed, 1), P.vertical ? 1 : 0), t));
          break;
        case 'gradientOverlay': {
          const modes: Record<string, number> = { fill: 0, multiply: 1, screen: 2, overlay: 3 };
          swap(
            this.fxPass(
              cur,
              10,
              (u) => {
                gl.uniform3fv(u.u_c1, rgb(String(P.color1 ?? '#ff2a6d')));
                gl.uniform3fv(u.u_c2, rgb(String(P.color2 ?? '#05d9e8')));
                gl.uniform4f(u.u_p, num(P.angle, 90), num(P.opacity, 1), modes[String(P.mode)] ?? 0, P.radial ? 1 : 0);
              },
              t,
            ),
          );
          break;
        }
        case 'pixelate':
          swap(this.fxPass(cur, 11, (u) => gl.uniform4f(u.u_p, Math.max(1, num(P.size, 16) * s), 0, 0, 0), t));
          break;
        case 'mirror':
          swap(this.fxPass(cur, 12, (u) => gl.uniform4f(u.u_p, P.mode === 'v' ? 1 : P.mode === 'quad' ? 2 : 0, 0, 0, 0), t));
          break;
        case 'invert':
          swap(this.fxPass(cur, 13, (u) => gl.uniform4f(u.u_p, num(P.amount, 1), 0, 0, 0), t));
          break;
        case 'posterize':
          swap(this.fxPass(cur, 14, (u) => gl.uniform4f(u.u_p, Math.max(2, num(P.levels, 6)), 0, 0, 0), t));
          break;
        case 'sharpen':
          swap(this.fxPass(cur, 15, (u) => gl.uniform4f(u.u_p, num(P.amount, 0.8), 0, 0, 0), t));
          break;
        case 'scanlines':
          swap(this.fxPass(cur, 16, (u) => gl.uniform4f(u.u_p, num(P.amount, 0.35), Math.max(0.5, num(P.density, 3) * s), 0, 0), t));
          break;
        case 'fisheye':
          swap(this.fxPass(cur, 17, (u) => gl.uniform4f(u.u_p, num(P.amount, 0.4), 0, 0, 0), t));
          break;
        default:
          break; // chromaKey / echo / cameraShake は描画段階で処理済み
      }
    }
    void p;
    return cur;
  }

  private blendInto(acc: PooledFBO, layer: FBO, mode: BlendMode, opacity: number): PooledFBO {
    const gl = this.gl;
    const out = this.acquire();
    this.bindTarget(out);
    const pr = this.useV('blend', { u_mode: BLEND_IDX[mode] ?? 0 });
    gl.uniform1f(pr.u.u_opacity, Math.max(0, Math.min(1, opacity)));
    this.tex(0, acc.tex, pr.u.u_base);
    this.tex(1, layer.tex, pr.u.u_layer);
    this.draw();
    this.release(acc);
    return out;
  }

  private transitionMix(a: FBO | null, b: FBO | null, type: TransitionType, prog: number, t: number): PooledFBO {
    const gl = this.gl;
    const out = this.acquire();
    this.bindTarget(out);
    const pr = this.useV('transition', { u_type: TRANS_IDX[type] ?? 0 });
    gl.uniform1f(pr.u.u_p, prog);
    gl.uniform2f(pr.u.u_res, this.outW, this.outH);
    gl.uniform1f(pr.u.u_time, t);
    this.tex(0, a ? a.tex : this.emptyTex, pr.u.u_a);
    this.tex(1, b ? b.tex : this.emptyTex, pr.u.u_b);
    this.draw();
    return out;
  }

  private adjust(p: Project, clip: Clip, acc: PooledFBO, t: number, opts: RenderOpts): PooledFBO {
    const gl = this.gl;
    const l = t - clip.start;
    const rc = resolveClipAt(clip, Math.max(0, Math.min(l, clip.duration)));
    let work = this.acquire();
    this.bindTarget(work);
    this.setLayerUniforms(rc, { w: this.outW, h: this.outH, cx: 0, cy: 0 }, t, true);
    const u = this.curLayer.u;
    // 画面全体を覆う四角形 (恒等変換)
    gl.uniform4f(u.u_rect, -1, -1, 1, 1);
    gl.uniform4f(u.u_uvRect, 0, 0, 1, 1);
    const id = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    gl.uniformMatrix4fv(u.u_mvp, false, id);
    gl.uniform1f(u.u_alphaMul, 1);
    this.tex(0, acc.tex, u.u_tex);
    this.draw();
    work = this.applyEffects(rc.effects, work, t, opts.scale, p);
    const opacity = rc.transform.opacity / 100;
    const out = this.blendInto(acc, work, 'normal', opacity);
    this.release(work);
    return out;
  }

  /** 書き出し用: この時刻に必要な動画フレームの一覧 */
  static videoNeeds(p: Project, t: number): { clip: Clip; asset: AssetMeta; srcTime: number }[] {
    const out: { clip: Clip; asset: AssetMeta; srcTime: number }[] = [];
    for (const track of p.tracks) {
      if (track.kind !== 'visual' || track.hidden) continue;
      for (const { clip } of layersOnTrack(p, track.id, t)) {
        if (clip.type !== 'video') continue;
        const asset = p.assets.find((a) => a.id === clip.assetId);
        if (asset) out.push({ clip, asset, srcTime: sourceTime(clip, t, asset.duration) });
      }
    }
    return out;
  }

  /** 1 フレーム描画。incomplete=true は素材が未準備で描けなかったレイヤーがあることを示す */
  render(p: Project, t: number, src: FrameSource, opts: RenderOpts): { incomplete: boolean; missing: string[] } {
    const state = { incomplete: false, missing: [] as string[] };
    if (this.lost || this.gl.isContextLost()) return { incomplete: true, missing: ['WebGL コンテキスト'] };
    const gl = this.gl;
    for (const f of this.pool) f.busy = false;
    let acc = this.acquire();
    const bg = rgb(p.background);
    this.clear(acc, bg[0], bg[1], bg[2], 1);
    for (const track of p.tracks) {
      if (track.kind !== 'visual' || track.hidden) continue;
      for (const item of layersOnTrack(p, track.id, t)) {
        const { clip } = item;
        if (clip.type === 'camera') continue;
        if (clip.type === 'adjustment') {
          acc = this.adjust(p, clip, acc, t, opts);
          continue;
        }
        let layer: PooledFBO | null;
        let opacity: number;
        let mode: BlendMode;
        if (item.transition) {
          // トランジション: 前のクリップ (A) と現在のクリップ (B) を混合
          const tr = item.transition;
          const a = tr.from ? this.renderClip(p, tr.from, t, src, opts, state) : null;
          const b = this.renderClip(p, clip, t, src, opts, state);
          const prog = applyEase(tr.ease, tr.progress);
          layer = this.transitionMix(a, b, tr.type, prog, t);
          this.release(a);
          this.release(b);
          opacity = 1;
          mode = clip.blendMode;
        } else {
          opacity = evalNum(clip, 'transform.opacity', Math.min(t - clip.start, clip.duration), clip.transform.opacity) / 100;
          mode = clip.blendMode;
          if (mode === 'normal' && !clip.effects.some((e) => e.enabled && !DIRECT_OK.has(e.type))) {
            if (opacity > 0.0001) this.renderClip(p, clip, t, src, opts, state, { acc, opacity: Math.min(1, opacity) });
            continue;
          }
          layer = this.renderClip(p, clip, t, src, opts, state);
        }
        if (!layer) continue;
        acc = this.blendInto(acc, layer, mode, opacity);
        this.release(layer);
      }
    }
    // 画面へ
    this.bindTarget(null);
    const pr = this.use('present');
    gl.uniform3f(pr.u.u_bg, bg[0], bg[1], bg[2]);
    this.tex(0, acc.tex, pr.u.u_tex);
    this.draw();
    this.release(acc);
    this.gc(p, opts.frame);
    return state;
  }

  private gcCounter = 0;
  private gc(p: Project, frame: number) {
    if (++this.gcCounter % 120 !== 0) return;
    const ids = new Set(p.clips.map((c) => c.id));
    for (const [id, e] of this.gen) {
      if (!ids.has(id) || frame - e.lastUsed > 600) {
        this.gl.deleteTexture(e.tex);
        this.gen.delete(id);
      }
    }
    for (const [id, tex] of this.videoTex) {
      if (!ids.has(id)) {
        this.gl.deleteTexture(tex);
        this.videoTex.delete(id);
      }
    }
  }

  dispose() {
    const gl = this.gl;
    for (const f of this.pool) deleteFBO(gl, f);
    for (const e of this.gen.values()) gl.deleteTexture(e.tex);
    for (const t of this.videoTex.values()) gl.deleteTexture(t);
    this.pool = [];
    this.gen.clear();
    this.videoTex.clear();
    (gl.getExtension('WEBGL_lose_context') as any)?.loseContext?.();
  }
}

interface LayerItem {
  clip: Clip;
  transition?: { from: Clip | null; type: TransitionType; progress: number; ease: Ease };
}

/** トラック上で時刻 t に描画すべきクリップ (トランジション情報付き) */
export function layersOnTrack(p: Project, trackId: string, t: number): LayerItem[] {
  const clips = p.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
  const out: LayerItem[] = [];
  const eps = 0.5 / p.fps;
  for (const c of clips) {
    if (t < c.start || t >= clipEnd(c)) continue;
    const tr = c.transitionIn;
    if (tr && tr.duration > 0 && t < c.start + tr.duration) {
      const prev = clips.find((x) => x !== c && Math.abs(clipEnd(x) - c.start) < eps) ?? null;
      out.push({ clip: c, transition: { from: prev, type: tr.type, progress: (t - c.start) / tr.duration, ease: tr.ease } });
    } else out.push({ clip: c });
  }
  return out;
}

export { buildCurve, parseCube } from './compositor-math';
