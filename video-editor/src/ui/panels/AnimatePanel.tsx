import { useMemo, useRef, useState } from 'react';
import { useStore } from '../../store/store';
import type { Clip, Ease, Keyframe } from '../../model/types';
import { EASE_LABELS, EASE_PRESETS, applyEase, interpolate } from '../../model/keyframes';
import { EFFECT_DEFS } from '../../model/defaults';
import { Chips, Section, Select, Slider } from '../controls';
import { updateClip } from '../params';
import { formatTime } from '../../model/ops';
import { PRESETS } from '../../presets/presets';
import { applyPreset } from '../actions';
import { Icon } from '../icons';

const st = () => useStore.getState();

const PATH_LABELS: Record<string, string> = {
  'transform.x': '位置 X',
  'transform.y': '位置 Y',
  'transform.z': '位置 Z',
  'transform.scaleX': '拡大率 X',
  'transform.scaleY': '拡大率 Y',
  'transform.rotation': '回転',
  'transform.rotationX': '回転 X',
  'transform.rotationY': '回転 Y',
  'transform.opacity': '不透明度',
  'transform.anchorX': 'アンカー X',
  'transform.anchorY': 'アンカー Y',
  'transform.skewX': '傾斜',
  'audio.volume': '音量',
  'shape.trimEnd': '描画範囲(終)',
  'shape.trimStart': '描画範囲(始)',
  'shape.progress': 'ゲージ進捗',
  'counter.progress': 'カウンター進捗',
  'chart.progress': 'グラフ進捗',
};

export function pathLabel(c: Clip, path: string) {
  if (PATH_LABELS[path]) return PATH_LABELS[path];
  const m = path.match(/^effects\.([^.]+)\.(.+)$/);
  if (m) {
    const e = c.effects.find((x) => x.id === m[1]);
    if (e) return `${EFFECT_DEFS[e.type].label}: ${(EFFECT_DEFS[e.type].params as any)[m[2]]?.label ?? m[2]}`;
  }
  if (path.startsWith('grade.')) return 'カラー: ' + path.slice(6);
  return path;
}

function easeBezier(e: Ease): [number, number, number, number] {
  if (e.kind === 'bezier' && e.bezier) return e.bezier;
  if (e.kind === 'easeIn' || e.kind === 'easeOut' || e.kind === 'easeInOut') return EASE_PRESETS[e.kind];
  return [0.33, 0.33, 0.67, 0.67];
}

