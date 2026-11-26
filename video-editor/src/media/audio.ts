// 音声ミックス。プレビュー (AudioContext) と書き出し (OfflineAudioContext) で同じグラフを使う。
// 長尺対応のため、素材の音声は必要な区間だけをデコードし (audioStream.ts)、時間窓ごとに再生ノードを積む。
import type { AssetMeta, Clip, Project } from '../model/types';
import { evalNum } from '../model/keyframes';
import { clipEnd } from '../model/ops';
import { audioOf, SAMPLE_RATE, type PcmRange } from './audioStream';

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

interface WindowPart {
  item: AudioItem;
  cs: number; // タイムライン上の区間
  ce: number;
  lo: number; // 素材内の区間
  hi: number;
}

function windowParts(p: Project, from: number, to: number): WindowPart[] {
  const out: WindowPart[] = [];
  for (const item of audioItems(p)) {
    const c = item.clip;
    const cs = Math.max(c.start, from);
    const ce = Math.min(clipEnd(c), to);
    if (ce - cs < 1e-4) continue;
    const l0 = cs - c.start;
    const l1 = ce - c.start;
    const span = c.duration * c.speed;
    const lo = c.reverse ? c.inPoint + span - l1 * c.speed : c.inPoint + l0 * c.speed;
    const hi = c.reverse ? c.inPoint + span - l0 * c.speed : c.inPoint + l1 * c.speed;
    out.push({ item, cs, ce, lo, hi });
  }
  return out;
}

/** 時間窓 [from, to] に必要な PCM を取得 (クリップ ID → 範囲) */
export async function fetchWindow(p: Project, from: number, to: number): Promise<Map<string, PcmRange>> {
  const parts = windowParts(p, from, to);
  const res = await Promise.all(parts.map((w) => audioOf(w.item.asset).range(w.lo - 0.01, w.hi + 0.01)));
  const m = new Map<string, PcmRange>();
  parts.forEach((w, i) => {
    const r = res[i];
    if (r) m.set(w.item.clip.id, r);
  });
  return m;
}

