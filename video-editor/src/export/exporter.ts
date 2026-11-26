// 動画書き出し。プレビューと同じ Compositor を元素材・出力解像度で使い、WebCodecs (H.264 + AAC) で MP4 にする。
import type { Project } from '../model/types';
import { Compositor } from '../render/compositor';
import { ExportFrameSource } from '../media/video';
import { decodeAll, renderAudioChunk, scheduleMix } from '../media/audio';
import { ensureFontAsset, imageFor } from '../media/registry';
import { projectDuration } from '../model/ops';
import { fontString } from '../render/text';
import { ensureWebFont } from '../render/fonts';
import { PreviewVideoPool } from '../media/video';

export interface ExportSettings {
  width: number;
  height: number;
  fps: number;
  videoBitrate: number;
  audioBitrate: number;
  from: number;
  to: number;
  fileName: string;
  /** 'webcodecs' (推奨) / 'realtime' (MediaRecorder 録画, 非対応端末向け) */
  engine: 'webcodecs' | 'realtime';
}

export interface ExportProgress {
  phase: 'prepare' | 'audio' | 'video' | 'finalize' | 'done' | 'error';
  progress: number;
  frame: number;
  totalFrames: number;
  fpsRate: number;
  etaSec: number;
  message: string;
}

export interface ExportResult {
  blob: Blob;
  fileName: string;
  mime: string;
  warnings: string[];
  seconds: number;
}

async function prepareAssets(p: Project, onMsg: (m: string) => void, maxDim: number) {
  onMsg('フォントを読み込み中…');
  for (const a of p.assets) if (a.kind === 'font') await ensureFontAsset(a).catch(() => {});
  const fontLoads: Promise<unknown>[] = [];
  for (const c of p.clips) {
    const st = c.type === 'text' ? c.text?.style : c.type === 'counter' ? c.counter?.style : null;
    if (!st) continue;
    await ensureWebFont(st.fontFamily);
    const txt = c.type === 'text' ? c.text!.content : '0123456789,.:-' + c.counter!.prefix + c.counter!.suffix;
    fontLoads.push(document.fonts.load(fontString(st, 48), txt || 'あ').catch(() => {}));
  }
  await Promise.all(fontLoads);
  await document.fonts.ready;
  onMsg('画像を読み込み中…');
  const used = new Set(p.clips.filter((c) => c.type === 'image').map((c) => c.assetId));
  for (const a of p.assets) if (used.has(a.id)) await imageFor(a, maxDim);
}

async function createTarget(useOpfs: boolean, warnings: string[]) {
  const mb = await import('mediabunny');
  if (useOpfs) {
    try {
      const root = await navigator.storage.getDirectory();
      const name = 'export-' + Date.now() + '.mp4';
      // 以前の書き出しファイルを掃除
      for await (const [n] of (root as any).entries()) if (String(n).startsWith('export-')) await root.removeEntry(n).catch(() => {});
      const fh = await root.getFileHandle(name, { create: true });
      const writable = await (fh as any).createWritable();
      return {
        target: new mb.StreamTarget(writable, { chunked: true, chunkSize: 8 * 1024 * 1024 }),
        fastStart: false as const,
        getBlob: async () => fh.getFile() as Promise<Blob>,
      };
    } catch (e) {
      warnings.push('端末ストレージへの直接書き込みに失敗したため、メモリ上で書き出します');
      console.warn(e);
    }
  }
  const target = new mb.BufferTarget();
  return { target, fastStart: 'in-memory' as const, getBlob: async () => new Blob([target.buffer!], { type: 'video/mp4' }) };
}

