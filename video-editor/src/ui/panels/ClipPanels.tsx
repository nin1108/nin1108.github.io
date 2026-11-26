import { useRef, useState } from 'react';
import { useStore } from '../../store/store';
import { createProxy, deleteProxy, proxyRecommended } from '../../media/proxy';
import type { BlendMode, Clip, TransitionType } from '../../model/types';
import { ParamSlider, Section, Select, Slider, Toggle, Chips } from '../controls';
import { updateClip, liveClip } from '../params';
import { canParent, clipEnd, formatTime, maxClipDuration, setClipSpeed, trimClipEnd, trimClipStart } from '../../model/ops';
import { closeTrackGaps, deleteSelected, detachSelectedAudio, duplicateSelected, groupSelected, splitAtPlayhead } from '../actions';
import { Icon } from '../icons';
import { TRANSITION_LABELS } from '../../presets/presets';
import { EASE_LABELS } from '../../model/keyframes';

const st = () => useStore.getState();

export function EditPanel({ clip }: { clip: Clip }) {
  const project = useStore((s) => s.project)!;
  const isMedia = clip.type === 'video' || clip.type === 'audio';
  const others = project.clips.filter((c) => c.id !== clip.id && c.type !== 'audio' && canParent(project, clip.id, c.id));
  return (
    <div className="panel-body">
      <div className="btn-grid">
        <button onClick={splitAtPlayhead}>
          <Icon name="split" />
          分割
        </button>
        <button onClick={duplicateSelected}>
          <Icon name="copy" />
          複製
        </button>
        <button onClick={() => deleteSelected(false)}>
          <Icon name="trash" />
          削除
        </button>
        <button onClick={() => deleteSelected(true)}>
          <Icon name="trash" />
          詰めて削除
        </button>
        <button onClick={closeTrackGaps}>
          <Icon name="back" />
          隙間を詰める
        </button>
        <button onClick={groupSelected}>
          <Icon name="group" />
          {clip.groupId ? 'グループ解除' : 'グループ化'}
        </button>
        {clip.type === 'video' && (
          <button onClick={detachSelectedAudio} disabled={clip.audioDetached}>
            <Icon name="music" />
            音声を分離
          </button>
        )}
        {isMedia && (
          <button className={clip.reverse ? 'on' : ''} onClick={() => updateClip(clip.id, (c) => (c.reverse = !c.reverse))}>
            <Icon name="reverse" />
            逆再生
          </button>
        )}
        {clip.type === 'video' && (
          <button className={clip.freeze ? 'on' : ''} onClick={() => updateClip(clip.id, (c, p) => {
            if (!c.freeze) {
              // 再生ヘッド位置のフレームで静止
              const t = Math.max(c.start, Math.min(clipEnd(c), st().time));
              c.inPoint = c.reverse ? c.inPoint + (c.duration - (t - c.start)) * c.speed : c.inPoint + (t - c.start) * c.speed;
              c.freeze = true;
            } else {
              c.freeze = false;
              c.duration = Math.min(c.duration, maxClipDuration(p, c));
            }
          })}>
            <Icon name="freeze" />
            静止画
          </button>
        )}
      </div>
      <Section title="名前・時間">
        <label className="ctl text-input">
          <span className="ctl-label">名前</span>
          <input value={clip.name} onChange={(e) => updateClip(clip.id, (c) => (c.name = e.target.value), 'name')} />
        </label>
        <div className="row-info">
          開始 {formatTime(clip.start, project.fps)} ／ 長さ {formatTime(clip.duration, project.fps)}
        </div>
        <Slider
          label="長さ (秒)"
          value={clip.duration}
          min={1 / project.fps}
          max={Math.min(600, Math.max(clip.duration * 2, 10, Number.isFinite(maxClipDuration(project, clip)) ? maxClipDuration(project, clip) : 10))}
          step={1 / project.fps}
          onLive={(v) => liveClip(clip.id, (c, p) => trimClipEnd(p, c, c.start + v))}
          onCommit={(v) => updateClip(clip.id, (c, p) => trimClipEnd(p, c, c.start + v))}
        />
        <div className="btn-row">
          <button onClick={() => updateClip(clip.id, (c, p) => trimClipStart(p, c, st().time))}>ここから開始</button>
          <button onClick={() => updateClip(clip.id, (c, p) => trimClipEnd(p, c, st().time))}>ここで終了</button>
          <button onClick={() => updateClip(clip.id, (c, p) => (c.start = Math.round(st().time * p.fps) / p.fps))}>再生ヘッドへ移動</button>
        </div>
      </Section>
      {isMedia || clip.type === 'video' ? <SpeedSection clip={clip} /> : null}
      {clip.type === 'video' && <ProxySection clip={clip} />}
      <Section title="親子付け・ラベル" defaultOpen={false}>
        <Select
          label="親レイヤー"
          value={clip.parentId ?? ''}
          options={[['', 'なし'] as [string, string], ...others.map((c) => [c.id, `${c.name} (${formatTime(c.start, project.fps, false)})`] as [string, string])]}
          onChange={(v) => updateClip(clip.id, (c) => (c.parentId = v || undefined))}
        />
        <div className="chips">
          {['', '#e53e3e', '#dd6b20', '#d69e2e', '#38a169', '#3182ce', '#805ad5', '#d53f8c'].map((col) => (
            <button key={col} className={'chip color' + ((clip.color ?? '') === col ? ' on' : '')} style={{ background: col || '#444' }} onClick={() => updateClip(clip.id, (c) => (c.color = col || undefined))}>
              {col ? '' : '既定'}
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
}

function ProxySection({ clip }: { clip: Clip }) {
  const asset = useStore((s) => s.project?.assets.find((a) => a.id === clip.assetId));
  const [prog, setProg] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  if (!asset) return null;
  return (
    <Section title="プレビュー用プロキシ" defaultOpen={proxyRecommended(asset)}>
      <p className="hint">
        {asset.proxyId
          ? 'プレビューは低解像度のプロキシで再生しています。書き出しは常に元の高画質素材を使います。'
          : `元素材 ${asset.width}×${asset.height}。重い動画は ${540}p のプロキシを作るとプレビューが軽くなります (書き出しは元素材)。`}
      </p>
      {prog != null ? (
        <>
          <div className="export-progress">
            <div className="bar">
              <div style={{ width: `${(prog * 100).toFixed(1)}%` }} />
            </div>
          </div>
          <button className="wide" onClick={() => abort.current?.abort()}>
            中止
          </button>
        </>
      ) : asset.proxyId ? (
        <button
          className="wide"
          onClick={async () => {
            const id = asset.proxyId!;
            st().update((p) => {
              const a = p.assets.find((x) => x.id === asset.id);
              if (a) a.proxyId = undefined;
            });
            await deleteProxy(id);
          }}
        >
          プロキシを削除 (元素材でプレビュー)
        </button>
      ) : (
        <button
          className="wide"
          onClick={async () => {
            abort.current = new AbortController();
            setProg(0);
            try {
              const id = await createProxy(asset, setProg, abort.current.signal);
              st().update((p) => {
                const a = p.assets.find((x) => x.id === asset.id);
                if (a) a.proxyId = id;
              });
              st().showToast('プロキシを作成しました', 'ok');
            } catch (e: any) {
              if (!abort.current?.signal.aborted) st().showToast(String(e?.message ?? e), 'error');
            } finally {
              setProg(null);
            }
          }}
        >
          プロキシを作成
        </button>
      )}
    </Section>
  );
}

function SpeedSection({ clip }: { clip: Clip }) {
  return (
    <Section title="再生速度">
      <Chips value={String(clip.speed) as string} options={['0.25', '0.5', '1', '1.5', '2', '4'].map((v) => [v, v + 'x'] as [string, string])} onChange={(v) => updateClip(clip.id, (c, p) => setClipSpeed(p, c, Number(v)))} />
      <Slider label="速度" value={clip.speed} min={0.1} max={16} step={0.05} unit="x" onLive={(v) => liveClip(clip.id, (c, p) => setClipSpeed(p, c, v))} onCommit={(v) => updateClip(clip.id, (c, p) => setClipSpeed(p, c, v))} />
      <p className="hint">速度変更時は音のピッチも変化します。</p>
    </Section>
  );
}

export function TransformPanel({ clip }: { clip: Clip }) {
  const project = useStore((s) => s.project)!;
  const asset = project.assets.find((a) => a.id === clip.assetId);
  const reset = () =>
    updateClip(clip.id, (c, p) => {
      for (const k of Object.keys(c.keyframes)) if (k.startsWith('transform.')) delete c.keyframes[k];
      const s = asset?.width && asset.height ? Math.round(Math.min(p.width / asset.width, p.height / asset.height) * 100000) / 1000 : 100;
      c.transform = { x: p.width / 2, y: p.height / 2, z: 0, scaleX: s, scaleY: s, rotation: 0, rotationX: 0, rotationY: 0, anchorX: 0, anchorY: 0, opacity: 100, skewX: 0 };
    });
  const fill = (mode: 'fit' | 'fill') =>
    updateClip(clip.id, (c, p) => {
      if (!asset?.width || !asset.height) return;
      const s = (mode === 'fit' ? Math.min : Math.max)(p.width / asset.width, p.height / asset.height) * 100;
      c.transform.scaleX = c.transform.scaleY = Math.round(s * 1000) / 1000;
      c.transform.x = p.width / 2;
      c.transform.y = p.height / 2;
      delete c.keyframes['transform.scaleX'];
      delete c.keyframes['transform.scaleY'];
    });
  return (
    <div className="panel-body">
      <div className="btn-row">
        <button onClick={reset}>リセット</button>
        {asset?.width ? (
          <>
            <button onClick={() => fill('fit')}>全体を表示</button>
            <button onClick={() => fill('fill')}>画面いっぱい</button>
          </>
        ) : null}
      </div>
      <p className="hint">プレビューを指でドラッグで移動、2本指で拡大・回転できます。◆でキーフレームを打てます。</p>
      <Section title="位置">
        <ParamSlider clip={clip} path="transform.x" label="X" min={-project.width} max={project.width * 2} step={1} />
        <ParamSlider clip={clip} path="transform.y" label="Y" min={-project.height} max={project.height * 2} step={1} />
        <ParamSlider clip={clip} path="transform.z" label="Z (奥行き)" min={-2000} max={6000} step={1} />
      </Section>
      <Section title="拡大・回転">
        <ParamSlider clip={clip} path="transform.scaleX" label="拡大率 X" min={0} max={400} step={0.1} unit="%" />
        <ParamSlider clip={clip} path="transform.scaleY" label="拡大率 Y" min={0} max={400} step={0.1} unit="%" />
        <div className="btn-row">
          <button onClick={() => updateClip(clip.id, (c) => (c.transform.scaleY = c.transform.scaleX))}>縦横比を揃える</button>
          <button onClick={() => updateClip(clip.id, (c) => (c.transform.scaleX = -c.transform.scaleX))}>左右反転</button>
          <button onClick={() => updateClip(clip.id, (c) => (c.transform.scaleY = -c.transform.scaleY))}>上下反転</button>
        </div>
        <ParamSlider clip={clip} path="transform.rotation" label="回転 (Z)" min={-720} max={720} step={0.1} unit="°" />
        <ParamSlider clip={clip} path="transform.rotationX" label="回転 X (3D)" min={-180} max={180} step={0.1} unit="°" />
        <ParamSlider clip={clip} path="transform.rotationY" label="回転 Y (3D)" min={-180} max={180} step={0.1} unit="°" />
        <ParamSlider clip={clip} path="transform.skewX" label="傾斜" min={-60} max={60} step={0.1} unit="°" />
      </Section>
      <Section title="アンカーポイント・不透明度">
        <ParamSlider clip={clip} path="transform.anchorX" label="アンカー X" min={-2000} max={2000} step={1} />
        <ParamSlider clip={clip} path="transform.anchorY" label="アンカー Y" min={-2000} max={2000} step={1} />
        <ParamSlider clip={clip} path="transform.opacity" label="不透明度" min={0} max={100} step={0.1} unit="%" />
      </Section>
      <Toggle label="3D レイヤー (仮想カメラの影響を受ける)" value={clip.is3D} onChange={(v) => updateClip(clip.id, (c) => (c.is3D = v))} />
    </div>
  );
}

export function CropPanel({ clip }: { clip: Clip }) {
  const m = clip.mask;
  return (
    <div className="panel-body">
      <Section title="クロップ">
        {(['left', 'right', 'top', 'bottom'] as const).map((k) => (
          <ParamSlider key={k} clip={clip} path={'crop.' + k} label={{ left: '左', right: '右', top: '上', bottom: '下' }[k]} min={0} max={0.95} step={0.001} display={100} unit="%" />
        ))}
      </Section>
      <Section title="マスク">
        <Toggle label="マスクを使う" value={m.enabled} onChange={(v) => updateClip(clip.id, (c) => (c.mask.enabled = v))} />
        {m.enabled && (
          <>
            <Chips value={m.shape} options={[['rect', '四角'], ['ellipse', '円']]} onChange={(v) => updateClip(clip.id, (c) => (c.mask.shape = v))} />
            <ParamSlider clip={clip} path="mask.cx" label="中心 X" min={-0.5} max={1.5} step={0.001} />
            <ParamSlider clip={clip} path="mask.cy" label="中心 Y" min={-0.5} max={1.5} step={0.001} />
            <ParamSlider clip={clip} path="mask.w" label="幅" min={0} max={2} step={0.001} />
            <ParamSlider clip={clip} path="mask.h" label="高さ" min={0} max={2} step={0.001} />
            {m.shape === 'rect' && <ParamSlider clip={clip} path="mask.roundness" label="角丸" min={0} max={1} step={0.01} />}
            <ParamSlider clip={clip} path="mask.feather" label="ぼかし" min={0} max={1} step={0.005} />
            <Toggle label="反転" value={m.invert} onChange={(v) => updateClip(clip.id, (c) => (c.mask.invert = v))} />
          </>
        )}
      </Section>
    </div>
  );
}

const BLENDS: [BlendMode, string][] = [
  ['normal', '通常'],
  ['multiply', '乗算'],
  ['screen', 'スクリーン'],
  ['overlay', 'オーバーレイ'],
  ['add', '加算 (覆い焼きリニア)'],
  ['softLight', 'ソフトライト'],
  ['hardLight', 'ハードライト'],
  ['darken', '比較 (暗)'],
  ['lighten', '比較 (明)'],
  ['difference', '差の絶対値'],
  ['exclusion', '除外'],
  ['colorDodge', '覆い焼きカラー'],
  ['colorBurn', '焼き込みカラー'],
];

export function ComposePanel({ clip }: { clip: Clip }) {
  return (
    <div className="panel-body">
      <ParamSlider clip={clip} path="transform.opacity" label="不透明度" min={0} max={100} step={0.1} unit="%" />
      <Select label="ブレンドモード" value={clip.blendMode} options={BLENDS} onChange={(v) => updateClip(clip.id, (c) => (c.blendMode = v))} />
      <Section title="モーションブラー">
        <Toggle label="モーションブラー" value={clip.motionBlur.enabled} onChange={(v) => updateClip(clip.id, (c) => (c.motionBlur.enabled = v))} />
        {clip.motionBlur.enabled && (
          <>
            <Slider label="シャッター角度" value={clip.motionBlur.shutterAngle} min={10} max={720} step={5} unit="°" onLive={(v) => liveClip(clip.id, (c) => (c.motionBlur.shutterAngle = v))} onCommit={(v) => updateClip(clip.id, (c) => (c.motionBlur.shutterAngle = v))} />
            <Slider label="サンプル数 (品質)" value={clip.motionBlur.samples} min={2} max={32} step={1} onLive={(v) => liveClip(clip.id, (c) => (c.motionBlur.samples = v))} onCommit={(v) => updateClip(clip.id, (c) => (c.motionBlur.samples = v))} />
            <p className="hint">動き (位置・回転・拡大) から自動で計算します。サンプル数を増やすと滑らかになりますが重くなります。</p>
          </>
        )}
      </Section>
    </div>
  );
}

export function AudioPanel({ clip }: { clip: Clip }) {
  const project = useStore((s) => s.project)!;
  const track = project.tracks.find((t) => t.id === clip.trackId);
  const a = clip.audio;
  const set = (fn: (c: Clip) => void, key: string) => updateClip(clip.id, fn, key);
  return (
    <div className="panel-body">
      {clip.type === 'video' && clip.audioDetached && <p className="hint">このクリップの音声は分離済みです (オーディオトラックで編集してください)。</p>}
      <Toggle label="ミュート" value={a.muted} onChange={(v) => set((c) => (c.audio.muted = v), 'mute')} />
      <ParamSlider clip={clip} path="audio.volume" label="音量" min={0} max={2} step={0.01} display={100} unit="%" />
      <Slider label="フェードイン" value={a.fadeIn} min={0} max={Math.min(10, clip.duration)} step={0.05} unit="秒" onLive={(v) => liveClip(clip.id, (c) => (c.audio.fadeIn = v))} onCommit={(v) => set((c) => (c.audio.fadeIn = v), 'fi')} />
      <Slider label="フェードアウト" value={a.fadeOut} min={0} max={Math.min(10, clip.duration)} step={0.05} unit="秒" onLive={(v) => liveClip(clip.id, (c) => (c.audio.fadeOut = v))} onCommit={(v) => set((c) => (c.audio.fadeOut = v), 'fo')} />
      <Slider label="パン (左右)" value={a.pan} min={-1} max={1} step={0.01} onLive={(v) => liveClip(clip.id, (c) => (c.audio.pan = v))} onCommit={(v) => set((c) => (c.audio.pan = v), 'pan')} />
      <Section title="イコライザー">
        {(['low', 'mid', 'high'] as const).map((k) => (
          <Slider key={k} label={{ low: '低音 (220Hz)', mid: '中音 (1.2kHz)', high: '高音 (5kHz)' }[k]} value={a.eq[k]} min={-12} max={12} step={0.5} unit="dB" onLive={(v) => liveClip(clip.id, (c) => (c.audio.eq[k] = v))} onCommit={(v) => set((c) => (c.audio.eq[k] = v), 'eq' + k)} />
        ))}
        <div className="btn-row">
          <button onClick={() => set((c) => (c.audio.eq = { low: -4, mid: 3, high: 2 }), 'eqp')}>声を明瞭に</button>
          <button onClick={() => set((c) => (c.audio.eq = { low: 5, mid: 0, high: 1 }), 'eqp')}>低音強調</button>
          <button onClick={() => set((c) => (c.audio.eq = { low: 0, mid: 0, high: 0 }), 'eqp')}>フラット</button>
        </div>
      </Section>
      <Section title="コンプレッサー">
        <Toggle label="コンプレッサー" value={a.compressor.enabled} onChange={(v) => set((c) => (c.audio.compressor.enabled = v), 'comp')} />
        {a.compressor.enabled && (
          <>
            <Slider label="しきい値" value={a.compressor.threshold} min={-60} max={0} step={1} unit="dB" onLive={(v) => liveClip(clip.id, (c) => (c.audio.compressor.threshold = v))} onCommit={(v) => set((c) => (c.audio.compressor.threshold = v), 'ct')} />
            <Slider label="レシオ" value={a.compressor.ratio} min={1} max={20} step={0.5} onLive={(v) => liveClip(clip.id, (c) => (c.audio.compressor.ratio = v))} onCommit={(v) => set((c) => (c.audio.compressor.ratio = v), 'cr')} />
          </>
        )}
      </Section>
      {track && (
        <Section title={`トラック「${track.name}」`} defaultOpen={false}>
          <Slider label="トラック音量" value={track.volume} min={0} max={2} step={0.01} display={100} unit="%" onLive={(v) => st().live((p) => { const t = p.tracks.find((x) => x.id === track.id); if (t) t.volume = v; })} onCommit={(v) => st().update((p) => { const t = p.tracks.find((x) => x.id === track.id); if (t) t.volume = v; })} />
        </Section>
      )}
    </div>
  );
}

const TRANS_TYPES = Object.keys(TRANSITION_LABELS) as TransitionType[];

export function TransitionPanel({ clip }: { clip: Clip }) {
  const project = useStore((s) => s.project)!;
  const tr = clip.transitionIn;
  const prev = project.clips.find((c) => c.trackId === clip.trackId && Math.abs(clipEnd(c) - clip.start) < 0.5 / project.fps);
  return (
    <div className="panel-body">
      <p className="hint">{prev ? `「${prev.name}」から「${clip.name}」への切り替え効果です。` : '前に隣接するクリップがないため、透明からの登場効果になります。'}</p>
      <div className="grid-buttons">
        <button className={!tr ? 'on' : ''} onClick={() => updateClip(clip.id, (c) => (c.transitionIn = undefined))}>
          なし
        </button>
        {TRANS_TYPES.map((t) => (
          <button key={t} className={tr?.type === t ? 'on' : ''} onClick={() => updateClip(clip.id, (c) => (c.transitionIn = { type: t, duration: c.transitionIn?.duration ?? Math.min(0.6, c.duration / 2), ease: c.transitionIn?.ease ?? { kind: 'easeInOut' } }))}>
            {TRANSITION_LABELS[t]}
          </button>
        ))}
      </div>
      {tr && (
        <>
          <Slider label="長さ" value={tr.duration} min={0.05} max={Math.min(5, clip.duration)} step={0.05} unit="秒" onLive={(v) => liveClip(clip.id, (c) => (c.transitionIn!.duration = v))} onCommit={(v) => updateClip(clip.id, (c) => (c.transitionIn!.duration = v))} />
          <Select label="イージング" value={tr.ease.kind} options={Object.entries(EASE_LABELS).filter(([k]) => k !== 'hold') as any} onChange={(v) => updateClip(clip.id, (c) => (c.transitionIn!.ease = { kind: v as any }))} />
          <button
            className="wide"
            onClick={() =>
              st().update((p) => {
                for (const c of p.clips) {
                  if (c.trackId !== clip.trackId || c.id === clip.id) continue;
                  const hasPrev = p.clips.some((x) => x.trackId === c.trackId && Math.abs(clipEnd(x) - c.start) < 0.5 / p.fps);
                  if (hasPrev) c.transitionIn = JSON.parse(JSON.stringify(tr));
                }
              })
            }
          >
            このトラックのすべての切り替えに適用
          </button>
        </>
      )}
    </div>
  );
}
