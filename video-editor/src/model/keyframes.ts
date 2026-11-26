import type { Clip, Ease, Keyframe, KeyValue } from './types';

// ---- cubic-bezier (CSS 準拠) ----
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  const solveX = (x: number) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-6) return t;
      const d = sampleDX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 30; i++) {
      const v = sampleX(t);
      if (Math.abs(v - x) < 1e-6) return t;
      if (x > v) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };
  return (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : sampleY(solveX(x)));
}

export const EASE_PRESETS: Record<string, [number, number, number, number]> = {
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
};

export const EASE_LABELS: Record<Ease['kind'], string> = {
  linear: 'リニア',
  hold: '停止(ホールド)',
  easeIn: 'イーズイン',
  easeOut: 'イーズアウト',
  easeInOut: 'イーズインアウト',
  bezier: 'ベジェ(カスタム)',
  bounce: 'バウンス',
  spring: 'スプリング',
  overshoot: 'オーバーシュート',
};

const bezierCache = new Map<string, (t: number) => number>();
function bez(b: [number, number, number, number]) {
  const k = b.join(',');
  let f = bezierCache.get(k);
  if (!f) {
    f = cubicBezier(b[0], b[1], b[2], b[3]);
    if (bezierCache.size > 500) bezierCache.clear();
    bezierCache.set(k, f);
  }
  return f;
}

function bounceOut(t: number) {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

/** 進捗 t (0..1) → 補間係数 (オーバーシュートで 0..1 を超えることがある) */
export function applyEase(ease: Ease | undefined, t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  if (!ease) return t;
  const a = ease.amount ?? 1;
  switch (ease.kind) {
    case 'linear':
      return t;
    case 'hold':
      return 0;
    case 'easeIn':
    case 'easeOut':
    case 'easeInOut':
      return bez(EASE_PRESETS[ease.kind])(t);
    case 'bezier':
      return bez(ease.bezier ?? [0.25, 0.1, 0.25, 1])(t);
    case 'bounce':
      return bounceOut(t);
    case 'spring': {
      // 減衰振動: 1 - e^{-zeta w t} cos(w_d t)
      const zeta = 0.28 / Math.max(0.2, a);
      const w = 14;
      const wd = w * Math.sqrt(1 - Math.min(0.99, zeta * zeta));
      const v = 1 - Math.exp(-zeta * w * t) * (Math.cos(wd * t) + ((zeta * w) / wd) * Math.sin(wd * t));
      // 終端で必ず1になるよう補正
      const end = 1 - Math.exp(-zeta * w) * (Math.cos(wd) + ((zeta * w) / wd) * Math.sin(wd));
      return v + (1 - end) * t;
    }
    case 'overshoot': {
      const s = 1.70158 * a;
      const u = t - 1;
      return u * u * ((s + 1) * u + s) + 1;
    }
  }
  return t;
}

// ---- 色 ----
export function parseColor(c: string): [number, number, number, number] {
  let s = (c || '#000000').trim();
  if (s.startsWith('#')) s = s.slice(1);
  if (s.length === 3 || s.length === 4) s = s.split('').map((ch) => ch + ch).join('');
  const n = (i: number) => parseInt(s.slice(i, i + 2), 16);
  const r = n(0);
  const g = n(2);
  const b = n(4);
  const a = s.length >= 8 ? n(6) / 255 : 1;
  return [Number.isFinite(r) ? r : 0, Number.isFinite(g) ? g : 0, Number.isFinite(b) ? b : 0, Number.isFinite(a) ? a : 1];
}

const hx = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
export function toHex(r: number, g: number, b: number, a = 1): string {
  return '#' + hx(r) + hx(g) + hx(b) + (a < 1 ? hx(a * 255) : '');
}

export function lerpColor(a: string, b: string, t: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  return toHex(ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t, ca[3] + (cb[3] - ca[3]) * t);
}

export function interpolate(kfs: Keyframe[], t: number): KeyValue | undefined {
  if (!kfs || kfs.length === 0) return undefined;
  if (t <= kfs[0].t) return kfs[0].v;
  const last = kfs[kfs.length - 1];
  if (t >= last.t) return last.v;
  // 二分探索
  let lo = 0;
  let hi = kfs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (kfs[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = kfs[lo];
  const b = kfs[hi];
  const span = b.t - a.t;
  const p = span <= 0 ? 1 : (t - a.t) / span;
  const e = applyEase(a.ease, p);
  if (typeof a.v === 'number' && typeof b.v === 'number') return a.v + (b.v - a.v) * e;
  if (typeof a.v === 'string' && typeof b.v === 'string') return lerpColor(a.v, b.v, Math.max(0, Math.min(1, e)));
  return e < 1 ? a.v : b.v;
}

// ---- パスでのパラメーター取得/設定 ----
// パス例: "transform.x", "effects.<effectId>.radius", "text.style.fill.color", "shape.trimEnd", "audio.volume"

export function getByPath(clip: Clip, path: string): unknown {
  const parts = path.split('.');
  let cur: any = clip;
  for (let i = 0; i < parts.length; i++) {
    if (cur == null) return undefined;
    const p = parts[i];
    if (p === 'effects' && Array.isArray(cur.effects)) {
      const eff = cur.effects.find((e: any) => e.id === parts[i + 1]);
      if (!eff) return undefined;
      cur = eff.params;
      i++;
      continue;
    }
    cur = cur[p];
  }
  return cur;
}

export function setByPath(clip: Clip, path: string, value: unknown): void {
  const parts = path.split('.');
  let cur: any = clip;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (p === 'effects' && Array.isArray(cur.effects)) {
      const eff = cur.effects.find((e: any) => e.id === parts[i + 1]);
      if (!eff) return;
      cur = eff.params;
      i++;
      if (i === parts.length - 1) return;
      continue;
    }
    if (cur[p] == null) cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

/** クリップローカル時間でのパラメーター値 (キーフレームがあれば補間、なければ静的値) */
export function evalParam<T = number>(clip: Clip, path: string, localT: number): T {
  const kfs = clip.keyframes[path];
  if (kfs && kfs.length) return interpolate(kfs, localT) as unknown as T;
  return getByPath(clip, path) as T;
}

export function evalNum(clip: Clip, path: string, localT: number, fallback = 0): number {
  const v = evalParam<unknown>(clip, path, localT);
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** クリップのすべてのキーフレーム値を適用したクリップのコピー (描画用) */
export function resolveClipAt(clip: Clip, localT: number): Clip {
  const paths = Object.keys(clip.keyframes);
  if (paths.length === 0) return clip;
  const c: Clip = structuredCloneLite(clip);
  for (const p of paths) {
    const kfs = clip.keyframes[p];
    if (kfs && kfs.length) setByPath(c, p, interpolate(kfs, localT));
  }
  return c;
}

function structuredCloneLite<T>(o: T): T {
  return JSON.parse(JSON.stringify(o));
}

export const KEYFRAME_EPS = 1e-4;

export function findKeyAt(kfs: Keyframe[] | undefined, t: number, fps: number): Keyframe | undefined {
  if (!kfs) return undefined;
  const tol = 0.5 / fps;
  return kfs.find((k) => Math.abs(k.t - t) < tol);
}
