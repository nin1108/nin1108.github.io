import { create } from 'zustand';
import { produce, setAutoFreeze } from 'immer';
import type { Clip, Project } from '../model/types';
import { saveProject } from '../storage/db';
import { projectDuration } from '../model/ops';

setAutoFreeze(false);

export type PanelId =
  | null
  | 'add'
  | 'edit'
  | 'transform'
  | 'speed'
  | 'crop'
  | 'compose'
  | 'effects'
  | 'color'
  | 'text'
  | 'shape'
  | 'animate'
  | 'audio'
  | 'transition'
  | 'presets'
  | 'project'
  | 'export'
  | 'particles'
  | 'counter'
  | 'chart'
  | 'solid'
  | 'layers'
  | 'record';

export type SaveState = 'saved' | 'saving' | 'dirty' | 'error';

interface State {
  project: Project | null;
  past: Project[];
  future: Project[];
  /** ジェスチャー中 (ドラッグ等) は開始時のスナップショットを保持し、終了時に1回だけ履歴に積む */
  gestureBase: Project | null;
  selection: string[];
  time: number;
  playing: boolean;
  pxPerSec: number;
  panel: PanelId;
  panelParam: string | null;
  saveState: SaveState;
  saveError: string | null;
  toast: { msg: string; kind: 'info' | 'error' | 'ok'; id: number } | null;
  previewQuality: 'auto' | 'low' | 'high';
  fullscreen: boolean;
  snapping: boolean;
  renderTick: number;
}

interface Actions {
  load(p: Project): void;
  close(): void;
  /** 履歴に残る変更 */
  update(fn: (p: Project) => void, opts?: { merge?: string }): void;
  /** ジェスチャー中の一時変更 (履歴に残らない。endGesture で確定) */
  beginGesture(): void;
  live(fn: (p: Project) => void): void;
  endGesture(): void;
  undo(): void;
  redo(): void;
  select(ids: string[]): void;
  setTime(t: number): void;
  setPlaying(b: boolean): void;
  setZoom(px: number): void;
  setPanel(p: PanelId, param?: string | null): void;
  showToast(msg: string, kind?: 'info' | 'error' | 'ok'): void;
  set(partial: Partial<State>): void;
  bump(): void;
}

const MAX_HISTORY = 150;
let lastMergeKey: string | null = null;
let lastMergeTime = 0;

