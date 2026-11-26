import { useRef, useState } from 'react';
import { useStore } from '../../store/store';
import type { Clip, EffectType } from '../../model/types';
import { EFFECT_DEFS, createEffect, defaultCurves, defaultGrade } from '../../model/defaults';
import { ParamColor, ParamSlider, Section, Select, Toggle } from '../controls';
import { setParam, updateClip } from '../params';
import { Icon } from '../icons';
import { buildCurve } from '../../render/compositor';
import { importFile } from '../../media/import';

const st = () => useStore.getState();

const EFFECT_GROUPS: [string, EffectType[]][] = [
  ['光・発光', ['glow', 'neon', 'lightRays', 'lensFlare', 'flash']],
  ['ぼかし', ['gaussianBlur', 'radialBlur', 'directionalBlur', 'tiltShift']],
  ['スタイライズ', ['rgbSplit', 'chromaticAberration', 'glitch', 'noise', 'scanlines', 'pixelate', 'posterize', 'invert', 'sharpen']],
  ['動き・変形', ['echo', 'cameraShake', 'ripple', 'wave', 'fisheye', 'mirror']],
  ['合成', ['shadow', 'gradientOverlay', 'chromaKey']],
];

export function EffectsPanel({ clip }: { clip: Clip }) {
  const [adding, setAdding] = useState(clip.effects.length === 0);
  const move = (i: number, d: number) =>
    updateClip(clip.id, (c) => {
      const j = i + d;
      if (j < 0 || j >= c.effects.length) return;
      [c.effects[i], c.effects[j]] = [c.effects[j], c.effects[i]];
    });
  return (
    <div className="panel-body">
      <button className="wide accent" onClick={() => setAdding(!adding)}>
        <Icon name="plus" size={18} /> エフェクトを追加
      </button>
      {adding &&
        EFFECT_GROUPS.map(([g, list]) => (
          <div key={g} className="fx-group">
            <div className="fx-group-title">{g}</div>
            <div className="grid-buttons">
              {list.map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    updateClip(clip.id, (c) => c.effects.push(createEffect(t)));
                    setAdding(false);
                  }}
                >
                  {EFFECT_DEFS[t].label}
                </button>
              ))}
            </div>
          </div>
        ))}
      {clip.effects.length === 0 && !adding && <p className="hint">エフェクトはまだありません。重ね掛けや、◆ボタンによるキーフレーム制御ができます。</p>}
      {clip.effects.map((e, i) => {
        const def = EFFECT_DEFS[e.type];
        return (
          <Section
            key={e.id}
            title={`${i + 1}. ${def.label}`}
            right={
              <span className="sec-actions">
                <input type="checkbox" checked={e.enabled} onChange={(ev) => updateClip(clip.id, (c) => (c.effects.find((x) => x.id === e.id)!.enabled = ev.target.checked))} aria-label="有効" />
                <button className="mini" onClick={() => move(i, -1)} aria-label="上へ">
                  ↑
                </button>
                <button className="mini" onClick={() => move(i, 1)} aria-label="下へ">
                  ↓
                </button>
                <button
                  className="mini"
                  aria-label="削除"
                  onClick={() =>
                    updateClip(clip.id, (c) => {
                      c.effects = c.effects.filter((x) => x.id !== e.id);
                      for (const k of Object.keys(c.keyframes)) if (k.startsWith(`effects.${e.id}.`)) delete c.keyframes[k];
                    })
                  }
                >
                  <Icon name="trash" size={14} />
                </button>
              </span>
            }
          >
            {Object.entries(def.params).map(([k, pd]) => {
              const path = `effects.${e.id}.${k}`;
              if (pd.type === 'color') return <ParamColor key={k} clip={clip} path={path} label={pd.label} />;
              if (pd.type === 'bool') return <Toggle key={k} label={pd.label} value={!!e.params[k]} onChange={(v) => setParam(clip.id, path, v)} />;
              if (pd.type === 'select') return <Select key={k} label={pd.label} value={String(e.params[k])} options={pd.options!} onChange={(v) => setParam(clip.id, path, v)} />;
              return <ParamSlider key={k} clip={clip} path={path} label={pd.label} min={pd.min ?? 0} max={pd.max ?? 1} step={pd.step ?? 1} />;
            })}
          </Section>
        );
      })}
    </div>
  );
}

