import { useRef, useState } from 'react';
import { useStore } from '../../store/store';
import type { Clip, ParticleData, ShapeData, SolidData } from '../../model/types';
import { ColorField, ParamColor, ParamSlider, Section, Select, Slider, Toggle, Chips } from '../controls';
import { liveClip, updateClip } from '../params';
import { ICONS } from '../../render/icons';
import { defaultParticles } from '../../model/defaults';
import { StyleEditor } from './TextPanel';
import { Icon } from '../icons';
import { addAssetClip, addAdjustment, addCamera, addGenerated, addParticles, addShape, addText, importFiles, NarrationRecorder, addRecording } from '../actions';
import { ACCEPT_MEDIA } from '../../media/import';
import { formatTime } from '../../model/ops';
import { inArtifact } from '../platform';

const st = () => useStore.getState();

export function ShapePanel({ clip }: { clip: Clip }) {
  const s = clip.shape!;
  const set = (fn: (x: ShapeData) => void, k: string) => updateClip(clip.id, (c) => fn(c.shape!), k);
  const [svgText, setSvgText] = useState(s.pathD ?? '');
  return (
    <div className="panel-body">
      <Select
        label="種類"
        value={s.kind}
        options={[['rect', '四角形'], ['ellipse', '円・楕円'], ['polygon', '多角形'], ['star', '星'], ['line', '線'], ['arrow', '矢印'], ['ring', '円形ゲージ'], ['icon', 'ピクトグラム'], ['path', 'SVG パス']]}
        onChange={(v) => set((x) => {
          x.kind = v;
          if (v === 'line' || v === 'arrow' || v === 'ring') x.stroke.enabled = true;
        }, 'kind')}
      />
      <Section title="サイズ">
        <ParamSlider clip={clip} path="shape.width" label="幅" min={1} max={4000} />
        <ParamSlider clip={clip} path="shape.height" label="高さ" min={1} max={4000} />
        {s.kind === 'rect' && <ParamSlider clip={clip} path="shape.radius" label="角丸" min={0} max={1000} />}
        {(s.kind === 'polygon' || s.kind === 'star') && <ParamSlider clip={clip} path="shape.sides" label="頂点数" min={3} max={24} keyable={false} />}
        {s.kind === 'star' && <ParamSlider clip={clip} path="shape.innerRatio" label="へこみ" min={0.05} max={0.95} step={0.01} />}
        {s.kind === 'arrow' && <ParamSlider clip={clip} path="shape.arrowHead" label="矢じりの大きさ" min={4} max={300} />}
        {s.kind === 'ring' && (
          <>
            <ParamSlider clip={clip} path="shape.progress" label="進捗" min={0} max={100} step={0.1} unit="%" />
            <ParamSlider clip={clip} path="shape.thickness" label="太さ" min={1} max={400} />
          </>
        )}
      </Section>
      {s.kind === 'icon' && (
        <Section title="ピクトグラム">
          <div className="icon-grid">
            {ICONS.map((ic) => (
              <button key={ic.id} className={s.iconId === ic.id ? 'on' : ''} onClick={() => set((x) => (x.iconId = ic.id), 'icon')} title={ic.label}>
                <svg viewBox="0 0 24 24" width={26} height={26} fill="currentColor" fillRule="evenodd">
                  <path d={ic.d} />
                </svg>
              </button>
            ))}
          </div>
        </Section>
      )}
      {s.kind === 'path' && (
        <Section title="SVG パス">
          <textarea className="text-content mono" rows={3} value={svgText} onChange={(e) => setSvgText(e.target.value)} placeholder="M0 0 L100 0 L50 100 Z" />
          <div className="btn-row">
            <button onClick={() => set((x) => {
              x.pathD = svgText;
              // パスの範囲から viewBox を推定
              try {
                const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                const pe = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                pe.setAttribute('d', svgText);
                el.appendChild(pe);
                el.style.position = 'absolute';
                el.style.visibility = 'hidden';
                document.body.appendChild(el);
                const b = pe.getBBox();
                el.remove();
                if (b.width > 0 && b.height > 0) x.pathViewBox = [b.x, b.y, b.width, b.height];
              } catch {
                /* */
              }
            }, 'path')}>適用</button>
          </div>
          <p className="hint">線の描画アニメーションは「線」→「描画範囲」をキーフレームで動かします。</p>
        </Section>
      )}
      {s.kind !== 'line' && s.kind !== 'arrow' && (
        <Section title={s.kind === 'ring' ? 'ゲージの色' : '塗り'}>
          {s.kind !== 'ring' && <Toggle label="塗り" value={s.fill.enabled} onChange={(v) => set((x) => (x.fill.enabled = v), 'fe')} />}
          <Chips value={s.fill.type} options={[['solid', '単色'], ['linear', 'グラデ'], ['radial', '円形'], ['metal', '金属']]} onChange={(v) => set((x) => (x.fill.type = v), 'ft')} />
          <ParamColor clip={clip} path="shape.fill.color" label="色1" />
          {s.fill.type !== 'solid' && <ParamColor clip={clip} path="shape.fill.color2" label="色2" />}
          {s.fill.type === 'linear' && <ParamSlider clip={clip} path="shape.fill.angle" label="角度" min={-180} max={180} />}
        </Section>
      )}
      <Section title="線">
        <Toggle label="線" value={s.stroke.enabled} onChange={(v) => set((x) => (x.stroke.enabled = v), 'se')} />
        {s.stroke.enabled && (
          <>
            <ParamColor clip={clip} path="shape.stroke.color" label="線の色" />
            <ParamSlider clip={clip} path="shape.stroke.width" label="太さ" min={0} max={200} step={0.5} />
            <Chips value={s.stroke.cap} options={[['round', '丸'], ['butt', '平'], ['square', '角']]} onChange={(v) => set((x) => (x.stroke.cap = v), 'cap')} />
            <Slider label="破線" value={s.stroke.dash} min={0} max={100} onLive={(v) => liveClip(clip.id, (c) => (c.shape!.stroke.dash = v))} onCommit={(v) => set((x) => (x.stroke.dash = v), 'dash')} />
            <ParamSlider clip={clip} path="shape.trimStart" label="描画範囲 開始" min={0} max={1} step={0.001} />
            <ParamSlider clip={clip} path="shape.trimEnd" label="描画範囲 終了" min={0} max={1} step={0.001} />
          </>
        )}
      </Section>
    </div>
  );
}

