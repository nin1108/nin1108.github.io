// 長尺対応の音声取得: 素材の音声を 5 秒単位の区間ごとにデコードし、必要な範囲だけをメモリに置く。
// (以前は素材全体を PCM に展開していたため、15 分の素材 1 本で約 350MB を消費していた)
//
// デコード方式 (上から順に試す):
//  1. 短い素材 (2.5 分以下): ブラウザの decodeAudioData で全体を展開しキャッシュ (高速・単純)
//  2. WebCodecs AudioDecoder (mediabunny AudioBufferSink) で区間だけをデコード
//  3. AAC 音声で AudioDecoder が無い端末: 区間のパケットに ADTS ヘッダーを付けて decodeAudioData
//  4. それも無理なら全体を decodeAudioData (従来どおり)
import type { AssetMeta } from '../model/types';
import { audioBufferFor, blobFor } from './registry';

export const SAMPLE_RATE = 48000;
export const SEG = 5; // 区間の長さ (秒)
const FULL_DECODE_MAX_SEC = 150;
const MAX_CACHED_SEGMENTS = 16; // 素材 1 本あたり 80 秒ぶん (≒ 31MB) を上限に古いものから破棄

export interface PcmRange {
  buffer: AudioBuffer;
  /** buffer の先頭が素材内の何秒か */
  t0: number;
}

/** テスト用: 強制的に特定のデコード方式を使う */
export const audioDebug = { force: null as null | 'webcodecs' | 'adts' | 'full', lastMode: '' };

function newBuffer(len: number) {
  return new AudioBuffer({ length: Math.max(1, len), numberOfChannels: 2, sampleRate: SAMPLE_RATE });
}

/** 任意サンプルレート・チャンネル数のデータを 48kHz ステレオの out に時刻 tOut から書き込む (線形補間) */
function writeResampled(out: AudioBuffer, outT0: number, chans: Float32Array[], srcRate: number, srcT0: number) {
  const L = out.getChannelData(0);
  const R = out.getChannelData(1);
  const a = chans[0];
  const b = chans.length > 1 ? chans[1] : chans[0];
  const n = a.length;
  const ratio = srcRate / SAMPLE_RATE;
  const startIdx = Math.round((srcT0 - outT0) * SAMPLE_RATE);
  const count = Math.floor(n / ratio);
  const i0 = Math.max(0, -startIdx);
  const i1 = Math.min(count, out.length - startIdx);
  for (let i = i0; i < i1; i++) {
    const j = startIdx + i;
    const x = i * ratio;
    const x0 = x | 0;
    const f = x - x0;
    const x1 = x0 + 1 < n ? x0 + 1 : x0;
    L[j] = a[x0] * (1 - f) + a[x1] * f;
    R[j] = b[x0] * (1 - f) + b[x1] * f;
  }
}

// ---- ADTS (AAC) ----
const ADTS_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
function parseAsc(desc: BufferSource | undefined, fallbackRate: number, fallbackCh: number) {
  let objectType = 2;
  let freqIdx = ADTS_RATES.indexOf(fallbackRate);
  let ch = fallbackCh;
  if (desc) {
    const u8 = desc instanceof ArrayBuffer ? new Uint8Array(desc) : new Uint8Array((desc as ArrayBufferView).buffer, (desc as ArrayBufferView).byteOffset, (desc as ArrayBufferView).byteLength);
    if (u8.length >= 2) {
      objectType = u8[0] >> 3;
      freqIdx = ((u8[0] & 7) << 1) | (u8[1] >> 7);
      ch = (u8[1] >> 3) & 15;
    }
  }
  if (freqIdx < 0 || freqIdx > 12) freqIdx = 3;
  return { profile: Math.max(1, Math.min(4, objectType)) - 1, freqIdx, ch: ch || 2 };
}
function adtsFrame(payload: Uint8Array, cfg: { profile: number; freqIdx: number; ch: number }) {
  const len = payload.length + 7;
  const h = new Uint8Array(len);
  h[0] = 0xff;
  h[1] = 0xf1;
  h[2] = (cfg.profile << 6) | (cfg.freqIdx << 2) | ((cfg.ch >> 2) & 1);
  h[3] = ((cfg.ch & 3) << 6) | ((len >> 11) & 3);
  h[4] = (len >> 3) & 0xff;
  h[5] = ((len & 7) << 5) | 0x1f;
  h[6] = 0xfc;
  h.set(payload, 7);
  return h;
}

