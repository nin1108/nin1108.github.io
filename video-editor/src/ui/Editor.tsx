import { useEffect, type ReactNode } from 'react';
import { useStore, flushSave, type PanelId } from '../store/store';
import { Preview } from './Preview';
import { Timeline } from './Timeline';
import { Icon } from './icons';
import { engine } from './engine';
import { formatTime, projectDuration } from '../model/ops';
import type { Clip } from '../model/types';
import { deleteSelected, duplicateSelected, splitAtPlayhead, importFiles } from './actions';
import { AudioPanel, ComposePanel, CropPanel, EditPanel, TransformPanel, TransitionPanel } from './panels/ClipPanels';
import { ColorPanel, EffectsPanel } from './panels/EffectsColor';
import { TextPanel } from './panels/TextPanel';
import { AddPanel, ChartPanel, CounterPanel, ParticlesPanel, ShapePanel, SolidPanel } from './panels/Generators';
import { AnimatePanel } from './panels/AnimatePanel';
import { ExportPanel, LayersPanel, PresetsPanel, ProjectPanel } from './panels/ProjectPanels';
import { releaseAll } from '../media/registry';

const st = () => useStore.getState();

const PANEL_TITLES: Record<Exclude<PanelId, null>, string> = {
  add: '追加',
  edit: '編集',
  transform: '変形',
  speed: '速度',
  crop: 'クロップ・マスク',
  compose: '合成',
  effects: 'エフェクト',
  color: 'カラー',
  text: 'テキスト',
  shape: '図形',
  animate: 'アニメーション',
  audio: '音声',
  transition: 'トランジション',
  presets: 'プリセット',
  project: 'プロジェクト設定',
  export: '書き出し',
  particles: 'パーティクル',
  counter: 'カウンター',
  chart: 'グラフ',
  solid: '背景',
  layers: 'レイヤー',
  record: '録音',
};

type Tool = { id: Exclude<PanelId, null>; icon: string; label: string };

function toolsFor(c: Clip | undefined): Tool[] {
  if (!c)
    return [
      { id: 'add', icon: 'plus', label: '追加' },
      { id: 'presets', icon: 'sparkle', label: 'プリセット' },
      { id: 'layers', icon: 'layers', label: 'レイヤー' },
      { id: 'project', icon: 'settings', label: '設定' },
      { id: 'export', icon: 'export', label: '書き出し' },
    ];
  const t: Tool[] = [];
  const typeTool: Record<string, Tool> = {
    text: { id: 'text', icon: 'text', label: 'テキスト' },
    shape: { id: 'shape', icon: 'shape', label: '図形' },
    particles: { id: 'particles', icon: 'particles', label: '粒子' },
    counter: { id: 'counter', icon: 'counter', label: 'カウンター' },
    chart: { id: 'chart', icon: 'chart', label: 'グラフ' },
    solid: { id: 'solid', icon: 'layers', label: '背景' },
  };
  if (typeTool[c.type]) t.push(typeTool[c.type]);
  t.push({ id: 'edit', icon: 'split', label: '編集' });
  if (c.type === 'audio') {
    t.push({ id: 'audio', icon: 'volume', label: '音量' }, { id: 'animate', icon: 'anim', label: 'キー' });
    return t;
  }
  if (c.type === 'camera') {
    t.push({ id: 'transform', icon: 'camera3d', label: 'カメラ' }, { id: 'animate', icon: 'anim', label: 'アニメ' }, { id: 'effects', icon: 'fx', label: 'シェイク' });
    return t;
  }
  if (c.type !== 'adjustment') t.push({ id: 'transform', icon: 'full', label: '変形' }, { id: 'animate', icon: 'anim', label: 'アニメ' });
  t.push({ id: 'effects', icon: 'fx', label: 'エフェクト' }, { id: 'color', icon: 'color', label: 'カラー' });
  if (c.type === 'video') t.push({ id: 'audio', icon: 'volume', label: '音声' });
  t.push({ id: 'compose', icon: 'adjust', label: '合成' }, { id: 'crop', icon: 'crop', label: 'マスク' });
  if (c.type !== 'adjustment') t.push({ id: 'transition', icon: 'transition', label: '切替' });
  t.push({ id: 'presets', icon: 'sparkle', label: 'プリセット' });
  return t;
}

