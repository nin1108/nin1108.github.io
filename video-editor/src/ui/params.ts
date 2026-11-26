import { useStore } from '../store/store';
import type { Clip, KeyValue, Project } from '../model/types';
import { evalParam, findKeyAt, getByPath, setByPath } from '../model/keyframes';
import { uid } from '../model/defaults';

export function findClip(p: Project, id: string) {
  return p.clips.find((c) => c.id === id);
}

/** 再生ヘッド位置でのクリップローカル時刻 (クリップ範囲内に丸める) */
export function localT(c: Clip, time: number) {
  return Math.max(0, Math.min(c.duration, time - c.start));
}

export function paramValue(c: Clip, path: string, time: number): KeyValue | undefined {
  return evalParam<KeyValue>(c, path, localT(c, time));
}

/**
 * パラメーターの変更。キーフレームがある場合は現在時刻のキーを追加/更新する (After Effects と同様)。
 * live=true はドラッグ中 (履歴に積まない)。
 */
export function setParam(clipId: string, path: string, value: KeyValue | boolean, opts: { live?: boolean } = {}) {
  const s = useStore.getState();
  const fn = (p: Project) => {
    const c = findClip(p, clipId);
    if (!c) return;
    const kfs = c.keyframes[path];
    if (kfs && kfs.length && typeof value !== 'boolean') {
      const t = localT(c, s.time);
      const k = findKeyAt(kfs, t, p.fps);
      if (k) k.v = value;
      else {
        kfs.push({ id: uid(), t, v: value, ease: kfs[0]?.ease ?? { kind: 'easeInOut' } });
        kfs.sort((a, b) => a.t - b.t);
      }
    } else setByPath(c, path, value);
  };
  if (opts.live) s.live(fn);
  else s.update(fn, { merge: clipId + ':' + path });
}

export function toggleKeyframe(clipId: string, path: string) {
  const s = useStore.getState();
  s.update((p) => {
    const c = findClip(p, clipId);
    if (!c) return;
    const t = localT(c, s.time);
    const list = c.keyframes[path] ?? [];
    const k = findKeyAt(list, t, p.fps);
    if (k) {
      const rest = list.filter((x) => x !== k);
      if (rest.length) c.keyframes[path] = rest;
      else {
        // 最後のキーを消したら静的値として残す
        setByPath(c, path, k.v);
        delete c.keyframes[path];
      }
    } else {
      const v = evalParam<KeyValue>(c, path, t) ?? (getByPath(c, path) as KeyValue);
      list.push({ id: uid(), t, v, ease: { kind: 'easeInOut' } });
      list.sort((a, b) => a.t - b.t);
      c.keyframes[path] = list;
    }
  });
}

export function clearKeyframes(clipId: string, path: string) {
  const s = useStore.getState();
  s.update((p) => {
    const c = findClip(p, clipId);
    if (!c || !c.keyframes[path]) return;
    const v = evalParam<KeyValue>(c, path, localT(c, s.time));
    setByPath(c, path, v);
    delete c.keyframes[path];
  });
}

export function updateClip(clipId: string, fn: (c: Clip, p: Project) => void, merge?: string) {
  useStore.getState().update((p) => {
    const c = findClip(p, clipId);
    if (c) fn(c, p);
  }, merge ? { merge: clipId + ':' + merge } : undefined);
}

export function liveClip(clipId: string, fn: (c: Clip, p: Project) => void) {
  useStore.getState().live((p) => {
    const c = findClip(p, clipId);
    if (c) fn(c, p);
  });
}