export const useStore = create<State & Actions>((set, get) => ({
  project: null,
  past: [],
  future: [],
  gestureBase: null,
  selection: [],
  time: 0,
  playing: false,
  pxPerSec: 80,
  panel: null,
  panelParam: null,
  saveState: 'saved',
  saveError: null,
  toast: null,
  previewQuality: 'auto',
  fullscreen: false,
  snapping: true,
  renderTick: 0,

  load(p) {
    set({ project: p, past: [], future: [], selection: [], time: 0, playing: false, panel: null, saveState: 'saved', gestureBase: null });
  },
  close() {
    set({ project: null, past: [], future: [], selection: [], playing: false, panel: null });
  },
  update(fn, opts) {
    const s = get();
    if (!s.project) return;
    const next = produce(s.project, (d) => {
      fn(d as Project);
      (d as Project).updatedAt = Date.now();
    });
    if (next === s.project) return;
    const now = Date.now();
    // 同一キーの連続変更 (スライダー操作など) は 1 つの履歴にまとめる
    const merge = opts?.merge && opts.merge === lastMergeKey && now - lastMergeTime < 1200;
    lastMergeKey = opts?.merge ?? null;
    lastMergeTime = now;
    if (s.gestureBase) {
      set({ project: next, saveState: 'dirty' });
    } else if (merge) {
      set({ project: next, future: [], saveState: 'dirty' });
    } else {
      set({ project: next, past: [...s.past, s.project].slice(-MAX_HISTORY), future: [], saveState: 'dirty' });
    }
  },
  beginGesture() {
    const s = get();
    if (s.project && !s.gestureBase) set({ gestureBase: s.project });
  },
  live(fn) {
    const s = get();
    if (!s.project) return;
    const next = produce(s.project, (d) => {
      fn(d as Project);
    });
    set({ project: next });
  },
  endGesture() {
    const s = get();
    if (!s.gestureBase || !s.project) return set({ gestureBase: null });
    if (s.project !== s.gestureBase) {
      set({ past: [...s.past, s.gestureBase].slice(-MAX_HISTORY), future: [], gestureBase: null, saveState: 'dirty', project: { ...s.project, updatedAt: Date.now() } });
    } else set({ gestureBase: null });
    lastMergeKey = null;
  },
  undo() {
    const s = get();
    if (!s.project || s.past.length === 0) return;
    const prev = s.past[s.past.length - 1];
    lastMergeKey = null;
    set({ project: prev, past: s.past.slice(0, -1), future: [s.project, ...s.future].slice(0, MAX_HISTORY), saveState: 'dirty', selection: s.selection.filter((id) => prev.clips.some((c) => c.id === id)) });
  },
  redo() {
    const s = get();
    if (!s.project || s.future.length === 0) return;
    const next = s.future[0];
    lastMergeKey = null;
    set({ project: next, past: [...s.past, s.project], future: s.future.slice(1), saveState: 'dirty', selection: s.selection.filter((id) => next.clips.some((c) => c.id === id)) });
  },
  select(ids) {
    set({ selection: ids });
  },
  setTime(t) {
    const p = get().project;
    const max = p ? Math.max(projectDuration(p), 0) : 0;
    set({ time: Math.max(0, Math.min(t, max + 30)) });
  },
  setPlaying(b) {
    set({ playing: b });
  },
  setZoom(px) {
    set({ pxPerSec: Math.max(4, Math.min(2400, px)) });
  },
  setPanel(panel, param = null) {
    set({ panel, panelParam: param });
  },
  showToast(msg, kind = 'info') {
    set({ toast: { msg, kind, id: Date.now() + Math.random() } });
  },
  set(partial) {
    set(partial);
  },
  bump() {
    set({ renderTick: get().renderTick + 1 });
  },
}));

export const selectedClip = (s: State): Clip | undefined => (s.project && s.selection.length ? s.project.clips.find((c) => c.id === s.selection[0]) : undefined);

// ---- 自動保存 ----
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saving: Promise<void> | null = null;
let thumbProvider: (() => string | undefined) | null = null;
export function setThumbProvider(fn: (() => string | undefined) | null) {
  thumbProvider = fn;
}

export async function flushSave(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const s = useStore.getState();
  if (!s.project || s.saveState === 'saved') return;
  if (saving) await saving;
  const p = s.gestureBase ? s.project : s.project;
  useStore.setState({ saveState: 'saving' });
  saving = (async () => {
    try {
      let thumb: string | undefined;
      try {
        thumb = thumbProvider?.();
      } catch {
        thumb = undefined;
      }
      await saveProject(p, thumb);
      if (useStore.getState().project === p) useStore.setState({ saveState: 'saved', saveError: null });
      else useStore.setState({ saveState: 'dirty' });
    } catch (e: any) {
      useStore.setState({ saveState: 'error', saveError: String(e?.message ?? e) });
    } finally {
      saving = null;
    }
  })();
  await saving;
}

useStore.subscribe((s, prev) => {
  if (s.project && s.project !== prev.project && prev.project && s.project.id === prev.project.id) {
    if (useStore.getState().saveState !== 'dirty') useStore.setState({ saveState: 'dirty' });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void flushSave();
    }, 700);
  }
});

if (typeof window !== 'undefined') {
  const flush = () => void flushSave();
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('beforeunload', (e) => {
    const st = useStore.getState().saveState;
    if (st === 'dirty' || st === 'saving') {
      flush();
      e.preventDefault();
    }
  });
}
