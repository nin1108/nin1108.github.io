import type { AssetMeta, Clip, Keyframe, Project, Track } from './types';
import { createClip, createTrack, uid } from './defaults';
import { interpolate } from './keyframes';

export const VISUAL_TYPES = new Set(['video', 'image', 'text', 'shape', 'solid', 'particles', 'counter', 'chart', 'adjustment', 'camera']);

export function clipEnd(c: Clip) {
  return c.start + c.duration;
}

export function projectDuration(p: Project): number {
  let d = 0;
  for (const c of p.clips) d = Math.max(d, clipEnd(c));
  return d;
}

export function frameSnap(t: number, fps: number) {
  return Math.round(t * fps) / fps;
}

export function assetOf(p: Project, c: Clip): AssetMeta | undefined {
  return c.assetId ? p.assets.find((a) => a.id === c.assetId) : undefined;
}

/** タイムライン時刻 → 素材内時刻 (秒) */
export function sourceTime(c: Clip, t: number, assetDuration?: number): number {
  const local = Math.max(0, t - c.start);
  if (c.freeze) return c.inPoint;
  const span = c.duration * c.speed;
  let s = c.reverse ? c.inPoint + span - local * c.speed : c.inPoint + local * c.speed;
  if (assetDuration != null) s = Math.max(0, Math.min(assetDuration - 0.001, s));
  return s;
}

/** クリップが利用する素材範囲の最大長 (トリム上限) */
export function maxClipDuration(p: Project, c: Clip): number {
  const a = assetOf(p, c);
  if (!a || a.duration == null || c.type === 'image' || c.freeze) return Infinity;
  return Math.max(1 / p.fps, (a.duration - c.inPoint) / c.speed);
}

export function trackOf(p: Project, c: Clip): Track | undefined {
  return p.tracks.find((t) => t.id === c.trackId);
}

export function clipsOnTrack(p: Project, trackId: string): Clip[] {
  return p.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
}

export function overlaps(p: Project, trackId: string, start: number, end: number, ignore: Set<string>): boolean {
  const eps = 1e-6;
  return p.clips.some((c) => c.trackId === trackId && !ignore.has(c.id) && c.start < end - eps && clipEnd(c) > start + eps);
}

export function trackKindFor(c: Clip): Track['kind'] {
  return c.type === 'audio' ? 'audio' : 'visual';
}

/** 指定範囲が空いているトラックを探す。なければ作成 */
export function findFreeTrack(p: Project, kind: Track['kind'], start: number, end: number, prefer?: string, ignore = new Set<string>(), from: 'top' | 'bottom' = 'top'): Track {
  if (prefer) {
    const t = p.tracks.find((x) => x.id === prefer && x.kind === kind);
    if (t && !t.locked && !overlaps(p, t.id, start, end, ignore)) return t;
  }
  // 映像: 'top' は前面のトラックから (テキスト等)、'bottom' は背面から (動画・画像素材)
  const order = kind === 'visual' && from === 'top' ? [...p.tracks].reverse() : p.tracks;
  for (const t of order) {
    if (t.kind === kind && !t.locked && !overlaps(p, t.id, start, end, ignore)) return t;
  }
  const n = p.tracks.filter((t) => t.kind === kind).length + 1;
  const t = createTrack(kind, kind === 'visual' ? `ビデオ ${n}` : `オーディオ ${n}`);
  if (kind === 'visual') {
    const lastVisual = p.tracks.map((x) => x.kind).lastIndexOf('visual');
    p.tracks.splice(lastVisual + 1, 0, t);
  } else p.tracks.push(t);
  return t;
}

function shiftKeys(kfs: Record<string, Keyframe[]>, dt: number, from: number, to: number): Record<string, Keyframe[]> {
  const out: Record<string, Keyframe[]> = {};
  for (const [path, list] of Object.entries(kfs)) {
    const atFrom = interpolate(list, from);
    const atTo = interpolate(list, to);
    const inside = list.filter((k) => k.t > from + 1e-6 && k.t < to - 1e-6).map((k) => ({ ...k, t: k.t + dt }));
    const res: Keyframe[] = [];
    // 境界で値が変わらないよう端点のキーを補完
    if (atFrom !== undefined && list.length > 1) res.push({ id: uid(), t: from + dt, v: atFrom, ease: list.find((k) => k.t <= from)?.ease ?? { kind: 'linear' } });
    res.push(...inside);
    if (atTo !== undefined && list.length > 1) res.push({ id: uid(), t: to + dt, v: atTo, ease: { kind: 'linear' } });
    if (list.length === 1) res.push({ ...list[0], id: uid(), t: Math.max(0, list[0].t + dt) });
    out[path] = dedupe(res);
  }
  return out;
}

