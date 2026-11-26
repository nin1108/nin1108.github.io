// 実行時のメディアキャッシュ (永続化しない)。
// オブジェクト URL・ImageBitmap・デコード済み AudioBuffer・フォントを管理し、メモリリークを防ぐため明示的に解放する。
import { getBlob, getMeta, putMeta } from '../storage/db';
import type { AssetMeta } from '../model/types';

const urls = new Map<string, string>();
const blobs = new Map<string, Blob>();
const images = new Map<string, { bmp: ImageBitmap | HTMLCanvasElement; key: string }>();
const audioBuffers = new Map<string, Promise<AudioBuffer | null>>();
const fontsLoaded = new Set<string>();

export async function blobFor(id: string): Promise<Blob> {
  let b = blobs.get(id);
  if (b) return b;
  b = await getBlob(id);
  if (!b) throw new Error('素材データが見つかりません (削除された可能性があります)');
  blobs.set(id, b);
  return b;
}

export async function urlFor(id: string): Promise<string> {
  let u = urls.get(id);
  if (u) return u;
  const b = await blobFor(id);
  u = URL.createObjectURL(b);
  urls.set(id, u);
  return u;
}

export function cachedUrl(id: string) {
  return urls.get(id);
}

let maxTex = 4096;
export function setMaxTextureSize(n: number) {
  maxTex = n;
}

/** 画像を取得。maxDim を超える場合は縮小 (プレビュー用は小さく、書き出し用は原寸) */
export async function imageFor(asset: AssetMeta, maxDim: number): Promise<ImageBitmap | HTMLCanvasElement> {
  const lim = Math.min(maxDim, maxTex);
  const key = asset.id + '@' + lim;
  const hit = images.get(key);
  if (hit) return hit.bmp;
  const blob = await blobFor(asset.id);
  let out: ImageBitmap | HTMLCanvasElement;
  if (asset.kind === 'svg' || blob.type === 'image/svg+xml') {
    const url = await urlFor(asset.id);
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const w0 = img.naturalWidth || asset.width || 1024;
    const h0 = img.naturalHeight || asset.height || 1024;
    const s = Math.min(lim / Math.max(w0, h0), 4);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w0 * s));
    c.height = Math.max(1, Math.round(h0 * s));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    out = c;
  } else {
    const full = await createImageBitmap(blob).catch(async () => {
      // 一部ブラウザ (HEIC 等) は <img> 経由のみデコード可能
      const url = await urlFor(asset.id);
      const img = new Image();
      img.src = url;
      await img.decode();
      return createImageBitmap(img);
    });
    const s = Math.min(1, lim / Math.max(full.width, full.height));
    if (s < 1) {
      out = await createImageBitmap(full, { resizeWidth: Math.round(full.width * s), resizeHeight: Math.round(full.height * s), resizeQuality: 'high' });
      full.close();
    } else out = full;
  }
  images.set(key, { bmp: out, key });
  return out;
}

export function cachedImage(asset: AssetMeta, maxDim: number) {
  return images.get(asset.id + '@' + Math.min(maxDim, maxTex))?.bmp;
}

// ---- 音声 ----
let decodeCtx: BaseAudioContext | null = null;
function getDecodeCtx(): BaseAudioContext {
  if (!decodeCtx) {
    const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
    try {
      decodeCtx = new OfflineAudioContext(2, 1, 48000);
    } catch {
      decodeCtx = new AC();
    }
  }
  return decodeCtx;
}

async function decodeWithMediabunny(blob: Blob): Promise<AudioBuffer | null> {
  const mb = await import('mediabunny');
  const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) return null;
    const dur = await track.computeDuration();
    const sr = 48000;
    const len = Math.max(1, Math.ceil(dur * sr));
    const sink = new mb.AudioBufferSink(track);
    const out = new AudioBuffer({ length: len, numberOfChannels: 2, sampleRate: sr });
    const L = out.getChannelData(0);
    const R = out.getChannelData(1);
    for await (const { buffer, timestamp } of sink.buffers()) {
      // サンプルレートが異なる場合は線形補間でリサンプル
      const ratio = buffer.sampleRate / sr;
      const a = buffer.getChannelData(0);
      const b = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : a;
      const startIdx = Math.round(timestamp * sr);
      const n = Math.floor(buffer.length / ratio);
      for (let i = 0; i < n; i++) {
        const j = startIdx + i;
        if (j < 0 || j >= len) continue;
        const x = i * ratio;
        const x0 = Math.floor(x);
        const f = x - x0;
        const x1 = Math.min(x0 + 1, buffer.length - 1);
        L[j] = a[x0] * (1 - f) + a[x1] * f;
        R[j] = b[x0] * (1 - f) + b[x1] * f;
      }
    }
    return out;
  } finally {
    input.dispose();
  }
}