const PK: [ParticleData['kind'], string][] = [
  ['particles', '粒子'],
  ['confetti', '紙吹雪'],
  ['sparks', '火花'],
  ['snow', '雪'],
  ['stars', '星'],
  ['bokeh', 'ボケ'],
  ['fireflies', '光の粒'],
  ['rain', '雨'],
];

export function ParticlesPanel({ clip }: { clip: Clip }) {
  const p = clip.particles!;
  const set = (fn: (x: ParticleData) => void, k: string) => updateClip(clip.id, (c) => fn(c.particles!), k);
  return (
    <div className="panel-body">
      <Select label="種類" value={p.kind} options={PK} onChange={(v) => updateClip(clip.id, (c, pr) => (c.particles = { ...defaultParticles(v, pr.width, pr.height), seed: c.particles!.seed }), 'kind')} />
      <ParamSlider clip={clip} path="particles.count" label="数" min={1} max={1500} />
      <ParamSlider clip={clip} path="particles.speed" label="速さ" min={0} max={3000} />
      <ParamSlider clip={clip} path="particles.size" label="大きさ" min={0.5} max={200} step={0.5} />
      <ParamSlider clip={clip} path="particles.lifetime" label="寿命 (秒)" min={0.1} max={20} step={0.1} />
      <ParamSlider clip={clip} path="particles.direction" label="方向" min={-180} max={180} />
      <ParamSlider clip={clip} path="particles.spread" label="広がり" min={0} max={360} />
      <ParamSlider clip={clip} path="particles.gravity" label="重力" min={-2000} max={3000} />
      <ParamSlider clip={clip} path="particles.glow" label="発光" min={0} max={1} step={0.01} />
      <Section title="発生源" defaultOpen={false}>
        <ParamSlider clip={clip} path="particles.emitterX" label="位置 X" min={-0.5} max={1.5} step={0.001} />
        <ParamSlider clip={clip} path="particles.emitterY" label="位置 Y" min={-0.5} max={1.5} step={0.001} />
        <ParamSlider clip={clip} path="particles.emitterW" label="幅" min={0} max={2} step={0.001} />
        <ParamSlider clip={clip} path="particles.emitterH" label="高さ" min={0} max={2} step={0.001} />
        <Toggle label="一斉に発生 (バースト)" value={p.burst} onChange={(v) => set((x) => (x.burst = v), 'burst')} />
        <button className="wide" onClick={() => set((x) => (x.seed = Math.floor(Math.random() * 100000)), 'seed')}>
          ランダムパターンを変える
        </button>
      </Section>
      <Section title="色">
        {p.colors.map((c, i) => (
          <ColorField key={i} label={`色 ${i + 1}`} value={c} onChange={(v) => set((x) => (x.colors[i] = v), 'c' + i)} extra={p.colors.length > 1 ? <button className="mini" onClick={() => set((x) => x.colors.splice(i, 1), 'cdel')}>×</button> : undefined} />
        ))}
        <button className="wide" onClick={() => set((x) => x.colors.push('#ffffff'), 'cadd')}>
          色を追加
        </button>
      </Section>
    </div>
  );
}

