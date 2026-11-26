import { useStore } from '../store/store';
import type { AssetMeta, Clip, ClipType, Project, ShapeData } from '../model/types';
import { createClip, createEffect, defaultParticles, defaultShape } from '../model/defaults';
import { clipEnd, closeGaps, deleteClips, detachAudio, duplicateClip, findFreeTrack, frameSnap, groupClips, splitClip, ungroup } from '../model/ops';
import { importFile } from '../media/import';
import { buildSRT, decodeText, parseSRT } from '../model/srt';
import { PRESETS } from '../presets/presets';
import { findClip } from './params';
import { saveFile } from './platform';

const st = () => useStore.getState();

function fitScale(p: Project, w: number, h: number) {
  return Math.round(Math.min(p.width / w, p.height / h) * 100 * 1000) / 1000;
}

export async function importFiles(files: FileList | File[], opts: { addToTimeline?: boolean } = { addToTimeline: true }) {
  const list = Array.from(files);
  let ok = 0;
  for (const f of list) {
    try {
      if (/\.(srt|vtt)$/i.test(f.name)) {
        await importSRT(f);
        ok++;
        continue;
      }
      st().showToast(`「${f.name}」を読み込み中…`);
      const { asset, background } = await importFile(f);
      const s = st();
      s.update((p) => {
        p.assets.push(asset);
        if (opts.addToTimeline && (asset.kind === 'video' || asset.kind === 'image' || asset.kind === 'audio' || asset.kind === 'svg')) addAssetClip(p, asset, s.time);
      });
      void background.then(() => st().bump());
      ok++;
    } catch (e: any) {
      st().showToast(String(e?.message ?? e), 'error');
    }
  }
  if (ok) st().showToast(`${ok} 件の素材を追加しました`, 'ok');
}

export function addAssetClip(p: Project, asset: AssetMeta, t: number): Clip {
  const type: ClipType = asset.kind === 'audio' ? 'audio' : asset.kind === 'video' ? 'video' : 'image';
  const dur = type === 'image' ? 5 : Math.max(1 / p.fps, asset.duration ?? 5);
  const start = frameSnap(t, p.fps);
  const track = findFreeTrack(p, type === 'audio' ? 'audio' : 'visual', start, start + dur, undefined, undefined, 'bottom');
  const c = createClip(p, type, track.id, start, dur, { assetId: asset.id, name: asset.name });
  if (type !== 'audio' && asset.width && asset.height) {
    const s = fitScale(p, asset.width, asset.height);
    c.transform.scaleX = c.transform.scaleY = s;
  }
  p.clips.push(c);
  st().select([c.id]);
  return c;
}

export function addGenerated(type: ClipType, init?: (c: Clip, p: Project) => void, dur = 5) {
  const s = st();
  let id = '';
  s.update((p) => {
    const start = frameSnap(s.time, p.fps);
    const track = findFreeTrack(p, 'visual', start, start + dur);
    const c = createClip(p, type, track.id, start, dur);
    if (type === 'text') {
      c.text!.style.fontSize = Math.round(Math.min(p.width, p.height) * 0.08);
    }
    if (type === 'counter') c.counter!.style.fontSize = Math.round(Math.min(p.width, p.height) * 0.12);
    if (type === 'chart') {
      c.chart!.width = Math.round(p.width * 0.75);
      c.chart!.height = Math.round(Math.min(p.height * 0.45, p.width * 0.5));
    }
    init?.(c, p);
    p.clips.push(c);
    id = c.id;
  });
  s.select([id]);
  return id;
}

export function addText(content = 'テキストを入力') {
  const id = addGenerated('text', (c) => (c.text!.content = content));
  st().setPanel('text');
  return id;
}

export function addShape(kind: ShapeData['kind'], iconId?: string) {
  return addGenerated('shape', (c, p) => {
    const sz = Math.round(Math.min(p.width, p.height) * 0.3);
    c.shape = { ...defaultShape(kind), width: kind === 'line' || kind === 'arrow' ? sz * 1.6 : sz, height: kind === 'line' || kind === 'arrow' ? 40 : sz, iconId };
    if (kind === 'icon') c.shape.fill.color = '#ffffff';
    c.name = iconId ? 'アイコン' : '図形';
  });
}