function dedupe(list: Keyframe[]): Keyframe[] {
  const out: Keyframe[] = [];
  for (const k of list.sort((a, b) => a.t - b.t)) {
    if (out.length && Math.abs(out[out.length - 1].t - k.t) < 1e-5) out[out.length - 1] = k;
    else out.push(k);
  }
  return out;
}

/** 分割: 新しい後半クリップの id を返す */
export function splitClip(p: Project, clipId: string, t: number): string | null {
  const c = p.clips.find((x) => x.id === clipId);
  if (!c) return null;
  const minLen = 1 / p.fps;
  if (t <= c.start + minLen || t >= clipEnd(c) - minLen) return null;
  const local = t - c.start;
  const right: Clip = JSON.parse(JSON.stringify(c));
  right.id = uid();
  right.start = t;
  right.duration = c.duration - local;
  if (!c.freeze) {
    if (c.reverse) {
      // 逆再生: 左側が素材の後半を使う
      right.inPoint = c.inPoint;
      c.inPoint = c.inPoint + right.duration * c.speed;
    } else right.inPoint = c.inPoint + local * c.speed;
  }
  right.keyframes = shiftKeys(c.keyframes, -local, local, c.duration);
  c.keyframes = shiftKeys(c.keyframes, 0, 0, local);
  c.duration = local;
  right.transitionIn = undefined;
  right.audio = { ...right.audio, fadeIn: 0 };
  c.audio = { ...c.audio, fadeOut: 0 };
  p.clips.push(right);
  return right.id;
}

export function trimClipStart(p: Project, c: Clip, newStart: number) {
  const minLen = 1 / p.fps;
  const end = clipEnd(c);
  let s = Math.min(newStart, end - minLen);
  if (c.type === 'video' || c.type === 'audio') {
    if (!c.reverse && !c.freeze) {
      const minStart = c.start - c.inPoint / c.speed;
      s = Math.max(s, minStart);
    } else if (c.reverse) {
      const a = p.assets.find((x) => x.id === c.assetId);
      if (a?.duration != null) s = Math.max(s, end - (a.duration - c.inPoint) / c.speed);
    }
  }
  s = Math.max(0, s);
  const delta = s - c.start;
  if (!c.reverse && !c.freeze) c.inPoint = Math.max(0, c.inPoint + delta * c.speed);
  c.start = s;
  c.duration = end - s;
  for (const list of Object.values(c.keyframes)) for (const k of list) k.t -= delta;
}

export function trimClipEnd(p: Project, c: Clip, newEnd: number) {
  const minLen = 1 / p.fps;
  let d = Math.max(minLen, newEnd - c.start);
  if (c.reverse && !c.freeze) {
    // 逆再生の末尾を伸ばす = 素材の先頭側を使う
    const extra = d - c.duration;
    const newIn = c.inPoint - extra * c.speed;
    if (newIn < 0) d = c.duration + c.inPoint / c.speed;
    c.inPoint = Math.max(0, c.inPoint - (d - c.duration) * c.speed);
  } else d = Math.min(d, maxClipDuration(p, c));
  c.duration = d;
}

export function setClipSpeed(p: Project, c: Clip, speed: number) {
  const s = Math.max(0.1, Math.min(16, speed));
  const srcSpan = c.duration * c.speed;
  c.speed = s;
  c.duration = Math.max(1 / p.fps, srcSpan / s);
  const max = maxClipDuration(p, c);
  if (c.duration > max) c.duration = max;
}