const reversedCache = new WeakMap<AudioBuffer, AudioBuffer>();
function reversed(buf: AudioBuffer): AudioBuffer {
  let r = reversedCache.get(buf);
  if (r) return r;
  r = new AudioBuffer({ length: buf.length, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const s = buf.getChannelData(c);
    const d = r.getChannelData(c);
    for (let i = 0, n = s.length; i < n; i++) d[i] = s[n - 1 - i];
  }
  reversedCache.set(buf, r);
  return r;
}

interface Chain {
  input: AudioNode;
  gain: GainNode;
  lastCurveEnd: number;
}

/**
 * ミックスグラフ。クリップごとの効果 (EQ・コンプ・音量・パン) とマスター/リミッターは窓をまたいで保持し、
 * 窓ごとに音源ノードだけを追加する (境界でコンプレッサー等の状態がリセットされない)。
 */
export class MixGraph {
  private master: GainNode;
  private tail: AudioNode;
  private chains = new Map<string, Chain>();
  private sources: AudioScheduledSourceNode[] = [];
  constructor(
    private ctx: BaseAudioContext,
    dest: AudioNode,
    private p: Project,
  ) {
    this.master = ctx.createGain();
    this.master.gain.value = p.masterVolume;
    this.tail = this.master;
    if (p.limiter) {
      // 音割れ防止リミッター
      const lim = ctx.createDynamicsCompressor();
      lim.threshold.value = -1.5;
      lim.knee.value = 0;
      lim.ratio.value = 20;
      lim.attack.value = 0.002;
      lim.release.value = 0.12;
      this.master.connect(lim);
      this.tail = lim;
    }
    this.tail.connect(dest);
  }

  private chain(c: Clip): Chain {
    let ch = this.chains.get(c.id);
    if (ch) return ch;
    const ctx = this.ctx;
    const input = ctx.createGain();
    let node: AudioNode = input;
    const eq = c.audio.eq;
    const biquad = (type: BiquadFilterType, f: number, g: number, q?: number) => {
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.gain.value = g;
      if (q) b.Q.value = q;
      node.connect(b);
      node = b;
    };
    if (eq.low) biquad('lowshelf', 220, eq.low);
    if (eq.mid) biquad('peaking', 1200, eq.mid, 0.8);
    if (eq.high) biquad('highshelf', 5000, eq.high);
    if (c.audio.compressor.enabled) {
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = c.audio.compressor.threshold;
      comp.ratio.value = c.audio.compressor.ratio;
      comp.knee.value = 6;
      comp.attack.value = 0.005;
      comp.release.value = 0.15;
      node.connect(comp);
      node = comp;
      const mk = ctx.createGain();
      mk.gain.value = Math.pow(10, (-c.audio.compressor.threshold * (1 - 1 / c.audio.compressor.ratio)) / 40);
      node.connect(mk);
      node = mk;
    }
    const gain = ctx.createGain();
    gain.gain.value = 0;
    node.connect(gain);
    node = gain;
    if (c.audio.pan && 'createStereoPanner' in ctx) {
      const pn = ctx.createStereoPanner();
      pn.pan.value = c.audio.pan;
      node.connect(pn);
      node = pn;
    }
    node.connect(this.master);
    ch = { input, gain, lastCurveEnd: -1 };
    this.chains.set(c.id, ch);
    return ch;
  }

  /** タイムライン [from, to] を ctx 時刻 startAt から鳴らす */
  addWindow(from: number, to: number, startAt: number, ranges: Map<string, PcmRange>) {
    const ctx = this.ctx;
    for (const w of windowParts(this.p, from, to)) {
      const r = ranges.get(w.item.clip.id);
      if (!r) continue;
      const c = w.item.clip;
      const len = w.ce - w.cs;
      const when = startAt + (w.cs - from);
      const ch = this.chain(c);
      // 音量カーブ (100Hz)
      const n = Math.max(2, Math.ceil(len * 100));
      const curve = new Float32Array(n);
      const l0 = w.cs - c.start;
      for (let i = 0; i < n; i++) curve[i] = clipGainAt(c, l0 + (i / (n - 1)) * len, w.item.trackVolume);
      const startWhen = Math.max(when, ctx.currentTime);
      const late = startWhen - when;
      try {
        if (late > 0 || when < ch.lastCurveEnd - 1e-6) ch.gain.gain.setValueAtTime(curve[Math.min(n - 1, Math.floor((late / len) * n))], startWhen);
        else ch.gain.gain.setValueCurveAtTime(curve, when, len * 0.999);
        ch.lastCurveEnd = when + len;
      } catch {
        ch.gain.gain.setValueAtTime(curve[0], startWhen);
      }
      if (len - late <= 0.001) continue;
      const buf = c.reverse ? reversed(r.buffer) : r.buffer;
      const bufEnd = r.t0 + r.buffer.duration;
      // 素材内の再生開始位置 (逆再生は反転バッファ上の位置)
      const srcPos = c.reverse ? bufEnd - w.hi : w.lo - r.t0;
      const offset = srcPos + late * c.speed;
      if (offset >= buf.duration) continue;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = c.speed;
      src.connect(ch.input);
      src.start(startWhen, Math.max(0, offset), Math.max(0.001, (len - late) * c.speed));
      this.sources.push(src);
    }
    // 終わった音源の参照を捨てる (長時間再生でのメモリ増加防止)
    if (this.sources.length > 64) this.sources = this.sources.slice(-32);
  }

  stop() {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* */
      }
      s.disconnect();
    }
    this.sources = [];
    for (const ch of this.chains.values()) ch.input.disconnect();
    this.chains.clear();
    this.master.disconnect();
    this.tail.disconnect();
  }
}

// ---- プレビュー再生エンジン (AudioContext の時計がマスタークロック) ----
const CHUNK = 2; // 秒
const AHEAD = 4; // 先読み (秒)

export class AudioEngine {
  ctx: AudioContext | null = null;
  private graph: MixGraph | null = null;
  private startCtx = 0;
  private startT = 0;
  private perfStart = 0;
  private cursor = 0;
  private gen = 0;
  private busy = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private project: Project | null = null;
  playing = false;