export function addParticles(kind: Parameters<typeof defaultParticles>[0]) {
  return addGenerated('particles', (c, p) => {
    c.particles = defaultParticles(kind, p.width, p.height);
    c.name = { particles: 'パーティクル', confetti: '紙吹雪', sparks: '火花', snow: '雪', stars: '星', bokeh: 'ボケ', fireflies: '光の粒', rain: '雨' }[kind ?? 'particles'];
  });
}

export function addAdjustment() {
  return addGenerated('adjustment', (c) => {
    c.grade.enabled = true;
    c.name = '調整レイヤー';
  });
}

export function addCamera() {
  const id = addGenerated('camera', (c) => (c.name = '仮想カメラ'), 10);
  st().showToast('カメラは「3D レイヤー」をオンにしたクリップに作用します', 'info');
  return id;
}

export function selected(): Clip | undefined {
  const s = st();
  return s.project && s.selection[0] ? findClip(s.project, s.selection[0]) : undefined;
}

export function splitAtPlayhead() {
  const s = st();
  const p = s.project;
  if (!p) return;
  const t = frameSnap(s.time, p.fps);
  const targets = s.selection.length ? s.selection : p.clips.filter((c) => t > c.start && t < clipEnd(c)).map((c) => c.id);
  let did = 0;
  let newSel: string[] = [];
  s.update((d) => {
    for (const id of targets) {
      const r = splitClip(d, id, t);
      if (r) {
        did++;
        newSel = [r];
      }
    }
  });
  if (!did) s.showToast('再生ヘッドの位置にクリップがありません');
  else s.select(newSel);
}

export function deleteSelected(ripple = false) {
  const s = st();
  if (!s.selection.length) return;
  const ids = new Set(s.selection);
  s.update((p) => deleteClips(p, ids, ripple));
  s.select([]);
  s.setPanel(null);
}

export function duplicateSelected() {
  const s = st();
  const ids: string[] = [];
  s.update((p) => {
    for (const id of s.selection) {
      const n = duplicateClip(p, id);
      if (n) ids.push(n);
    }
  });
  if (ids.length) s.select(ids);
}

export function detachSelectedAudio() {
  const s = st();
  const c = selected();
  if (!c) return;
  let r: string | null = null;
  s.update((p) => (r = detachAudio(p, c.id)));
  s.showToast(r ? '音声を分離しました' : 'この素材には音声がありません', r ? 'ok' : 'info');
}

export function groupSelected() {
  const s = st();
  if (s.selection.length < 2) {
    const c = selected();
    if (c?.groupId) {
      s.update((p) => ungroup(p, c.groupId!));
      s.showToast('グループを解除しました');
    } else s.showToast('グループ化するには、長押しで複数のクリップを選択してください');
    return;
  }
  s.update((p) => groupClips(p, s.selection));
  s.showToast(`${s.selection.length} 個のクリップをグループ化しました`, 'ok');
}

export function closeTrackGaps() {
  const c = selected();
  if (!c) return;
  st().update((p) => closeGaps(p, c.trackId));
}

export function applyPreset(id: string) {
  const s = st();
  const pr = PRESETS.find((x) => x.id === id);
  if (!pr) return;
  if (pr.build) {
    s.update((p) => pr.build!(p, frameSnap(s.time, p.fps)));
    s.showToast(`テンプレート「${pr.name}」を追加しました`, 'ok');
    return;
  }
  const c = selected();
  if (!c) {
    if (pr.kind === 'text') {
      const nid = addText('テキストを入力');
      s.update((p) => {
        const nc = findClip(p, nid);
        if (nc) {
          const fs = nc.text!.style.fontSize;
          pr.apply!(nc, p);
          nc.text!.style.fontSize = Math.min(nc.text!.style.fontSize, fs * 1.2);
        }
      });
      return;
    }
    if (pr.kind === 'look' || pr.kind === 'effect') {
      const nid = addAdjustment();
      s.update((p) => {
        const nc = findClip(p, nid);
        if (nc) pr.apply!(nc, p);
      });
      s.showToast('調整レイヤーに適用しました (下のレイヤー全体に効きます)');
      return;
    }
    s.showToast('先にクリップを選択してください');
    return;
  }
  if (pr.kind === 'text' && c.type !== 'text' && c.type !== 'counter') {
    s.showToast('テロッププリセットはテキストに適用できます');
    return;
  }
  const before = JSON.stringify(c);
  let changed = false;
  s.update((p) => {
    const cc = findClip(p, c.id);
    if (cc) {
      pr.apply!(cc, p);
      changed = JSON.stringify(cc) !== before;
    }
  });
  if (changed) s.showToast(`「${pr.name}」を適用しました`, 'ok');
  else s.showToast(`「${pr.name}」はこの種類のクリップには適用できません`);
}

