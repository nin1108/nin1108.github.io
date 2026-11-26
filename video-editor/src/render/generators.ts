// Canvas2D で生成するレイヤー (図形・パーティクル・カウンター・グラフ・背景)
import type { ChartData, CounterData, ParticleData, ShapeData, SolidData } from '../model/types';
import { makeFill, renderText, roundRect, type LayerImage } from './text';
import { iconById } from './icons';
import { parseColor } from '../model/keyframes';

type Ctx = CanvasRenderingContext2D;

function prep(target: HTMLCanvasElement | undefined, W: number, H: number, res: number) {
  const r = Math.min(res, 4096 / Math.max(1, W), 4096 / Math.max(1, H));
  const pw = Math.max(1, Math.ceil(W * r));
  const ph = Math.max(1, Math.ceil(H * r));
  const c = target ?? document.createElement('canvas');
  if (c.width !== pw || c.height !== ph) {
    c.width = pw;
    c.height = ph;
  }
  const ctx = c.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, pw, ph);
  ctx.setTransform(r, 0, 0, r, 0, 0);
  return { c, ctx, r };
}

// ---- 図形 ----
let pathMeasure: SVGPathElement | null = null;
const lenCache = new Map<string, number>();
function svgPathLength(d: string): number {
  const hit = lenCache.get(d);
  if (hit != null) return hit;
  try {
    if (!pathMeasure) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '0');
      svg.setAttribute('height', '0');
      svg.style.position = 'absolute';
      svg.style.visibility = 'hidden';
      pathMeasure = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      svg.appendChild(pathMeasure);
      document.body.appendChild(svg);
    }
    pathMeasure.setAttribute('d', d);
    const l = pathMeasure.getTotalLength();
    lenCache.set(d, l);
    return l;
  } catch {
    return 1000;
  }
}

function polygonPoints(n: number, rx: number, ry: number, star: boolean, inner: number): [number, number][] {
  const pts: [number, number][] = [];
  const count = star ? n * 2 : n;
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / count;
    const k = star && i % 2 === 1 ? inner : 1;
    pts.push([Math.cos(a) * rx * k, Math.sin(a) * ry * k]);
  }
  return pts;
}

function perimeter(pts: [number, number][], closed: boolean) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (closed && pts.length > 1) l += Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
  return l;
}