/** 区間の速度曲線 (イージング) をタッチで編集 */
function SpeedCurve({ clip, path, kf }: { clip: Clip; path: string; kf: Keyframe }) {
  const S = 200;
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<0 | 1 | null>(null);
  const e = kf.ease;
  const b = easeBezier(e);
  const pts = Array.from({ length: 61 }, (_, i) => {
    const x = i / 60;
    return `${i ? 'L' : 'M'}${x * S},${S - applyEase(e, x) * S * 0.7 - S * 0.15}`;
  }).join(' ');
  const y = (v: number) => S - v * S * 0.7 - S * 0.15;
  const setEase = (ne: Ease, live: boolean) => {
    const fn = (p: any) => {
      const c = p.clips.find((q: Clip) => q.id === clip.id);
      const k = c?.keyframes[path]?.find((q: Keyframe) => q.id === kf.id);
      if (k) k.ease = ne;
    };
    if (live) st().live(fn);
    else st().update(fn);
  };
  const onMove = (ev: React.PointerEvent) => {
    if (drag.current == null) return;
    const r = svgRef.current!.getBoundingClientRect();
    const px = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
    const py = (S - ((ev.clientY - r.top) / r.height) * S - S * 0.15) / (S * 0.7);
    const nb: [number, number, number, number] = [...b];
    if (drag.current === 0) {
      nb[0] = px;
      nb[1] = Math.max(-1, Math.min(2, py));
    } else {
      nb[2] = px;
      nb[3] = Math.max(-1, Math.min(2, py));
    }
    setEase({ kind: 'bezier', bezier: nb.map((v) => Math.round(v * 1000) / 1000) as any }, true);
  };
  const isBez = ['bezier', 'easeIn', 'easeOut', 'easeInOut', 'linear'].includes(e.kind);
  return (
    <div className="speed-curve">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${S} ${S}`}
        className="curve-svg"
        onPointerMove={onMove}
        onPointerUp={() => {
          if (drag.current != null) st().endGesture();
          drag.current = null;
        }}
        onPointerCancel={() => {
          if (drag.current != null) st().endGesture();
          drag.current = null;
        }}
      >
        <rect x={0} y={y(1)} width={S} height={y(0) - y(1)} fill="#ffffff08" />
        <line x1={0} x2={S} y1={y(0)} y2={y(0)} stroke="#ffffff30" />
        <line x1={0} x2={S} y1={y(1)} y2={y(1)} stroke="#ffffff30" />
        <path d={pts} stroke="#4da3ff" strokeWidth={2.5} fill="none" />
        {isBez && (
          <>
            <line x1={0} y1={y(0)} x2={b[0] * S} y2={y(b[1])} stroke="#ffcc00" />
            <line x1={S} y1={y(1)} x2={b[2] * S} y2={y(b[3])} stroke="#ffcc00" />
            {[0, 1].map((h) => (
              <circle
                key={h}
                cx={(h ? b[2] : b[0]) * S}
                cy={y(h ? b[3] : b[1])}
                r={11}
                fill="#ffcc00"
                stroke="#000"
                onPointerDown={(ev) => {
                  (ev.target as Element).setPointerCapture(ev.pointerId);
                  st().beginGesture();
                  drag.current = h as 0 | 1;
                }}
              />
            ))}
          </>
        )}
      </svg>
      <Select label="補間方法" value={e.kind} options={Object.entries(EASE_LABELS) as any} onChange={(v) => setEase({ kind: v as Ease['kind'], amount: e.amount, bezier: v === 'bezier' ? easeBezier(e) : undefined }, false)} />
      {(e.kind === 'spring' || e.kind === 'overshoot') && (
        <Slider label="強さ" value={e.amount ?? 1} min={0.2} max={3} step={0.05} onLive={(v) => setEase({ ...e, amount: v }, true)} onCommit={(v) => setEase({ ...e, amount: v }, false)} />
      )}
      {isBez && <p className="hint">黄色のハンドルをドラッグして速度曲線を調整します。</p>}
    </div>
  );
}

/** 値グラフ: キーフレームを時間・値方向にドラッグ */
function ValueGraph({ clip, path, selId, onSelect }: { clip: Clip; path: string; selId: string | null; onSelect: (id: string) => void }) {
  const kfs = clip.keyframes[path] ?? [];
  const W = 320;
  const H = 140;
  const nums = kfs.filter((k) => typeof k.v === 'number').map((k) => k.v as number);
  const isNum = nums.length === kfs.length && kfs.length > 0;
  const lo = isNum ? Math.min(...nums) : 0;
  const hi = isNum ? Math.max(...nums) : 1;
  const pad = (hi - lo) * 0.15 || 1;
  const vmin = lo - pad;
  const vmax = hi + pad;
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; t0: number; v0: number; x0: number; y0: number } | null>(null);
  const time = useStore((s) => s.time);
  const fps = useStore((s) => s.project!.fps);
  const X = (t: number) => (t / Math.max(0.001, clip.duration)) * W;
  const Y = (v: number) => H - ((v - vmin) / (vmax - vmin)) * H;
  const d = isNum
    ? Array.from({ length: 121 }, (_, i) => {
        const t = (i / 120) * clip.duration;
        return `${i ? 'L' : 'M'}${X(t)},${Y(interpolate(kfs, t) as number)}`;
      }).join(' ')
    : '';
  const onMove = (e: React.PointerEvent) => {
    const g = drag.current;
    if (!g) return;
    const r = svgRef.current!.getBoundingClientRect();
    const dt = ((e.clientX - g.x0) / r.width) * clip.duration;
    const dv = isNum ? -((e.clientY - g.y0) / r.height) * (vmax - vmin) : 0;
    st().live((p) => {
      const c = p.clips.find((q) => q.id === clip.id);
      const k = c?.keyframes[path]?.find((q) => q.id === g.id);
      if (!c || !k) return;
      k.t = Math.max(0, Math.min(c.duration, Math.round((g.t0 + dt) * fps) / fps));
      if (isNum) k.v = Math.round((g.v0 + dv) * 100) / 100;
      c.keyframes[path].sort((a, b) => a.t - b.t);
    });
  };
  return (
    <svg
      ref={svgRef}
      className="value-graph"
      viewBox={`0 0 ${W} ${H}`}
      onPointerMove={onMove}
      onPointerUp={() => {
        if (drag.current) st().endGesture();
        drag.current = null;
      }}
    >
      <rect width={W} height={H} fill="#ffffff06" />
      <line x1={X(time - clip.start)} x2={X(time - clip.start)} y1={0} y2={H} stroke="#ff4d4d" />
      {isNum && <path d={d} stroke="#4da3ff" strokeWidth={2} fill="none" />}
      {kfs.map((k) => (
        <rect
          key={k.id}
          x={X(k.t) - 8}
          y={(isNum ? Y(k.v as number) : H / 2) - 8}
          width={16}
          height={16}
          transform={`rotate(45 ${X(k.t)} ${isNum ? Y(k.v as number) : H / 2})`}
          fill={k.id === selId ? '#ffcc00' : '#fff'}
          stroke="#000"
          onPointerDown={(e) => {
            (e.target as Element).setPointerCapture(e.pointerId);
            onSelect(k.id);
            st().beginGesture();
            drag.current = { id: k.id, t0: k.t, v0: typeof k.v === 'number' ? k.v : 0, x0: e.clientX, y0: e.clientY };
          }}
        />
      ))}
    </svg>
  );
}

export function AnimatePanel({ clip }: { clip: Clip }) {
  const project = useStore((s) => s.project)!;
  const time = useStore((s) => s.time);
  const paths = Object.keys(clip.keyframes).filter((p) => clip.keyframes[p]?.length);
  const [path, setPath] = useState<string>(paths[0] ?? '');
  const [selId, setSelId] = useState<string | null>(null);
  const cur = paths.includes(path) ? path : paths[0];
  const kfs = cur ? clip.keyframes[cur] : [];
  const sel = kfs.find((k) => k.id === selId) ?? kfs.find((k) => Math.abs(k.t - (time - clip.start)) < 0.5 / project.fps) ?? kfs[0];
  const allTimes = useMemo(() => [...new Set(Object.values(clip.keyframes).flat().map((k) => k.t))].sort((a, b) => a - b), [clip]);
  const go = (dir: 1 | -1) => {
    const l = time - clip.start;
    const t = dir > 0 ? allTimes.find((x) => x > l + 1e-4) : [...allTimes].reverse().find((x) => x < l - 1e-4);
    if (t != null) st().setTime(clip.start + t);
  };
  const animPresets = PRESETS.filter((p) => p.kind === 'anim');
  return (
    <div className="panel-body">
      <div className="btn-row">
        <button onClick={() => go(-1)}>◀ 前のキー</button>
        <button onClick={() => go(1)}>次のキー ▶</button>
      </div>
      {paths.length === 0 ? (
        <p className="hint">キーフレームはまだありません。各パラメーターの ◆ ボタンで追加するか、下のアニメーションプリセットを使ってください。</p>
      ) : (
        <Section title="グラフエディター">
          <Select label="パラメーター" value={cur} options={paths.map((p) => [p, `${pathLabel(clip, p)} (${clip.keyframes[p].length})`] as [string, string])} onChange={(v) => setPath(v)} />
          <ValueGraph clip={clip} path={cur} selId={sel?.id ?? null} onSelect={setSelId} />
          <div className="kf-list">
            {kfs.map((k, i) => (
              <button key={k.id} className={'chip' + (k.id === sel?.id ? ' on' : '')} onClick={() => {
                setSelId(k.id);
                st().setTime(clip.start + k.t);
              }}>
                {i + 1}: {formatTime(k.t, project.fps)}
              </button>
            ))}
          </div>
          {sel && (
            <>
              <div className="row-info">
                選択中のキー: {formatTime(sel.t, project.fps)} 値 {typeof sel.v === 'number' ? Math.round(sel.v * 100) / 100 : sel.v}
              </div>
              {kfs.indexOf(sel) < kfs.length - 1 ? <SpeedCurve clip={clip} path={cur} kf={sel} /> : <p className="hint">最後のキーフレームです (補間は次のキーまでの区間に設定します)。</p>}
              <div className="btn-row">
                <button onClick={() => updateClip(clip.id, (c) => {
                  c.keyframes[cur] = c.keyframes[cur].filter((k) => k.id !== sel.id);
                  if (!c.keyframes[cur].length) delete c.keyframes[cur];
                })}>
                  <Icon name="trash" size={16} /> キーを削除
                </button>
                <button onClick={() => updateClip(clip.id, (c) => {
                  for (const k of c.keyframes[cur]) k.ease = JSON.parse(JSON.stringify(sel.ease));
                })}>補間を全キーに適用</button>
                <button onClick={() => updateClip(clip.id, (c) => void delete c.keyframes[cur])}>このパラメーターのキーを全削除</button>
              </div>
            </>
          )}
        </Section>
      )}
      <Section title="アニメーションプリセット">
        <div className="grid-buttons">
          {animPresets.map((p) => (
            <button key={p.id} onClick={() => applyPreset(p.id)}>
              {p.name}
            </button>
          ))}
        </div>
      </Section>
      <Section title="よく使う補間" defaultOpen={false}>
        <Chips
          value={'' as string}
          options={(['linear', 'easeInOut', 'easeOut', 'bounce', 'spring', 'overshoot'] as Ease['kind'][]).map((k) => [k, EASE_LABELS[k]] as [string, string])}
          onChange={(v) => updateClip(clip.id, (c) => {
            for (const list of Object.values(c.keyframes)) for (const k of list) k.ease = { kind: v as Ease['kind'] };
          })}
        />
        <p className="hint">このクリップのすべてのキーフレームの補間を一括変更します。</p>
      </Section>
    </div>
  );
}