export function CounterPanel({ clip }: { clip: Clip }) {
  const c = clip.counter!;
  const set = (fn: (x: NonNullable<Clip['counter']>) => void, k: string) => updateClip(clip.id, (cc) => fn(cc.counter!), k);
  return (
    <div className="panel-body">
      <Chips value={c.mode} options={[['number', '数値カウンター'], ['timer', 'タイマー']]} onChange={(v) => set((x) => (x.mode = v), 'mode')} />
      <div className="row2">
        <label className="ctl text-input">
          <span className="ctl-label">{c.mode === 'timer' ? '開始 (秒)' : '開始値'}</span>
          <input inputMode="decimal" value={c.from} onChange={(e) => Number.isFinite(Number(e.target.value)) && set((x) => (x.from = Number(e.target.value)), 'from')} />
        </label>
        <label className="ctl text-input">
          <span className="ctl-label">{c.mode === 'timer' ? '終了 (秒)' : '終了値'}</span>
          <input inputMode="decimal" value={c.to} onChange={(e) => Number.isFinite(Number(e.target.value)) && set((x) => (x.to = Number(e.target.value)), 'to')} />
        </label>
      </div>
      <ParamSlider clip={clip} path="counter.progress" label="進捗 (◆で動かす)" min={0} max={1} step={0.001} display={100} unit="%" />
      <div className="btn-row">
        <button onClick={() => updateClip(clip.id, (cc) => {
          cc.keyframes['counter.progress'] = [
            { id: 'a' + Math.random(), t: 0, v: 0, ease: { kind: 'easeOut' } },
            { id: 'b' + Math.random(), t: cc.duration, v: 1, ease: { kind: 'linear' } },
          ];
        })}>クリップ全体でカウント</button>
        {c.mode === 'timer' && <button onClick={() => updateClip(clip.id, (cc) => {
          cc.counter!.to = cc.counter!.from + cc.duration * (cc.counter!.to >= cc.counter!.from ? 1 : -1);
          cc.keyframes['counter.progress'] = [
            { id: 'a' + Math.random(), t: 0, v: 0, ease: { kind: 'linear' } },
            { id: 'b' + Math.random(), t: cc.duration, v: 1, ease: { kind: 'linear' } },
          ];
        })}>実時間で進める</button>}
      </div>
      {c.mode === 'number' ? (
        <>
          <Slider label="小数点以下の桁数" value={c.decimals} min={0} max={4} step={1} onLive={() => {}} onCommit={(v) => set((x) => (x.decimals = v), 'dec')} />
          <Toggle label="3桁区切り" value={c.thousands} onChange={(v) => set((x) => (x.thousands = v), 'th')} />
        </>
      ) : (
        <Chips value={c.timerFormat} options={[['mm:ss', '分:秒'], ['mm:ss.ff', '分:秒.1/100'], ['hh:mm:ss', '時:分:秒']]} onChange={(v) => set((x) => (x.timerFormat = v), 'tf')} />
      )}
      <div className="row2">
        <label className="ctl text-input">
          <span className="ctl-label">前に付ける文字</span>
          <input value={c.prefix} onChange={(e) => set((x) => (x.prefix = e.target.value), 'pre')} />
        </label>
        <label className="ctl text-input">
          <span className="ctl-label">後ろに付ける文字</span>
          <input value={c.suffix} onChange={(e) => set((x) => (x.suffix = e.target.value), 'suf')} />
        </label>
      </div>
      <StyleEditor clip={clip} base="counter" />
    </div>
  );
}