export function renderShape(target: HTMLCanvasElement | undefined, s: ShapeData, res: number): LayerImage & { canvas: HTMLCanvasElement } {
  const sw = s.stroke.enabled ? s.stroke.width : 0;
  const pad = sw + (s.kind === 'arrow' ? s.arrowHead : 0) + 4;
  const W = s.width + pad * 2;
  const H = s.height + pad * 2;
  const { c, ctx } = prep(target, W, H, res);
  ctx.translate(W / 2, H / 2);
  const w = s.width;
  const h = s.height;
  const trimS = Math.max(0, Math.min(1, s.trimStart));
  const trimE = Math.max(0, Math.min(1, s.trimEnd));
  const trimmed = trimS > 0.0001 || trimE < 0.9999;
  ctx.lineCap = s.stroke.cap;
  ctx.lineJoin = 'round';

  const applyStroke = (len: number) => {
    if (!s.stroke.enabled || sw <= 0) return;
    ctx.lineWidth = sw;
    ctx.strokeStyle = s.stroke.color;
    if (trimmed) {
      if (trimE - trimS <= 0.0001) return;
      ctx.setLineDash([len * (trimE - trimS), len * 2]);
      ctx.lineDashOffset = -len * trimS;
    } else if (s.stroke.dash > 0) ctx.setLineDash([s.stroke.dash, s.stroke.dash]);
    else ctx.setLineDash([]);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  const applyFill = (path?: Path2D) => {
    if (!s.fill.enabled) return;
    ctx.fillStyle = makeFill(ctx, s.fill, -w / 2, -h / 2, w, h);
    if (path) ctx.fill(path, 'evenodd');
    else ctx.fill('evenodd');
  };

  switch (s.kind) {
    case 'rect': {
      ctx.beginPath();
      roundRect(ctx, -w / 2, -h / 2, w, h, s.radius);
      applyFill();
      applyStroke(2 * (w + h));
      break;
    }
    case 'ellipse': {
      ctx.beginPath();
      ctx.ellipse(0, 0, w / 2, h / 2, 0, -Math.PI / 2, Math.PI * 1.5);
      applyFill();
      const a = w / 2;
      const b = h / 2;
      applyStroke(Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b))));
      break;
    }
    case 'polygon':
    case 'star': {
      const pts = polygonPoints(Math.max(3, Math.round(s.sides)), w / 2, h / 2, s.kind === 'star', s.innerRatio);
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      applyFill();
      applyStroke(perimeter(pts, true));
      break;
    }
    case 'line': {
      ctx.beginPath();
      ctx.moveTo(-w / 2, 0);
      ctx.lineTo(w / 2, 0);
      applyStroke(w);
      break;
    }
    case 'arrow': {
      const head = s.arrowHead;
      const shaftEnd = w / 2 - head * 0.6;
      const tipX = -w / 2 + w * trimE;
      ctx.beginPath();
      ctx.moveTo(-w / 2 + w * trimS, 0);
      ctx.lineTo(Math.min(tipX, shaftEnd), 0);
      if (s.stroke.enabled) {
        ctx.lineWidth = sw;
        ctx.strokeStyle = s.stroke.color;
        ctx.stroke();
      }
      if (trimE > 0.02) {
        const hx = Math.min(tipX, w / 2);
        ctx.beginPath();
        ctx.moveTo(hx, 0);
        ctx.lineTo(hx - head, -head * 0.6);
        ctx.lineTo(hx - head, head * 0.6);
        ctx.closePath();
        ctx.fillStyle = s.stroke.enabled ? s.stroke.color : s.fill.color;
        ctx.fill();
      }
      break;
    }
    case 'ring': {
      const r = Math.min(w, h) / 2 - s.thickness / 2;
      ctx.lineWidth = s.thickness;
      ctx.lineCap = s.stroke.cap;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      const [cr, cg, cb] = parseColor(s.fill.color);
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.22)`;
      ctx.stroke();
      const p = Math.max(0, Math.min(100, s.progress)) / 100;
      if (p > 0) {
        ctx.beginPath();
        ctx.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
        ctx.strokeStyle = s.fill.type === 'solid' ? s.stroke.color : makeFill(ctx, s.fill, -w / 2, -h / 2, w, h);
        ctx.stroke();
      }
      break;
    }
    case 'path':
    case 'icon': {
      const icon = s.kind === 'icon' ? iconById(s.iconId) : undefined;
      const d = icon ? icon.d : s.pathD || 'M0 0';
      const vb = icon ? [0, 0, 24, 24] : (s.pathViewBox ?? [0, 0, 100, 100]);
      const sc = Math.min(w / vb[2], h / vb[3]);
      ctx.save();
      ctx.scale(sc, sc);
      ctx.translate(-vb[0] - vb[2] / 2, -vb[1] - vb[3] / 2);
      const path = new Path2D(d);
      if (s.fill.enabled) {
        ctx.fillStyle = makeFill(ctx, s.fill, vb[0], vb[1], vb[2], vb[3]);
        ctx.fill(path, 'evenodd');
      }
      if (s.stroke.enabled && sw > 0) {
        ctx.lineWidth = sw / sc;
        ctx.strokeStyle = s.stroke.color;
        if (trimmed) {
          const len = svgPathLength(d);
          ctx.setLineDash([len * (trimE - trimS), len * 2]);
          ctx.lineDashOffset = -len * trimS;
        }
        ctx.stroke(path);
        ctx.setLineDash([]);
      }
      ctx.restore();
      break;
    }
  }
  return { canvas: c, w: W, h: H, cx: W / 2, cy: H / 2 };
}

// ---- パーティクル (時間の関数として決定論的に計算 → プレビューと書き出しが一致) ----
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const spriteCache = new Map<string, HTMLCanvasElement>();
function glowSprite(color: string, soft: number): HTMLCanvasElement {
  const key = color + '|' + soft.toFixed(2);
  let c = spriteCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const [r, gg, b] = parseColor(color);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, `rgba(255,255,255,1)`);
  grad.addColorStop(0.15 + (1 - soft) * 0.3, `rgba(${r},${gg},${b},1)`);
  grad.addColorStop(0.45 + (1 - soft) * 0.3, `rgba(${r},${gg},${b},${0.35 * soft + 0.1})`);
  grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  spriteCache.set(key, c);
  return c;
}

export function renderParticles(target: HTMLCanvasElement | undefined, p: ParticleData, t: number, res: number): LayerImage & { canvas: HTMLCanvasElement } {
  const W = p.width;
  const H = p.height;
  const { c, ctx } = prep(target, W, H, res);
  const n = Math.max(0, Math.min(2000, Math.round(p.count)));
  const life = Math.max(0.05, p.lifetime);
  const dir = (p.direction * Math.PI) / 180;
  const spread = (p.spread * Math.PI) / 180;
  const glowing = p.glow > 0.01;
  ctx.globalCompositeOperation = glowing && p.kind !== 'confetti' ? 'lighter' : 'source-over';
  for (let i = 0; i < n; i++) {
    const base = mulberry(p.seed * 7919 + i * 104729);
    const offset = p.burst ? base() * 0.15 : base() * life;
    let age: number;
    let cycle = 0;
    if (p.burst) {
      age = t - offset;
      if (age < 0 || age > life) continue;
    } else {
      const tt = t + life - offset; // 開始時点ですでに画面内に存在させる
      cycle = Math.floor(tt / life);
      age = tt - cycle * life;
    }
    const rnd = mulberry(p.seed * 31 + i * 7717 + cycle * 1299709);
    const ex = (p.emitterX + (rnd() - 0.5) * p.emitterW) * W;
    const ey = (p.emitterY + (rnd() - 0.5) * p.emitterH) * H;
    const ang = dir + (rnd() - 0.5) * spread;
    const sp = p.speed * (0.4 + rnd() * 0.8);
    const vx = Math.cos(ang) * sp;
    const vy = Math.sin(ang) * sp;
    let x = ex + vx * age;
    let y = ey + vy * age + 0.5 * p.gravity * age * age;
    const size = p.size * (0.4 + rnd() * 1.0);
    const color = p.colors[Math.floor(rnd() * p.colors.length) % Math.max(1, p.colors.length)] ?? '#ffffff';
    const lp = age / life;
    let alpha = Math.min(1, lp * 8) * Math.min(1, (1 - lp) * 4);
    const phase = rnd() * Math.PI * 2;
    switch (p.kind) {
      case 'confetti': {
        const spin = 4 + rnd() * 8;
        const sway = Math.sin(age * 3 + phase) * 30;
        x += sway;
        y -= 0.5 * p.gravity * age * age * Math.min(0.85, age * 0.6); // 空気抵抗の近似
        ctx.save();
        ctx.globalAlpha = Math.min(1, (1 - lp) * 3);
        ctx.translate(x, y);
        ctx.rotate(age * spin + phase);
        ctx.scale(1, Math.cos(age * spin * 1.3 + phase));
        ctx.fillStyle = color;
        if (rnd() > 0.7) {
          ctx.beginPath();
          ctx.arc(0, 0, size * 0.45, 0, Math.PI * 2);
          ctx.fill();
        } else ctx.fillRect(-size / 2, -size * 0.3, size, size * 0.6);
        ctx.restore();
        continue;
      }
      case 'sparks':
      case 'rain': {
        const cvx = vx;
        const cvy = vy + p.gravity * age;
        const sl = Math.hypot(cvx, cvy) || 1;
        const len = p.kind === 'rain' ? size * 10 : Math.min(60, sl * 0.04) + size;
        ctx.globalAlpha = alpha * (p.kind === 'rain' ? 0.55 : 1);
        ctx.strokeStyle = color;
        ctx.lineWidth = size * (p.kind === 'rain' ? 0.5 : 0.7);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - (cvx / sl) * len, y - (cvy / sl) * len);
        ctx.stroke();
        if (glowing && p.kind === 'sparks') {
          const s = glowSprite(color, 1);
          const gsz = size * 6 * p.glow;
          ctx.globalAlpha = alpha * 0.6;
          ctx.drawImage(s, x - gsz / 2, y - gsz / 2, gsz, gsz);
        }
        continue;
      }
      case 'snow':
        x += Math.sin(age * 1.2 + phase) * 25;
        break;
      case 'stars':
        alpha *= 0.55 + 0.45 * Math.sin(t * (1.5 + rnd() * 3) + phase);
        break;
      case 'fireflies':
        x += Math.sin(age * 0.9 + phase) * 40;
        y += Math.cos(age * 0.7 + phase * 2) * 30;
        alpha *= 0.4 + 0.6 * Math.max(0, Math.sin(t * 2.2 + phase));
        break;
      case 'bokeh':
        alpha *= 0.35;
        break;
      default:
        break;
    }
    if (alpha <= 0.002) continue;
    ctx.globalAlpha = Math.max(0, alpha);
    if (glowing || p.kind === 'bokeh') {
      const s = glowSprite(color, p.kind === 'bokeh' ? 0.2 : p.glow);
      const gsz = size * (p.kind === 'bokeh' ? 1 : 2 + p.glow * 4);
      ctx.drawImage(s, x - gsz / 2, y - gsz / 2, gsz, gsz);
    } else {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  return { canvas: c, w: W, h: H, cx: W / 2, cy: H / 2 };
}

// ---- カウンター / タイマー ----
export function counterText(cd: CounterData): string {
  const v = cd.from + (cd.to - cd.from) * cd.progress;
  if (cd.mode === 'timer') {
    const total = Math.max(0, v);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = Math.floor(total % 60);
    const ff = Math.floor((total % 1) * 100);
    const p2 = (n: number) => String(n).padStart(2, '0');
    const body = cd.timerFormat === 'hh:mm:ss' ? `${p2(h)}:${p2(m)}:${p2(s)}` : cd.timerFormat === 'mm:ss.ff' ? `${p2(m + h * 60)}:${p2(s)}.${p2(ff)}` : `${p2(m + h * 60)}:${p2(s)}`;
    return cd.prefix + body + cd.suffix;
  }
  const fixed = Math.abs(v).toFixed(Math.max(0, Math.min(6, cd.decimals)));
  let [ip, dp] = fixed.split('.');
  if (cd.thousands) ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return cd.prefix + (v < 0 ? '-' : '') + ip + (dp ? '.' + dp : '') + cd.suffix;
}

export function renderCounter(target: HTMLCanvasElement | undefined, cd: CounterData, res: number) {
  return renderText(target, counterText(cd), cd.style, [], 0, 1, res, { tabular: true });
}

// ---- グラフ ----
export function renderChart(target: HTMLCanvasElement | undefined, ch: ChartData, res: number): LayerImage & { canvas: HTMLCanvasElement } {
  const pad = 40;
  const W = ch.width + pad * 2;
  const H = ch.height + pad * 2;
  const { c, ctx } = prep(target, W, H, res);
  ctx.translate(pad, pad);
  const n = Math.max(1, ch.values.length);
  const max = ch.maxValue > 0 ? ch.maxValue : Math.max(1e-9, ...ch.values.map((v) => Math.abs(v)));
  const fsz = Math.max(14, Math.min(ch.width, ch.height) * 0.06);
  ctx.font = `700 ${fsz}px "${ch.fontFamily}", "Hiragino Sans", "Noto Sans JP", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const prog = (i: number) => {
    const st = (i / n) * ch.stagger;
    const p = (ch.progress - st) / Math.max(0.0001, 1 - ch.stagger);
    const x = Math.max(0, Math.min(1, p));
    return 1 - Math.pow(1 - x, 3);
  };
  const col = (i: number) => ch.colors[i % Math.max(1, ch.colors.length)] ?? '#00c2ff';
  const labelH = ch.showLabels ? fsz * 1.8 : 0;
  if (ch.kind === 'bar' || ch.kind === 'hbar' || ch.kind === 'line') {
    const plotW = ch.width;
    const plotH = ch.height - labelH;
    ctx.strokeStyle = ch.gridColor;
    ctx.lineWidth = 2;
    for (let g = 0; g <= 4; g++) {
      ctx.beginPath();
      if (ch.kind === 'hbar') {
        const x = (plotW * g) / 4;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, ch.height);
      } else {
        const y = plotH - (plotH * g) / 4;
        ctx.moveTo(0, y);
        ctx.lineTo(plotW, y);
      }
      ctx.stroke();
    }
    if (ch.kind === 'bar') {
      const slot = plotW / n;
      const bw = slot * 0.62;
      ch.values.forEach((v, i) => {
        const p = prog(i);
        const bh = (Math.max(0, v) / max) * plotH * p;
        const x = i * slot + (slot - bw) / 2;
        const g = ctx.createLinearGradient(0, plotH - bh, 0, plotH);
        g.addColorStop(0, col(i));
        g.addColorStop(1, col(i) + 'aa');
        ctx.fillStyle = g;
        ctx.beginPath();
        roundRect(ctx, x, plotH - bh, bw, bh, Math.min(10, bw / 4));
        ctx.fill();
        ctx.fillStyle = ch.textColor;
        if (ch.showValues && p > 0.02) ctx.fillText(formatNum(v * p), x + bw / 2, plotH - bh - fsz * 0.8);
        if (ch.showLabels) ctx.fillText(ch.labels[i] ?? '', x + bw / 2, plotH + labelH / 2);
      });
    } else if (ch.kind === 'hbar') {
      const lw = ch.showLabels ? ch.width * 0.22 : 0;
      const slot = ch.height / n;
      const bh = slot * 0.62;
      ch.values.forEach((v, i) => {
        const p = prog(i);
        const bw = (Math.max(0, v) / max) * (ch.width - lw - fsz * 3) * p;
        const y = i * slot + (slot - bh) / 2;
        ctx.fillStyle = col(i);
        ctx.beginPath();
        roundRect(ctx, lw, y, bw, bh, Math.min(10, bh / 4));
        ctx.fill();
        ctx.fillStyle = ch.textColor;
        ctx.textAlign = 'right';
        if (ch.showLabels) ctx.fillText(ch.labels[i] ?? '', lw - fsz * 0.5, y + bh / 2);
        ctx.textAlign = 'left';
        if (ch.showValues && p > 0.02) ctx.fillText(formatNum(v * p), lw + bw + fsz * 0.4, y + bh / 2);
        ctx.textAlign = 'center';
      });
    } else {
      const pts = ch.values.map((v, i) => [n === 1 ? plotW / 2 : (i / (n - 1)) * plotW, plotH - (v / max) * plotH] as [number, number]);
      let total = 0;
      for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const drawLen = total * Math.max(0, Math.min(1, ch.progress));
      ctx.strokeStyle = col(0);
      ctx.lineWidth = ch.lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let acc = 0;
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) {
        const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        if (acc + seg <= drawLen) ctx.lineTo(pts[i][0], pts[i][1]);
        else {
          const f = Math.max(0, (drawLen - acc) / seg);
          ctx.lineTo(pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f);
          break;
        }
        acc += seg;
      }
      ctx.stroke();
      acc = 0;
      pts.forEach((pt, i) => {
        if (i > 0) acc += Math.hypot(pt[0] - pts[i - 1][0], pt[1] - pts[i - 1][1]);
        if (acc > drawLen + 0.5) return;
        ctx.fillStyle = ch.textColor;
        ctx.beginPath();
        ctx.arc(pt[0], pt[1], ch.lineWidth * 0.9, 0, Math.PI * 2);
        ctx.fill();
        if (ch.showValues) ctx.fillText(formatNum(ch.values[i]), pt[0], pt[1] - fsz);
        if (ch.showLabels) ctx.fillText(ch.labels[i] ?? '', pt[0], plotH + labelH / 2);
      });
    }
  } else {
    const r = Math.min(ch.width, ch.height) / 2;
    const cx = ch.width / 2;
    const cy = ch.height / 2;
    const sum = ch.values.reduce((a, b) => a + Math.max(0, b), 0) || 1;
    let a0 = -Math.PI / 2;
    const sweepTotal = Math.PI * 2 * Math.max(0, Math.min(1, ch.progress));
    let drawn = 0;
    ch.values.forEach((v, i) => {
      const full = (Math.max(0, v) / sum) * Math.PI * 2;
      const sweep = Math.max(0, Math.min(full, sweepTotal - drawn));
      drawn += full;
      if (sweep > 0) {
        ctx.beginPath();
        if (ch.kind === 'donut') {
          ctx.arc(cx, cy, r, a0, a0 + sweep);
          ctx.arc(cx, cy, r * 0.58, a0 + sweep, a0, true);
        } else {
          ctx.moveTo(cx, cy);
          ctx.arc(cx, cy, r, a0, a0 + sweep);
        }
        ctx.closePath();
        ctx.fillStyle = col(i);
        ctx.fill();
        if (sweep >= full - 1e-6 && (ch.showLabels || ch.showValues)) {
          const mid = a0 + full / 2;
          const lr = ch.kind === 'donut' ? r * 0.79 : r * 0.65;
          ctx.fillStyle = ch.textColor;
          const label = [ch.showLabels ? ch.labels[i] : '', ch.showValues ? Math.round((Math.max(0, v) / sum) * 100) + '%' : ''].filter(Boolean).join(' ');
          ctx.fillText(label, cx + Math.cos(mid) * lr, cy + Math.sin(mid) * lr);
        }
      }
      a0 += full;
    });
  }
  return { canvas: c, w: W, h: H, cx: W / 2, cy: H / 2 };
}

