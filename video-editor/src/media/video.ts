import type { AssetMeta, Clip } from '../model/types';
import { urlFor, blobFor } from './registry';

export type Drawable = TexImageSource & { width?: number; height?: number };

export interface FrameSource {
  /** clip の素材時刻 srcTime のフレームを返す (未準備なら null) */
  frame(clip: Clip, asset: AssetMeta, srcTime: number): Drawable | null;
  frameAsync?(clip: Clip, asset: AssetMeta, srcTime: number): Promise<Drawable | null>;
}

// =========================================================
// プレビュー: <video> 要素をクリップごとに用意し、再生中は実時間再生、停止中はシークで同期
// =========================================================
interface PoolEntry {
  el: HTMLVideoElement;
  assetId: string;
  lastUsed: number;
  seeking: boolean;
  pendingSeek: number | null;
  ready: boolean;
}

export class PreviewVideoPool implements FrameSource {
  private pool = new Map<string, PoolEntry>();
  private onFrame: () => void;
  private maxElements = 6;
  constructor(onFrame: () => void) {
    this.onFrame = onFrame;
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(ua)) this.maxElements = 4;
  }

  private create(clip: Clip, asset: AssetMeta): PoolEntry {
    const el = document.createElement('video');
    el.muted = true;
    el.defaultMuted = true;
    el.playsInline = true;
    el.setAttribute('playsinline', '');
    el.setAttribute('webkit-playsinline', '');
    el.preload = 'auto';
    el.crossOrigin = 'anonymous';
    const e: PoolEntry = { el, assetId: asset.id, lastUsed: performance.now(), seeking: false, pendingSeek: null, ready: false };
    el.addEventListener('loadeddata', () => {
      e.ready = true;
      this.onFrame();
    });
    el.addEventListener('seeked', () => {
      e.seeking = false;
      if (e.pendingSeek != null) {
        const t = e.pendingSeek;
        e.pendingSeek = null;
        this.seek(e, t);
      }
      this.onFrame();
    });
    el.addEventListener('error', () => {
      e.ready = false;
    });
    // iOS Safari は preload を無視してフレームを読み込まないことがあるため、
    // ミュート再生→即停止でデコーダを起こす (ミュート・インライン再生はユーザー操作なしで許可される)
    el.addEventListener('loadedmetadata', () => {
      setTimeout(() => {
        if (el.readyState < 2 && el.paused) {
          el.play()
            .then(() => {
              if (!e.ready || this.pool.get(clip.id) === e) el.pause();
            })
            .catch(() => {});
        }
      }, 300);
    });
    void urlFor(asset.proxyId ?? asset.id).then((u) => {
      el.src = u;
      el.load();
    });
    this.pool.set(clip.id, e);
    this.evict();
    return e;
  }

  private evict() {
    if (this.pool.size <= this.maxElements) return;
    const entries = [...this.pool.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    while (this.pool.size > this.maxElements && entries.length) {
      const [id, e] = entries.shift()!;
      this.release(id, e);
    }
  }

  private release(id: string, e: PoolEntry) {
    try {
      e.el.pause();
      e.el.removeAttribute('src');
      e.el.load();
    } catch {
      /* */
    }
    this.pool.delete(id);
  }

  private seek(e: PoolEntry, t: number) {
    if (e.seeking) {
      e.pendingSeek = t;
      return;
    }
    if (Math.abs(e.el.currentTime - t) < 0.001) return;
    e.seeking = true;
    try {
      // fastSeek は不正確なので使わない
      e.el.currentTime = t;
    } catch {
      e.seeking = false;
    }
  }

  /** 毎フレーム呼ばれる: 可視クリップを同期し、不要な要素を解放する */
  sync(active: { clip: Clip; asset: AssetMeta; srcTime: number }[], playing: boolean, fps: number) {
    const now = performance.now();
    const keep = new Set<string>();
    for (const { clip, asset, srcTime } of active) {
      keep.add(clip.id);
      let e = this.pool.get(clip.id);
      if (!e || e.assetId !== asset.id) {
        if (e) this.release(clip.id, e);
        e = this.create(clip, asset);
      }
      e.lastUsed = now;
      if (!e.ready) continue;
      const el = e.el;
      const realtime = playing && !clip.reverse && !clip.freeze && clip.speed <= 4;
      if (realtime) {
        if (Math.abs(el.playbackRate - clip.speed) > 0.001) el.playbackRate = clip.speed;
        const drift = el.currentTime - srcTime;
        if (el.paused) {
          this.seek(e, srcTime);
          el.play().catch(() => {});
        } else if (Math.abs(drift) > 0.25) this.seek(e, srcTime + 0.05);
      } else {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - srcTime) > 0.5 / fps) this.seek(e, srcTime);
      }
    }
    for (const [id, e] of this.pool) {
      if (!keep.has(id)) {
        if (!e.el.paused) e.el.pause();
        if (now - e.lastUsed > 4000) this.release(id, e);
      }
    }
  }

  /** 再生開始前に次のクリップを先読み */
  preload(clip: Clip, asset: AssetMeta, srcTime: number) {
    let e = this.pool.get(clip.id);
    if (!e) e = this.create(clip, asset);
    e.lastUsed = performance.now();
    if (e.ready && e.el.paused && Math.abs(e.el.currentTime - srcTime) > 0.1) this.seek(e, srcTime);
  }

  frame(clip: Clip): Drawable | null {
    const e = this.pool.get(clip.id);
    if (!e || !e.ready || e.el.readyState < 2) return null;
    return e.el;
  }

  isSettled(): boolean {
    for (const e of this.pool.values()) if (e.seeking || !e.ready) return false;
    return true;
  }

  pauseAll() {
    for (const e of this.pool.values()) if (!e.el.paused) e.el.pause();
  }

  dispose() {
    for (const [id, e] of this.pool) this.release(id, e);
  }
}