export function ChartPanel({ clip }: { clip: Clip }) {
  const ch = clip.chart!;
  const set = (fn: (x: NonNullable<Clip['chart']>) => void, k: string) => updateClip(clip.id, (cc) => fn(cc.chart!), k);
  const [text, setText] = useState(ch.labels.map((l, i) => `${l},${ch.values[i] ?? 0}`).join('\n'));
  return (
    <div className="panel-body">
      <Chips value={ch.kind} options={[['bar', '棒'], ['hbar', '横棒'], ['line', '折れ線'], ['pie', '円'], ['donut', 'ドーナツ']]} onChange={(v) => set((x) => (x.kind = v), 'kind')} />
      <label className="ctl text-input">
        <span className="ctl-label">データ (1行に「ラベル,値」)</span>
        <textarea
          className="text-content mono"
          rows={5}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const rows = e.target.value
              .split('\n')
              .map((l) => l.split(/[,，\t]/))
              .filter((r) => r.length >= 2 && Number.isFinite(Number(r[1])));
            if (rows.length) set((x) => {
              x.labels = rows.map((r) => r[0].trim());
              x.values = rows.map((r) => Number(r[1]));
            }, 'data');
          }}
        />
      </label>
      <ParamSlider clip={clip} path="chart.progress" label="アニメ進捗" min={0} max={1} step={0.001} display={100} unit="%" />
      <ParamSlider clip={clip} path="chart.stagger" label="時間差" min={0} max={0.9} step={0.01} />
      <ParamSlider clip={clip} path="chart.width" label="幅" min={100} max={4000} />
      <ParamSlider clip={clip} path="chart.height" label="高さ" min={100} max={4000} />
      <Slider label="最大値 (0で自動)" value={ch.maxValue} min={0} max={Math.max(100, ...ch.values) * 2} step={1} onLive={(v) => liveClip(clip.id, (c) => (c.chart!.maxValue = v))} onCommit={(v) => set((x) => (x.maxValue = v), 'max')} />
      <Toggle label="値を表示" value={ch.showValues} onChange={(v) => set((x) => (x.showValues = v), 'sv')} />
      <Toggle label="ラベルを表示" value={ch.showLabels} onChange={(v) => set((x) => (x.showLabels = v), 'sl')} />
      <Section title="色" defaultOpen={false}>
        {ch.colors.map((c, i) => (
          <ColorField key={i} label={`色 ${i + 1}`} value={c} onChange={(v) => set((x) => (x.colors[i] = v), 'c' + i)} />
        ))}
        <button className="wide" onClick={() => set((x) => x.colors.push('#ffffff'), 'cadd')}>
          色を追加
        </button>
        <ColorField label="文字色" value={ch.textColor} onChange={(v) => set((x) => (x.textColor = v), 'tc')} />
        <ColorField label="目盛り線" value={ch.gridColor} onChange={(v) => set((x) => (x.gridColor = v), 'gc')} />
      </Section>
    </div>
  );
}