function formatNum(v: number) {
  const r = Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
  return r.toLocaleString('ja-JP');
}

// ---- 背景 (単色・グラデーション・アニメーション背景) ----
export function renderSolid(target: HTMLCanvasElement | undefined, s: SolidData, t: number, res: number): LayerImage & { canvas: HTMLCanvasElement } {
  const W = s.width;
  const H = s.height;
  const { c, ctx } = prep(target, W, H, res);
  const sp = s.animSpeed;
  ctx.fillStyle = makeFill(ctx, s.fill, 0, 0, W, H);
  if (s.animated === 'gradientShift') {
    const a = t * 0.4 * sp;
    const g = ctx.createLinearGradient(W / 2 + Math.cos(a) * W, H / 2 + Math.sin(a) * H, W / 2 - Math.cos(a) * W, H / 2 - Math.sin(a) * H);
    g.addColorStop(0, s.fill.color);
    g.addColorStop(0.5, s.fill.color2);
    g.addColorStop(1, s.fill.color3 ?? s.fill.color);
    ctx.fillStyle = g;
  }
  ctx.fillRect(0, 0, W, H);
  const rnd = mulberry(12345);
  switch (s.animated) {
    case 'starfield': {
      ctx.fillStyle = '#ffffff';
      const n = 400;
      for (let i = 0; i < n; i++) {
        const x0 = rnd() - 0.5;
        const y0 = rnd() - 0.5;
        const z = (((rnd() - t * 0.08 * sp) % 1) + 1) % 1;
        const zz = 0.05 + z;
        const x = W / 2 + (x0 / zz) * W * 0.25;
        const y = H / 2 + (y0 / zz) * W * 0.25;
        if (x < 0 || y < 0 || x > W || y > H) continue;
        const sz = Math.max(0.6, (1 - z) * 4);
        ctx.globalAlpha = Math.min(1, (1 - z) * 1.4);
        ctx.beginPath();
        ctx.arc(x, y, sz, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'grid': {
      const horizon = H * 0.45;
      ctx.strokeStyle = s.fill.color2;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.8;
      for (let i = -20; i <= 20; i++) {
        ctx.beginPath();
        ctx.moveTo(W / 2 + i * W * 0.02, horizon);
        ctx.lineTo(W / 2 + i * W * 0.25, H);
        ctx.stroke();
      }
      const off = (t * 0.6 * sp) % 1;
      for (let k = 0; k < 18; k++) {
        const z = (k + 1 - off) / 18;
        const y = horizon + (H - horizon) * Math.pow(z, 2.2);
        ctx.globalAlpha = 0.2 + z * 0.8;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const g = ctx.createLinearGradient(0, horizon - H * 0.15, 0, horizon + 4);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, s.fill.color2 + '88');
      ctx.fillStyle = g;
      ctx.fillRect(0, horizon - H * 0.15, W, H * 0.15 + 4);
      break;
    }
    case 'aurora': {
      ctx.globalCompositeOperation = 'lighter';
      const cols = [s.fill.color2, s.fill.color3 ?? '#00ffa2', '#5a8cff'];
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.moveTo(0, H);
        for (let x = 0; x <= W; x += W / 40) {
          const y = H * (0.35 + k * 0.08) + Math.sin(x / W * 6 + t * 0.6 * sp + k * 2) * H * 0.06 + Math.sin(x / W * 13 - t * 0.9 * sp + k) * H * 0.025;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(W, H);
        ctx.closePath();
        const g = ctx.createLinearGradient(0, H * 0.25, 0, H);
        g.addColorStop(0, cols[k] + '00');
        g.addColorStop(0.25, cols[k] + '55');
        g.addColorStop(1, cols[k] + '00');
        ctx.fillStyle = g;
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      break;
    }
    case 'hexagon': {
      const R = Math.max(W, H) / 22;
      const hw = Math.sqrt(3) * R;
      ctx.lineWidth = 2;
      for (let row = -1; row < H / (R * 1.5) + 1; row++) {
        for (let col = -1; col < W / hw + 1; col++) {
          const x = col * hw + (row % 2 ? hw / 2 : 0);
          const y = row * R * 1.5;
          const pulse = 0.5 + 0.5 * Math.sin(t * 2 * sp - (Math.hypot(x - W / 2, y - H / 2) / Math.max(W, H)) * 12);
          ctx.strokeStyle = s.fill.color2;
          ctx.globalAlpha = 0.1 + pulse * 0.45;
          ctx.beginPath();
          for (let k = 0; k < 6; k++) {
            const a = Math.PI / 6 + (k * Math.PI) / 3;
            const px = x + Math.cos(a) * R * 0.92;
            const py = y + Math.sin(a) * R * 0.92;
            if (k) ctx.lineTo(px, py);
            else ctx.moveTo(px, py);
          }
          ctx.closePath();
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'nebula': {
      ctx.globalCompositeOperation = 'lighter';
      const cols = [s.fill.color2, s.fill.color3 ?? '#ff3d9a', '#3d7bff', '#7a3dff'];
      for (let k = 0; k < 7; k++) {
        const x = W * (0.2 + rnd() * 0.6) + Math.sin(t * 0.15 * sp + k) * W * 0.08;
        const y = H * (0.2 + rnd() * 0.6) + Math.cos(t * 0.12 * sp + k * 2) * H * 0.06;
        const r = Math.max(W, H) * (0.25 + rnd() * 0.3);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        const cc = cols[k % cols.length];
        g.addColorStop(0, cc + '44');
        g.addColorStop(1, cc + '00');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 250; i++) {
        ctx.globalAlpha = 0.3 + 0.7 * Math.abs(Math.sin(t * (0.5 + rnd()) + i));
        ctx.fillRect(rnd() * W, rnd() * H, 1.5, 1.5);
      }
      ctx.globalAlpha = 1;
      break;
    }
    default:
      break;
  }
  return { canvas: c, w: W, h: H, cx: W / 2, cy: H / 2 };
}

export type { Ctx };