export function duplicateClip(p: Project, clipId: string): string | null {
  const c = p.clips.find((x) => x.id === clipId);
  if (!c) return null;
  const copy: Clip = JSON.parse(JSON.stringify(c));
  copy.id = uid();
  const effMap = new Map<string, string>();
  copy.effects = copy.effects.map((e) => {
    const nid = uid();
    effMap.set(e.id, nid);
    return { ...e, id: nid };
  });
  const kf: Record<string, Keyframe[]> = {};
  for (const [path, list] of Object.entries(copy.keyframes)) {
    let np = path;
    for (const [o, n] of effMap) np = np.replace(`effects.${o}.`, `effects.${n}.`);
    kf[np] = list.map((k) => ({ ...k, id: uid() }));
  }
  copy.keyframes = kf;
  copy.start = clipEnd(c);
  copy.groupId = undefined;
  const track = findFreeTrack(p, trackKindFor(c), copy.start, copy.start + copy.duration, c.trackId);
  copy.trackId = track.id;
  p.clips.push(copy);
  return copy.id;
}

export function deleteClips(p: Project, ids: Set<string>, ripple = false) {
  const removed = p.clips.filter((c) => ids.has(c.id));
  p.clips = p.clips.filter((c) => !ids.has(c.id));
  for (const c of p.clips) if (c.parentId && ids.has(c.parentId)) c.parentId = undefined;
  if (ripple) {
    for (const r of removed) {
      for (const c of p.clips) if (c.trackId === r.trackId && c.start >= clipEnd(r) - 1e-6) c.start -= r.duration;
    }
  }
}

/** トラック上の隙間を詰める */
export function closeGaps(p: Project, trackId: string) {
  let t = 0;
  for (const c of clipsOnTrack(p, trackId)) {
    c.start = t;
    t = clipEnd(c);
  }
}

export function snapPoints(p: Project, exclude: Set<string>, playhead: number): number[] {
  const pts = [0, playhead];
  for (const c of p.clips) {
    if (exclude.has(c.id)) continue;
    pts.push(c.start, clipEnd(c));
  }
  for (const m of p.markers) pts.push(m.t);
  return pts;
}

export function snapValue(v: number, points: number[], threshold: number): { v: number; snapped: boolean } {
  let best = v;
  let bd = threshold;
  for (const pt of points) {
    const d = Math.abs(pt - v);
    if (d < bd) {
      bd = d;
      best = pt;
    }
  }
  return { v: best, snapped: best !== v };
}

export function detachAudio(p: Project, clipId: string): string | null {
  const c = p.clips.find((x) => x.id === clipId);
  if (!c || c.type !== 'video') return null;
  const a = assetOf(p, c);
  if (!a?.hasAudio) return null;
  const track = findFreeTrack(p, 'audio', c.start, clipEnd(c));
  const ac = createClip(p, 'audio', track.id, c.start, c.duration, {
    assetId: c.assetId,
    inPoint: c.inPoint,
    speed: c.speed,
    reverse: c.reverse,
    name: `${c.name} (音声)`,
    audio: JSON.parse(JSON.stringify(c.audio)),
  });
  if (c.keyframes['audio.volume']) ac.keyframes['audio.volume'] = JSON.parse(JSON.stringify(c.keyframes['audio.volume']));
  p.clips.push(ac);
  c.audioDetached = true;
  return ac.id;
}

export function groupClips(p: Project, ids: string[]) {
  const gid = uid();
  for (const c of p.clips) if (ids.includes(c.id)) c.groupId = gid;
  return gid;
}

export function ungroup(p: Project, gid: string) {
  for (const c of p.clips) if (c.groupId === gid) c.groupId = undefined;
}

export function groupMembers(p: Project, c: Clip): Clip[] {
  if (!c.groupId) return [c];
  return p.clips.filter((x) => x.groupId === c.groupId);
}

/** 親子付けの循環を防止 */
export function canParent(p: Project, childId: string, parentId: string): boolean {
  let cur: string | undefined = parentId;
  const seen = new Set<string>();
  while (cur) {
    if (cur === childId) return false;
    if (seen.has(cur)) return false;
    seen.add(cur);
    cur = p.clips.find((c) => c.id === cur)?.parentId;
  }
  return true;
}

export function formatTime(t: number, fps: number, withFrames = true): string {
  const neg = t < 0;
  t = Math.max(0, Math.abs(t));
  const totalFrames = Math.round(t * fps);
  const f = totalFrames % fps;
  const s = Math.floor(totalFrames / fps);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  const str = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` + (withFrames ? `:${String(f).padStart(2, '0')}` : '');
  return neg ? '-' + str : str;
}

export function parseTimecode(s: string, fps: number): number | null {
  const parts = s.trim().split(':').map((x) => Number(x));
  if (parts.some((x) => !Number.isFinite(x))) return null;
  if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / fps;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}
