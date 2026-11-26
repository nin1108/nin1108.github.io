import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { engine } from './engine';
import { projectQuad } from '../render/evaluate';
import { clipEnd, formatTime, projectDuration } from '../model/ops';
import type { Clip, Project } from '../model/types';
import { evalNum } from '../model/keyframes';
import { setParam, localT } from './params';
import { Icon } from './icons';

function quadFor(p: Project, c: Clip, t: number) {
  const info = engine.comp?.layerInfo.get(c.id);
  if (!info) return null;
  const rect: [number, number, number, number] = [-info.cx + c.crop.left * info.w, -info.cy + c.crop.top * info.h, -info.cx + (1 - c.crop.right) * info.w, -info.cy + (1 - c.crop.bottom) * info.h];
  return projectQuad(p, c, Math.min(Math.max(t, c.start), clipEnd(c) - 1e-4), rect);
}

function inside(pt: [number, number], q: [number, number][]) {
  let c = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    if (q[i][1] > pt[1] !== q[j][1] > pt[1] && pt[0] < ((q[j][0] - q[i][0]) * (pt[1] - q[i][1])) / (q[j][1] - q[i][1]) + q[i][0]) c = !c;
  }
  return c;
}

type G =
  | { kind: 'none' }
  | { kind: 'move'; id: string; x0: number; y0: number; px: number; py: number; moved: boolean }
  | { kind: 'pinch'; id: string; d0: number; a0: number; sx: number; sy: number; rot: number; cx0: number; cy0: number; px: number; py: number };