function PanelContent({ panel, clip }: { panel: Exclude<PanelId, null>; clip?: Clip }): ReactNode {
  switch (panel) {
    case 'add':
      return <AddPanel />;
    case 'presets':
      return <PresetsPanel />;
    case 'project':
      return <ProjectPanel />;
    case 'export':
      return <ExportPanel />;
    case 'layers':
      return <LayersPanel />;
    default:
      break;
  }
  if (!clip) return <div className="panel-body hint">クリップを選択してください</div>;
  switch (panel) {
    case 'edit':
    case 'speed':
      return <EditPanel clip={clip} />;
    case 'transform':
      return <TransformPanel clip={clip} />;
    case 'crop':
      return <CropPanel clip={clip} />;
    case 'compose':
      return <ComposePanel clip={clip} />;
    case 'effects':
      return <EffectsPanel clip={clip} />;
    case 'color':
      return <ColorPanel clip={clip} />;
    case 'text':
      return <TextPanel clip={clip} />;
    case 'shape':
      return clip.shape ? <ShapePanel clip={clip} /> : null;
    case 'particles':
      return clip.particles ? <ParticlesPanel clip={clip} /> : null;
    case 'counter':
      return clip.counter ? <CounterPanel clip={clip} /> : null;
    case 'chart':
      return clip.chart ? <ChartPanel clip={clip} /> : null;
    case 'solid':
      return clip.solid ? <SolidPanel clip={clip} /> : null;
    case 'animate':
      return <AnimatePanel clip={clip} />;
    case 'audio':
      return <AudioPanel clip={clip} />;
    case 'transition':
      return <TransitionPanel clip={clip} />;
    default:
      return null;
  }
}

function Header({ onHome }: { onHome: () => void }) {
  const name = useStore((s) => s.project?.name ?? '');
  const saveState = useStore((s) => s.saveState);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const saveLabel = { saved: '保存済み', saving: '保存中…', dirty: '未保存', error: '保存エラー' }[saveState];
  return (
    <header className="topbar">
      <button className="icon-btn" onClick={onHome} aria-label="プロジェクト一覧">
        <Icon name="back" />
      </button>
      <div className="title" onClick={() => st().setPanel('project')}>
        <div className="pname">{name || '無題'}</div>
        <div className={'save ' + saveState}>{saveLabel}</div>
      </div>
      <button className="icon-btn" disabled={!canUndo} onClick={() => st().undo()} aria-label="元に戻す">
        <Icon name="undo" />
      </button>
      <button className="icon-btn" disabled={!canRedo} onClick={() => st().redo()} aria-label="やり直す">
        <Icon name="redo" />
      </button>
      <button className="export-btn" onClick={() => st().setPanel('export')}>
        書き出し
      </button>
    </header>
  );
}

function Transport() {
  const project = useStore((s) => s.project)!;
  const time = useStore((s) => s.time);
  const playing = useStore((s) => s.playing);
  const dur = projectDuration(project);
  const step = (n: number) => {
    st().setPlaying(false);
    st().setTime(Math.max(0, Math.round((st().time + n / project.fps) * project.fps) / project.fps));
  };
  return (
    <div className="transport">
      <span className="tc">
        {formatTime(time, project.fps)}
        <small> / {formatTime(dur, project.fps)}</small>
      </span>
      <div className="tp-btns">
        <button className="icon-btn" onClick={() => st().setTime(0)} aria-label="先頭へ">
          <Icon name="toStart" size={20} />
        </button>
        <button className="icon-btn" onClick={() => step(-1)} aria-label="1フレーム戻る">
          <Icon name="prevFrame" size={20} />
        </button>
        <button className="play-btn" onClick={() => engine.togglePlay()} aria-label={playing ? '一時停止' : '再生'}>
          <Icon name={playing ? 'pause' : 'play'} size={26} />
        </button>
        <button className="icon-btn" onClick={() => step(1)} aria-label="1フレーム進む">
          <Icon name="nextFrame" size={20} />
        </button>
        <button className="icon-btn" onClick={() => st().set({ fullscreen: true })} aria-label="全画面プレビュー">
          <Icon name="full" size={20} />
        </button>
      </div>
      <div className="tp-quick">
        <button className="icon-btn" onClick={splitAtPlayhead} aria-label="分割">
          <Icon name="split" size={20} />
        </button>
      </div>
    </div>
  );
}

