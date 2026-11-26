// 音声ミックス。プレビュー (AudioContext) と書き出し (OfflineAudioContext) で同じグラフを構築し、結果を一致させる。
import type { AssetMeta, Clip, Project } from '../model/types';
import { audioBufferFor, reversedBuffer } from './registry';
import { evalNum } from '../model/keyframes';
import { clipEnd } from '../model/ops';

export interface AudioItem {
  clip: Clip;
  asset: AssetMeta;
  trackVolume: number;
}

export function audioItems(p: Project): AudioItem[] {
  const out: AudioItem[] = [];
  for (const c of p.clips) {
    const track = p.tracks.find((t) => t.id === c.trackId);
    if (!track || track.muted) continue;
    if (c.type !== 'audio' && c.type !== 'video') continue;
    if (c.type === 'video' && c.audioDetached) continue;
    if (c.audio.muted || c.freeze) continue;
    const asset = p.assets.find((a) => a.id === c.assetId);
    if (!asset || asset.hasAudio === false) continue;
    out.push({ clip: c, asset, trackVolume: track.volume });
  }
  return out;
}

/** クリップのローカル時刻 l における音量 (キーフレーム・フェード込み) */
export function clipGainAt(c: Clip, l: number, trackVolume: number): number {
  let g = evalNum(c, 'audio.volume', l, c.audio.volume);
  if (c.audio.fadeIn > 0 && l < c.audio.fadeIn) g *= Math.max(0, l / c.audio.fadeIn);
  const rem = c.duration - l;
  if (c.audio.fadeOut > 0 && rem < c.audio.fadeOut) g *= Math.max(0, rem / c.audio.fadeOut);
  return Math.max(0, g * trackVolume);
}

export interface ScheduledMix {
  stop(): void;
}

/**
 * [from, to] の区間のミックスを ctx に構築する。startAt は ctx 時刻で from に対応する時刻。
 */
export function scheduleMix(ctx: BaseAudioContext, dest: AudioNode, p: Project, buffers: Map<string, AudioBuffer>, from: number, to: number, startAt: number): ScheduledMix {
  const nodes: AudioScheduledSourceNode[] = [];
  const master = ctx.createGain();
  master.gain.value = p.masterVolume;
  let tail: AudioNode = master;
  if (p.limiter) {
    // 音割れ防止リミッター
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -1.5;
    lim.knee.value = 0;
    lim.ratio.value = 20;
    lim.attack.value = 0.002;
    lim.release.value = 0.12;
    master.connect(lim);
    tail = lim;
  }
  tail.connect(dest);
  for (const it of audioItems(p)) {
    const c = it.clip;
    const buf0 = buffers.get(it.asset.id);
    if (!buf0) continue;
    const cs = Math.max(c.start, from);
    const ce = Math.min(clipEnd(c), to);
    if (ce - cs < 0.001) continue;
    const buf = c.reverse ? reversedBuffer(it.asset.id, buf0) : buf0;
    const l0 = cs - c.start;
    const span = c.duration * c.speed;
    const offset = c.reverse ? buf0.duration - (c.inPoint + span) + l0 * c.speed : c.inPoint + l0 * c.speed;
    if (offset >= buf.duration) continue;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = c.speed;
    let node: AudioNode = src;
    const g = ctx.createGain();
    // 音量カーブ (キーフレーム/フェード) を 100Hz でサンプリング
    const len = ce - cs;
    const n = Math.max(2, Math.ceil(len * 100));
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) curve[i] = clipGainAt(c, l0 + (i / (n - 1)) * len, it.trackVolume);
    const when = startAt + (cs - from);
    if (when < ctx.currentTime) {
      g.gain.value = curve[0];
    } else {
      g.gain.setValueAtTime(curve[0], when);
      try {
        g.gain.setValueCurveAtTime(curve, when, len);
      } catch {
        g.gain.value = curve[0];
      }
    }
    const eq = c.audio.eq;
    if (eq.low) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowshelf';
      f.frequency.value = 220;
      f.gain.value = eq.low;
      node.connect(f);
      node = f;
    }
    if (eq.mid) {
      const f = ctx.createBiquadFilter();
      f.type = 'peaking';
      f.frequency.value = 1200;
      f.Q.value = 0.8;
      f.gain.value = eq.mid;
      node.connect(f);
      node = f;
    }
    if (eq.high) {
      const f = ctx.createBiquadFilter();
      f.type = 'highshelf';
      f.frequency.value = 5000;
      f.gain.value = eq.high;
      node.connect(f);
      node = f;
    }
    if (c.audio.compressor.enabled) {
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = c.audio.compressor.threshold;
      comp.ratio.value = c.audio.compressor.ratio;
      comp.knee.value = 6;
      comp.attack.value = 0.005;
      comp.release.value = 0.15;
      node.connect(comp);
      node = comp;
      // メイクアップゲイン
      const mk = ctx.createGain();
      mk.gain.value = Math.pow(10, (-c.audio.compressor.threshold * (1 - 1 / c.audio.compressor.ratio)) / 40);
      node.connect(mk);
      node = mk;
    }
    node.connect(g);
    node = g;
    if (c.audio.pan && 'createStereoPanner' in ctx) {
      const pn = ctx.createStereoPanner();
      pn.pan.value = c.audio.pan;
      node.connect(pn);
      node = pn;
    }
    node.connect(master);
    const startWhen = Math.max(when, ctx.currentTime);
    const late = startWhen - when;
    src.start(startWhen, offset + late * c.speed, Math.max(0.001, (len - late) * c.speed));
    nodes.push(src);
  }
  return {
    stop() {
      for (const n of nodes) {
        try {
          n.stop();
        } catch {
          /* */
        }
        n.disconnect();
      }
      master.disconnect();
      tail.disconnect();
    },
  };
}

