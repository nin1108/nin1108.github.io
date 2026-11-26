// 書き出し MP4 の保存先。長尺 (15 分 1080p ≒ 1.3GB) でもメモリに全体を持たないよう、端末ストレージへ逐次書き込む。
//  1. OPFS の createWritable (Chrome / 新しい Safari)
//  2. OPFS の SyncAccessHandle を Worker で使う (createWritable の無い Safari)
//  3. IndexedDB に 8MB 単位で分割保存 (OPFS が使えない環境)
//  4. メモリ (短い動画のみ)
import { idb } from '../storage/db';

type Chunk = { type: 'write'; data: Uint8Array; position: number };

export interface OutputTarget {
  /** mediabunny の Target */
  target: any;
  fastStart: false | 'in-memory';
  kind: 'opfs' | 'opfs-worker' | 'idb' | 'memory';
  getBlob(): Promise<Blob>;
}

/** テスト用: 指定した方式を使えないものとして扱う */
export const targetDebug = { disable: [] as string[], memoryMax: 60 * 1024 * 1024 };

async function cleanOpfs(root: FileSystemDirectoryHandle) {
  try {
    for await (const [n] of (root as any).entries()) if (String(n).startsWith('export-')) await root.removeEntry(n).catch(() => {});
  } catch {
    /* */
  }
}

async function viaCreateWritable(mb: any): Promise<OutputTarget> {
  if (targetDebug.disable.includes('opfs')) throw new Error('disabled');
  const root = await navigator.storage.getDirectory();
  await cleanOpfs(root);
  const name = 'export-' + Date.now() + '.mp4';
  const fh = await root.getFileHandle(name, { create: true });
  if (typeof (fh as any).createWritable !== 'function') throw new Error('createWritable unsupported');
  const writable = await (fh as any).createWritable();
  return {
    target: new mb.StreamTarget(writable, { chunked: true, chunkSize: 8 * 1024 * 1024 }),
    fastStart: false,
    kind: 'opfs',
    getBlob: () => fh.getFile(),
  };
}

const WORKER_SRC = `
let h = null;
onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.op === 'open') {
      const root = await navigator.storage.getDirectory();
      const fh = await root.getFileHandle(m.name, { create: true });
      h = await fh.createSyncAccessHandle();
      h.truncate(0);
    } else if (m.op === 'write') {
      let off = 0;
      while (off < m.data.byteLength) off += h.write(m.data.subarray(off), { at: m.position + off });
    } else if (m.op === 'close') {
      h.flush();
      h.close();
      h = null;
    }
    postMessage({ id: m.id, ok: true });
  } catch (err) {
    postMessage({ id: m.id, ok: false, error: String(err && err.message || err) });
  }
};`;

async function viaWorker(mb: any): Promise<OutputTarget> {
  if (targetDebug.disable.includes('opfs-worker')) throw new Error('disabled');
  const root = await navigator.storage.getDirectory();
  await cleanOpfs(root);
  const name = 'export-' + Date.now() + '.mp4';
  const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
  const w = new Worker(url);
  URL.revokeObjectURL(url);
  let seq = 0;
  const pending = new Map<number, { res: () => void; rej: (e: Error) => void }>();
  w.onmessage = (e) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok) p.res();
    else p.rej(new Error(e.data.error));
  };
  const call = (msg: any, transfer: Transferable[] = []) =>
    new Promise<void>((res, rej) => {
      const id = ++seq;
      pending.set(id, { res, rej });
      w.postMessage({ ...msg, id }, transfer);
    });
  try {
    await call({ op: 'open', name });
  } catch (e) {
    w.terminate();
    throw e;
  }
  const writable = new WritableStream<Chunk>({
    write: (c) => {
      const copy = c.data.slice();
      return call({ op: 'write', data: copy, position: c.position }, [copy.buffer]);
    },
    close: async () => {
      await call({ op: 'close' });
      w.terminate();
    },
    abort: () => {
      w.terminate();
    },
  });
  return {
    target: new mb.StreamTarget(writable, { chunked: true, chunkSize: 8 * 1024 * 1024 }),
    fastStart: false,
    kind: 'opfs-worker',
    getBlob: async () => (await (await navigator.storage.getDirectory()).getFileHandle(name)).getFile(),
  };
}