export async function exportVideo(p: Project, s: ExportSettings, onProgress: (pr: ExportProgress) => void, signal: AbortSignal): Promise<ExportResult> {
  if (s.engine === 'realtime') return exportRealtime(p, s, onProgress, signal);
  const t0 = performance.now();
  const warnings: string[] = [];
  const mb = await import('mediabunny');
  const from = Math.max(0, s.from);
  const to = Math.min(projectDuration(p), s.to);
  const dur = to - from;
  if (dur <= 0) throw new Error('書き出す範囲に素材がありません');
  const totalFrames = Math.max(1, Math.round(dur * s.fps));
  const report = (phase: ExportProgress['phase'], progress: number, frame: number, message: string, fpsRate = 0, etaSec = 0) =>
    onProgress({ phase, progress, frame, totalFrames, fpsRate, etaSec, message });

  report('prepare', 0, 0, '準備中…');
  const scale = s.width / p.width;
  await prepareAssets(p, (m) => report('prepare', 0, 0, m), Math.max(s.width, s.height) * 2);
  if (signal.aborted) throw new DOMException('キャンセルしました', 'AbortError');

  // 音声コーデックの確認 (ブラウザが AAC を符号化できない場合は WASM エンコーダを使用)
  let hasAudio = p.clips.some((c) => (c.type === 'audio' || c.type === 'video') && !c.audio.muted);
  if (hasAudio && !(await mb.canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000, bitrate: s.audioBitrate }))) {
    report('prepare', 0, 0, 'AAC エンコーダを読み込み中…');
    try {
      const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
      registerAacEncoder();
      warnings.push('この端末は AAC のハードウェア符号化に非対応のため、ソフトウェア符号化を使用しました');
    } catch (e) {
      console.warn(e);
      hasAudio = false;
      warnings.push('AAC 音声を符号化できないため、音声なしで書き出しました');
    }
  }
  let buffers = new Map<string, AudioBuffer>();
  if (hasAudio) {
    report('audio', 0, 0, '音声をデコード中…');
    buffers = await decodeAll(p, (d, n) => report('audio', d / Math.max(1, n), 0, `音声をデコード中… (${d}/${n})`));
    if (buffers.size === 0) hasAudio = false;
  }

  const canvas = document.createElement('canvas');
  const comp = new Compositor(canvas, { preserve: true });
  comp.setSize(s.width, s.height);
  const frames = new ExportFrameSource(true);
  const useOpfs = dur > 45;
  const { target, fastStart, getBlob } = await createTarget(useOpfs, warnings);
  const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart }), target });
  const videoSource = new mb.CanvasSource(canvas, {
    codec: 'avc',
    bitrate: s.videoBitrate,
    keyFrameInterval: 2,
    latencyMode: 'quality',
  } as any);
  output.addVideoTrack(videoSource, { frameRate: s.fps });
  let audioSource: InstanceType<typeof mb.AudioBufferSource> | null = null;
  if (hasAudio) {
    audioSource = new mb.AudioBufferSource({ codec: 'aac', bitrate: s.audioBitrate });
    output.addAudioTrack(audioSource);
  }
  const abortHandler = () => void output.cancel().catch(() => {});
  signal.addEventListener('abort', abortHandler);
  try {
    await output.start();
    const CHUNK = 10; // 秒
    let missingFrames = 0;
    const missingNames = new Set<string>();
    let audioDone = 0;
    const tStart = performance.now();
    for (let i = 0; i < totalFrames; i++) {
      if (signal.aborted) throw new DOMException('キャンセルしました', 'AbortError');
      const t = from + i / s.fps;
      // 音声は映像に先行して 10 秒単位で追加 (メモリ節約)
      if (audioSource && audioDone < dur && t - from + 1 / s.fps > audioDone - 0.5) {
        const len = Math.min(CHUNK, dur - audioDone);
        const buf = await renderAudioChunk(p, buffers, from + audioDone, len, 48000);
        await audioSource.add(buf);
        audioDone += len;
      }
      const needs = Compositor.videoNeeds(p, t);
      await frames.prefetch(needs);
      if (i % 30 === 0) frames.releaseUnused(new Set(needs.map((n) => n.clip.id)));
      let res = comp.render(p, t, frames, { scale, imageMaxDim: Math.max(s.width, s.height) * 2, frame: i, final: true });
      // 未準備の素材 (フォント等) があれば少し待って再描画
      for (let retry = 0; res.incomplete && retry < 40; retry++) {
        await new Promise((r) => setTimeout(r, 50));
        await frames.prefetch(needs);
        res = comp.render(p, t, frames, { scale, imageMaxDim: Math.max(s.width, s.height) * 2, frame: i, final: true });
      }
      if (res.incomplete) {
        missingFrames++;
        for (const m of res.missing) missingNames.add(m);
        console.warn('export: incomplete frame', i, t.toFixed(3), res.missing);
      }
      await videoSource.add(i / s.fps, 1 / s.fps);
      if (i % 3 === 0 || i === totalFrames - 1) {
        const el = (performance.now() - tStart) / 1000;
        const rate = (i + 1) / Math.max(0.001, el);
        report('video', (i + 1) / totalFrames, i + 1, `映像を書き出し中… ${i + 1}/${totalFrames} フレーム`, rate, (totalFrames - i - 1) / Math.max(0.01, rate));
      }
    }
    while (audioSource && audioDone < dur - 1e-6) {
      const len = Math.min(CHUNK, dur - audioDone);
      await audioSource.add(await renderAudioChunk(p, buffers, from + audioDone, len, 48000));
      audioDone += len;
    }
    report('finalize', 1, totalFrames, 'ファイルを仕上げ中…');
    videoSource.close();
    audioSource?.close();
    await output.finalize();
    const blob = await getBlob();
    if (missingFrames) warnings.push(`${missingFrames} フレームで素材を読み込めず、一部のレイヤーが描画されませんでした (${[...missingNames].slice(0, 4).join('、')})`);
    if (frames.usedFallback) warnings.push('一部の動画はフレーム単位シーク方式でデコードしました (時間がかかります)');
    report('done', 1, totalFrames, '完了');
    return { blob: blob.type ? blob : new Blob([blob], { type: 'video/mp4' }), fileName: s.fileName, mime: 'video/mp4', warnings, seconds: (performance.now() - t0) / 1000 };
  } catch (e) {
    if (output.state !== 'canceled' && output.state !== 'finalized') await output.cancel().catch(() => {});
    throw e;
  } finally {
    signal.removeEventListener('abort', abortHandler);
    frames.dispose();
    comp.dispose();
    canvas.width = canvas.height = 1;
  }
}