// =========================================================
// 書き出し: フレーム正確なデコード
// =========================================================
interface Reader {
  get(ts: number): Promise<Drawable | null>;
  dispose(): void;
}

class WebCodecsReader implements Reader {
  private iter: AsyncGenerator<any, void, unknown> | null = null;
  private cur: any = null;
  private next: any = null;
  private ended = false;
  constructor(
    private input: any,
    private sink: any,
    private firstTs: number,
  ) {}
  static async create(blob: Blob): Promise<WebCodecsReader | null> {
    if (typeof VideoDecoder === 'undefined') return null;
    const mb = await import('mediabunny');
    const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS });
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track || !(await track.canDecode())) {
        input.dispose();
        return null;
      }
      const sink = new mb.CanvasSink(track, { poolSize: 3 });
      const first = await track.getFirstTimestamp();
      return new WebCodecsReader(input, sink, first);
    } catch (e) {
      input.dispose();
      console.warn('WebCodecs reader unavailable', e);
      return null;
    }
  }
  async get(ts0: number): Promise<Drawable | null> {
    const ts = ts0 + this.firstTs;
    const eps = 1e-4;
    const needRestart = !this.iter || !this.cur || ts < this.cur.timestamp - eps || ts > this.cur.timestamp + 3;
    if (needRestart) {
      if (this.iter) await this.iter.return(undefined);
      // 逆再生などの後退は getCanvas で個別取得
      if (this.cur && ts < this.cur.timestamp - eps && ts > this.cur.timestamp - 3) {
        const w = await this.sink.getCanvas(ts);
        this.iter = null;
        this.cur = null;
        this.next = null;
        return w?.canvas ?? null;
      }
      this.iter = this.sink.canvases(ts);
      const a = await this.iter!.next();
      this.cur = a.done ? null : a.value;
      const b = a.done ? { done: true, value: null } : await this.iter!.next();
      this.next = b.done ? null : b.value;
      this.ended = !!b.done;
    }
    while (this.next && this.next.timestamp <= ts + eps) {
      this.cur = this.next;
      if (this.ended) {
        this.next = null;
        break;
      }
      const r = await this.iter!.next();
      if (r.done) {
        this.ended = true;
        this.next = null;
      } else this.next = r.value;
    }
    return this.cur?.canvas ?? null;
  }
  dispose() {
    void this.iter?.return(undefined);
    this.input.dispose();
  }
}

class SeekReader implements Reader {
  private el: HTMLVideoElement;
  private ready: Promise<void>;
  constructor(url: string) {
    const el = document.createElement('video');
    el.muted = true;
    el.playsInline = true;
    el.preload = 'auto';
    el.src = url;
    this.el = el;
    this.ready = new Promise((res, rej) => {
      el.onloadeddata = () => res();
      el.onerror = () => rej(new Error('動画を読み込めません'));
    });
    el.load();
  }
  async get(ts: number): Promise<Drawable | null> {
    await this.ready;
    const el = this.el;
    const target = Math.max(0, Math.min(ts + 0.001, (el.duration || ts) - 0.001));
    if (Math.abs(el.currentTime - target) > 0.0005) {
      await new Promise<void>((res) => {
        const to = setTimeout(res, 3000);
        el.addEventListener(
          'seeked',
          () => {
            clearTimeout(to);
            res();
          },
          { once: true },
        );
        el.currentTime = target;
      });
      const rvfc = (el as any).requestVideoFrameCallback;
      if (rvfc) await new Promise<void>((res) => {
        const to = setTimeout(res, 120);
        rvfc.call(el, () => {
          clearTimeout(to);
          res();
        });
      });
    }
    return el;
  }
  dispose() {
    this.el.removeAttribute('src');
    this.el.load();
  }
}

export class ExportFrameSource implements FrameSource {
  private readers = new Map<string, Reader>();
  private frames = new Map<string, Drawable | null>();
  public usedFallback = false;
  constructor(private preferWebCodecs = true) {}

  private async reader(clip: Clip, asset: AssetMeta): Promise<Reader> {
    let r = this.readers.get(clip.id);
    if (r) return r;
    const blob = await blobFor(asset.id); // 書き出しは常に元素材 (プロキシではない)
    if (this.preferWebCodecs) r = (await WebCodecsReader.create(blob)) ?? undefined;
    if (!r) {
      this.usedFallback = true;
      r = new SeekReader(await urlFor(asset.id));
    }
    this.readers.set(clip.id, r);
    return r;
  }

  /** フレーム描画前に必要な映像をデコードしておく */
  async prefetch(items: { clip: Clip; asset: AssetMeta; srcTime: number }[]) {
    this.frames.clear();
    for (const it of items) {
      const r = await this.reader(it.clip, it.asset);
      const key = it.clip.id + '@' + it.srcTime.toFixed(5);
      this.frames.set(key, await r.get(it.srcTime));
    }
  }

  frame(clip: Clip, _asset: AssetMeta, srcTime: number): Drawable | null {
    return this.frames.get(clip.id + '@' + srcTime.toFixed(5)) ?? null;
  }

  releaseUnused(activeIds: Set<string>) {
    for (const [id, r] of this.readers) {
      if (!activeIds.has(id)) {
        r.dispose();
        this.readers.delete(id);
      }
    }
  }

  dispose() {
    for (const r of this.readers.values()) r.dispose();
    this.readers.clear();
    this.frames.clear();
  }
}
