import type { CharAnimation, Fill, TextStyle } from '../model/types';
import { applyEase, parseColor, toHex } from '../model/keyframes';
import { JP_FONT_STACK } from '../model/defaults';

export interface LayerImage {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  /** 論理サイズ (コンポジション px) */
  w: number;
  h: number;
  /** ローカル原点 (アンカー基準点) の位置 (論理 px, 左上から) */
  cx: number;
  cy: number;
}

export function fontString(st: Pick<TextStyle, 'fontFamily' | 'fontWeight' | 'italic'>, size: number): string {
  const fam = st.fontFamily ? `"${st.fontFamily.replace(/"/g, '')}", ` : '';
  return `${st.italic ? 'italic ' : ''}${st.fontWeight || 400} ${Math.max(1, size)}px ${fam}${JP_FONT_STACK}`;
}

let measureCtx: CanvasRenderingContext2D | null = null;
function mctx() {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')!;
  return measureCtx;
}

// 縦書き用の字形置き換え・回転
const VERT_MAP: Record<string, string> = { '「': '﹁', '」': '﹂', '『': '﹃', '』': '﹄', '（': '︵', '）': '︶', '(': '︵', ')': '︶', '【': '︻', '】': '︼', '〔': '︹', '〕': '︺', '［': '﹇', '］': '﹈', '｛': '︷', '｝': '︸', '〈': '︿', '〉': '﹀', '《': '︽', '》': '︾', '…': '︙', '‥': '︰' };
const VERT_ROTATE = new Set(['ー', '−', '-', '—', '―', '〜', '～', '~', '=', '＝', '→', '←', '：', ':', '；', ';']);
const VERT_SHIFT = new Set(['、', '。', '，', '．', ',', '.', 'っ', 'ゃ', 'ゅ', 'ょ', 'ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ', 'ッ', 'ャ', 'ュ', 'ョ', 'ァ', 'ィ', 'ゥ', 'ェ', 'ォ', 'ヮ', 'ゎ']);

interface Glyph {
  ch: string;
  x: number; // 文字中心 (論理 px, コンテンツ左上原点)
  y: number; // ベースライン中心付近 (middle)
  w: number;
  rotate: boolean;
  line: number;
  index: number;
  shift: boolean;
}

export interface TextLayout {
  glyphs: Glyph[];
  width: number;
  height: number;
  fontSize: number;
}

export function layoutText(content: string, st: TextStyle, opts: { tabular?: boolean } = {}): TextLayout {
  const ctx = mctx();
  const fs = st.fontSize;
  ctx.font = fontString(st, fs);
  const lines = content.replace(/\r/g, '').split('\n');
  const glyphs: Glyph[] = [];
  const lh = fs * st.lineHeight;
  let index = 0;
  const digitW = opts.tabular ? Math.max(...'0123456789'.split('').map((d) => ctx.measureText(d).width)) : 0;
  if (!st.vertical) {
    const widths: number[] = [];
    const lineGlyphs: Glyph[][] = [];
    lines.forEach((line, li) => {
      const chars = Array.from(line);
      const gs: Glyph[] = [];
      let x = 0;
      let prefix = '';
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        let w: number;
        let px: number;
        if (opts.tabular && /\d/.test(ch)) {
          w = digitW;
          px = x;
        } else {
          // 接頭辞の幅で位置を決めることでカーニングを保つ
          const before = ctx.measureText(prefix).width;
          w = ctx.measureText(ch).width;
          px = opts.tabular ? x : before + i * st.letterSpacing;
        }
        gs.push({ ch, x: px + w / 2, y: li * lh + lh / 2, w, rotate: false, line: li, index: index++, shift: false });
        prefix += ch;
        x = px + w + st.letterSpacing;
      }
      const lw = gs.length ? gs[gs.length - 1].x + gs[gs.length - 1].w / 2 : 0;
      widths.push(lw);
      lineGlyphs.push(gs);
    });
    const width = Math.max(1, ...widths);
    lineGlyphs.forEach((gs, li) => {
      const off = st.align === 'left' ? 0 : st.align === 'right' ? width - widths[li] : (width - widths[li]) / 2;
      for (const g of gs) {
        g.x += off;
        glyphs.push(g);
      }
    });
    return { glyphs, width, height: Math.max(lh, lines.length * lh), fontSize: fs };
  }
  // 縦書き: 列は右から左
  const colW = fs * st.lineHeight;
  const adv = fs + st.letterSpacing;
  const cols = lines.length;
  let maxLen = 0;
  lines.forEach((line, li) => {
    const chars = Array.from(line);
    maxLen = Math.max(maxLen, chars.length);
    chars.forEach((ch0, i) => {
      const ch = VERT_MAP[ch0] ?? ch0;
      const x = (cols - 1 - li) * colW + colW / 2;
      const y = i * adv + fs / 2;
      glyphs.push({ ch, x, y, w: ctx.measureText(ch).width, rotate: VERT_ROTATE.has(ch0), line: li, index: index++, shift: VERT_SHIFT.has(ch0) });
    });
  });
  const height = Math.max(fs, maxLen * adv - st.letterSpacing);
  // 揃え (縦方向)
  lines.forEach((line, li) => {
    const len = Array.from(line).length * adv - st.letterSpacing;
    const off = st.align === 'left' ? 0 : st.align === 'right' ? height - len : (height - len) / 2;
    for (const g of glyphs) if (g.line === li) g.y += off;
  });
  return { glyphs, width: cols * colW, height, fontSize: fs };
}

