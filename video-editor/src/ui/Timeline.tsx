import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store';
import type { Clip, Project, Track } from '../model/types';
import { clipEnd, formatTime, groupMembers, overlaps, projectDuration, snapPoints, snapValue, trimClipEnd, trimClipStart, sourceTime } from '../model/ops';
import { cachedPeaks, cachedThumbs, loadThumbs, peaksFor, PEAKS_PER_SEC } from '../media/registry';
import { Icon } from './icons';
import { engine } from './engine';

const RULER_H = 26;
const VIS_H = 52;
const AUD_H = 42;
const HEAD_W = 46;
const HANDLE_W = 20;

const TYPE_COLORS: Record<string, string> = {
  video: '#2b6cb0',
  image: '#2f855a',
  audio: '#0e7c7b',
  text: '#9c4221',
  shape: '#6b46c1',
  solid: '#4a5568',
  particles: '#b83280',
  counter: '#975a16',
  chart: '#2c7a7b',
  adjustment: '#718096',
  camera: '#c05621',
};

const TYPE_ICON: Record<string, string> = { video: 'video', image: 'image', audio: 'music', text: 'text', shape: 'shape', solid: 'layers', particles: 'particles', counter: 'counter', chart: 'chart', adjustment: 'adjust', camera: 'camera3d' };

function trackH(t: Track) {
  return t.kind === 'audio' ? AUD_H : VIS_H;
}

/** 表示順: 上ほど前面のビジュアル → オーディオ */
function displayTracks(p: Project): Track[] {
  const vis = p.tracks.filter((t) => t.kind === 'visual').reverse();
  const aud = p.tracks.filter((t) => t.kind === 'audio');
  return [...vis, ...aud];
}

