import { useEffect, useRef, useState } from 'react';
import type { ProjectSummary } from '../model/types';
import { deleteProject, listProjects, loadProject, saveProject, storageEstimate } from '../storage/db';
import { createProject, normalizeProject, uid } from '../model/defaults';
import { dimsFor } from '../export/capabilities';
import { formatTime } from '../model/ops';
import { Icon } from './icons';
import { decodeText } from '../model/srt';

const PRESET_SIZES: { label: string; sub: string; a: [number, number] }[] = [
  { label: '9:16', sub: 'Shorts / TikTok / リール', a: [9, 16] },
  { label: '16:9', sub: 'YouTube / テレビ', a: [16, 9] },
  { label: '1:1', sub: 'Instagram 投稿', a: [1, 1] },
  { label: '4:5', sub: 'Instagram 縦', a: [4, 5] },
  { label: '4:3', sub: 'スライド・クラシック', a: [4, 3] },
  { label: '21:9', sub: 'シネマスコープ', a: [21, 9] },
];

export function Home({ onOpen }: { onOpen: (id: string) => void }) {
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [aspect, setAspect] = useState<[number, number]>([9, 16]);
  const [fps, setFps] = useState(30);
  const [custom, setCustom] = useState({ w: 1080, h: 1920, on: false });
  const [est, setEst] = useState<{ usage: number; quota: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = () =>
    listProjects()
      .then(setList)
      .catch((e) => {
        setErr('保存領域を開けませんでした: ' + (e?.message ?? e) + ' (プライベートブラウズでは保存できない場合があります)');
        setList([]);
      });
  useEffect(() => {
    void refresh();
    void storageEstimate().then(setEst);
  }, []);
  const create = async () => {
    const [w, h] = custom.on ? [Math.max(16, Math.round(custom.w / 2) * 2), Math.max(16, Math.round(custom.h / 2) * 2)] : dimsFor(aspect[0], aspect[1], 1080);
    const p = createProject(name.trim() || `プロジェクト ${new Date().toLocaleDateString('ja-JP')}`, w, h, fps);
    await saveProject(p);
    onOpen(p.id);
  };
  const duplicate = async (id: string) => {
    const p = await loadProject(id);
    if (!p) return;
    const np = { ...JSON.parse(JSON.stringify(p)), id: uid(), name: p.name + ' のコピー', updatedAt: Date.now(), createdAt: Date.now() };
    await saveProject(np);
    void refresh();
  };
  return (
    <div className="home">
      <header className="home-head">
        <h1>
          <span className="logo">▶</span> モバイル動画エディター
        </h1>
        <p>スマートフォンだけで、キーフレーム・エフェクト・テロップを使った本格的な動画を制作できます。</p>
      </header>
      {err && <p className="warn">{err}</p>}
      <button className="wide accent big" onClick={() => setCreating(true)}>
        <Icon name="plus" /> 新規プロジェクト
      </button>
      {creating && (
        <div className="create-box">
          <label className="ctl text-input">
            <span className="ctl-label">名前</span>
            <input value={name} placeholder="無題のプロジェクト" onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="aspect-grid">
            {PRESET_SIZES.map((s) => (
              <button key={s.label} className={'aspect' + (!custom.on && aspect[0] === s.a[0] && aspect[1] === s.a[1] ? ' on' : '')} onClick={() => {
                setAspect(s.a);
                setCustom({ ...custom, on: false });
              }}>
                <span className="aspect-shape" style={{ aspectRatio: `${s.a[0]} / ${s.a[1]}` }} />
                <b>{s.label}</b>
                <small>{s.sub}</small>
              </button>
            ))}
            <button className={'aspect' + (custom.on ? ' on' : '')} onClick={() => setCustom({ ...custom, on: true })}>
              <b>カスタム</b>
              <small>自由なサイズ</small>
            </button>
          </div>
          {custom.on && (
            <div className="row2">
              <label className="ctl text-input">
                <span className="ctl-label">幅</span>
                <input inputMode="numeric" value={custom.w} onChange={(e) => setCustom({ ...custom, w: Number(e.target.value) || 0 })} />
              </label>
              <label className="ctl text-input">
                <span className="ctl-label">高さ</span>
                <input inputMode="numeric" value={custom.h} onChange={(e) => setCustom({ ...custom, h: Number(e.target.value) || 0 })} />
              </label>
            </div>
          )}
          <div className="chips">
            {[24, 30, 60].map((f) => (
              <button key={f} className={'chip' + (fps === f ? ' on' : '')} onClick={() => setFps(f)}>
                {f} fps
              </button>
            ))}
          </div>
          <div className="btn-row">
            <button onClick={() => setCreating(false)}>キャンセル</button>
            <button className="accent" onClick={create}>
              作成
            </button>
          </div>
        </div>
      )}
      <h2>プロジェクト</h2>
      {list === null && <p className="hint">読み込み中…</p>}
      {list && list.length === 0 && <p className="hint">まだプロジェクトがありません。</p>}
      <div className="project-list">
        {list?.map((p) => (
          <div key={p.id} className="project-card">
            <button className="project-open" onClick={() => onOpen(p.id)}>
              <div className="thumb" style={{ aspectRatio: `${p.width} / ${p.height}` }}>
                {p.thumb ? <img src={p.thumb} alt="" /> : <Icon name="video" size={28} />}
              </div>
              <div className="meta">
                <b>{p.name}</b>
                <small>
                  {p.width}×{p.height} ／ {formatTime(p.duration, 30, false)}
                </small>
                <small>{new Date(p.updatedAt).toLocaleString('ja-JP')}</small>
              </div>
            </button>
            <div className="card-actions">
              <button className="mini" onClick={() => duplicate(p.id)} aria-label="複製">
                <Icon name="copy" size={16} />
              </button>
              <button
                className="mini"
                aria-label="削除"
                onClick={async () => {
                  if (!confirm(`「${p.name}」を削除しますか？ この操作は取り消せません。`)) return;
                  await deleteProject(p.id);
                  void refresh();
                }}
              >
                <Icon name="trash" size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="home-foot">
        <button className="wide" onClick={() => fileRef.current?.click()}>
          プロジェクトファイル (.json) を読み込む
        </button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            const p = normalizeProject(JSON.parse(decodeText(await f.arrayBuffer())));
            p.id = uid();
            await saveProject(p);
            void refresh();
            alert('読み込みました。素材 (動画・画像) は含まれないため、必要に応じて再度読み込んでください。');
          } catch {
            alert('プロジェクトファイルを読み込めませんでした');
          }
        }} />
        {est && (
          <p className="hint">
            端末内の使用量: {(est.usage / 1048576).toFixed(0)} MB / 上限目安 {(est.quota / 1048576).toFixed(0)} MB
          </p>
        )}
        <p className="hint">データはこの端末のブラウザ内にのみ保存され、外部には送信されません。</p>
      </div>
    </div>
  );
}