interface CharState {
  opacity: number;
  dx: number;
  dy: number;
  scale: number;
  rot: number;
  hue: number;
  blur: number;
}

function orderIndex(i: number, n: number, order: CharAnimation['order'], seed: number) {
  switch (order) {
    case 'backward':
      return n - 1 - i;
    case 'center':
      return Math.abs(i - (n - 1) / 2);
    case 'random': {
      const r = Math.sin((i + 1) * 12.9898 + seed * 78.233) * 43758.5453;
      return (r - Math.floor(r)) * n;
    }
    default:
      return i;
  }
}

function rnd(a: number, b: number) {
  const r = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return r - Math.floor(r);
}

export function charStates(layout: TextLayout, anims: CharAnimation[], t: number, clipDur: number): CharState[] {
  const n = layout.glyphs.length;
  const fs = layout.fontSize;
  return layout.glyphs.map((g, i) => {
    const s: CharState = { opacity: 1, dx: 0, dy: 0, scale: 1, rot: 0, hue: 0, blur: 0 };
    for (const a of anims) {
      if (a.kind === 'none') continue;
      const k = orderIndex(i, n, a.order, 7);
      if (a.mode === 'loop') {
        const ph = t * Math.max(0.05, 1 / Math.max(0.05, a.duration)) * Math.PI * 2 - k * a.stagger * Math.PI * 2;
        switch (a.kind) {
          case 'wave':
            s.dy += Math.sin(ph) * fs * 0.15 * a.amount;
            break;
          case 'shake': {
            const f = Math.floor(t * 30);
            s.dx += (rnd(i, f) - 0.5) * fs * 0.12 * a.amount;
            s.dy += (rnd(i + 99, f) - 0.5) * fs * 0.12 * a.amount;
            break;
          }
          case 'jitter': {
            const f = Math.floor(t * 12);
            s.rot += (rnd(i, f) - 0.5) * 0.35 * a.amount;
            s.scale *= 1 + (rnd(i + 7, f) - 0.5) * 0.2 * a.amount;
            break;
          }
          case 'colorWave':
            s.hue += ((Math.sin(ph) + 1) / 2) * 120 * a.amount;
            break;
          case 'scaleIn':
          case 'popIn':
            s.scale *= 1 + Math.sin(ph) * 0.12 * a.amount;
            break;
          case 'fade':
            s.opacity *= 0.55 + 0.45 * Math.sin(ph);
            break;
          default:
            break;
        }
        continue;
      }
      const tt = a.mode === 'in' ? t : clipDur - t;
      const raw = (tt - k * a.stagger) / Math.max(0.001, a.duration);
      const p = Math.max(0, Math.min(1, raw));
      const e = applyEase(a.ease, p);
      const inv = 1 - e;
      switch (a.kind) {
        case 'typewriter':
          s.opacity *= raw >= 0 ? (raw > 0 ? 1 : 0) : 0;
          if (tt - k * a.stagger <= 0) s.opacity = 0;
          break;
        case 'fade':
          s.opacity *= Math.max(0, Math.min(1, e));
          break;
        case 'slideUp':
          s.dy += inv * fs * 0.8 * a.amount;
          s.opacity *= Math.min(1, p * 2);
          break;
        case 'slideDown':
          s.dy -= inv * fs * 0.8 * a.amount;
          s.opacity *= Math.min(1, p * 2);
          break;
        case 'scaleIn':
          s.scale *= Math.max(0, e);
          s.opacity *= Math.min(1, p * 3);
          break;
        case 'popIn':
          s.scale *= Math.max(0, applyEase({ kind: 'overshoot', amount: 1.6 * a.amount }, p));
          s.opacity *= Math.min(1, p * 4);
          break;
        case 'rotateIn':
          s.rot += inv * -Math.PI * 0.6 * a.amount;
          s.scale *= 0.5 + 0.5 * e;
          s.opacity *= Math.min(1, p * 2);
          break;
        case 'blurIn':
          s.blur += inv * fs * 0.25 * a.amount;
          s.scale *= 1 + inv * 0.6;
          s.opacity *= Math.min(1, e * 1.5);
          break;
        case 'drop':
          s.dy -= inv * fs * 2.2 * a.amount;
          s.opacity *= Math.min(1, p * 4);
          break;
        default:
          break;
      }
    }
    return s;
  });
}

