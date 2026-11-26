// プレビューエンジン: 再生ループ・音声同期・オンデマンド描画
import { Compositor } from '../render/compositor';
import { PreviewVideoPool } from '../media/video';
import { AudioEngine } from '../media/audio';
import { useStore, setThumbProvider } from '../store/store';
import { projectDuration, sourceTime } from '../model/ops';
import type { Project } from '../model/types';
import { setMaxTextureSize } from '../media/registry';

class PreviewEngine {
  comp: Compositor | null = null;
  pool: PreviewVideoPool;
  audio = new AudioEngine();
  private canvas: HTMLCanvasElement | null = null;
  private raf = 0;
  private dirty = true;
  private frame = 0;
  private lastProject: Project | null = null;
  private lastSize = '';
  cssW = 0;
  cssH = 0;
  renderScale = 1;
  fpsMeter = { frames: 0, last: performance.now(), value: 0 };
  error: string | null = null;

  constructor() {
    this.pool = new PreviewVideoPool(() => this.invalidate());
    useStore.subscribe((s, prev) => {
      if (s.project !== prev.project) {
        this.invalidate();
        if (s.playing && s.project && prev.project && s.project.id === prev.project.id) this.audio.reschedule(s.project);
        if (s.project) this.audio.prepare(s.project, () => {
          const st = useStore.getState();
          if (st.playing && st.project) this.audio.reschedule(st.project);
          useStore.getState().bump();
        });
      }
      if (s.time !== prev.time && !s.playing) this.invalidate();
      if (s.previewQuality !== prev.previewQuality) this.invalidate();
      if (s.playing !== prev.playing) {
        if (s.playing) this.startPlayback();
        else this.stopPlayback();
      }
    });
  }

  attach(canvas: HTMLCanvasElement) {
    if (this.canvas === canvas && this.comp) return;
    this.detach();
    this.canvas = canvas;
    try {
      this.comp = new Compositor(canvas, { preserve: false });
      this.comp.onNeedsRedraw = () => this.invalidate();
      setMaxTextureSize(this.comp.maxTextureSize);
      this.error = null;
    } catch (e: any) {
      this.error = String(e?.message ?? e);
      this.comp = null;
    }
    setThumbProvider(() => this.thumbnail());
    this.loop();
  }

  detach() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.comp?.dispose();
    this.comp = null;
    this.canvas = null;
    setThumbProvider(null);
  }

  dispose() {
    this.detach();
    this.pool.dispose();
    this.audio.stop();
  }

  setCssSize(w: number, h: number) {
    this.cssW = w;
    this.cssH = h;
    this.invalidate();
  }

  invalidate() {
    this.dirty = true;
  }

  private startPlayback() {
    const s = useStore.getState();
    if (!s.project) return;
    const dur = projectDuration(s.project);
    let t = s.time;
    if (t >= dur - 0.01) t = 0;
    this.audio.unlock();
    this.audio.play(s.project, t);
    if (t !== s.time) useStore.setState({ time: t });
  }

  private stopPlayback() {
    const t = this.audio.now();
    this.audio.stop();
    this.pool.pauseAll();
    const s = useStore.getState();
    if (s.project) useStore.setState({ time: Math.round(t * s.project.fps) / s.project.fps });
    this.invalidate();
  }

  /** ユーザー操作 (タップ) の中で呼ぶ: iOS の音声制限解除 */
  togglePlay() {
    this.audio.unlock();
    const s = useStore.getState();
    s.setPlaying(!s.playing);
  }

  private computeSize(p: Project): [number, number] {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const q = useStore.getState().previewQuality;
    const cap = q === 'low' ? 640 : q === 'high' ? Math.max(p.width, p.height) : /iPhone|iPad|Android/.test(navigator.userAgent) ? 1280 : 1920;
    const fit = Math.min(this.cssW / p.width, this.cssH / p.height);
    let w = p.width * fit * dpr;
    let h = p.height * fit * dpr;
    const s = Math.min(1, cap / Math.max(w, h), p.width / w);
    w *= s;
    h *= s;
    return [Math.max(2, Math.round(w)), Math.max(2, Math.round(h))];
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const s = useStore.getState();
    const p = s.project;
    if (!p || !this.comp || this.cssW < 4) return;
    if (s.playing) {
      const t = this.audio.now();
      const dur = projectDuration(p);
      if (t >= dur) {
        useStore.setState({ playing: false, time: dur });
        return;
      }
      useStore.setState({ time: t });
      this.renderAt(p, t, true);
      return;
    }
    if (this.dirty || p !== this.lastProject) this.renderAt(p, s.time, false);
  };

  private renderAt(p: Project, t: number, playing: boolean) {
    if (!this.comp) return;
    const [w, h] = this.computeSize(p);
    const key = w + 'x' + h;
    if (key !== this.lastSize) {
      this.comp.setSize(w, h);
      this.lastSize = key;
    }
    this.renderScale = w / p.width;
    // 動画要素の同期 (少し先のクリップは先読み)
    const active: { clip: any; asset: any; srcTime: number }[] = [];
    for (const c of p.clips) {
      if (c.type !== 'video') continue;
      const track = p.tracks.find((x) => x.id === c.trackId);
      if (!track || track.hidden) continue;
      const asset = p.assets.find((a) => a.id === c.assetId);
      if (!asset) continue;
      const inRange = t >= c.start - (c.transitionIn ? 0 : 0) && t < c.start + c.duration;
      const inTransitionTail = p.clips.some((n) => n.trackId === c.trackId && n.transitionIn && Math.abs(n.start - (c.start + c.duration)) < 0.5 / p.fps && t >= n.start && t < n.start + n.transitionIn.duration);
      if (inRange || inTransitionTail) active.push({ clip: c, asset, srcTime: sourceTime(c, t, asset.duration) });
      else if (playing && c.start > t && c.start - t < 1.5) this.pool.preload(c, asset, sourceTime(c, c.start, asset.duration));
    }
    this.pool.sync(active, playing, p.fps);
    this.dirty = false;
    this.lastProject = p;
    try {
      const r = this.comp.render(p, t, this.pool, { scale: this.renderScale, imageMaxDim: Math.min(2048, Math.max(w, h) * 1.5), frame: this.frame++, final: false });
      if (r.incomplete && !playing) {
        // 素材の準備待ち: 少し後に再描画
        setTimeout(() => this.invalidate(), 60);
      }
      this.error = null;
    } catch (e: any) {
      console.error(e);
      this.error = String(e?.message ?? e);
    }
    const m = this.fpsMeter;
    m.frames++;
    const now = performance.now();
    if (now - m.last > 1000) {
      m.value = Math.round((m.frames * 1000) / (now - m.last));
      m.frames = 0;
      m.last = now;
    }
  }

  /** プロジェクト一覧用サムネイル */
  thumbnail(): string | undefined {
    if (!this.canvas || !this.comp) return undefined;
    const p = useStore.getState().project;
    if (!p) return undefined;
    try {
      this.renderAt(p, useStore.getState().time, false);
      const c = document.createElement('canvas');
      const s = 160 / Math.max(this.canvas.width, this.canvas.height);
      c.width = Math.max(1, Math.round(this.canvas.width * s));
      c.height = Math.max(1, Math.round(this.canvas.height * s));
      c.getContext('2d')!.drawImage(this.canvas, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.7);
    } catch {
      return undefined;
    }
  }
}

export const engine = new PreviewEngine();