export function SolidPanel({ clip }: { clip: Clip }) {
  const s = clip.solid!;
  const set = (fn: (x: SolidData) => void, k: string) => updateClip(clip.id, (c) => fn(c.solid!), k);
  return (
    <div className="panel-body">
      <Select
        label="背景アニメーション"
        value={s.animated}
        options={[['none', 'なし (静止)'], ['gradientShift', '流れるグラデーション'], ['starfield', '星空ワープ'], ['grid', 'サイバーグリッド'], ['aurora', 'オーロラ'], ['hexagon', 'ヘキサゴン'], ['nebula', '星雲']]}
        onChange={(v) => set((x) => (x.animated = v), 'anim')}
      />
      <Chips value={s.fill.type} options={[['solid', '単色'], ['linear', 'グラデ'], ['radial', '円形グラデ']]} onChange={(v) => set((x) => (x.fill.type = v), 'ft')} />
      <ParamColor clip={clip} path="solid.fill.color" label="色1" />
      <ParamColor clip={clip} path="solid.fill.color2" label="色2 (アクセント)" />
      {s.fill.type === 'linear' && <ParamSlider clip={clip} path="solid.fill.angle" label="角度" min={-180} max={180} />}
      <ParamSlider clip={clip} path="solid.animSpeed" label="アニメ速度" min={0} max={5} step={0.05} />
      <div className="row2">
        <ParamSlider clip={clip} path="solid.width" label="幅" min={10} max={8000} keyable={false} />
        <ParamSlider clip={clip} path="solid.height" label="高さ" min={10} max={8000} keyable={false} />
      </div>
    </div>
  );
}

// ---------- 追加パネル ----------
export function AddPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const project = useStore((s) => s.project)!;
  const [tab, setTab] = useState<'media' | 'text' | 'shape' | 'fx' | 'audio'>('media');
  return (
    <div className="panel-body">
      <Chips value={tab} options={[['media', '素材'], ['text', 'テキスト'], ['shape', '図形'], ['fx', '演出'], ['audio', '音声']]} onChange={setTab} />
      <input ref={fileRef} type="file" multiple accept={ACCEPT_MEDIA + ',.srt,.vtt'} hidden onChange={(e) => {
        const f = e.target.files;
        if (f && f.length) void importFiles(Array.from(f));
        e.target.value = '';
      }} />
      {tab === 'media' && (
        <>
          <button className="wide accent big" onClick={() => fileRef.current?.click()}>
            <Icon name="folder" /> 動画・画像・音声を読み込む
          </button>
          <p className="hint">読み込んだ素材は端末内に保存され、ページを閉じても残ります。SRT 字幕もここから読み込めます。</p>
          <MediaBin />
        </>
      )}
      {tab === 'text' && (
        <div className="grid-buttons big">
          <button onClick={() => addText()}>
            <Icon name="text" />
            テキスト
          </button>
          <button onClick={() => addGenerated('counter', (c) => (c.name = 'カウンター'))}>
            <Icon name="counter" />
            数値カウンター
          </button>
          <button onClick={() => addGenerated('counter', (c) => {
            c.name = 'タイマー';
            c.counter!.mode = 'timer';
            c.counter!.from = 0;
            c.counter!.to = c.duration;
            c.keyframes['counter.progress'] = [
              { id: 'k1', t: 0, v: 0, ease: { kind: 'linear' } },
              { id: 'k2', t: c.duration, v: 1, ease: { kind: 'linear' } },
            ];
          })}>
            <Icon name="speed" />
            タイマー
          </button>
          <button onClick={() => st().setPanel('presets')}>
            <Icon name="sparkle" />
            テロッププリセット
          </button>
        </div>
      )}
      {tab === 'shape' && (
        <>
          <div className="grid-buttons">
            {([['rect', '四角'], ['ellipse', '円'], ['polygon', '多角形'], ['star', '星'], ['line', '線'], ['arrow', '矢印'], ['ring', '円形ゲージ'], ['path', 'SVGパス']] as [ShapeData['kind'], string][]).map(([k, l]) => (
              <button key={k} onClick={() => addShape(k)}>
                {l}
              </button>
            ))}
            <button onClick={() => addGenerated('chart', (c) => (c.name = 'グラフ'))}>
              <Icon name="chart" />
              グラフ
            </button>
          </div>
          <div className="fx-group-title">ピクトグラム</div>
          <div className="icon-grid">
            {ICONS.map((ic) => (
              <button key={ic.id} onClick={() => addShape('icon', ic.id)} title={ic.label}>
                <svg viewBox="0 0 24 24" width={26} height={26} fill="currentColor" fillRule="evenodd">
                  <path d={ic.d} />
                </svg>
              </button>
            ))}
          </div>
        </>
      )}
      {tab === 'fx' && (
        <>
          <div className="fx-group-title">パーティクル</div>
          <div className="grid-buttons">
            {PK.map(([k, l]) => (
              <button key={k} onClick={() => addParticles(k)}>
                {l}
              </button>
            ))}
          </div>
          <div className="fx-group-title">背景・レイヤー</div>
          <div className="grid-buttons">
            <button onClick={() => addGenerated('solid', (c) => (c.name = '背景'))}>単色背景</button>
            <button onClick={() => addGenerated('solid', (c) => {
              c.name = 'アニメ背景';
              c.solid!.animated = 'gradientShift';
              c.solid!.fill = { type: 'linear', color: '#1b0f4a', color2: '#d63384', color3: '#0d6efd', angle: 45 };
            })}>アニメ背景</button>
            <button onClick={() => addGenerated('solid', (c) => {
              c.name = '宇宙背景';
              c.solid!.animated = 'nebula';
              c.solid!.fill = { type: 'radial', color: '#0a0f2e', color2: '#6f2dbd', color3: '#ff3d9a', angle: 0 };
            })}>宇宙背景</button>
            <button onClick={addAdjustment}>調整レイヤー</button>
            <button onClick={addCamera}>仮想カメラ</button>
          </div>
          <p className="hint">調整レイヤーは、下にあるすべてのレイヤーにカラー補正・エフェクトをかけます。</p>
        </>
      )}
      {tab === 'audio' && (
        <>
          <button className="wide accent" onClick={() => fileRef.current?.click()}>
            <Icon name="music" /> BGM・効果音を読み込む
          </button>
          <RecordBox />
          <MediaBin kind="audio" />
        </>
      )}
      <p className="hint">追加位置: 再生ヘッド ({formatTime(useStore.getState().time, project.fps)})</p>
    </div>
  );
}