  ensureCtx(): AudioContext {
    if (!this.ctx) {
      const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive', sampleRate: SAMPLE_RATE });
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

  /** 停止中に再生位置付近の音声を先にデコードしておく */
  warm(p: Project, t: number) {
    void fetchWindow(p, t, t + CHUNK * 2).catch(() => {});
  }

  play(p: Project, t: number) {
    const ctx = this.ensureCtx();
    if (ctx.state !== 'running') void ctx.resume();
    this.begin(p, t, 0.08);
    this.playing = true;
    if (!this.timer) this.timer = setInterval(() => this.pump(), 200);
  }

  private begin(p: Project, t: number, lead: number) {
    this.graph?.stop();
    const ctx = this.ctx!;
    this.project = p;
    this.graph = new MixGraph(ctx, ctx.destination, p);
    this.startT = t;
    this.startCtx = ctx.currentTime + lead;
    this.perfStart = performance.now() + lead * 1000;
    this.cursor = t;
    this.gen++;
    this.busy = false;
    this.pump();
  }

  private pump() {
    if (!this.playing && this.gen === 0) return;
    const p = this.project;
    if (!p || !this.graph || this.busy) return;
    const now = this.now();
    if (this.cursor > now + AHEAD) return;
    const gen = this.gen;
    const from = this.cursor;
    const to = from + CHUNK;
    this.busy = true;
    void fetchWindow(p, from, to)
      .then((ranges) => {
        if (gen !== this.gen || !this.graph) return;
        this.graph.addWindow(from, to, this.startCtx + (from - this.startT), ranges);
        this.cursor = to;
      })
      .catch((e) => console.warn('audio window failed', e))
      .finally(() => {
        if (gen === this.gen) {
          this.busy = false;
          if (this.cursor <= this.now() + AHEAD) this.pump();
        }
      });
  }

  /** 再生中にプロジェクトが変わった場合に再スケジュール */
  reschedule(p: Project) {
    if (!this.playing || !this.ctx) return;
    this.begin(p, this.now(), 0.03);
  }

  now(): number {
    if (!this.playing) return this.startT;
    const ctx = this.ctx;
    if (ctx && ctx.state === 'running') {
      const lat = (ctx as any).outputLatency ?? ctx.baseLatency ?? 0;
      return this.startT + Math.max(0, ctx.currentTime - this.startCtx - (Number.isFinite(lat) ? lat : 0));
    }
    return this.startT + Math.max(0, (performance.now() - this.perfStart) / 1000);
  }

  stop() {
    this.playing = false;
    this.gen++;
    this.graph?.stop();
    this.graph = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  dispose() {
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
  }
}

/**
 * オフライン書き出し: [from, from+dur] をレンダリングする。
 * コンプレッサー等の状態を落ち着かせるため 0.5 秒手前から描画し、その部分は捨てる。
 */
export async function renderAudioChunk(p: Project, from: number, dur: number, sampleRate = SAMPLE_RATE): Promise<AudioBuffer> {
  const pre = Math.min(0.5, from);
  const total = dur + pre;
  const len = Math.max(1, Math.round(total * sampleRate));
  const OAC: typeof OfflineAudioContext = (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  const ctx = new OAC(2, len, sampleRate);
  const graph = new MixGraph(ctx, ctx.destination, p);
  const ranges = await fetchWindow(p, from - pre, from + dur);
  graph.addWindow(from - pre, from + dur, 0, ranges);
  const rendered = await ctx.startRendering();
  const skip = Math.round(pre * sampleRate);
  const outLen = Math.max(1, Math.round(dur * sampleRate));
  const out = new AudioBuffer({ length: outLen, numberOfChannels: 2, sampleRate });
  for (let c = 0; c < 2; c++) out.getChannelData(c).set(rendered.getChannelData(c).subarray(skip, skip + outLen));
  return out;
}

/** 実時間録画 (MediaRecorder) 用: 再生エンジンと同じ方式で dest に流す */
export class RealtimeMix {
  private graph: MixGraph;
  private cursor: number;
  private timer: ReturnType<typeof setInterval>;
  private busy = false;
  constructor(
    private ctx: AudioContext,
    dest: AudioNode,
    private p: Project,
    private from: number,
    private startCtx: number,
  ) {
    this.graph = new MixGraph(ctx, dest, p);
    this.cursor = from;
    this.timer = setInterval(() => this.pump(), 200);
    this.pump();
  }
  private pump() {
    if (this.busy) return;
    const now = this.from + (this.ctx.currentTime - this.startCtx);
    if (this.cursor > now + AHEAD) return;
    const a = this.cursor;
    this.busy = true;
    void fetchWindow(this.p, a, a + CHUNK)
      .then((r) => {
        this.graph.addWindow(a, a + CHUNK, this.startCtx + (a - this.from), r);
        this.cursor = a + CHUNK;
      })
      .finally(() => (this.busy = false));
  }
  stop() {
    clearInterval(this.timer);
    this.graph.stop();
  }
}
