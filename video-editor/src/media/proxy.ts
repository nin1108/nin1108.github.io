// プレビュー用プロキシ (低解像度 H.264) の生成。書き出しは常に元素材を使う。
import type { AssetMeta } from '../model/types';
import { uid } from '../model/defaults';
import { putBlob, idb } from '../storage/db';
import { blobFor } from './registry';

export const PROXY_SHORT_SIDE = 540;

export function proxyRecommended(a: AssetMeta) {
  return a.kind === 'video' && !a.proxyId && Math.min(a.width ?? 0, a.height ?? 0) > 1080;
}

export async function createProxy(asset: AssetMeta, onProgress: (p: number) => void, signal?: AbortSignal): Promise<string> {
  if (typeof VideoEncoder === 'undefined') throw new Error('この端末はプロキシ作成 (WebCodecs) に対応していません');
  const mb = await import('mediabunny');
  const input = new mb.Input({ source: new mb.BlobSource(await blobFor(asset.id)), formats: mb.ALL_FORMATS });
  const target = new mb.BufferTarget();
  const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const landscape = (asset.width ?? 1) >= (asset.height ?? 1);
  const conv = await mb.Conversion.init({
    input,
    output,
    video: { ...(landscape ? { height: PROXY_SHORT_SIDE } : { width: PROXY_SHORT_SIDE }), codec: 'avc', bitrate: 1_500_000, keyFrameInterval: 1 },
    audio: { discard: true },
  });
  if (!conv.isValid) {
    input.dispose();
    throw new Error('この動画はプロキシに変換できません');
  }
  conv.onProgress = (p) => onProgress(p);
  const abort = () => void conv.cancel();
  signal?.addEventListener('abort', abort);
  try {
    await conv.execute();
  } finally {
    signal?.removeEventListener('abort', abort);
    input.dispose();
  }
  const id = uid();
  await putBlob(id, new Blob([target.buffer!], { type: 'video/mp4' }));
  return id;
}

export async function deleteProxy(id: string) {
  await idb.del('blobs', id).catch(() => {});
}