function makeFill(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, f: Fill, x0: number, y0: number, w: number, h: number): string | CanvasGradient {
  if (f.type === 'solid') return f.color;
  if (f.type === 'radial') {
    const g = ctx.createRadialGradient(x0 + w / 2, y0 + h / 2, 0, x0 + w / 2, y0 + h / 2, Math.max(w, h) / 2);
    g.addColorStop(0, f.color);
    g.addColorStop(1, f.color2);
    return g;
  }
  if (f.type === 'metal') {
    const g = ctx.createLinearGradient(x0, y0, x0, y0 + h);
    const [r, gg, b] = parseColor(f.color);
    const dark = toHex(r * 0.45, gg * 0.45, b * 0.45);
    g.addColorStop(0, f.color2);
    g.addColorStop(0.35, f.color);
    g.addColorStop(0.5, dark);
    g.addColorStop(0.52, f.color);
    g.addColorStop(0.8, f.color2);
    g.addColorStop(1, f.color3 ?? dark);
    return g;
  }
  const a = (f.angle * Math.PI) / 180;
  const cx = x0 + w / 2;
  const cy = y0 + h / 2;
  const len = (Math.abs(Math.cos(a)) * w + Math.abs(Math.sin(a)) * h) / 2;
  const g = ctx.createLinearGradient(cx - Math.cos(a) * len, cy - Math.sin(a) * len, cx + Math.cos(a) * len, cy + Math.sin(a) * len);
  g.addColorStop(0, f.color);
  if (f.color3) g.addColorStop(0.5, f.color3);
  g.addColorStop(1, f.color2);
  return g;
}

function hueRotateHex(hex: string, deg: number): string {
  const [r, g, b, a] = parseColor(hex);
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
    h *= 60;
  }
  h = (h + deg) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return toHex((r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255, a);
}

const supportsFilter = (() => {
  try {
    const c = document.createElement('canvas').getContext('2d') as any;
    return c && typeof c.filter === 'string' && /Chrome|Firefox/.test(navigator.userAgent) && !/Version\/[\d.]+ .*Safari/.test(navigator.userAgent);
  } catch {
    return false;
  }
})();

export function textPadding(st: TextStyle): number {
  const strokeW = st.strokes.reduce((a, s) => a + (s.enabled ? s.width : 0), 0);
  let pad = strokeW + 4;
  if (st.glow.enabled) pad += st.glow.blur * 1.5;
  if (st.shadow.enabled) pad += st.shadow.blur * 1.5 + Math.max(Math.abs(st.shadow.offsetX), Math.abs(st.shadow.offsetY));
  if (st.extrude.enabled) pad += st.extrude.depth;
  if (st.background.enabled) pad += Math.max(st.background.paddingX, st.background.paddingY) + Math.abs(st.background.skew) * 0.5 + (st.background.borderWidth ?? 0);
  return pad + st.fontSize * 0.3;
}

