import { useEffect, useRef, useState } from 'react';
import { useStore, flushSave } from '../../store/store';
import { CATEGORY_LABELS, KIND_LABELS, PRESETS, userPresetToPreset, type PresetCategory, type PresetKind } from '../../presets/presets';
import { applyPreset, downloadBlob, exportSRT, importSRT, selected } from '../actions';
import { Chips, ColorField, Section, Slider, Toggle } from '../controls';
import { formatTime, projectDuration } from '../../model/ops';
import { RESOLUTIONS, detectCaps, dimsFor, recommendedBitrate, type Caps } from '../../export/capabilities';
import { exportVideo, type ExportProgress, type ExportResult } from '../../export/exporter';
import { loadBackups, storageEstimate } from '../../storage/db';
import { normalizeProject } from '../../model/defaults';
import { Icon } from '../icons';
import { askConfirm } from '../dialog';
import { PresetThumb } from './PresetThumb';
import { loadPresetStore, usePresetStore, USER_PREFIX } from '../../presets/userPresets';
import { inArtifact } from '../platform';
import { engine } from '../engine';

const st = () => useStore.getState();

export function PresetsPanel() {
  const [cat, setCat] = useState<PresetCategory | 'all'>('all');
  const [kind, setKind] = useState<PresetKind | 'all'>('all');
  useStore((s) => s.selection);
  const mine = usePresetStore((s) => s.mine);
  const overrides = usePresetStore((s) => s.overrides);
  useEffect(() => {
    void loadPresetStore();
  }, []);
  const all = [...mine.map(userPresetToPreset), ...PRESETS];
  const list = all.filter((p) => (cat === 'all' || p.category === cat) && (kind === 'all' || p.kind === kind));
  const versionOf = (p: (typeof all)[number]) => overrides[p.id]?.savedAt ?? mine.find((m) => USER_PREFIX + m.id === p.id)?.updatedAt;
  const clip = selected();
  return (
    <div className="panel-body">
      <p className="hint">全 {all.length} 種類。{clip ? `選択中「${clip.name}」に適用します。テンプレートは再生ヘッド位置に追加されます。` : 'クリップ未選択時: テロップは新規テキスト、カラー/エフェクトは調整レイヤーとして追加します。'}</p>
      {clip?.type === 'text' && (
        <button className="wide" onClick={() => useStore.getState().setPanel('text')}>
          選択中のテロップをプリセットに上書き保存
        </button>
      )}
      <div className="scroll-chips">
        <Chips value={kind} options={[['all', 'すべて'], ...(Object.entries(KIND_LABELS) as [PresetKind, string][])]} onChange={setKind} />
      </div>
      <div className="scroll-chips">
        <Chips value={cat} options={[['all', '全カテゴリー'], ...(Object.entries(CATEGORY_LABELS) as [PresetCategory, string][])]} onChange={setCat} />
      </div>
      <div className="preset-grid">
        {list.map((p) => (
          <button key={p.id} className={'preset ' + p.kind} onClick={() => applyPreset(p.id)}>
            {p.kind === 'text' ? <PresetThumb preset={p} version={versionOf(p)} /> : <span className="preset-kind">{KIND_LABELS[p.kind]}</span>}
            {overrides[p.id] && <span className="badge">編集済み</span>}
            <span className={'preset-name' + (p.kind === 'text' ? ' small' : '')}>{p.name}</span>
            <span className="preset-cat">{CATEGORY_LABELS[p.category]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const ASPECTS: [string, number, number][] = [
  ['16:9', 16, 9],
  ['9:16', 9, 16],
  ['1:1', 1, 1],
  ['4:3', 4, 3],
  ['21:9', 21, 9],
  ['4:5', 4, 5],
];

export function ProjectPanel() {
  const project = useStore((s) => s.project)!;
  const quality = useStore((s) => s.previewQuality);
  const srtRef = useRef<HTMLInputElement>(null);
  const [est, setEst] = useState<{ usage: number; quota: number } | null>(null);
  const [backups, setBackups] = useState<{ t: number }[]>([]);
  useEffect(() => {
    void storageEstimate().then(setEst);
    void loadBackups(project.id).then((b) => setBackups(b.map((x) => ({ t: x.t }))));
  }, [project.id]);
  const [cw, setCw] = useState(project.width);
  const [ch, setCh] = useState(project.height);
  const resize = (w: number, h: number) => {
    w = Math.max(16, Math.min(7680, Math.round(w / 2) * 2));
    h = Math.max(16, Math.min(7680, Math.round(h / 2) * 2));
    st().update((p) => {
      const sx = w / p.width;
      const sy = h / p.height;
      // 既存レイヤーの位置を新しいサイズへ比例移動
      for (const c of p.clips) {
        c.transform.x *= sx;
        c.transform.y *= sy;
        for (const k of c.keyframes['transform.x'] ?? []) if (typeof k.v === 'number') k.v *= sx;
        for (const k of c.keyframes['transform.y'] ?? []) if (typeof k.v === 'number') k.v *= sy;
        if (c.solid) {
          c.solid.width = w;
          c.solid.height = h;
        }
        if (c.particles) {
          c.particles.width = w;
          c.particles.height = h;
        }
      }
      p.width = w;
      p.height = h;
      p.cameraFocal = Math.round(Math.max(w, h) * 1.2);
    });
    setCw(w);
    setCh(h);
  };
  return (
    <div className="panel-body">
      <label className="ctl text-input">
        <span className="ctl-label">プロジェクト名</span>
        <input value={project.name} onChange={(e) => st().update((p) => (p.name = e.target.value), { merge: 'pname' })} />
      </label>
      <Section title="画面サイズ・フレームレート">
        <div className="chips">
          {ASPECTS.map(([l, a, b]) => {
            const [w, h] = dimsFor(a, b, 1080);
            return (
              <button key={l} className={'chip' + (project.width === w && project.height === h ? ' on' : '')} onClick={() => resize(w, h)}>
                {l}
              </button>
            );
          })}
        </div>
        <div className="row2">
          <label className="ctl text-input">
            <span className="ctl-label">幅</span>
            <input inputMode="numeric" value={cw} onChange={(e) => setCw(Number(e.target.value) || 0)} onBlur={() => resize(cw, ch)} />
          </label>
          <label className="ctl text-input">
            <span className="ctl-label">高さ</span>
            <input inputMode="numeric" value={ch} onChange={(e) => setCh(Number(e.target.value) || 0)} onBlur={() => resize(cw, ch)} />
          </label>
        </div>
        <Chips value={String(project.fps)} options={[['24', '24fps'], ['25', '25fps'], ['30', '30fps'], ['60', '60fps']]} onChange={(v) => st().update((p) => (p.fps = Number(v)))} />
        <ColorField label="背景色" value={project.background} onChange={(v) => st().update((p) => (p.background = v), { merge: 'bg' })} />
        <Slider label="カメラの焦点距離 (3D の遠近感)" value={project.cameraFocal} min={200} max={8000} step={10} onLive={(v) => st().live((p) => (p.cameraFocal = v))} onCommit={(v) => st().update((p) => (p.cameraFocal = v))} />
      </Section>
      <Section title="音声">
        <Slider label="マスター音量" value={project.masterVolume} min={0} max={2} step={0.01} display={100} unit="%" onLive={(v) => st().live((p) => (p.masterVolume = v))} onCommit={(v) => st().update((p) => (p.masterVolume = v))} />
        <Toggle label="音割れ防止リミッター" value={project.limiter} onChange={(v) => st().update((p) => (p.limiter = v))} />
      </Section>
      <Section title="字幕 (SRT)">
        <div className="btn-row">
          <button onClick={() => srtRef.current?.click()}>SRT を読み込む</button>
          <button onClick={() => {
            const txt = exportSRT();
            downloadBlob(new Blob(['﻿' + txt], { type: 'text/plain;charset=utf-8' }), `${project.name || 'subtitles'}.srt`);
          }}>SRT を書き出す</button>
        </div>
        <input ref={srtRef} type="file" accept=".srt,.vtt,text/plain" hidden onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) await importSRT(f).catch((err) => st().showToast(String(err?.message ?? err), 'error'));
        }} />
        <p className="hint">UTF-8 / UTF-16 / Shift_JIS を自動判定します。書き出しは全テキストクリップが対象です。</p>
      </Section>
      <Section title="プレビュー">
        <Chips value={quality} options={[['low', '軽量'], ['auto', '自動'], ['high', '高画質']]} onChange={(v) => st().set({ previewQuality: v })} />
        <p className="hint">プレビューは画面サイズに合わせた低解像度で描画し、書き出し時は元素材を使って出力解像度で描画します。現在 {engine.fpsMeter.value} fps。</p>
      </Section>
      <Section title="保存・復元" defaultOpen={false}>
        <p className="hint">編集内容は自動的に端末内 (IndexedDB) に保存されます。{est ? `使用量 ${(est.usage / 1048576).toFixed(0)}MB / 上限目安 ${(est.quota / 1048576).toFixed(0)}MB` : ''}</p>
        <div className="btn-row">
          <button onClick={() => void flushSave().then(() => st().showToast('保存しました', 'ok'))}>今すぐ保存</button>
          <button onClick={() => {
            const blob = new Blob([JSON.stringify(project)], { type: 'application/json' });
            downloadBlob(blob, `${project.name}.mve.json`);
          }}>プロジェクトファイルを書き出す</button>
        </div>
        {backups.length > 0 && (
          <>
            <div className="fx-group-title">自動バックアップから復元</div>
            {backups.map((b, i) => (
              <button key={b.t} className="wide" onClick={async () => {
                if (!(await askConfirm('この時点の内容に戻しますか？', '現在の内容は「元に戻す」で復帰できます。', { okLabel: '戻す' }))) return;
                const list = await loadBackups(project.id);
                const bp = list[i]?.p;
                if (bp) st().update((p) => Object.assign(p, normalizeProject({ ...bp, id: p.id })));
              }}>
                {new Date(b.t).toLocaleString('ja-JP')}
              </button>
            ))}
          </>
        )}
      </Section>
    </div>
  );
}

export function LayersPanel() {
  const project = useStore((s) => s.project)!;
  const time = useStore((s) => s.time);
  const sel = useStore((s) => s.selection);
  const tracks = [...project.tracks].reverse();
  const moveTrack = (id: string, dir: 1 | -1) =>
    st().update((p) => {
      const i = p.tracks.findIndex((t) => t.id === id);
      const j = i + dir;
      if (j < 0 || j >= p.tracks.length || p.tracks[j].kind !== p.tracks[i].kind) return;
      [p.tracks[i], p.tracks[j]] = [p.tracks[j], p.tracks[i]];
    });
  return (
    <div className="panel-body">
      <p className="hint">上にあるトラックほど前面に表示されます。</p>
      {tracks.map((t) => {
        const clips = project.clips.filter((c) => c.trackId === t.id).sort((a, b) => a.start - b.start);
        const now = clips.find((c) => time >= c.start && time < c.start + c.duration);
        return (
          <div key={t.id} className="layer-row">
            <div className="layer-head">
              <input className="layer-name" value={t.name} onChange={(e) => st().update((p) => (p.tracks.find((x) => x.id === t.id)!.name = e.target.value), { merge: 'tn' + t.id })} />
              <button className="mini" onClick={() => moveTrack(t.id, 1)} aria-label="前面へ">
                ↑
              </button>
              <button className="mini" onClick={() => moveTrack(t.id, -1)} aria-label="背面へ">
                ↓
              </button>
              <button className="mini" onClick={() => st().update((p) => {
                const tt = p.tracks.find((x) => x.id === t.id)!;
                if (t.kind === 'audio') tt.muted = !tt.muted;
                else tt.hidden = !tt.hidden;
              })}>
                <Icon name={t.kind === 'audio' ? (t.muted ? 'mute' : 'volume') : t.hidden ? 'eyeoff' : 'eye'} size={16} />
              </button>
              <button className="mini" onClick={() => st().update((p) => {
                const tt = p.tracks.find((x) => x.id === t.id)!;
                tt.locked = !tt.locked;
              })}>
                <Icon name={t.locked ? 'lock' : 'unlock'} size={14} />
              </button>
              {clips.length === 0 && (
                <button className="mini" onClick={() => st().update((p) => (p.tracks = p.tracks.filter((x) => x.id !== t.id)))} aria-label="トラック削除">
                  <Icon name="trash" size={14} />
                </button>
              )}
            </div>
            <div className="layer-clips">
              {clips.map((c) => (
                <button key={c.id} className={'chip' + (sel.includes(c.id) ? ' on' : '') + (c === now ? ' now' : '')} onClick={() => {
                  st().select([c.id]);
                  if (time < c.start || time >= c.start + c.duration) st().setTime(c.start);
                }}>
                  {c.type === 'text' ? c.text?.content.slice(0, 10) : c.name}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      <div className="btn-row">
        <button onClick={() => st().update((p) => {
          const n = p.tracks.filter((t) => t.kind === 'visual').length + 1;
          p.tracks.splice(p.tracks.map((t) => t.kind).lastIndexOf('visual') + 1, 0, { id: Math.random().toString(36).slice(2, 10), kind: 'visual', name: `ビデオ ${n}`, hidden: false, muted: false, locked: false, volume: 1 });
        })}>映像トラック追加</button>
        <button onClick={() => st().update((p) => {
          const n = p.tracks.filter((t) => t.kind === 'audio').length + 1;
          p.tracks.push({ id: Math.random().toString(36).slice(2, 10), kind: 'audio', name: `オーディオ ${n}`, hidden: false, muted: false, locked: false, volume: 1 });
        })}>音声トラック追加</button>
      </div>
    </div>
  );
}

// ---------- 書き出し ----------
export function ExportPanel() {
  const project = useStore((s) => s.project)!;
  const [caps, setCaps] = useState<Caps | null>(null);
  const [res, setRes] = useState(1080);
  const [fps, setFps] = useState(project.fps >= 50 ? 60 : project.fps);
  const [mbps, setMbps] = useState(0);
  const [prog, setProg] = useState<ExportProgress | null>(null);
  const [result, setResult] = useState<(ExportResult & { url: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const dur = projectDuration(project);
  useEffect(() => {
    void detectCaps(project.width, project.height).then(setCaps);
  }, [project.width, project.height]);
  useEffect(() => () => {
    if (result) URL.revokeObjectURL(result.url);
  }, [result]);
  const [w, h] = dimsFor(project.width, project.height, res);
  const key = `${w}x${h}@${fps}`;
  const supported = caps ? caps.supported[key] : undefined;
  const bitrate = mbps > 0 ? mbps * 1e6 : recommendedBitrate(w, h, fps);
  const engineKind: 'webcodecs' | 'realtime' = caps && !caps.webcodecs ? 'realtime' : 'webcodecs';
  const estSize = ((bitrate + 192000) * dur) / 8 / 1048576;
  const running = prog && prog.phase !== 'done' && prog.phase !== 'error';
  const start = async () => {
    setError(null);
    if (result) URL.revokeObjectURL(result.url);
    setResult(null);
    st().setPlaying(false);
    await flushSave();
    const ac = new AbortController();
    abort.current = ac;
    const t0 = Date.now();
    try {
      const wakeLock = await (navigator as any).wakeLock?.request?.('screen').catch(() => null);
      const r = await exportVideo(
        project,
        { width: w, height: h, fps, videoBitrate: bitrate, audioBitrate: 192000, from: 0, to: dur, fileName: `${(project.name || 'video').replace(/[\\/:*?"<>|]/g, '_')}_${h}p${fps}.mp4`, engine: engineKind },
        (p) => setProg(p),
        ac.signal,
      );
      void wakeLock?.release?.();
      setResult({ ...r, url: URL.createObjectURL(r.blob) });
      st().showToast(`書き出し完了 (${((Date.now() - t0) / 1000).toFixed(0)} 秒)`, 'ok');
    } catch (e: any) {
      if (e?.name === 'AbortError' || ac.signal.aborted) {
        setError('書き出しをキャンセルしました');
      } else {
        console.error(e);
        setError('書き出しに失敗しました: ' + (e?.message ?? e) + (res > 1080 ? ' (解像度を下げると成功する場合があります)' : ''));
      }
      setProg(null);
    }
  };
  const share = async () => {
    if (!result) return;
    // Artifact 内では downloads 機能が iPhone の共有シートを開く
    if (inArtifact) {
      await downloadBlob(result.blob, result.fileName);
      return;
    }
    const file = new File([result.blob], result.fileName, { type: result.mime });
    try {
      if ((navigator as any).canShare?.({ files: [file] })) await navigator.share({ files: [file], title: project.name });
      else downloadBlob(result.blob, result.fileName);
    } catch (e: any) {
      if (e?.name !== 'AbortError') downloadBlob(result.blob, result.fileName);
    }
  };
  return (
    <div className="panel-body">
      <div className="row-info">
        長さ {formatTime(dur, project.fps)} ／ 画面比 {project.width}×{project.height}
      </div>
      {!caps && <p className="hint">端末の書き出し性能を確認中…</p>}
      {caps && !caps.webcodecs && <p className="warn">この端末は WebCodecs に非対応のため、実時間録画方式 (MediaRecorder) で書き出します。iOS 16.4 以降 / 最新の Chrome を推奨します。</p>}
      <Section title="解像度">
        <div className="chips">
          {RESOLUTIONS.map((r) => {
            const [rw, rh] = dimsFor(project.width, project.height, r.short);
            const ok = !caps || !caps.webcodecs ? r.short <= 1080 : caps.supported[`${rw}x${rh}@${fps}`];
            return (
              <button key={r.short} className={'chip' + (res === r.short ? ' on' : '')} disabled={caps ? !ok : false} onClick={() => setRes(r.short)}>
                {r.label}
                {caps && !ok ? ' (非対応)' : ''}
              </button>
            );
          })}
        </div>
        <div className="row-info">
          出力: {w}×{h}
        </div>
      </Section>
      <Section title="フレームレート・画質">
        <Chips value={String(fps)} options={[['24', '24fps'], ['30', '30fps'], ['60', '60fps']]} onChange={(v) => setFps(Number(v))} />
        <Slider label="ビットレート (0=自動)" value={mbps} min={0} max={80} step={1} unit="Mbps" onLive={setMbps} onCommit={setMbps} />
        <div className="row-info">
          {(bitrate / 1e6).toFixed(1)} Mbps ／ 推定サイズ 約 {estSize.toFixed(0)} MB ／ H.264 + AAC (MP4)
        </div>
        {supported === false && <p className="warn">この組み合わせはこの端末のエンコーダーで非対応と判定されました。解像度かフレームレートを下げてください。</p>}
        {res >= 2160 && <p className="warn">4K は端末の負荷とメモリ使用量が大きく、時間がかかります。</p>}
      </Section>
      {!running && (
        <button className="wide accent big" disabled={dur <= 0 || supported === false} onClick={start}>
          <Icon name="export" /> 書き出し開始
        </button>
      )}
      {prog && (
        <div className="export-progress">
          <div className="bar">
            <div style={{ width: `${(prog.progress * 100).toFixed(1)}%` }} />
          </div>
          <div className="row-info">
            {prog.message} {prog.phase === 'video' && prog.fpsRate > 0 ? `／ ${prog.fpsRate.toFixed(1)} fps ／ 残り約 ${Math.ceil(prog.etaSec)} 秒` : ''}
          </div>
          {running && (
            <button className="wide danger" onClick={() => abort.current?.abort()}>
              キャンセル
            </button>
          )}
          {running && <p className="hint">書き出し中は画面を閉じたり、アプリを切り替えたりしないでください。</p>}
        </div>
      )}
      {error && <p className="warn">{error}</p>}
      {result && (
        <div className="export-result">
          <video src={result.url} controls playsInline className="result-video" />
          <div className="row-info">
            {result.fileName} ／ {(result.blob.size / 1048576).toFixed(1)} MB ／ {result.seconds.toFixed(0)} 秒で書き出し
          </div>
          {result.warnings.map((w2, i) => (
            <p key={i} className="warn">
              {w2}
            </p>
          ))}
          <div className="btn-row">
            <button className="accent" onClick={share}>
              <Icon name="share" /> 共有・写真に保存
            </button>
            <button onClick={() => downloadBlob(result.blob, result.fileName)}>
              <Icon name="export" /> ダウンロード
            </button>
          </div>
        </div>
      )}
      {caps && (
        <Section title="端末情報" defaultOpen={false}>
          <div className="row-info small">
            WebCodecs: {caps.webcodecs ? '対応' : '非対応'} ／ AAC: {caps.aacNative ? 'ネイティブ' : 'ソフトウェア'} ／ 最大テクスチャ {caps.maxTexture}px ／ CPU {caps.cores} コア ／ メモリ {caps.deviceMemory ?? '不明'}GB ／ OPFS 書き込み {caps.opfsWritable ? '可' : '不可'}
          </div>
        </Section>
      )}
    </div>
  );
}