/** 音声のデコード (キャッシュ)。音声トラックが無い・非対応なら null */
export function audioBufferFor(asset: AssetMeta): Promise<AudioBuffer | null> {
  let p = audioBuffers.get(asset.id);
  if (p) return p;
  p = (async () => {
    const blob = await blobFor(asset.id);
    // 大きなファイルは全体を ArrayBuffer に載せずにストリーミングデコード (iOS のメモリ対策)
    const big = blob.size > 150 * 1024 * 1024;
    if (big && 'AudioDecoder' in window) {
      try {
        const r = await decodeWithMediabunny(blob);
        if (r) return r;
      } catch (e) {
        console.warn('mediabunny audio decode failed', e);
      }
    }
    try {
      const ab = await blob.arrayBuffer();
      return await new Promise<AudioBuffer>((res, rej) => {
        const r = getDecodeCtx().decodeAudioData(ab, res, rej);
        if (r && typeof (r as any).then === 'function') (r as Promise<AudioBuffer>).then(res, rej);
      });
    } catch (e) {
      if (!big && 'AudioDecoder' in window) {
        try {
          return await decodeWithMediabunny(blob);
        } catch {
          /* */
        }
      }
      console.warn('audio decode failed', asset.name, e);
      return null;
    }
  })();
  audioBuffers.set(asset.id, p);
  return p;
}

export function hasDecodedAudio(id: string) {
  return audioBuffers.has(id);
}

const reversed = new Map<string, AudioBuffer>();
export function reversedBuffer(id: string, buf: AudioBuffer): AudioBuffer {
  let r = reversed.get(id);
  if (r) return r;
  r = new AudioBuffer({ length: buf.length, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c);
    const dst = r.getChannelData(c);
    for (let i = 0, n = src.length; i < n; i++) dst[i] = src[n - 1 - i];
  }
  reversed.set(id, r);
  return r;
}

// ---- 波形ピーク (1 秒あたり 100 点) ----
export const PEAKS_PER_SEC = 100;
const peaksCache = new Map<string, Float32Array>();
export function cachedPeaks(id: string) {
  return peaksCache.get(id);
}
export async function peaksFor(asset: AssetMeta): Promise<Float32Array | null> {
  const hit = peaksCache.get(asset.id);
  if (hit) return hit;
  const stored = await getMeta<Float32Array>('peaks:' + asset.id).catch(() => undefined);
  if (stored) {
    peaksCache.set(asset.id, stored);
    return stored;
  }
  const buf = await audioBufferFor(asset);
  if (!buf) return null;
  const n = Math.max(1, Math.ceil(buf.duration * PEAKS_PER_SEC));
  const out = new Float32Array(n);
  const step = buf.sampleRate / PEAKS_PER_SEC;
  const chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
  for (let i = 0; i < n; i++) {
    let m = 0;
    const s = Math.floor(i * step);
    const e = Math.min(buf.length, Math.floor((i + 1) * step));
    for (const ch of chans) for (let j = s; j < e; j += 4) {
      const v = Math.abs(ch[j]);
      if (v > m) m = v;
    }
    out[i] = m;
  }
  peaksCache.set(asset.id, out);
  void putMeta('peaks:' + asset.id, out).catch(() => {});
  return out;
}

// ---- フォント ----
export async function ensureFontAsset(asset: AssetMeta) {
  if (!asset.fontFamily || fontsLoaded.has(asset.id)) return;
  const blob = await blobFor(asset.id);
  const buf = await blob.arrayBuffer();
  const ff = new FontFace(asset.fontFamily, buf);
  await ff.load();
  (document.fonts as any).add(ff);
  fontsLoaded.add(asset.id);
}

// ---- サムネイル (動画: 数枚の JPEG) ----
const thumbCache = new Map<string, { t: number; url: string; img?: HTMLImageElement }[]>();
export function cachedThumbs(id: string) {
  return thumbCache.get(id);
}
export async function loadThumbs(id: string) {
  if (thumbCache.has(id)) return thumbCache.get(id)!;
  const t = await getMeta<{ t: number; url: string }[]>('thumbs:' + id).catch(() => undefined);
  if (t) {
    const withImg = t.map((x) => {
      const img = new Image();
      img.src = x.url;
      return { ...x, img };
    });
    thumbCache.set(id, withImg);
    return withImg;
  }
  return undefined;
}
export function setThumbs(id: string, t: { t: number; url: string }[]) {
  const withImg = t.map((x) => {
    const img = new Image();
    img.src = x.url;
    return { ...x, img };
  });
  thumbCache.set(id, withImg);
  void putMeta('thumbs:' + id, t).catch(() => {});
}

/** プロジェクトを閉じるときにキャッシュを解放 */
export function releaseAll() {
  for (const u of urls.values()) URL.revokeObjectURL(u);
  urls.clear();
  blobs.clear();
  for (const v of images.values()) if ('close' in v.bmp) (v.bmp as ImageBitmap).close();
  images.clear();
  audioBuffers.clear();
  reversed.clear();
  peaksCache.clear();
}

export function releaseImagesAbove(maxDim: number) {
  for (const [k, v] of images) {
    const lim = Number(k.split('@')[1]);
    if (lim > maxDim) {
      if ('close' in v.bmp) (v.bmp as ImageBitmap).close();
      images.delete(k);
    }
  }
}