/** WebCodecs 非対応端末用: 実時間で再生しながら MediaRecorder で録画する */
async function exportRealtime(p: Project, s: ExportSettings, onProgress: (pr: ExportProgress) => void, signal: AbortSignal): Promise<ExportResult> {
  const warnings = ['この端末は WebCodecs に非対応のため、実時間録画方式で書き出しています。録画中は画面を閉じないでください。フレーム落ちが発生する場合があります。'];
  const t0 = performance.now();
  const from = Math.max(0, s.from);
  const to = Math.min(projectDuration(p), s.to);
  const dur = to - from;
  const totalFrames = Math.round(dur * s.fps);
  await prepareAssets(p, () => {}, Math.max(s.width, s.height) * 2);
  const buffers = await decodeAll(p);
  const canvas = document.createElement('canvas');
  const comp = new Compositor(canvas, { preserve: false });
  comp.setSize(s.width, s.height);
  const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
  const actx = new AC();
  const dest = actx.createMediaStreamDestination();
  const stream = (canvas as any).captureStream(s.fps) as MediaStream;
  for (const tr of dest.stream.getAudioTracks()) stream.addTrack(tr);
  const mime = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
  const rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: s.videoBitrate, audioBitsPerSecond: s.audioBitrate });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  let rerender = false;
  const pool = new PreviewVideoPool(() => (rerender = true));
  // 先読み
  for (const n of Compositor.videoNeeds(p, from)) pool.preload(n.clip, n.asset, n.srcTime);
  await new Promise((r) => setTimeout(r, 800));
  await actx.resume();
  const startCtx = actx.currentTime + 0.2;
  const mix = scheduleMix(actx, dest, p, buffers, from, to, startCtx);
  rec.start(1000);
  try {
    await new Promise<void>((resolve, reject) => {
      const tick = () => {
        if (signal.aborted) return reject(new DOMException('キャンセルしました', 'AbortError'));
        const t = from + Math.max(0, actx.currentTime - startCtx);
        if (t >= to) return resolve();
        const active = Compositor.videoNeeds(p, t);
        pool.sync(active, true, s.fps);
        comp.render(p, t, pool, { scale: s.width / p.width, imageMaxDim: Math.max(s.width, s.height) * 2, frame: Math.round(t * s.fps), final: true });
        rerender = false;
        onProgress({ phase: 'video', progress: (t - from) / dur, frame: Math.round((t - from) * s.fps), totalFrames, fpsRate: s.fps, etaSec: to - t, message: '実時間録画中…' });
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  } finally {
    mix.stop();
    pool.dispose();
    void rerender;
  }
  await new Promise<void>((r) => {
    rec.onstop = () => r();
    rec.stop();
  });
  await actx.close();
  comp.dispose();
  const type = rec.mimeType || mime || 'video/webm';
  const ext = type.includes('mp4') ? 'mp4' : 'webm';
  if (ext !== 'mp4') warnings.push('この端末は MP4 録画に非対応のため WebM で保存しました');
  onProgress({ phase: 'done', progress: 1, frame: totalFrames, totalFrames, fpsRate: 0, etaSec: 0, message: '完了' });
  return { blob: new Blob(chunks, { type }), fileName: s.fileName.replace(/\.mp4$/, '.' + ext), mime: type, warnings, seconds: (performance.now() - t0) / 1000 };
}