export function Editor({ onHome }: { onHome: () => void }) {
  const project = useStore((s) => s.project)!;
  const panel = useStore((s) => s.panel);
  const selection = useStore((s) => s.selection);
  const toast = useStore((s) => s.toast);
  const fullscreen = useStore((s) => s.fullscreen);
  const clip = selection.length ? project.clips.find((c) => c.id === selection[0]) : undefined;
  const tools = toolsFor(clip);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => useStore.setState({ toast: null }), toast.kind === 'error' ? 6000 : 2600);
    return () => clearTimeout(id);
  }, [toast]);

  // キーボードショートカット (外部キーボード・PC 用)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.code === 'Space') {
        e.preventDefault();
        engine.togglePlay();
      } else if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) st().redo();
        else st().undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        st().redo();
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelected();
      } else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected(false);
      else if (e.key.toLowerCase() === 's' && !mod) splitAtPlayhead();
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const p = st().project!;
        const n = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1);
        st().setPlaying(false);
        st().setTime(Math.max(0, st().time + n / p.fps));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ドラッグ&ドロップ読み込み (PC/タブレット)
  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer?.files.length) void importFiles(Array.from(e.dataTransfer.files));
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);

  const goHome = async () => {
    st().setPlaying(false);
    await flushSave();
    engine.pool.dispose();
    engine.audio.stop();
    releaseAll();
    onHome();
  };

  return (
    <div className={'editor' + (panel ? ' has-panel' : '') + (fullscreen ? ' fullscreen' : '')}>
      <Header onHome={goHome} />
      <div className="stage">
        <Preview />
        <Transport />
      </div>
      <div className="lower">
        <Timeline />
        {panel && (
          <div className="sheet" role="dialog" aria-label={PANEL_TITLES[panel]}>
            <div className="sheet-head">
              <span>{PANEL_TITLES[panel]}</span>
              {clip && panel !== 'add' && panel !== 'project' && panel !== 'export' && panel !== 'layers' && <span className="sheet-sub">{clip.type === 'text' ? clip.text?.content.slice(0, 14) : clip.name}</span>}
              <button className="icon-btn" onClick={() => st().setPanel(null)} aria-label="閉じる">
                <Icon name="close" />
              </button>
            </div>
            <div className="sheet-body">
              <PanelContent panel={panel} clip={clip} />
            </div>
          </div>
        )}
      </div>
      <nav className="toolbar">
        {clip && (
          <button className="tool back" onClick={() => {
            st().select([]);
            st().setPanel(null);
          }}>
            <Icon name="back" />
            <span>戻る</span>
          </button>
        )}
        {tools.map((t) => (
          <button key={t.id} className={'tool' + (panel === t.id ? ' on' : '')} onClick={() => st().setPanel(panel === t.id ? null : t.id)}>
            <Icon name={t.icon} />
            <span>{t.label}</span>
          </button>
        ))}
        {clip && (
          <>
            <button className="tool" onClick={duplicateSelected}>
              <Icon name="copy" />
              <span>複製</span>
            </button>
            <button className="tool" onClick={() => deleteSelected(false)}>
              <Icon name="trash" />
              <span>削除</span>
            </button>
          </>
        )}
      </nav>
      {toast && <div className={'toast ' + toast.kind}>{toast.msg}</div>}
    </div>
  );
}