function tickStep(pxPerSec: number, fps: number): [number, number] {
  const cands = [1 / fps, 2 / fps, 5 / fps, 10 / fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  for (const c of cands) if (c * pxPerSec >= 70) return [c, c >= 1 ? (c >= 10 ? c / 5 : c / 2) : c / 5 >= 1 / fps ? c / 5 : 1 / fps];
  return [1200, 600];
}

type Drag =
  | { kind: 'none' }
  | { kind: 'pending'; x: number; y: number; t0: number; clipId: string | null; pointerId: number; timer: number; time0: number; scrollY0: number }
  | { kind: 'scrub'; x: number; y: number; time0: number; scrollY0: number; axis: 'x' | 'y' | null; vx: number; lastX: number; lastT: number }
  | { kind: 'move'; x: number; y: number; ids: string[]; starts: Map<string, number>; tracks: Map<string, string>; anchorId: string }
  | { kind: 'trim'; side: 'l' | 'r'; clipId: string; x: number }
  | { kind: 'pinch'; d0: number; px0: number };

export function Timeline() {
  const project = useStore((s) => s.project)!;
  const time = useStore((s) => s.time);
  const pxPerSec = useStore((s) => s.pxPerSec);
  const selection = useStore((s) => s.selection);
  const snapping = useStore((s) => s.snapping);
  const tick = useStore((s) => s.renderTick);
  const playing = useStore((s) => s.playing);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(360);
  const [height, setHeight] = useState(200);
  const [scrollY, setScrollY] = useState(0);
  const [snapLine, setSnapLine] = useState<number | null>(null);
  const [multi, setMulti] = useState(false);
  const drag = useRef<Drag>({ kind: 'none' });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const inertia = useRef(0);

  useLayoutEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => {
      setWidth(el.clientWidth);
      setHeight(el.clientHeight);
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const areaW = width - HEAD_W;
  const centerX = HEAD_W + areaW / 2;
  const xOf = (t: number) => centerX + (t - time) * pxPerSec;
  const tOf = (x: number) => time + (x - centerX) / pxPerSec;
  const tracks = useMemo(() => displayTracks(project), [project]);
  const rows = useMemo(() => {
    let y = RULER_H;
    return tracks.map((t) => {
      const r = { track: t, y, h: trackH(t) };
      y += r.h;
      return r;
    });
  }, [tracks]);
  const contentH = rows.length ? rows[rows.length - 1].y + rows[rows.length - 1].h : RULER_H;
  const maxScrollY = Math.max(0, contentH + 40 - height);
  const sy = Math.min(scrollY, maxScrollY);
  const rowAt = (y: number) => rows.find((r) => y + sy >= r.y && y + sy < r.y + r.h);
  const dur = projectDuration(project);
  const tStart = tOf(HEAD_W);
  const tEnd = tOf(width);

  // サムネイル・波形の描画
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(width * dpr);
    cv.height = Math.round(height * dpr);
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(HEAD_W, RULER_H, width - HEAD_W, height - RULER_H);
    ctx.clip();
    for (const r of rows) {
      const y = r.y - sy;
      if (y > height || y + r.h < RULER_H) continue;
      for (const c of project.clips) {
        if (c.trackId !== r.track.id || clipEnd(c) < tStart || c.start > tEnd) continue;
        const x0 = Math.max(HEAD_W, xOf(c.start));
        const x1 = Math.min(width, xOf(clipEnd(c)));
        if (x1 <= x0) continue;
        const asset = project.assets.find((a) => a.id === c.assetId);
        if (c.type === 'video' && asset) {
          const thumbs = cachedThumbs(asset.id);
          if (!thumbs) void loadThumbs(asset.id).then((t) => t && useStore.getState().bump());
          else if (thumbs.length) {
            const th = r.h - 18;
            const img0 = thumbs[0].img;
            const tw = img0 && img0.naturalWidth ? (img0.naturalWidth / img0.naturalHeight) * th : th * 1.6;
            for (let x = xOf(c.start); x < x1; x += tw) {
              if (x + tw < x0) continue;
              const tt = sourceTime(c, Math.min(clipEnd(c) - 0.01, c.start + (x - xOf(c.start) + tw / 2) / pxPerSec), asset.duration);
              let best = thumbs[0];
              for (const th2 of thumbs) if (Math.abs(th2.t - tt) < Math.abs(best.t - tt)) best = th2;
              if (best.img?.complete && best.img.naturalWidth) {
                ctx.globalAlpha = 0.85;
                ctx.drawImage(best.img, x, y + 2, tw, th);
                ctx.globalAlpha = 1;
              }
            }
          }
        }
        if ((c.type === 'audio' || (c.type === 'video' && !c.audioDetached)) && asset?.hasAudio) {
          const peaks = cachedPeaks(asset.id);
          if (!peaks) void peaksFor(asset).then((pk) => pk && useStore.getState().bump());
          else {
            const base = c.type === 'audio' ? y + r.h / 2 : y + r.h - 9;
            const amp = c.type === 'audio' ? r.h / 2 - 4 : 7;
            ctx.fillStyle = c.type === 'audio' ? 'rgba(160,255,240,0.75)' : 'rgba(255,255,255,0.55)';
            for (let x = Math.floor(x0); x < x1; x += 2) {
              const tl = c.start + (x - xOf(c.start)) / pxPerSec;
              const st = sourceTime(c, tl, asset.duration);
              const i = Math.floor(st * PEAKS_PER_SEC);
              const v = Math.min(1, (peaks[i] ?? 0) * c.audio.volume) * amp;
              ctx.fillRect(x, base - (c.type === 'audio' ? v : v), 1.5, c.type === 'audio' ? v * 2 : v);
            }
          }
        }
      }
    }
    ctx.restore();
  }, [project, time, pxPerSec, width, height, sy, tick, rows]);

  const store = useStore.getState;
  const clipAt = (x: number, y: number): Clip | null => {
    const r = rowAt(y);
    if (!r || y < RULER_H) return null;
    const t = tOf(x);
    return project.clips.find((c) => c.trackId === r.track.id && t >= c.start && t < clipEnd(c)) ?? null;
  };
  const handleAt = (x: number, y: number): { side: 'l' | 'r'; clip: Clip } | null => {
    const sel = selection.length === 1 ? project.clips.find((c) => c.id === selection[0]) : undefined;
    if (!sel) return null;
    const r = rows.find((rr) => rr.track.id === sel.trackId);
    if (!r) return null;
    const yy = y + sy;
    if (yy < r.y || yy > r.y + r.h) return null;
    const lx = xOf(sel.start);
    const rx = xOf(clipEnd(sel));
    if (x >= lx - HANDLE_W && x <= lx + 6) return { side: 'l', clip: sel };
    if (x >= rx - 6 && x <= rx + HANDLE_W) return { side: 'r', clip: sel };
    return null;
  };

  const snapT = (t: number, exclude: Set<string>) => {
    if (!snapping) return { v: t, snapped: false };
    return snapValue(t, snapPoints(project, exclude, store().time), 10 / pxPerSec);
  };

  const onDown = (e: React.PointerEvent) => {
    const el = wrapRef.current!;
    el.setPointerCapture(e.pointerId);
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    pointers.current.set(e.pointerId, { x, y });
    cancelAnimationFrame(inertia.current);
    if (pointers.current.size === 2) {
      const d = drag.current;
      if (d.kind === 'pending') clearTimeout(d.timer);
      if (d.kind === 'move' || d.kind === 'trim') store().endGesture();
      const [a, b] = [...pointers.current.values()];
      drag.current = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), px0: store().pxPerSec };
      return;
    }
    if (pointers.current.size > 2) return;
    if (store().playing) store().setPlaying(false);
    if (x < HEAD_W) return;
    const h = handleAt(x, y);
    if (h) {
      store().beginGesture();
      drag.current = { kind: 'trim', side: h.side, clipId: h.clip.id, x };
      return;
    }
    const c = y >= RULER_H ? clipAt(x, y) : null;
    const timer = window.setTimeout(() => {
      const d = drag.current;
      if (d.kind !== 'pending' || !d.clipId) return;
      const clip = store().project!.clips.find((cc) => cc.id === d.clipId);
      const track = clip && store().project!.tracks.find((t) => t.id === clip.trackId);
      if (!clip || track?.locked) return;
      navigator.vibrate?.(15);
      const sel = store().selection.includes(clip.id) ? store().selection : [clip.id];
      const members = new Set<string>();
      for (const id of sel) {
        const cc = store().project!.clips.find((q) => q.id === id);
        if (cc) for (const m of groupMembers(store().project!, cc)) members.add(m.id);
      }
      const ids = [...members];
      store().select(sel);
      store().beginGesture();
      const p = store().project!;
      drag.current = {
        kind: 'move',
        x: d.x,
        y: d.y,
        ids,
        anchorId: clip.id,
        starts: new Map(ids.map((id) => [id, p.clips.find((q) => q.id === id)!.start])),
        tracks: new Map(ids.map((id) => [id, p.clips.find((q) => q.id === id)!.trackId])),
      };
    }, 380);
    drag.current = { kind: 'pending', x, y, t0: performance.now(), clipId: c?.id ?? null, pointerId: e.pointerId, timer, time0: store().time, scrollY0: sy };
  };

  const onMove = (e: React.PointerEvent) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x, y });
    const d = drag.current;
    if (d.kind === 'pinch') {
      if (pointers.current.size < 2) return;
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      store().setZoom(d.px0 * (dist / Math.max(10, d.d0)));
      return;
    }
    if (d.kind === 'pending') {
      const dx = x - d.x;
      const dy = y - d.y;
      if (Math.hypot(dx, dy) > 8) {
        clearTimeout(d.timer);
        drag.current = { kind: 'scrub', x: d.x, y: d.y, time0: d.time0, scrollY0: d.scrollY0, axis: Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y', vx: 0, lastX: x, lastT: performance.now() };
      }
      return;
    }
    if (d.kind === 'scrub') {
      if (d.axis === 'x') {
        const now = performance.now();
        const dt = Math.max(1, now - d.lastT);
        d.vx = d.vx * 0.6 + ((x - d.lastX) / dt) * 0.4;
        d.lastX = x;
        d.lastT = now;
        const p = store().project!;
        const t = Math.max(0, Math.min(projectDuration(p) + 5, d.time0 - (x - d.x) / store().pxPerSec));
        store().setTime(snapping && p.markers.length ? snapValue(t, p.markers.map((m) => m.t), 6 / store().pxPerSec).v : t);
      } else setScrollY(Math.max(0, Math.min(maxScrollY, d.scrollY0 - (y - d.y))));
      return;
    }
    if (d.kind === 'move') {
      const dt = (x - d.x) / store().pxPerSec;
      const p = store().project!;
      const anchor0 = d.starts.get(d.anchorId)!;
      const anchorClip = p.clips.find((c) => c.id === d.anchorId)!;
      const ex = new Set(d.ids);
      let ns = Math.max(0, anchor0 + dt);
      const s1 = snapT(ns, ex);
      const s2 = snapT(ns + anchorClip.duration, ex);
      if (s1.snapped) {
        ns = s1.v;
        setSnapLine(s1.v);
      } else if (s2.snapped) {
        ns = s2.v - anchorClip.duration;
        setSnapLine(s2.v);
      } else setSnapLine(null);
      ns = Math.round(ns * p.fps) / p.fps;
      const delta = ns - anchor0;
      const row = rowAt(y);
      store().live((pp) => {
        for (const id of d.ids) {
          const c = pp.clips.find((q) => q.id === id)!;
          c.start = Math.max(0, d.starts.get(id)! + delta);
        }
        // トラック移動 (単一クリップのみ、同種トラック間)
        if (d.ids.length === 1 && row) {
          const c = pp.clips.find((q) => q.id === d.ids[0])!;
          const kindOk = (row.track.kind === 'audio') === (c.type === 'audio');
          if (kindOk && !row.track.locked && !overlaps(pp, row.track.id, c.start, clipEnd(c), new Set([c.id]))) c.trackId = row.track.id;
        }
      });
      return;
    }
    if (d.kind === 'trim') {
      const p = store().project!;
      const c = p.clips.find((q) => q.id === d.clipId);
      if (!c) return;
      const ex = new Set([c.id]);
      let t = tOf(x);
      const sn = snapT(t, ex);
      t = Math.round(sn.v * p.fps) / p.fps;
      setSnapLine(sn.snapped ? sn.v : null);
      store().live((pp) => {
        const cc = pp.clips.find((q) => q.id === d.clipId)!;
        if (d.side === 'l') trimClipStart(pp, cc, t);
        else trimClipEnd(pp, cc, t);
      });
    }
  };

  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const d = drag.current;
    if (d.kind === 'pinch') {
      if (pointers.current.size === 0) drag.current = { kind: 'none' };
      return;
    }
    if (d.kind === 'pending') {
      clearTimeout(d.timer);
      // タップ
      if (d.y < RULER_H) {
        store().setTime(Math.max(0, tOf(d.x)));
      } else if (d.clipId) {
        const s = store();
        if (multi) s.select(s.selection.includes(d.clipId) ? s.selection.filter((i) => i !== d.clipId) : [...s.selection, d.clipId]);
        else s.select([d.clipId]);
      } else {
        store().select([]);
        if (store().panel && store().panel !== 'add' && store().panel !== 'project' && store().panel !== 'export') store().setPanel(null);
      }
    } else if (d.kind === 'scrub' && d.axis === 'x') {
      // 慣性スクロール
      let v = d.vx;
      const step = () => {
        v *= 0.92;
        if (Math.abs(v) < 0.02) return;
        const s = store();
        s.setTime(Math.max(0, s.time - (v * 16) / s.pxPerSec));
        inertia.current = requestAnimationFrame(step);
      };
      if (Math.abs(v) > 0.3) inertia.current = requestAnimationFrame(step);
    } else if (d.kind === 'move' || d.kind === 'trim') {
      // 重なり解消: 同一トラックで重なる場合は空きトラックへ
      if (d.kind === 'move') {
        store().live((pp) => {
          for (const id of d.ids) {
            const c = pp.clips.find((q) => q.id === id)!;
            if (overlaps(pp, c.trackId, c.start, clipEnd(c), new Set(d.ids))) {
              const kind = c.type === 'audio' ? 'audio' : 'visual';
              const free = pp.tracks.filter((t) => t.kind === kind && !t.locked).find((t) => !overlaps(pp, t.id, c.start, clipEnd(c), new Set(d.ids)));
              if (free) c.trackId = free.id;
              else {
                const nt = { id: Math.random().toString(36).slice(2, 10), kind, name: kind === 'audio' ? 'オーディオ' : 'ビデオ', hidden: false, muted: false, locked: false, volume: 1 } as Track;
                if (kind === 'visual') pp.tracks.splice(pp.tracks.map((t) => t.kind).lastIndexOf('visual') + 1, 0, nt);
                else pp.tracks.push(nt);
                c.trackId = nt.id;
              }
            }
          }
        });
      }
      store().endGesture();
      setSnapLine(null);
    }
    drag.current = { kind: 'none' };
  };

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) store().setZoom(pxPerSec * Math.exp(-e.deltaY * 0.01));
    else if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) store().setTime(Math.max(0, time + (e.deltaX || e.deltaY) / pxPerSec));
    else setScrollY(Math.max(0, Math.min(maxScrollY, sy + e.deltaY)));
  };

  // 目盛り
  const [major, minor] = tickStep(pxPerSec, project.fps);
  const ticks: { x: number; label?: string; major: boolean }[] = [];
  const firstMinor = Math.floor(Math.max(0, tStart) / minor) * minor;
  for (let t = firstMinor; t <= tEnd; t += minor) {
    if (t < 0) continue;
    const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
    ticks.push({ x: xOf(t), major: isMajor, label: isMajor ? (major < 1 ? formatTime(t, project.fps) : formatTime(t, project.fps, false)) : undefined });
    if (ticks.length > 400) break;
  }

  const toggleTrack = (t: Track, key: 'hidden' | 'muted' | 'locked') => store().update((p) => {
    const tt = p.tracks.find((x) => x.id === t.id);
    if (tt) tt[key] = !tt[key];
  });

  const selectedClip = selection.length === 1 ? project.clips.find((c) => c.id === selection[0]) : undefined;

  return (
    <div className="timeline" ref={wrapRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}>
      <canvas ref={canvasRef} className="tl-canvas" style={{ width, height }} />
      {/* ルーラー */}
      <div className="tl-ruler" style={{ left: HEAD_W, width: areaW, height: RULER_H }}>
        {ticks.map((tk, i) => (
          <div key={i} className={'tick' + (tk.major ? ' major' : '')} style={{ left: tk.x - HEAD_W }}>
            {tk.label && <span>{tk.label}</span>}
          </div>
        ))}
        {project.markers.map((m) => (
          <div key={m.id} className="marker" style={{ left: xOf(m.t) - HEAD_W, background: m.color }} title={m.label} />
        ))}
        <div className="tl-end" style={{ left: xOf(dur) - HEAD_W }} />
      </div>
      {/* トラック */}
      <div className="tl-rows" style={{ top: 0 }}>
        {rows.map((r) => {
          const y = r.y - sy;
          if (y > height || y + r.h < RULER_H - r.h) return null;
          const clips = project.clips.filter((c) => c.trackId === r.track.id && clipEnd(c) >= tStart - 1 && c.start <= tEnd + 1);
          return (
            <div key={r.track.id} className={'tl-row ' + r.track.kind + (r.track.locked ? ' locked' : '')} style={{ top: y, height: r.h }}>
              <div className="tl-head" style={{ width: HEAD_W }} onPointerDown={(e) => e.stopPropagation()}>
                <button className="mini" onClick={() => toggleTrack(r.track, r.track.kind === 'audio' ? 'muted' : 'hidden')} aria-label="表示切替">
                  <Icon name={r.track.kind === 'audio' ? (r.track.muted ? 'mute' : 'volume') : r.track.hidden ? 'eyeoff' : 'eye'} size={15} />
                </button>
                <button className="mini" onClick={() => toggleTrack(r.track, 'locked')} aria-label="ロック">
                  <Icon name={r.track.locked ? 'lock' : 'unlock'} size={13} />
                </button>
              </div>
              {clips.map((c) => {
                const x0 = xOf(c.start);
                const w = Math.max(2, c.duration * pxPerSec);
                const sel = selection.includes(c.id);
                const kfTimes = sel ? [...new Set(Object.values(c.keyframes).flat().map((k) => Math.round(k.t * project.fps)))] : [];
                return (
                  <div
                    key={c.id}
                    className={'clip ' + c.type + (sel ? ' sel' : '') + (c.groupId ? ' grouped' : '')}
                    style={{ left: x0, width: w, background: (c.color ?? TYPE_COLORS[c.type]) + (c.type === 'video' || c.type === 'audio' ? '66' : 'cc') }}
                  >
                    <div className="clip-label">
                      <Icon name={TYPE_ICON[c.type]} size={12} />
                      <span>{c.type === 'text' ? c.text?.content.replace(/\n/g, ' ') : c.name}</span>
                      {c.speed !== 1 && <em>{c.speed}x</em>}
                      {c.reverse && <em>逆</em>}
                      {c.parentId && <Icon name="link" size={11} />}
                    </div>
                    {c.transitionIn && <div className="clip-trans" style={{ width: Math.min(w, c.transitionIn.duration * pxPerSec) }} />}
                    {kfTimes.map((f) => (
                      <div key={f} className="kf-mark" style={{ left: (f / project.fps) * pxPerSec - 5 }} />
                    ))}
                    {sel && selection.length === 1 && (
                      <>
                        <div className="handle l" />
                        <div className="handle r" />
                      </>
                    )}
                  </div>
                );
              })}
              {/* トランジション接合部 */}
              {r.track.kind === 'visual' &&
                clips.map((c) => {
                  const next = project.clips.find((n) => n.trackId === c.trackId && Math.abs(n.start - clipEnd(c)) < 0.5 / project.fps);
                  if (!next || pxPerSec * Math.min(c.duration, next.duration) < 40) return null;
                  return (
                    <button
                      key={'j' + c.id}
                      className={'junction' + (next.transitionIn ? ' on' : '')}
                      style={{ left: xOf(clipEnd(c)) - 11, top: r.h / 2 - 11 }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => {
                        store().select([next.id]);
                        store().setPanel('transition');
                      }}
                      aria-label="トランジション"
                    >
                      <Icon name="transition" size={13} />
                    </button>
                  );
                })}
            </div>
          );
        })}
      </div>
      {snapLine != null && <div className="snap-line" style={{ left: xOf(snapLine) }} />}
      <div className="playhead" style={{ left: centerX }} />
      <div className="tl-corner" style={{ width: HEAD_W, height: RULER_H }} onPointerDown={(e) => e.stopPropagation()}>
        <button className={'mini' + (snapping ? ' on' : '')} onClick={() => store().set({ snapping: !snapping })} title="スナップ" aria-label="スナップ">
          <Icon name="magnet" size={14} />
        </button>
      </div>
      <div className="tl-tools" onPointerDown={(e) => e.stopPropagation()}>
        <button className={'mini' + (multi ? ' on' : '')} onClick={() => setMulti(!multi)} title="複数選択">
          複数
        </button>
        <button className="mini" onClick={() => store().setZoom(pxPerSec / 1.6)} aria-label="縮小">
          −
        </button>
        <button className="mini" onClick={() => store().setZoom(pxPerSec * 1.6)} aria-label="拡大">
          ＋
        </button>
        <button
          className="mini"
          onClick={() => {
            const s = store();
            s.update((p) => {
              p.markers.push({ id: Math.random().toString(36).slice(2), t: s.time, label: 'マーカー', color: '#ffcc00' });
            });
          }}
          title="マーカー追加"
        >
          ▼
        </button>
      </div>
      {selectedClip && !playing && null}
      {engine && null}
    </div>
  );
}