function CurvesEditor({ clip }: { clip: Clip }) {
  const [ch, setCh] = useState<'master' | 'r' | 'g' | 'b'>('master');
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef<number | null>(null);
  const pts = clip.grade.curves[ch];
  const S = 240;
  const curve = buildCurve(pts);
  const path = Array.from(curve)
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i / 255) * S},${S - v * S}`)
    .join(' ');
  const color = { master: '#ffffff', r: '#ff5555', g: '#55ff77', b: '#5599ff' }[ch];
  const toPt = (e: React.PointerEvent): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height))];
  };
  const onDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const [x, y] = toPt(e);
    let idx = pts.findIndex((p) => Math.hypot(p[0] - x, p[1] - y) < 0.07);
    st().beginGesture();
    if (idx < 0) {
      st().live((p) => {
        const c = p.clips.find((q) => q.id === clip.id)!;
        const list = c.grade.curves[ch];
        list.push([x, y]);
        list.sort((a, b) => a[0] - b[0]);
        c.grade.enabled = true;
      });
      idx = [...pts, [x, y] as [number, number]].sort((a, b) => a[0] - b[0]).findIndex((p) => p[0] === x && p[1] === y);
    }
    dragging.current = idx;
  };
  const onMove = (e: React.PointerEvent) => {
    if (dragging.current == null) return;
    const [x, y] = toPt(e);
    const i = dragging.current;
    st().live((p) => {
      const c = p.clips.find((q) => q.id === clip.id)!;
      const list = c.grade.curves[ch];
      if (!list[i]) return;
      const lo = i > 0 ? list[i - 1][0] + 0.01 : 0;
      const hi = i < list.length - 1 ? list[i + 1][0] - 0.01 : 1;
      list[i] = [i === 0 ? 0 : i === list.length - 1 ? 1 : Math.max(lo, Math.min(hi, x)), y];
    });
  };
  const onUp = () => {
    dragging.current = null;
    st().endGesture();
  };
  return (
    <div className="curves">
      <div className="chips">
        {(['master', 'r', 'g', 'b'] as const).map((k) => (
          <button key={k} className={'chip' + (k === ch ? ' on' : '')} onClick={() => setCh(k)}>
            {{ master: 'RGB', r: 'R', g: 'G', b: 'B' }[k]}
          </button>
        ))}
        <button className="chip" onClick={() => updateClip(clip.id, (c) => (c.grade.curves[ch] = defaultCurves()[ch]))}>
          リセット
        </button>
      </div>
      <svg ref={svgRef} viewBox={`0 0 ${S} ${S}`} className="curve-svg" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        {[0.25, 0.5, 0.75].map((g) => (
          <g key={g} stroke="#ffffff22">
            <line x1={g * S} x2={g * S} y1={0} y2={S} />
            <line y1={g * S} y2={g * S} x1={0} x2={S} />
          </g>
        ))}
        <line x1={0} y1={S} x2={S} y2={0} stroke="#ffffff22" />
        <path d={path} stroke={color} strokeWidth={2} fill="none" />
        {pts.map((p, i) => (
          <circle
            key={i}
            cx={p[0] * S}
            cy={S - p[1] * S}
            r={7}
            fill={color}
            stroke="#000"
            onDoubleClick={() => updateClip(clip.id, (c) => {
              const l = c.grade.curves[ch];
              if (i > 0 && i < l.length - 1) l.splice(i, 1);
            })}
          />
        ))}
      </svg>
      <p className="hint">タップで点を追加、ドラッグで調整、ダブルタップで点を削除。</p>
    </div>
  );
}

export function ColorPanel({ clip }: { clip: Clip }) {
  const project = useStore((s) => s.project)!;
  const g = clip.grade;
  const luts = project.assets.filter((a) => a.kind === 'lut');
  const fileRef = useRef<HTMLInputElement>(null);
  const S = (path: string, label: string, min = -1, max = 1, step = 0.01) => <ParamSlider clip={clip} path={'grade.' + path} label={label} min={min} max={max} step={step} />;
  return (
    <div className="panel-body">
      <div className="btn-row">
        <Toggle label="カラー補正を有効化" value={g.enabled} onChange={(v) => updateClip(clip.id, (c) => (c.grade.enabled = v))} />
        <button onClick={() => updateClip(clip.id, (c) => {
          c.grade = { ...defaultGrade(), enabled: true };
          for (const k of Object.keys(c.keyframes)) if (k.startsWith('grade.')) delete c.keyframes[k];
        })}>
          リセット
        </button>
      </div>
      {!g.enabled && <p className="hint">スライダーを動かすと自動で有効になります。</p>}
      <div onPointerDown={() => !g.enabled && updateClip(clip.id, (c) => (c.grade.enabled = true))}>
        <Section title="基本補正">
          {S('exposure', '露出', -3, 3)}
          {S('brightness', '明るさ')}
          {S('contrast', 'コントラスト')}
          {S('highlights', 'ハイライト')}
          {S('shadows', 'シャドウ')}
          {S('whites', '白レベル')}
          {S('blacks', '黒レベル')}
        </Section>
        <Section title="色">
          {S('temperature', '色温度')}
          {S('tint', '色かぶり補正 (ホワイトバランス)')}
          {S('saturation', '彩度')}
          {S('vibrance', '自然な彩度')}
          {S('hue', '色相', -180, 180, 0.5)}
        </Section>
        <Section title="フィルム・効果">
          {S('fade', 'フェード (黒浮き)', 0, 1)}
          {S('vignette', 'ビネット', 0, 1)}
          {S('vignetteSize', 'ビネットの大きさ', 0, 1)}
          {S('grain', 'フィルムグレイン', 0, 1)}
        </Section>
        <Section title="RGB カーブ" defaultOpen={false}>
          <CurvesEditor clip={clip} />
        </Section>
        <Section title="LUT (.cube)" defaultOpen={false}>
          <Select
            label="LUT"
            value={g.lutAssetId ?? ''}
            options={[['', 'なし'] as [string, string], ...luts.map((l) => [l.id, l.name] as [string, string])]}
            onChange={(v) => updateClip(clip.id, (c) => {
              c.grade.lutAssetId = v || undefined;
              c.grade.enabled = true;
            })}
          />
          {g.lutAssetId && S('lutIntensity', 'LUT の強さ', 0, 1)}
          <button className="wide" onClick={() => fileRef.current?.click()}>
            .cube ファイルを読み込む
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".cube"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                const { asset } = await importFile(f);
                st().update((p) => {
                  p.assets.push(asset);
                  const c = p.clips.find((q) => q.id === clip.id);
                  if (c) {
                    c.grade.lutAssetId = asset.id;
                    c.grade.enabled = true;
                  }
                });
              } catch (err: any) {
                st().showToast(String(err?.message ?? err), 'error');
              }
            }}
          />
        </Section>
      </div>
    </div>
  );
}