async function viaIdb(mb: any): Promise<OutputTarget> {
  if (targetDebug.disable.includes('idb')) throw new Error('disabled');
  const CH = 8 * 1024 * 1024;
  for (const k of await idb.keys('blobs')) if (String(k).startsWith('export:')) await idb.del('blobs', String(k));
  const cache = new Map<number, { buf: Uint8Array; dirty: boolean }>();
  const stored = new Set<number>();
  let end = 0;
  const persist = async (i: number) => {
    const c = cache.get(i)!;
    if (c.dirty) {
      await idb.put('blobs', 'export:' + i, new Blob([c.buf as Uint8Array<ArrayBuffer>]));
      stored.add(i);
    }
    cache.delete(i);
  };
  const chunk = async (i: number) => {
    let c = cache.get(i);
    if (c) return c;
    const buf = new Uint8Array(CH);
    if (stored.has(i)) {
      const b = await idb.get<Blob>('blobs', 'export:' + i);
      if (b) buf.set(new Uint8Array(await b.arrayBuffer()));
    }
    c = { buf, dirty: false };
    cache.set(i, c);
    // メモリに置くのは直近 2 チャンクまで
    while (cache.size > 2) {
      const oldest = [...cache.keys()].filter((k) => k !== i).sort((a, b) => a - b)[0];
      await persist(oldest);
    }
    return c;
  };
  const writable = new WritableStream<Chunk>({
    write: async ({ data, position }) => {
      let off = 0;
      while (off < data.byteLength) {
        const pos = position + off;
        const i = Math.floor(pos / CH);
        const inner = pos - i * CH;
        const n = Math.min(CH - inner, data.byteLength - off);
        const c = await chunk(i);
        c.buf.set(data.subarray(off, off + n), inner);
        c.dirty = true;
        off += n;
      }
      end = Math.max(end, position + data.byteLength);
    },
    close: async () => {
      for (const i of [...cache.keys()]) await persist(i);
    },
  });
  return {
    target: new mb.StreamTarget(writable, { chunked: true, chunkSize: CH }),
    fastStart: false,
    kind: 'idb',
    getBlob: async () => {
      const parts: Blob[] = [];
      const last = Math.floor((end - 1) / CH);
      for (let i = 0; i <= last; i++) {
        const b = (await idb.get<Blob>('blobs', 'export:' + i)) ?? new Blob([new Uint8Array(CH)]);
        parts.push(i === last ? b.slice(0, end - i * CH) : b);
      }
      return new Blob(parts, { type: 'video/mp4' });
    },
  };
}

export async function createOutputTarget(estimatedBytes: number, warnings: string[]): Promise<OutputTarget> {
  const mb = await import('mediabunny');
  // 小さいファイルはメモリ上で作る (先頭にインデックスを置き、再生開始が速い MP4 になる)
  if (estimatedBytes < targetDebug.memoryMax) {
    const target = new mb.BufferTarget();
    return { target, fastStart: 'in-memory', kind: 'memory', getBlob: async () => new Blob([target.buffer!], { type: 'video/mp4' }) };
  }
  for (const f of [viaCreateWritable, viaWorker, viaIdb]) {
    try {
      return await f(mb);
    } catch (e) {
      console.warn('output target unavailable:', f.name, e);
    }
  }
  if (estimatedBytes > 500 * 1024 * 1024) {
    throw new Error('この環境では端末ストレージに書き込めないため、長い動画を書き出せません。解像度を下げるか、範囲を短くしてください。');
  }
  warnings.push('端末ストレージに書き込めないため、メモリ上で書き出しました');
  const target = new mb.BufferTarget();
  return { target, fastStart: 'in-memory', kind: 'memory', getBlob: async () => new Blob([target.buffer!], { type: 'video/mp4' }) };
}

/** 空き容量の確認 (足りない場合は警告文を返す) */
export async function checkSpace(bytes: number): Promise<string | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    if (e?.quota && e.usage != null && e.quota - e.usage < bytes * 1.1) {
      return `端末の空き容量が不足している可能性があります (必要 約 ${Math.round(bytes / 1048576)}MB / 空き 約 ${Math.round((e.quota - e.usage) / 1048576)}MB)。`;
    }
  } catch {
    /* */
  }
  return null;
}