export function Preview() {
  const project = useStore((s) => s.project)!;
  const time = useStore((s) => s.time);
  const selection = useStore((s) => s.selection);
  const playing = useStore((s) => s.playing);
  const fullscreen = useStore((s) => s.fullscreen);
  useStore((s) => s.renderTick);
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 300, h: 300 });
  const [guides, setGuides] = useState<{ v: boolean; h: boolean }>({ v: false, h: false });
  const g = useRef<G>({ kind: 'none' });
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const lastTap = useRef(0);
  const [, force] = useState(0);

  useLayoutEffect(() => {
    const el = boxRef.current!;
    const ro = new ResizeObserver(() => {
      setBox({ w: el.clientWidth, h: el.clientHeight });
      engine.setCssSize(el.clientWidth, el.clientHeight);
    });
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    engine.setCssSize(el.clientWidth, el.clientHeight);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    engine.attach(canvasRef.current!);
    const id = setInterval(() => force((n) => n + 1), 500);
    return () => {
      clearInterval(id);
      engine.detach();
    };
  }, []);

  const fit = Math.min(box.w / project.width, box.h / project.height);
  const cw = project.width * fit;
  const ch = project.height * fit;
  const ox = (box.w - cw) / 2;
  const oy = (box.h - ch) / 2;
  const toComp = (x: number, y: number): [number, number] => [(x - ox) / fit, (y - oy) / fit];

  const sel = selection.length === 1 ? project.clips.find((c) => c.id === selection[0]) : undefined;
  const selVisible = sel && sel.type !== 'audio' && sel.type !== 'adjustment' && sel.type !== 'camera' && time >= sel.start && time < clipEnd(sel);
  const quad = selVisible && !playing ? quadFor(project, sel!, time) : null;

  const hitTest = (pt: [number, number]): Clip | undefined => {
    // 前面のトラックから順に判定
    const vis = project.tracks.filter((t) => t.kind === 'visual' && !t.hidden && !t.locked).reverse();
    for (const t of vis) {
      for (const c of project.clips) {
        if (c.trackId !== t.id || time < c.start || time >= clipEnd(c) || c.type === 'adjustment' || c.type === 'camera') continue;
        const q = quadFor(project, c, time);
        if (q && inside(pt, q)) return c;
      }
    }
    return undefined;
  };

  const val = (c: Clip, k: string, d: number) => evalNum(c, 'transform.' + k, localT(c, time), d);

  const onDown = (e: React.PointerEvent) => {
    const el = boxRef.current!;
    el.setPointerCapture(e.pointerId);
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    ptrs.current.set(e.pointerId, { x, y });
    const s = useStore.getState();
    if (s.playing) return;
    if (ptrs.current.size === 2 && g.current.kind === 'move') {
      const id = g.current.id;
      const c = s.project!.clips.find((q) => q.id === id);
      if (!c) return;
      const [a, b] = [...ptrs.current.values()];
      g.current = { kind: 'pinch', id, d0: Math.hypot(a.x - b.x, a.y - b.y), a0: Math.atan2(b.y - a.y, b.x - a.x), sx: val(c, 'scaleX', c.transform.scaleX), sy: val(c, 'scaleY', c.transform.scaleY), rot: val(c, 'rotation', c.transform.rotation), cx0: (a.x + b.x) / 2, cy0: (a.y + b.y) / 2, px: val(c, 'x', c.transform.x), py: val(c, 'y', c.transform.y) };
      return;
    }
    if (ptrs.current.size > 1) return;
    const pt = toComp(x, y);
    let target = sel && quad && inside(pt, quad) ? sel : hitTest(pt);
    if (!target && sel && selVisible) target = undefined;
    const now = performance.now();
    if (now - lastTap.current < 280) {
      useStore.getState().set({ fullscreen: !useStore.getState().fullscreen });
      lastTap.current = 0;
      return;
    }
    lastTap.current = now;
    if (!target) {
      g.current = { kind: 'none' };
      return;
    }
    const track = s.project!.tracks.find((t) => t.id === target!.trackId);
    if (track?.locked) return;
    if (!s.selection.includes(target.id)) s.select([target.id]);
    s.beginGesture();
    g.current = { kind: 'move', id: target.id, x0: x, y0: y, px: val(target, 'x', target.transform.x), py: val(target, 'y', target.transform.y), moved: false };
  };

  const onMove = (e: React.PointerEvent) => {
    if (!ptrs.current.has(e.pointerId)) return;
    const r = boxRef.current!.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    ptrs.current.set(e.pointerId, { x, y });
    const cur = g.current;
    if (cur.kind === 'move') {
      let nx = cur.px + (x - cur.x0) / fit;
      let ny = cur.py + (y - cur.y0) / fit;
      if (Math.hypot(x - cur.x0, y - cur.y0) > 3) cur.moved = true;
      if (!cur.moved) return;
      // 中央スナップ
      const th = 8 / fit;
      const v = Math.abs(nx - project.width / 2) < th;
      const h = Math.abs(ny - project.height / 2) < th;
      if (v) nx = project.width / 2;
      if (h) ny = project.height / 2;
      setGuides({ v, h });
      setParam(cur.id, 'transform.x', Math.round(nx * 10) / 10, { live: true });
      setParam(cur.id, 'transform.y', Math.round(ny * 10) / 10, { live: true });
    } else if (cur.kind === 'pinch' && ptrs.current.size >= 2) {
      const [a, b] = [...ptrs.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const k = d / Math.max(10, cur.d0);
      let rot = cur.rot + ((ang - cur.a0) * 180) / Math.PI;
      // 0/90/180 度付近に吸着
      const snapA = Math.round(rot / 90) * 90;
      if (Math.abs(rot - snapA) < 3) rot = snapA;
      setParam(cur.id, 'transform.scaleX', Math.round(cur.sx * k * 100) / 100, { live: true });
      setParam(cur.id, 'transform.scaleY', Math.round(cur.sy * k * 100) / 100, { live: true });
      setParam(cur.id, 'transform.rotation', Math.round(rot * 10) / 10, { live: true });
      setParam(cur.id, 'transform.x', cur.px + ((a.x + b.x) / 2 - cur.cx0) / fit, { live: true });
      setParam(cur.id, 'transform.y', cur.py + ((a.y + b.y) / 2 - cur.cy0) / fit, { live: true });
    }
  };

  const onUp = (e: React.PointerEvent) => {
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size === 0) {
      if (g.current.kind !== 'none') useStore.getState().endGesture();
      g.current = { kind: 'none' };
      setGuides({ v: false, h: false });
    } else if (g.current.kind === 'pinch') {
      // 1 本指に戻ったら移動を継続
      const c = useStore.getState().project!.clips.find((q) => q.id === (g.current as any).id);
      const [a] = [...ptrs.current.values()];
      if (c) g.current = { kind: 'move', id: c.id, x0: a.x, y0: a.y, px: val(c, 'x', c.transform.x), py: val(c, 'y', c.transform.y), moved: true };
    }
  };

  const dur = projectDuration(project);
  return (
    <div className={'preview' + (fullscreen ? ' fs' : '')}>
      <div className="preview-box" ref={boxRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <canvas ref={canvasRef} className="preview-canvas" style={{ left: ox, top: oy, width: cw, height: ch }} />
        {engine.error && <div className="preview-error">{engine.error}</div>}
        <svg className="gizmo" width={box.w} height={box.h}>
          {quad && (
            <polygon
              points={quad.map(([x, y]) => `${ox + x * fit},${oy + y * fit}`).join(' ')}
              fill="none"
              stroke="#4da3ff"
              strokeWidth={1.5}
              strokeDasharray="5 3"
            />
          )}
          {quad && quad.map(([x, y], i) => <circle key={i} cx={ox + x * fit} cy={oy + y * fit} r={5} fill="#fff" stroke="#4da3ff" strokeWidth={2} />)}
          {guides.v && <line x1={ox + cw / 2} x2={ox + cw / 2} y1={oy} y2={oy + ch} stroke="#ff3dd2" strokeWidth={1} />}
          {guides.h && <line x1={ox} x2={ox + cw} y1={oy + ch / 2} y2={oy + ch / 2} stroke="#ff3dd2" strokeWidth={1} />}
        </svg>
        {fullscreen && (
          <div className="fs-bar" onPointerDown={(e) => e.stopPropagation()}>
            <button onClick={() => engine.togglePlay()} aria-label="再生">
              <Icon name={playing ? 'pause' : 'play'} />
            </button>
            <span className="tc">
              {formatTime(time, project.fps)} / {formatTime(dur, project.fps)}
            </span>
            <input type="range" min={0} max={Math.max(0.01, dur)} step={1 / project.fps} value={Math.min(time, dur)} onChange={(e) => useStore.getState().setTime(Number(e.target.value))} />
            <button onClick={() => useStore.getState().set({ fullscreen: false })} aria-label="全画面を終了">
              <Icon name="close" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
