// IndexedDB ラッパー。
// - projects: プロジェクト JSON (自動保存)
// - backups: 定期バックアップ (破損時の復旧用、プロジェクトごとに最大 5 世代)
// - blobs: 素材バイナリ (動画/画像/音声/フォント/LUT/プロキシ)
// - meta: 波形ピーク・サムネイル・テロッププリセットなど
import type { Project, ProjectSummary } from '../model/types';
import { projectDuration } from '../model/ops';

const DB_NAME = 'mve-db';
const DB_VERSION = 1;
let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects');
      if (!db.objectStoreNames.contains('summaries')) db.createObjectStore('summaries');
      if (!db.objectStoreNames.contains('backups')) db.createObjectStore('backups');
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('データベースが他のタブで使用中です。ほかのタブを閉じてください。'));
  });
  dbp.catch(() => (dbp = null));
  return dbp;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        const r = fn(s);
        let result: T;
        if (r) r.onsuccess = () => (result = r.result);
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error ?? new Error('IndexedDB transaction aborted'));
      }),
  );
}

export const idb = {
  get: <T>(store: string, key: string) => tx<T>(store, 'readonly', (s) => s.get(key) as IDBRequest<T>),
  put: (store: string, key: string, value: unknown) => tx<IDBValidKey>(store, 'readwrite', (s) => s.put(value, key)),
  del: (store: string, key: string) => tx<undefined>(store, 'readwrite', (s) => s.delete(key)),
  keys: (store: string) => tx<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys()),
  all: <T>(store: string) => tx<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>),
};

export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* 非対応 */
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    if (e) return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  } catch {
    /* */
  }
  return null;
}

// ---- プロジェクト ----
const lastBackup = new Map<string, number>();

export async function saveProject(p: Project, thumb?: string) {
  const summary: ProjectSummary = { id: p.id, name: p.name, width: p.width, height: p.height, updatedAt: p.updatedAt, duration: projectDuration(p) };
  if (thumb) summary.thumb = thumb;
  else {
    const old = await idb.get<ProjectSummary>('summaries', p.id).catch(() => undefined);
    if (old?.thumb) summary.thumb = old.thumb;
  }
  await idb.put('projects', p.id, p);
  await idb.put('summaries', p.id, summary);
  // 5 分ごとにバックアップ世代を残す
  const now = Date.now();
  if (now - (lastBackup.get(p.id) ?? 0) > 5 * 60 * 1000) {
    lastBackup.set(p.id, now);
    const list = ((await idb.get<{ t: number; p: Project }[]>('backups', p.id).catch(() => undefined)) ?? []).slice(-4);
    list.push({ t: now, p });
    await idb.put('backups', p.id, list);
  }
}

export const loadProject = (id: string) => idb.get<Project>('projects', id);
export const listProjects = async () => ((await idb.all<ProjectSummary>('summaries')) ?? []).sort((a, b) => b.updatedAt - a.updatedAt);
export const loadBackups = async (id: string) => (await idb.get<{ t: number; p: Project }[]>('backups', id)) ?? [];

export async function deleteProject(id: string) {
  const p = await loadProject(id);
  await idb.del('projects', id);
  await idb.del('summaries', id);
  await idb.del('backups', id);
  if (p) {
    // 他のプロジェクトで使われていない素材のみ削除
    const others = await idb.all<Project>('projects');
    const used = new Set<string>();
    for (const o of others) for (const a of o.assets) {
      used.add(a.id);
      if (a.proxyId) used.add(a.proxyId);
    }
    for (const a of p.assets) {
      for (const id2 of [a.id, a.proxyId]) {
        if (id2 && !used.has(id2)) {
          await idb.del('blobs', id2).catch(() => {});
          await idb.del('meta', 'peaks:' + id2).catch(() => {});
          await idb.del('meta', 'thumbs:' + id2).catch(() => {});
        }
      }
    }
  }
}

// ---- 素材 ----
export const putBlob = (id: string, blob: Blob) => idb.put('blobs', id, blob);
export const getBlob = (id: string) => idb.get<Blob>('blobs', id);
export const putMeta = (key: string, v: unknown) => idb.put('meta', key, v);
export const getMeta = <T>(key: string) => idb.get<T>('meta', key);