function decodeAudioDataP(ctx: BaseAudioContext, buf: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((res, rej) => {
    const r = ctx.decodeAudioData(buf, res, rej);
    if (r && typeof (r as any).then === 'function') (r as Promise<AudioBuffer>).then(res, rej);
  });
}

class AssetAudio {
  private segs = new Map<number, Promise<AudioBuffer | null>>();
  private order: number[] = [];
  private inputP: Promise<any> | null = null;
  private mode: 'full' | 'webcodecs' | 'adts' | null = null;
  constructor(public asset: AssetMeta) {}

  private async input() {
    if (!this.inputP) {
      this.inputP = (async () => {
        const mb = await import('mediabunny');
        const input = new mb.Input({ source: new mb.BlobSource(await blobFor(this.asset.id)), formats: mb.ALL_FORMATS });
        const track = await input.getPrimaryAudioTrack();
        return { mb, input, track };
      })();
    }
    return this.inputP;
  }

  private async pickMode(): Promise<'full' | 'webcodecs' | 'adts'> {
    if (this.mode) return this.mode;
    const dur = this.asset.duration ?? 0;
    let mode: 'full' | 'webcodecs' | 'adts' = 'full';
    if (audioDebug.force) mode = audioDebug.force;
    else if (dur > FULL_DECODE_MAX_SEC) {
      try {
        const { track } = await this.input();
        if (track && typeof AudioDecoder !== 'undefined' && (await track.canDecode())) mode = 'webcodecs';
        else if (track && (await track.getCodec()) === 'aac') mode = 'adts';
      } catch {
        mode = 'full';
      }
    }
    this.mode = mode;
    audioDebug.lastMode = mode;
    return mode;
  }

  /** 区間 k ([k*SEG, (k+1)*SEG)) を 48kHz ステレオで返す */
  segment(k: number): Promise<AudioBuffer | null> {
    let p = this.segs.get(k);
    if (p) {
      this.order = this.order.filter((x) => x !== k);
      this.order.push(k);
      return p;
    }
    p = this.decodeSegment(k).catch((e) => {
      console.warn('audio segment decode failed', this.asset.name, k, e);
      return null;
    });
    this.segs.set(k, p);
    this.order.push(k);
    while (this.order.length > MAX_CACHED_SEGMENTS) this.segs.delete(this.order.shift()!);
    return p;
  }

