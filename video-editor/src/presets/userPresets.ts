// 利用者が作ったテロップのプリセット (マイプリセット) と、標準プリセットの上書き内容を管理する。
// どちらも端末内 (IndexedDB) に保存し、プロジェクトをまたいで使える。
import { create } from 'zustand';
import type { CharAnimation, TextStyle } from '../model/types';
import { getMeta, putMeta } from '../storage/db';
import { uid } from '../model/defaults';

export interface UserTextPreset {
  id: string;
  name: string;
  style: TextStyle;
  anims: CharAnimation[];
  updatedAt?: number;
}

export interface PresetOverride {
  style: TextStyle;
  anims: CharAnimation[];
  savedAt: number;
}

interface PresetStore {
  loaded: boolean;
  mine: UserTextPreset[];
  overrides: Record<string, PresetOverride>;
}

export const usePresetStore = create<PresetStore>(() => ({ loaded: false, mine: [], overrides: {} }));

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

let loading: Promise<void> | null = null;
export function loadPresetStore(): Promise<void> {
  if (!loading) {
    loading = (async () => {
      const [mine, overrides] = await Promise.all([
        getMeta<UserTextPreset[]>('textPresets').catch(() => undefined),
        getMeta<Record<string, PresetOverride>>('presetOverrides').catch(() => undefined),
      ]);
      usePresetStore.setState({ loaded: true, mine: Array.isArray(mine) ? mine : [], overrides: overrides && typeof overrides === 'object' ? overrides : {} });
    })();
  }
  return loading;
}

/** 互換用: 以前の TextPanel から使っていた読み込み関数 */
export async function loadUserPresets(): Promise<UserTextPreset[]> {
  await loadPresetStore();
  return usePresetStore.getState().mine;
}

async function persistMine(list: UserTextPreset[]) {
  usePresetStore.setState({ mine: list });
  await putMeta('textPresets', list);
}

async function persistOverrides(o: Record<string, PresetOverride>) {
  usePresetStore.setState({ overrides: o });
  await putMeta('presetOverrides', o);
}

export async function addUserPreset(name: string, style: TextStyle, anims: CharAnimation[]): Promise<string> {
  await loadPresetStore();
  const id = uid();
  await persistMine([...usePresetStore.getState().mine, { id, name, style: clone(style), anims: clone(anims), updatedAt: Date.now() }]);
  return id;
}

export async function overwriteUserPreset(id: string, style: TextStyle, anims: CharAnimation[]) {
  await loadPresetStore();
  await persistMine(usePresetStore.getState().mine.map((p) => (p.id === id ? { ...p, style: clone(style), anims: clone(anims), updatedAt: Date.now() } : p)));
}

export async function renameUserPreset(id: string, name: string) {
  await loadPresetStore();
  await persistMine(usePresetStore.getState().mine.map((p) => (p.id === id ? { ...p, name } : p)));
}

export async function deleteUserPreset(id: string) {
  await loadPresetStore();
  await persistMine(usePresetStore.getState().mine.filter((p) => p.id !== id));
}

/** 標準プリセットを上書き (元のデザインは消さず、上書き分として保存) */
export async function setPresetOverride(id: string, style: TextStyle, anims: CharAnimation[]) {
  await loadPresetStore();
  await persistOverrides({ ...usePresetStore.getState().overrides, [id]: { style: clone(style), anims: clone(anims), savedAt: Date.now() } });
}

export async function clearPresetOverride(id: string) {
  await loadPresetStore();
  const o = { ...usePresetStore.getState().overrides };
  delete o[id];
  await persistOverrides(o);
}

export function getPresetOverride(id: string): PresetOverride | undefined {
  return usePresetStore.getState().overrides[id];
}

/** マイプリセットのクリップ上の識別子 */
export const USER_PREFIX = 'user:';
