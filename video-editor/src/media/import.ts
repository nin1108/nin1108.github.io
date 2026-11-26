import type { AssetMeta } from '../model/types';
import { uid } from '../model/defaults';
import { putBlob } from '../storage/db';
import { setThumbs, peaksFor } from './registry';

const EXT: Record<string, AssetMeta['kind']> = {
  mp4: 'video', m4v: 'video', mov: 'video', webm: 'video', mkv: 'video', '3gp': 'video',
  jpg: 'image', jpeg: 'image', png: 'image', webp: 'image', gif: 'image', avif: 'image', heic: 'image', heif: 'image', bmp: 'image',
  svg: 'svg',
  mp3: 'audio', m4a: 'audio', aac: 'audio', wav: 'audio', ogg: 'audio', oga: 'audio', opus: 'audio', flac: 'audio', caf: 'audio',
  ttf: 'font', otf: 'font', woff: 'font', woff2: 'font',
  cube: 'lut',
};

export const ACCEPT_MEDIA = 'video/*,image/*,audio/*,.mp4,.mov,.m4v,.webm,.mp3,.m4a,.wav,.aac,.ogg,.flac,.svg';
export const ACCEPT_FONT = '.ttf,.otf,.woff,.woff2,font/*';

const MAX_SIZE = 4 * 1024 * 1024 * 1024; // 4GB

async function sniff(file: File): Promise<AssetMeta['kind'] | null> {
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const s = (o: number, n: number) => String.fromCharCode(...head.slice(o, o + n));
  if (head.length < 4) return null;
  if (s(4, 4) === 'ftyp') {
    const brand = s(8, 4);
    if (/^(M4A |M4B |mp42?$)/.test(brand) && file.type.startsWith('audio')) return 'audio';
    if (brand.startsWith('M4A') || brand.startsWith('M4B')) return 'audio';
    if (/heic|heix|mif1|msf1|avif/.test(brand)) return 'image';
    return 'video';
  }
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return file.type.startsWith('audio') ? 'audio' : 'video';
  if (head[0] === 0xff && head[1] === 0xd8) return 'image';
  if (head[0] === 0x89 && s(1, 3) === 'PNG') return 'image';
  if (s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP') return 'image';
  if (s(0, 4) === 'RIFF' && s(8, 4) === 'WAVE') return 'audio';
  if (s(0, 3) === 'GIF') return 'image';
  if (s(0, 2) === 'BM') return 'image';
  if (s(0, 3) === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) return 'audio';
  if (s(0, 4) === 'OggS') return 'audio';
  if (s(0, 4) === 'fLaC') return 'audio';
  if (s(0, 4) === 'caff') return 'audio';
  if (s(0, 4) === 'wOFF' || s(0, 4) === 'wOF2' || s(0, 4) === 'OTTO' || (head[0] === 0 && head[1] === 1 && head[2] === 0 && head[3] === 0) || s(0, 4) === 'true') return 'font';
  const text = s(0, 64).trimStart().toLowerCase();
  if (text.startsWith('<svg') || text.startsWith('<?xml')) return 'svg';
  return null;
}

function extKind(name: string): AssetMeta['kind'] | null {
  const e = name.split('.').pop()?.toLowerCase() ?? '';
  return EXT[e] ?? null;
}

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(msg)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        res(v);
      },
      (e) => {
        clearTimeout(t);
        rej(e);
      },
    );
  });
}

function probeVideo(url: string): Promise<{ duration: number; width: number; height: number; el: HTMLVideoElement }> {
  return withTimeout(
    new Promise((resolve, reject) => {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.onloadeddata = () => {
        if (!Number.isFinite(v.duration) || v.duration <= 0) {
          // 一部の WebM は duration が Infinity になる → 末尾へシークして確定させる
          v.currentTime = 1e9;
          v.ontimeupdate = () => {
            v.ontimeupdate = null;
            resolve({ duration: v.duration, width: v.videoWidth, height: v.videoHeight, el: v });
          };
          return;
        }
        resolve({ duration: v.duration, width: v.videoWidth, height: v.videoHeight, el: v });
      };
      v.onerror = () => reject(new Error('この動画はこの端末のブラウザでは再生できない形式です'));
      v.src = url;
      v.load();
    }),
    30000,
    '動画の読み込みがタイムアウトしました',
  );
}

function probeAudio(url: string): Promise<number> {
  return withTimeout(
    new Promise((resolve, reject) => {
      const a = document.createElement('audio');
      a.preload = 'metadata';
      a.onloadedmetadata = () => resolve(a.duration);
      a.onerror = () => reject(new Error('この音声形式は再生できません'));
      a.src = url;
    }),
    20000,
    '音声の読み込みがタイムアウトしました',
  );
}

async function videoInfoMediabunny(file: Blob): Promise<{ hasAudio: boolean; fps?: number } | null> {
  try {
    const mb = await import('mediabunny');
    const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
    try {
      const a = await input.getPrimaryAudioTrack();
      const v = await input.getPrimaryVideoTrack();
      let fps: number | undefined;
      if (v) {
        const st = await v.computePacketStats(120).catch(() => null);
        if (st?.averagePacketRate) fps = Math.round(st.averagePacketRate * 100) / 100;
      }
      return { hasAudio: !!a, fps };
    } finally {
      input.dispose();
    }
  } catch {
    return null;
  }
}