// ---- SRT ----
export async function importSRT(file: File) {
  const text = decodeText(await file.arrayBuffer());
  const cues = parseSRT(text);
  if (!cues.length) throw new Error('字幕を読み取れませんでした (SRT 形式を確認してください)');
  const s = st();
  s.update((p) => {
    const fs = Math.round(Math.min(p.width, p.height) * 0.05);
    const track = findFreeTrack(p, 'visual', cues[0].start, cues[cues.length - 1].end);
    track.name = '字幕';
    for (const cue of cues) {
      const c = createClip(p, 'text', track.id, cue.start, cue.end - cue.start, { name: cue.text.slice(0, 12) });
      c.text!.content = cue.text;
      c.text!.style.fontSize = fs;
      c.text!.style.fontWeight = 700;
      c.text!.style.strokes[0] = { enabled: true, color: '#000000', width: Math.round(fs * 0.12) };
      c.transform.y = p.height * 0.86;
      p.clips.push(c);
    }
  });
  s.showToast(`${cues.length} 件の字幕を読み込みました`, 'ok');
}

export function exportSRT(): string {
  const p = st().project!;
  const cues = p.clips
    .filter((c) => c.type === 'text' && c.text?.content.trim())
    .sort((a, b) => a.start - b.start)
    .map((c) => ({ start: c.start, end: clipEnd(c), text: c.text!.content }));
  return buildSRT(cues);
}

export async function downloadBlob(blob: Blob, name: string): Promise<boolean> {
  const r = await saveFile(blob, name);
  if (r.message) st().showToast(r.message, 'error');
  return r.ok;
}

export function addEffectToSelected(type: Parameters<typeof createEffect>[0]) {
  const c = selected();
  if (!c) return;
  st().update((p) => {
    const cc = findClip(p, c.id);
    cc?.effects.push(createEffect(type));
  });
}

// ---- ナレーション録音 ----
export class NarrationRecorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;
  startedAt = 0;
  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m));
    this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.chunks = [];
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start(500);
    this.startedAt = performance.now();
  }
  async stop(): Promise<Blob> {
    const rec = this.rec!;
    await new Promise<void>((r) => {
      rec.onstop = () => r();
      rec.stop();
    });
    this.stream?.getTracks().forEach((t) => t.stop());
    return new Blob(this.chunks, { type: rec.mimeType || 'audio/mp4' });
  }
  cancel() {
    try {
      this.rec?.stop();
    } catch {
      /* */
    }
    this.stream?.getTracks().forEach((t) => t.stop());
  }
}

export async function addRecording(blob: Blob, at: number) {
  const ext = blob.type.includes('mp4') ? 'm4a' : 'webm';
  const file = new File([blob], `ナレーション_${new Date().toLocaleTimeString('ja-JP').replace(/:/g, '')}.${ext}`, { type: blob.type });
  const { asset, background } = await importFile(file);
  const s = st();
  s.update((p) => {
    p.assets.push(asset);
    const dur = asset.duration && Number.isFinite(asset.duration) ? asset.duration : 1;
    const track = findFreeTrack(p, 'audio', at, at + dur);
    const c = createClip(p, 'audio', track.id, at, dur, { assetId: asset.id, name: 'ナレーション' });
    p.clips.push(c);
  });
  void background.then(() => st().bump());
}