function MediaBin({ kind }: { kind?: 'audio' }) {
  const project = useStore((s) => s.project)!;
  const assets = project.assets.filter((a) => (kind ? a.kind === 'audio' : a.kind !== 'font' && a.kind !== 'lut'));
  if (!assets.length) return null;
  return (
    <Section title={`読み込み済み素材 (${assets.length})`}>
      <div className="media-bin">
        {assets.map((a) => (
          <button
            key={a.id}
            className="media-item"
            onClick={() => st().update((p) => void addAssetClip(p, a, st().time))}
          >
            <Icon name={a.kind === 'video' ? 'video' : a.kind === 'audio' ? 'music' : 'image'} size={18} />
            <span>{a.name}</span>
            {a.duration ? <em>{formatTime(a.duration, project.fps, false)}</em> : null}
          </button>
        ))}
      </div>
      <p className="hint">タップでタイムラインに追加します。</p>
    </Section>
  );
}


function RecordBox() {
  if (inArtifact) return <p className="hint">この画面ではマイクを使えないため録音できません。スマホのボイスメモ等で録音した音声ファイルを「BGM・効果音を読み込む」から追加してください。</p>;
  return <RecordBoxInner />;
}

function RecordBoxInner() {
  const [rec, setRec] = useState<NarrationRecorder | null>(null);
  const [startT, setStartT] = useState(0);
  const [, force] = useState(0);
  const running = !!rec;
  return (
    <div className="record-box">
      <button
        className={'wide ' + (running ? 'danger' : '')}
        onClick={async () => {
          if (!rec) {
            const r = new NarrationRecorder();
            try {
              await r.start();
              setStartT(st().time);
              setRec(r);
              const id = setInterval(() => (r ? force((n) => n + 1) : clearInterval(id)), 250);
            } catch (e: any) {
              st().showToast('マイクを使用できません: ' + (e?.message ?? e), 'error');
            }
          } else {
            const blob = await rec.stop();
            setRec(null);
            try {
              await addRecording(blob, startT);
              st().showToast('ナレーションを追加しました', 'ok');
            } catch (e: any) {
              st().showToast(String(e?.message ?? e), 'error');
            }
          }
        }}
      >
        <Icon name={running ? 'stop' : 'mic'} /> {running ? `録音停止 (${((performance.now() - rec!.startedAt) / 1000).toFixed(1)}秒)` : 'ナレーションを録音'}
      </button>
      <p className="hint">録音は再生ヘッドの位置に追加されます。</p>
    </div>
  );
}