export async function decodeAll(p: Project, onProgress?: (done: number, total: number) => void): Promise<Map<string, AudioBuffer>> {
  const items = audioItems(p);
  const assets = [...new Map(items.map((i) => [i.asset.id, i.asset])).values()];
  const out = new Map<string, AudioBuffer>();
  let done = 0;
  for (const a of assets) {
    const b = await audioBufferFor(a);
    if (b) out.set(a.id, b);
    onProgress?.(++done, assets.length);
  }
  return out;
}

// ---- プレビュー再生エンジン (マスタークロック) ----
export class AudioEngine {
  ctx: AudioContext | null = null;
  private mix: ScheduledMix | null = null;
  private startCtx = 0;
  private startT = 0;
  private perfStart = 0;
  private buffers = new Map<string, AudioBuffer>();
  playing = false;
  private pendingDecode = new Set<string>();

  ensureCtx(): AudioContext {
    if (!this.ctx) {
      const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
    }
    return this.ctx;
  }

  /** ユーザー操作内で呼び、iOS の自動再生制限を解除する */
  unlock() {
    const ctx = this.ensureCtx();
    if (ctx.state !== 'running') void ctx.resume();
    const b = ctx.createBuffer(1, 1, 22050);
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.connect(ctx.destination);
    s.start(0);
  }

  /** デコード済みバッファを取り込み、未デコードはバックグラウンドで開始 */
  prepare(p: Project, onReady: () => void) {
    for (const it of audioItems(p)) {
      if (this.buffers.has(it.asset.id) || this.pendingDecode.has(it.asset.id)) continue;
      this.pendingDecode.add(it.asset.id);
      void audioBufferFor(it.asset).then((b) => {
        this.pendingDecode.delete(it.asset.id);
        if (b) {
          this.buffers.set(it.asset.id, b);
          onReady();
        }
      });
    }
  }

  isLoading() {
    return this.pendingDecode.size > 0;
  }

  play(p: Project, t: number) {
    const ctx = this.ensureCtx();
    if (ctx.state !== 'running') void ctx.resume();
    this.stopMix();
    this.startT = t;
    this.startCtx = ctx.currentTime + 0.06;
    this.perfStart = performance.now() + 60;
    this.mix = scheduleMix(ctx, ctx.destination, p, this.buffers, t, t + 24 * 3600, this.startCtx);
    this.playing = true;
  }

  /** 再生中にプロジェクトが変わった/新しい音声がデコードされた場合に再スケジュール */
  reschedule(p: Project) {
    if (!this.playing || !this.ctx) return;
    const t = this.now();
    this.stopMix();
    this.startT = t;
    this.startCtx = this.ctx.currentTime + 0.03;
    this.perfStart = performance.now() + 30;
    this.mix = scheduleMix(this.ctx, this.ctx.destination, p, this.buffers, t, t + 24 * 3600, this.startCtx);
  }

  now(): number {
    if (!this.playing) return this.startT;
    const ctx = this.ctx;
    if (ctx && ctx.state === 'running') {
      // AudioContext の時計をマスタークロックにする (映像を音に合わせる)
      const lat = (ctx as any).outputLatency ?? ctx.baseLatency ?? 0;
      return this.startT + Math.max(0, ctx.currentTime - this.startCtx - (Number.isFinite(lat) ? lat : 0));
    }
    return this.startT + Math.max(0, (performance.now() - this.perfStart) / 1000);
  }

  private stopMix() {
    this.mix?.stop();
    this.mix = null;
  }

  stop() {
    this.stopMix();
    this.playing = false;
  }

  dispose() {
    this.stop();
    this.buffers.clear();
    void this.ctx?.close();
    this.ctx = null;
  }
}

/** オフライン書き出し: chunk ごとにレンダリングしてメモリ使用量を抑える */
export async function renderAudioChunk(p: Project, buffers: Map<string, AudioBuffer>, from: number, dur: number, sampleRate = 48000): Promise<AudioBuffer> {
  const len = Math.max(1, Math.round(dur * sampleRate));
  const OAC: typeof OfflineAudioContext = (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  const ctx = new OAC(2, len, sampleRate);
  scheduleMix(ctx, ctx.destination, p, buffers, from, from + dur, 0);
  return ctx.startRendering();
}