async function makeThumbs(el: HTMLVideoElement, duration: number, id: string) {
  const n = Math.max(1, Math.min(24, Math.ceil(duration / 2)));
  const h = 72;
  const w = Math.max(1, Math.round((el.videoWidth / Math.max(1, el.videoHeight)) * h));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const out: { t: number; url: string }[] = [];
  for (let i = 0; i < n; i++) {
    const t = Math.min(duration - 0.05, (i + 0.5) * (duration / n));
    await withTimeout(
      new Promise<void>((res) => {
        const done = () => {
          el.removeEventListener('seeked', done);
          res();
        };
        el.addEventListener('seeked', done);
        el.currentTime = Math.max(0, t);
      }),
      5000,
      'thumb timeout',
    ).catch(() => {});
    try {
      ctx.drawImage(el, 0, 0, w, h);
      out.push({ t, url: c.toDataURL('image/jpeg', 0.6) });
    } catch {
      break;
    }
  }
  setThumbs(id, out);
}

export interface ImportResult {
  asset: AssetMeta;
  /** バックグラウンド処理 (サムネイル/波形) */
  background: Promise<void>;
}

export async function importFile(file: File): Promise<ImportResult> {
  if (file.size === 0) throw new Error(`「${file.name}」は空のファイルです`);
  if (file.size > MAX_SIZE) throw new Error(`「${file.name}」は大きすぎます (4GB まで)`);
  const sniffed = await sniff(file);
  const byExt = extKind(file.name);
  let kind = sniffed ?? byExt;
  if (!kind) {
    if (file.type.startsWith('video/')) kind = 'video';
    else if (file.type.startsWith('image/')) kind = 'image';
    else if (file.type.startsWith('audio/')) kind = 'audio';
  }
  if (byExt === 'lut') kind = 'lut';
  if (!kind) throw new Error(`「${file.name}」は対応していないファイル形式です`);
  // 拡張子と中身が矛盾する場合は中身を優先 (例: .mp4 の音声のみファイル)
  const id = uid();
  const asset: AssetMeta = { id, name: file.name, kind, mime: file.type || '', size: file.size, createdAt: Date.now() };
  const url = URL.createObjectURL(file);
  let background: Promise<void> = Promise.resolve();
  let revokeLater = false;
  try {
    if (kind === 'video') {
      const info = await probeVideo(url);
      if (!info.width || !info.height) {
        // 映像トラックの無い mp4 (音声のみ)
        asset.kind = 'audio';
        asset.duration = info.duration;
        asset.hasAudio = true;
      } else {
        asset.duration = info.duration;
        asset.width = info.width;
        asset.height = info.height;
        const mb = await videoInfoMediabunny(file);
        asset.hasAudio = mb ? mb.hasAudio : true;
        asset.fps = mb?.fps;
        revokeLater = true;
        background = makeThumbs(info.el, info.duration, id).finally(() => {
          info.el.removeAttribute('src');
          info.el.load();
          URL.revokeObjectURL(url);
        });
      }
    } else if (kind === 'image' || kind === 'svg') {
      const img = new Image();
      img.src = url;
      await withTimeout(img.decode(), 20000, '画像の読み込みがタイムアウトしました').catch(() => {
        throw new Error(`「${file.name}」はこのブラウザで表示できない画像形式です`);
      });
      asset.width = img.naturalWidth || 1024;
      asset.height = img.naturalHeight || 1024;
      if (kind === 'svg') asset.mime = 'image/svg+xml';
    } else if (kind === 'audio') {
      asset.duration = await probeAudio(url);
      asset.hasAudio = true;
    } else if (kind === 'font') {
      const family = 'UserFont-' + file.name.replace(/\.[^.]+$/, '').replace(/[^\w぀-ヿ一-鿿-]/g, '_');
      const ff = new FontFace(family, await file.arrayBuffer());
      await ff.load().catch(() => {
        throw new Error(`「${file.name}」はフォントとして読み込めませんでした`);
      });
      (document.fonts as any).add(ff);
      asset.fontFamily = family;
    } else if (kind === 'lut') {
      const txt = await file.text();
      if (!/LUT_3D_SIZE\s+\d+/.test(txt)) throw new Error('3D LUT (.cube) のみ対応しています');
    }
  } finally {
    if (!revokeLater) URL.revokeObjectURL(url);
  }
  await putBlob(id, file);
  if (asset.hasAudio && asset.duration && asset.duration < 3 * 3600) {
    const prev = background;
    background = prev.then(() => peaksFor(asset).then(() => undefined)).catch(() => undefined);
  }
  return { asset, background };
}

export async function importBlob(blob: Blob, name: string): Promise<ImportResult> {
  const f = new File([blob], name, { type: blob.type });
  return importFile(f);
}