function ensureCanvas(c: HTMLCanvasElement | undefined, w: number, h: number): HTMLCanvasElement {
  const cv = c ?? document.createElement('canvas');
  if (cv.width !== w || cv.height !== h) {
    cv.width = w;
    cv.height = h;
  } else cv.getContext('2d')!.clearRect(0, 0, w, h);
  return cv;
}

const scratch: { a?: HTMLCanvasElement } = {};

/**
 * テキストを描画する。
 * res: 論理 px → 実ピクセル倍率 (プレビュー縮小・拡大表示時の高解像度化)
 */
export function renderText(
  target: HTMLCanvasElement | undefined,
  content: string,
  st: TextStyle,
  anims: CharAnimation[],
  t: number,
  clipDur: number,
  res: number,
  opts: { tabular?: boolean } = {},
): LayerImage & { canvas: HTMLCanvasElement } {
  const layout = layoutText(content, st, opts);
  const pad = textPadding(st);
  const W = layout.width + pad * 2;
  const H = layout.height + pad * 2;
  // 巨大テクスチャの防止
  const maxPx = 4096;
  const r = Math.min(res, maxPx / W, maxPx / H);
  const pw = Math.max(1, Math.ceil(W * r));
  const ph = Math.max(1, Math.ceil(H * r));
  const out = ensureCanvas(target, pw, ph);
  const body = ensureCanvas(scratch.a, pw, ph);
  scratch.a = body;
  const ctx = body.getContext('2d')!;
  ctx.setTransform(r, 0, 0, r, pad * r, pad * r);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  const fs = st.fontSize;
  const states = charStates(layout, anims, t, clipDur);

  // 座布団 (テロップ背景)
  const bg = st.background;
  if (bg.enabled && bg.opacity > 0) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    layout.glyphs.forEach((g, i) => {
      if (states[i].opacity <= 0.001 && anims.some((a) => a.kind === 'typewriter')) return;
      const hw = st.vertical ? fs / 2 : g.w / 2;
      const hh = st.vertical ? fs / 2 : (fs * st.lineHeight) / 2;
      minX = Math.min(minX, g.x - hw);
      maxX = Math.max(maxX, g.x + hw);
      minY = Math.min(minY, g.y - hh);
      maxY = Math.max(maxY, g.y + hh);
    });
    if (Number.isFinite(minX)) {
      const x0 = minX - bg.paddingX;
      const y0 = minY - bg.paddingY;
      const w = maxX - minX + bg.paddingX * 2;
      const h = maxY - minY + bg.paddingY * 2;
      ctx.save();
      ctx.globalAlpha = bg.opacity;
      ctx.transform(1, 0, Math.tan((bg.skew * Math.PI) / 180), 1, -Math.tan((bg.skew * Math.PI) / 180) * (y0 + h / 2), 0);
      ctx.fillStyle = bg.color2 ? makeFill(ctx, { type: 'linear', color: bg.color, color2: bg.color2, angle: 90 }, x0, y0, w, h) : bg.color;
      ctx.beginPath();
      roundRect(ctx, x0, y0, w, h, Math.min(bg.radius, h / 2, w / 2));
      ctx.fill();
      if (bg.borderWidth && bg.borderColor) {
        ctx.lineWidth = bg.borderWidth;
        ctx.strokeStyle = bg.borderColor;
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  const fillStyle = makeFill(ctx, st.fill, 0, 0, layout.width, layout.height);
  const font = fontString(st, fs);
  ctx.font = font;
  const strokes = st.strokes.filter((s) => s.enabled && s.width > 0);
  // 縁取りは外側から順に、累積幅で描画する (二重・三重縁取り)
  const cum: { color: string; width: number }[] = [];
  let acc = 0;
  for (const s of strokes) {
    acc += s.width;
    cum.push({ color: s.color, width: acc * 2 });
  }

  const drawGlyph = (g: Glyph, s: CharState, pass: (dx: number, dy: number) => void) => {
    if (s.opacity <= 0.001 || s.scale <= 0.001) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, s.opacity);
    ctx.translate(g.x + s.dx + (g.shift ? fs * 0.35 : 0), g.y + s.dy - (g.shift ? fs * 0.35 : 0));
    if (s.rot) ctx.rotate(s.rot);
    if (g.rotate) ctx.rotate(Math.PI / 2);
    if (s.scale !== 1) ctx.scale(s.scale, s.scale);
    if (s.blur > 0.5 && supportsFilter) (ctx as any).filter = `blur(${s.blur * r}px)`;
    pass(0, 0);
    ctx.restore();
  };

  // 立体文字 (押し出し)
  if (st.extrude.enabled && st.extrude.depth > 0) {
    const a = (st.extrude.angle * Math.PI) / 180;
    const steps = Math.ceil(st.extrude.depth);
    const [er, eg, eb] = parseColor(st.extrude.color);
    const outer = cum.length ? cum[cum.length - 1].width : 0;
    for (let k = steps; k >= 1; k--) {
      const shade = 0.6 + 0.4 * (1 - k / steps);
      const col = toHex(er * shade, eg * shade, eb * shade);
      layout.glyphs.forEach((g, i) =>
        drawGlyph(g, states[i], () => {
          const dx = Math.cos(a) * k;
          const dy = Math.sin(a) * k;
          if (outer > 0) {
            ctx.lineWidth = outer;
            ctx.strokeStyle = col;
            ctx.strokeText(g.ch, dx, dy);
          }
          ctx.fillStyle = col;
          ctx.fillText(g.ch, dx, dy);
        }),
      );
    }
  }
  for (let k = cum.length - 1; k >= 0; k--) {
    ctx.lineWidth = cum[k].width;
    ctx.strokeStyle = cum[k].color;
    layout.glyphs.forEach((g, i) => drawGlyph(g, states[i], () => ctx.strokeText(g.ch, 0, 0)));
  }
  layout.glyphs.forEach((g, i) =>
    drawGlyph(g, states[i], () => {
      if (states[i].hue) ctx.fillStyle = hueRotateHex(st.fill.color, states[i].hue);
      else {
        // グラデーションは全体座標で揃えるため、文字のローカル原点分ずらす
        ctx.save();
        ctx.translate(-g.x, -g.y);
        ctx.fillStyle = fillStyle;
        ctx.fillText(g.ch, g.x, g.y);
        ctx.restore();
        return;
      }
      ctx.fillText(g.ch, 0, 0);
    }),
  );
  if (st.gloss.enabled) {
    layout.glyphs.forEach((g, i) =>
      drawGlyph(g, states[i], () => {
        const gr = ctx.createLinearGradient(0, -fs / 2, 0, fs * 0.1);
        gr.addColorStop(0, `rgba(255,255,255,${st.gloss.opacity})`);
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gr;
        ctx.fillText(g.ch, 0, 0);
      }),
    );
  }

  // 仕上げ: 発光・影を合成
  const octx = out.getContext('2d')!;
  octx.setTransform(1, 0, 0, 1, 0, 0);
  if (st.glow.enabled && st.glow.strength > 0) {
    octx.save();
    octx.shadowColor = st.glow.color;
    octx.shadowBlur = st.glow.blur * r;
    const n = Math.max(1, Math.min(4, Math.round(st.glow.strength * 2)));
    for (let i = 0; i < n; i++) octx.drawImage(body, 0, 0);
    octx.restore();
  }
  if (st.shadow.enabled) {
    octx.save();
    octx.shadowColor = st.shadow.color;
    octx.shadowBlur = st.shadow.blur * r;
    octx.shadowOffsetX = st.shadow.offsetX * r;
    octx.shadowOffsetY = st.shadow.offsetY * r;
    octx.drawImage(body, 0, 0);
    octx.restore();
  }
  octx.drawImage(body, 0, 0);
  // 揃え位置をレイヤーの原点にする (左揃えなら左端が位置の基準)
  let cx = W / 2;
  let cy = H / 2;
  if (!st.vertical) {
    if (st.align === 'left') cx = pad;
    else if (st.align === 'right') cx = W - pad;
  } else {
    if (st.align === 'left') cy = pad;
    else if (st.align === 'right') cy = H - pad;
  }
  return { canvas: out, w: W, h: H, cx, cy };
}

export function roundRect(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

export { makeFill, hueRotateHex };