  async decodeSegment(k: number): Promise<AudioBuffer | null> {
    const mode = await this.pickMode();
    const t0 = k * SEG;
    const dur = this.asset.duration ?? 0;
    const t1 = Math.min(t0 + SEG, dur > 0 ? dur : t0 + SEG);
    if (t1 <= t0) return null;
    const out = newBuffer(Math.round((t1 - t0) * SAMPLE_RATE));
    if (mode === 'full') {
      const full = await audioBufferFor(this.asset);
      if (!full) return null;
      const chans = Array.from({ length: full.numberOfChannels }, (_, i) => full.getChannelData(i).subarray(Math.floor(t0 * full.sampleRate), Math.ceil(t1 * full.sampleRate)));
      writeResampled(out, t0, chans, full.sampleRate, Math.floor(t0 * full.sampleRate) / full.sampleRate);
      return out;
    }
    const { mb, track } = await this.input();
    if (!track) return null;
    if (mode === 'webcodecs') {
      const sink = new mb.AudioBufferSink(track);
      for await (const { buffer, timestamp } of sink.buffers(t0, t1)) {
        const chans = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
        writeResampled(out, t0, chans, buffer.sampleRate, timestamp);
      }
      return out;
    }
    // ADTS: 前後 2 パケットの余裕 (デコーダの重ね合わせ用) を付けてデコードし、時刻で切り出す
    const cfgRaw = await track.getDecoderConfig();
    const cfg = parseAsc(cfgRaw?.description, cfgRaw?.sampleRate ?? 48000, cfgRaw?.numberOfChannels ?? 2);
    const sink = new mb.EncodedPacketSink(track);
    let first = await sink.getPacket(Math.max(0, t0 - 0.06));
    if (!first) first = await sink.getFirstPacket();
    if (!first) return null;
    const frames: Uint8Array[] = [];
    let total = 0;
    let pkt: any = first;
    while (pkt && pkt.timestamp < t1 + 0.05) {
      const f = adtsFrame(pkt.data, cfg);
      frames.push(f);
      total += f.length;
      pkt = await sink.getNextPacket(pkt);
    }
    const all = new Uint8Array(total);
    let o = 0;
    for (const f of frames) {
      all.set(f, o);
      o += f.length;
    }
    const rate = ADTS_RATES[cfg.freqIdx];
    const OAC: typeof OfflineAudioContext = (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
    const decoded = await decodeAudioDataP(new OAC(2, 1, rate), all.buffer);
    const chans = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
    writeResampled(out, t0, chans, decoded.sampleRate, first.timestamp);
    return out;
  }

  /** 素材内 [a, b] 秒の PCM */
  async range(a: number, b: number): Promise<PcmRange | null> {
    const mode = await this.pickMode();
    if (mode === 'full') {
      const full = await audioBufferFor(this.asset);
      return full ? { buffer: full, t0: 0 } : null;
    }
    a = Math.max(0, a);
    b = Math.max(a + 1 / SAMPLE_RATE, b);
    const k0 = Math.floor(a / SEG);
    const k1 = Math.floor((b - 1e-9) / SEG);
    const segs = await Promise.all(Array.from({ length: k1 - k0 + 1 }, (_, i) => this.segment(k0 + i)));
    if (segs.every((s) => !s)) return null;
    if (k0 === k1) return { buffer: segs[0]!, t0: k0 * SEG };
    const out = newBuffer(Math.round((k1 - k0 + 1) * SEG * SAMPLE_RATE));
    segs.forEach((s, i) => {
      if (!s) return;
      const off = Math.round(i * SEG * SAMPLE_RATE);
      for (let c = 0; c < 2; c++) out.getChannelData(c).set(s.getChannelData(c).subarray(0, Math.min(s.length, out.length - off)), off);
    });
    return { buffer: out, t0: k0 * SEG };
  }

  dispose() {
    this.segs.clear();
    this.order = [];
    void this.inputP?.then((x) => x.input.dispose()).catch(() => {});
    this.inputP = null;
  }
}

const sources = new Map<string, AssetAudio>();

export function audioOf(asset: AssetMeta): AssetAudio {
  let s = sources.get(asset.id);
  if (!s) {
    s = new AssetAudio(asset);
    sources.set(asset.id, s);
  }
  return s;
}

export function releaseAudioSources() {
  for (const s of sources.values()) s.dispose();
  sources.clear();
}

/** 波形ピーク (1 秒あたり pps 点) を区間ごとに計算し、PCM をため込まない */
export async function computePeaks(asset: AssetMeta, pps: number): Promise<Float32Array | null> {
  const dur = asset.duration ?? 0;
  if (!(dur > 0)) return null;
  const src = new AssetAudio(asset); // キャッシュを汚さない専用インスタンス
  try {
    const out = new Float32Array(Math.ceil(dur * pps));
    const step = SAMPLE_RATE / pps;
    let any = false;
    for (let k = 0; k * SEG < dur; k++) {
      const seg = await src.decodeSegment(k);
      if (!seg) continue;
      any = true;
      const L = seg.getChannelData(0);
      const R = seg.getChannelData(1);
      const base = Math.round(k * SEG * pps);
      const n = Math.ceil(seg.length / step);
      for (let i = 0; i < n && base + i < out.length; i++) {
        let m = 0;
        const e = Math.min(seg.length, Math.floor((i + 1) * step));
        for (let j = Math.floor(i * step); j < e; j += 4) {
          const v = Math.max(Math.abs(L[j]), Math.abs(R[j]));
          if (v > m) m = v;
        }
        out[base + i] = m;
      }
    }
    return any ? out : null;
  } finally {
    src.dispose();
  }
}

/** テスト用: 指定方式で区間 k をデコード (キャッシュしない) */
export async function decodeSegmentWith(asset: AssetMeta, k: number, mode: 'webcodecs' | 'adts' | 'full'): Promise<AudioBuffer | null> {
  const prev = audioDebug.force;
  audioDebug.force = mode;
  const a = new AssetAudio(asset);
  try {
    return await a.decodeSegment(k);
  } finally {
    audioDebug.force = prev;
    a.dispose();
  }
}
