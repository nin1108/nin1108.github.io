// 完成判定テスト (E2E)。実ブラウザ (Playwright Chromium) でアプリを操作し、書き出した MP4 を ffprobe/ffmpeg で検証する。
// 使い方: npm run build && npx vite preview --port 4173 & node tests/e2e/run.mjs [--long]
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require(join(execFileSync('npm', ['root', '-g']).toString().trim(), 'playwright'));
}
const { chromium, devices } = playwright;

const here = dirname(fileURLToPath(import.meta.url));
const MEDIA = join(here, '.media');
const OUT = join(here, '.out');
mkdirSync(MEDIA, { recursive: true });
mkdirSync(OUT, { recursive: true });
const URL_BASE = process.env.APP_URL ?? 'http://localhost:4173/';
const LONG = process.argv.includes('--long');
// --quick: 書き出しを 720p30 にして短時間で確認する
const QUICK = process.argv.includes('--quick');
// --long15: 15 分・1080p30 の横型動画 (区間デコード・逐次書き込みの検証)
const LONG15 = process.argv.includes('--long15');
const EXP = QUICK ? { res: '720p', fps: 30, w: 720, h: 1280 } : { res: '1080p', fps: 60, w: 1080, h: 1920 };

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

function ff(args) {
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
}

function genMedia() {
  const f = (n) => join(MEDIA, n);
  if (!existsSync(f('video_v.mp4')))
    ff(['-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30:duration=12', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=12', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-shortest', f('video_v.mp4')]);
  if (!existsSync(f('greenscreen.mp4')))
    ff(['-f', 'lavfi', '-i', 'color=c=0x00ff00:size=720x1280:rate=30:duration=6', '-f', 'lavfi', '-i', 'testsrc=size=400x400:rate=30:duration=6', '-filter_complex', '[0][1]overlay=160:440', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-an', f('greenscreen.mp4')]);
  if (!existsSync(f('photo.png'))) ff(['-f', 'lavfi', '-i', 'testsrc=size=1600x1200', '-frames:v', '1', f('photo.png')]);
  if (!existsSync(f('bgm.mp3'))) ff(['-f', 'lavfi', '-i', 'aevalsrc=0.25*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*2*t))|0.25*sin(2*PI*330*t):s=48000:d=34', '-c:a', 'libmp3lame', '-b:a', '192k', f('bgm.mp3')]);
  if (!existsSync(f('se.wav'))) ff(['-f', 'lavfi', '-i', 'aevalsrc=0.8*sin(2*PI*1200*t)*exp(-8*t):s=48000:d=0.6', f('se.wav')]);
  if (!existsSync(f('subs.srt'))) writeFileSync(f('subs.srt'), '1\n00:00:01,000 --> 00:00:03,500\nこんにちは、字幕テストです\n\n2\n00:00:04,000 --> 00:00:06,000\n二行目の\n字幕です\n');
  if (LONG && !existsSync(f('long_h.mp4')))
    ff(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=500', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=500', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', f('long_h.mp4')]);
  if (LONG15 && !existsSync(f('long15.mp4')))
    // 60 秒ごとに 1kHz のビープ (音ズレ確認用) を入れた 15 分の 1080p 動画
    ff(['-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=30:duration=900', '-f', 'lavfi', '-i', "aevalsrc='0.2*sin(2*PI*300*t)+0.7*sin(2*PI*1000*t)*lt(mod(t,60),0.15)':s=48000:d=900", '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '32', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-shortest', f('long15.mp4')]);
  if (LONG15 && !existsSync(f('bgm15.mp3'))) ff(['-f', 'lavfi', '-i', 'aevalsrc=0.15*sin(2*PI*180*t):s=48000:d=900', '-c:a', 'libmp3lame', '-b:a', '128k', f('bgm15.mp3')]);
  return f;
}

async function waitFor(page, fn, arg, timeout = 60000) {
  return page.waitForFunction(fn, arg, { timeout, polling: 200 });
}

async function exportAndSave(page, name, opts) {
  // 書き出しパネルを UI から開いて操作する
  await page.evaluate(() => window.__MVE__.store.useStore.getState().setPanel('export'));
  await page.getByRole('button', { name: new RegExp('^' + opts.res) }).first().click();
  await page.getByRole('button', { name: `${opts.fps}fps`, exact: true }).click();
  await page.getByRole('button', { name: '書き出し開始' }).click();
  const t0 = Date.now();
  let last = '';
  for (;;) {
    await page.waitForTimeout(2000);
    const state = await page.evaluate(() => ({
      info: [...document.querySelectorAll('.export-progress .row-info')].map((e) => e.textContent).join(' '),
      done: !!document.querySelector('.result-video'),
      err: [...document.querySelectorAll('.warn')].map((e) => e.textContent).join(' | '),
    }));
    if (state.info !== last) {
      last = state.info;
      process.stdout.write(`   … ${state.info.slice(0, 90)}\r`);
    }
    if (state.done) {
      await opts.onDone?.();
      break;
    }
    if (/失敗|キャンセル/.test(state.err)) throw new Error(state.err);
    if (Date.now() - t0 > (opts.timeout ?? 40 * 60 * 1000)) throw new Error('export timeout');
  }
  console.log('');
  // 書き出した動画を 16MB ずつ取り出す (大きな文字列を作らない)
  const size = await page.evaluate(async () => {
    const v = document.querySelector('.result-video');
    window.__E2E_BLOB__ = await (await fetch(v.src)).blob();
    return window.__E2E_BLOB__.size;
  });
  const path = join(OUT, name);
  writeFileSync(path, Buffer.alloc(0));
  for (let off = 0; off < size; off += 16 * 1024 * 1024) {
    const b64 = await page.evaluate(async (off) => {
      const buf = new Uint8Array(await window.__E2E_BLOB__.slice(off, off + 16 * 1024 * 1024).arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    }, off);
    appendFileSync(path, Buffer.from(b64, 'base64'));
  }
  await page.evaluate(() => (window.__E2E_BLOB__ = null));
  const warnings = await page.evaluate(() => [...document.querySelectorAll('.export-result .warn')].map((e) => e.textContent));
  return { path, seconds: (Date.now() - t0) / 1000, warnings };
}

function probe(path) {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path]).toString());
  return j;
}

function decodeErrors(path) {
  try {
    const out = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'null', '-'], { stderr: 'pipe' }).toString();
    return out.trim();
  } catch (e) {
    return String(e.stderr ?? e.message);
  }
}

/** 指定時刻の平均音量 (dB) */
function volumeAt(path, t, d = 0.2) {
  try {
    const out = execFileSync('ffmpeg', ['-v', 'info', '-ss', String(t), '-t', String(d), '-i', path, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
    return out.toString();
  } catch (e) {
    const s = String(e.stderr ?? '');
    const m = s.match(/max_volume: (-?[\d.]+) dB/);
    return m ? Number(m[1]) : NaN;
  }
}
function maxVolume(path, t, d = 0.2) {
  const r = execFileSync('sh', ['-c', `ffmpeg -v info -ss ${t} -t ${d} -i "${path}" -af volumedetect -vn -f null - 2>&1 | grep max_volume || true`]).toString();
  const m = r.match(/max_volume: (-?[\d.]+) dB/);
  return m ? Number(m[1]) : -Infinity;
}

async function main() {
  const f = genMedia();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'], userAgent: devices['Pixel 7'].userAgent });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    if (m.text().startsWith('export: incomplete')) console.log('   [diag]', m.text());
  });
  await page.goto(URL_BASE);
  await waitFor(page, () => !!window.__MVE__);

  // ---- 1. 30 秒の縦型プロジェクトを作成 (UI 操作) ----
  await page.getByRole('button', { name: '新規プロジェクト' }).click();
  await page.getByPlaceholder('無題のプロジェクト').fill('E2E 縦型テスト');
  await page.getByRole('button', { name: /9:16/ }).click();
  await page.getByRole('button', { name: '60 fps' }).click();
  await page.getByRole('button', { name: '作成' }).click();
  await waitFor(page, () => !!window.__MVE__.store.useStore.getState().project);
  const p0 = await page.evaluate(() => {
    const p = window.__MVE__.store.useStore.getState().project;
    return { w: p.width, h: p.height, fps: p.fps };
  });
  check('縦型 1080x1920 60fps プロジェクト作成', p0.w === 1080 && p0.h === 1920 && p0.fps === 60, JSON.stringify(p0));

  // ---- 2. 素材の読み込み (UI のファイル選択) ----
  await page.getByRole('button', { name: '追加' }).click();
  await page.locator('input[type=file][multiple]').setInputFiles([f('video_v.mp4'), f('photo.png'), f('bgm.mp3'), f('greenscreen.mp4')]);
  await waitFor(page, () => window.__MVE__.store.useStore.getState().project.assets.length >= 4, null, 90000);
  const assets = await page.evaluate(() => window.__MVE__.store.useStore.getState().project.assets.map((a) => ({ kind: a.kind, d: a.duration, w: a.width, hasAudio: a.hasAudio })));
  check('動画・画像・音声の読み込み', assets.some((a) => a.kind === 'video' && a.hasAudio) && assets.some((a) => a.kind === 'image') && assets.some((a) => a.kind === 'audio'), JSON.stringify(assets));
  // 不正ファイル
  writeFileSync(join(MEDIA, 'broken.mp4'), Buffer.from('this is not a video file at all'));
  await page.evaluate(() => window.__MVE__.store.useStore.getState().setPanel('add'));
  await page.locator('input[type=file][multiple]').setInputFiles([join(MEDIA, 'broken.mp4')]);
  await page.waitForTimeout(1500);
  const afterBroken = await page.evaluate(() => window.__MVE__.store.useStore.getState().project.assets.length);
  check('不正なファイルの拒否', afterBroken === 4, `assets=${afterBroken}`);

  // ---- 3〜5. 構成 (テキスト・図形・キーフレーム・エフェクト・パーティクル・効果音) ----
  await page.locator('input[type=file][multiple]').setInputFiles([f('se.wav'), f('subs.srt')]);
  await waitFor(page, () => window.__MVE__.store.useStore.getState().project.assets.length >= 5);
  await page.evaluate(() => {
    const { store, defaults } = window.__MVE__;
    const S = store.useStore.getState();
    S.update((p) => {
      const byKind = (k) => p.clips.filter((c) => c.type === k);
      const video = p.clips.find((c) => c.type === 'video' && p.assets.find((a) => a.id === c.assetId)?.name === 'video_v.mp4');
      const green = p.clips.find((c) => c.type === 'video' && p.assets.find((a) => a.id === c.assetId)?.name === 'greenscreen.mp4');
      const img = byKind('image')[0];
      const bgm = p.clips.find((c) => c.type === 'audio' && p.assets.find((a) => a.id === c.assetId)?.name === 'bgm.mp3');
      const se = p.clips.find((c) => c.type === 'audio' && p.assets.find((a) => a.id === c.assetId)?.name === 'se.wav');
      const vTrack = video.trackId;
      // 動画 0-12s → 画像 12-20s (クロスフェード) → 調整レイヤーで締め
      video.start = 0;
      img.trackId = vTrack;
      img.start = 12;
      img.duration = 18;
      img.transitionIn = { type: 'crossfade', duration: 1, ease: { kind: 'easeInOut' } };
      img.keyframes['transform.scaleX'] = [
        { id: 'k1', t: 0, v: img.transform.scaleX, ease: { kind: 'linear' } },
        { id: 'k2', t: 18, v: img.transform.scaleX * 1.2, ease: { kind: 'linear' } },
      ];
      img.keyframes['transform.scaleY'] = JSON.parse(JSON.stringify(img.keyframes['transform.scaleX']));
      // クロマキー合成
      green.start = 2;
      green.transform.scaleX = green.transform.scaleY = 60;
      green.transform.x = 760;
      green.transform.y = 1400;
      green.effects.push(defaults.createEffect('chromaKey', { color: '#00ff00' }));
      // BGM 30s フェード
      bgm.start = 0;
      bgm.duration = 30;
      bgm.audio.fadeIn = 1;
      bgm.audio.fadeOut = 2;
      bgm.audio.volume = 0.6;
      // 効果音を 5.0 秒と 15.0 秒に
      se.start = 5;
      const se2 = JSON.parse(JSON.stringify(se));
      se2.id = 'se2';
      se2.start = 15;
      p.clips.push(se2);
      // テキスト (キーフレーム + グロー + モーションブラー)
      const tt = p.tracks.find((t) => t.name === 'テキスト');
      const txt = defaults.createClip(p, 'text', tt.id, 0.5, 9);
      txt.text.content = '宇宙の謎に迫る';
      txt.text.style.fontSize = 120;
      txt.text.style.glow = { enabled: true, color: '#00e5ff', blur: 30, strength: 1 };
      txt.text.anims = [{ kind: 'popIn', duration: 0.4, stagger: 0.05, order: 'forward', amount: 1, mode: 'in', ease: { kind: 'easeOut' } }];
      txt.transform.y = 500;
      txt.keyframes['transform.x'] = [
        { id: 'a', t: 0, v: -400, ease: { kind: 'easeOut' } },
        { id: 'b', t: 1, v: 540, ease: { kind: 'linear' } },
        { id: 'c', t: 8, v: 540, ease: { kind: 'easeIn' } },
        { id: 'd', t: 9, v: 1500, ease: { kind: 'linear' } },
      ];
      txt.keyframes['transform.rotation'] = [
        { id: 'r1', t: 0, v: -30, ease: { kind: 'spring' } },
        { id: 'r2', t: 1.2, v: 0, ease: { kind: 'linear' } },
      ];
      txt.motionBlur = { enabled: true, shutterAngle: 360, samples: 12 };
      txt.effects.push(defaults.createEffect('glow', { radius: 30, intensity: 1.5, threshold: 0.3 }));
      p.clips.push(txt);
      // 図形 (円形ゲージ + 線の描画)
      const ring = defaults.createClip(p, 'shape', tt.id, 12, 8);
      ring.shape = { ...defaults.defaultShape('ring'), width: 500, height: 500, progress: 80, thickness: 50 };
      ring.keyframes['shape.progress'] = [
        { id: 'p1', t: 0, v: 0, ease: { kind: 'easeOut' } },
        { id: 'p2', t: 3, v: 80, ease: { kind: 'linear' } },
      ];
      ring.transform.y = 900;
      p.clips.push(ring);
      // パーティクル (光の粒 + 紙吹雪)
      const v3 = defaults.createTrack('visual', 'FX');
      p.tracks.splice(p.tracks.map((t) => t.kind).lastIndexOf('visual') + 1, 0, v3);
      const pt = defaults.createClip(p, 'particles', v3.id, 0, 30);
      pt.particles = defaults.defaultParticles('fireflies', p.width, p.height);
      pt.transform.x = 540;
      pt.transform.y = 960;
      p.clips.push(pt);
    });
  });
  // 調整レイヤーは UI のプリセットから追加 (選択解除 → カラールック → 調整レイヤーとして追加)
  await page.evaluate(() => window.__MVE__.store.useStore.getState().select([]));
  await page.evaluate(() => window.__MVE__.actions.applyPreset('l-teal-orange'));
  await page.evaluate(() => {
    const S = window.__MVE__.store.useStore.getState();
    S.update((p) => {
      const adj = p.clips.find((c) => c.type === 'adjustment');
      adj.start = 0;
      adj.duration = 30;
    });
  });
  // 分割・Undo・Redo の確認
  const before = await page.evaluate(() => window.__MVE__.store.useStore.getState().project.clips.length);
  await page.evaluate(() => {
    const S = window.__MVE__.store.useStore.getState();
    const v = S.project.clips.find((c) => c.type === 'video');
    S.select([v.id]);
    S.setTime(6);
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__MVE__.actions.splitAtPlayhead());
  const afterSplit = await page.evaluate(() => window.__MVE__.store.useStore.getState().project.clips.length);
  await page.getByRole('button', { name: '元に戻す' }).click();
  const afterUndo = await page.evaluate(() => window.__MVE__.store.useStore.getState().project.clips.length);
  await page.getByRole('button', { name: 'やり直す' }).click();
  const afterRedo = await page.evaluate(() => window.__MVE__.store.useStore.getState().project.clips.length);
  check('分割・Undo・Redo', afterSplit === before + 1 && afterUndo === before && afterRedo === before + 1, `${before}→${afterSplit}→${afterUndo}→${afterRedo}`);
  const dur = await page.evaluate(() => {
    const p = window.__MVE__.store.useStore.getState().project;
    return Math.max(...p.clips.map((c) => c.start + c.duration));
  });
  check('30 秒の長さ', Math.abs(dur - 30) < 0.05, `${dur.toFixed(2)}s`);
  const kfCount = await page.evaluate(() => window.__MVE__.store.useStore.getState().project.clips.reduce((n, c) => n + Object.values(c.keyframes).flat().length, 0));
  check('複数のキーフレーム', kfCount >= 8, `${kfCount} 個`);

  // プレビューのスクリーンショット
  for (const t of [0.6, 5, 12.5, 16]) {
    await page.evaluate((t) => {
      const S = window.__MVE__.store.useStore.getState();
      S.select([]);
      S.setPanel(null);
      S.setTime(t);
    }, t);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(OUT, `preview_${t}.png`) });
  }
  // 再生テスト (プレビューのフレームレート)
  await page.evaluate(() => window.__MVE__.store.useStore.getState().setTime(0));
  await page.evaluate(() => window.__MVE__.engine.togglePlay());
  await page.waitForTimeout(3000);
  const playT = await page.evaluate(() => window.__MVE__.store.useStore.getState().time);
  const pfps = await page.evaluate(() => window.__MVE__.engine.fpsMeter.value);
  await page.evaluate(() => window.__MVE__.engine.togglePlay());
  check('プレビュー再生 (時計が進む)', playT > 2 && playT < 4, `3秒後 t=${playT.toFixed(2)}s, プレビュー ${pfps}fps (ソフトウェアGL)`);

  // ---- 6〜7. 1080p 60fps で書き出し ----
  await page.evaluate(() => window.__MVE__.store.useStore.getState().select([]));
  if (QUICK) {
    // 端末ストレージ (OPFS) が使えない環境を想定し、IndexedDB への分割保存経路で書き出す
    await page.evaluate(() => Object.assign(window.__MVE__.targetDebug, { disable: ['opfs', 'opfs-worker'], memoryMax: 0 }));
  }
  const ex = await exportAndSave(page, `e2e_vertical_${EXP.res}${EXP.fps}.mp4`, { res: EXP.res, fps: EXP.fps });
  const pr = probe(ex.path);
  const v = pr.streams.find((s) => s.codec_type === 'video');
  const a = pr.streams.find((s) => s.codec_type === 'audio');
  check(`MP4 書き出し (H.264 ${EXP.w}x${EXP.h} ${EXP.fps}fps)`, v?.codec_name === 'h264' && v.width === EXP.w && v.height === EXP.h && new RegExp(`^${EXP.fps}(/1)?$`).test(v.r_frame_rate), `${v?.codec_name} ${v?.width}x${v?.height} ${v?.r_frame_rate} (${ex.seconds.toFixed(0)}秒)`);
  check('AAC 音声トラック', a?.codec_name === 'aac' && Number(a.sample_rate) === 48000, `${a?.codec_name} ${a?.sample_rate}Hz ${a?.channels}ch`);
  check('動画の長さ', Math.abs(Number(pr.format.duration) - 30) < 0.1, `${pr.format.duration}s`);
  const nb = Number(v?.nb_frames);
  check(`フレーム数 (${EXP.fps}fps × 30秒 = ${EXP.fps * 30})`, Math.abs(nb - EXP.fps * 30) <= 1, String(nb));
  check('書き出しで全レイヤーを描画 (素材の読み込み漏れなし)', !ex.warnings.some((w) => w.includes('読み込めず')), ex.warnings.join(' / '));
  const derr = decodeErrors(ex.path);
  check('MP4 が正常にデコードできる (ffmpeg)', derr === '', derr.slice(0, 200));
  // 音声同期: 効果音 (1200Hz) が 5.0s と 15.0s に存在し、直前は静か
  const hp = (t) => Number(execFileSync('sh', ['-c', `ffmpeg -v info -ss ${t} -t 0.12 -i "${ex.path}" -af highpass=f=900,volumedetect -vn -f null - 2>&1 | grep max_volume || true`]).toString().match(/max_volume: (-?[\d.]+)/)?.[1] ?? -99);
  const se1 = hp(5.0), pre1 = hp(4.75), se2v = hp(15.0), pre2 = hp(14.75);
  check('効果音の同期 (5.0秒/15.0秒)', se1 > pre1 + 12 && se2v > pre2 + 12, `5.0s: ${se1}dB (直前 ${pre1}dB), 15.0s: ${se2v}dB (直前 ${pre2}dB)`);
  check('BGM のフェードイン', maxVolume(ex.path, 0, 0.1) < maxVolume(ex.path, 2, 0.5) - 6, `0s ${maxVolume(ex.path, 0, 0.1)}dB / 2s ${maxVolume(ex.path, 2, 0.5)}dB`);
  if (ex.warnings.length) console.log('   書き出し警告:', ex.warnings.join(' / '));
  if (QUICK) {
    const kind = await page.evaluate(() => window.__MVE_LAST_EXPORT__?.targetKind);
    check('IndexedDB 分割保存での書き出し', kind === 'idb', String(kind));
    await page.evaluate(() => Object.assign(window.__MVE__.targetDebug, { disable: [], memoryMax: 60 * 1024 * 1024 }));
  }
  for (const t of [0.6, 5, 12.5, 16]) ff(['-ss', String(t), '-i', ex.path, '-frames:v', '1', join(OUT, `export_${t}.png`)]);

  // プレビューと書き出しの一致: 同じ時刻の書き出しフレームと、アプリのレンダラーで描いたフレームを比較
  const diff = await page.evaluate(async () => {
    const { Compositor, ExportFrameSource, store } = window.__MVE__;
    const p = store.useStore.getState().project;
    const c = document.createElement('canvas');
    const comp = new Compositor(c, { preserve: true });
    comp.setSize(270, 480);
    const src = new ExportFrameSource(true);
    const out = {};
    for (const t of [5, 16]) {
      await src.prefetch(Compositor.videoNeeds(p, t));
      for (let i = 0; i < 20; i++) {
        const r = comp.render(p, t, src, { scale: 0.25, imageMaxDim: 4096, frame: i, final: true });
        if (!r.incomplete) break;
        await new Promise((r2) => setTimeout(r2, 100));
      }
      out[t] = c.toDataURL('image/png');
    }
    src.dispose();
    comp.dispose();
    return out;
  });
  for (const [t, url] of Object.entries(diff)) writeFileSync(join(OUT, `render_${t}.png`), Buffer.from(url.split(',')[1], 'base64'));
  const cmp = (t) => {
    const r = execFileSync('sh', ['-c', `ffmpeg -v info -i "${join(OUT, `export_${t}.png`)}" -i "${join(OUT, `render_${t}.png`)}" -filter_complex "[0]scale=270:480[a];[a][1]psnr" -f null - 2>&1 | grep -o 'average:[0-9.inf]*' || true`]).toString();
    return r.trim();
  };
  const psnr5 = cmp(5), psnr16 = cmp(16);
  const val = (s) => (s.includes('inf') ? 99 : Number(s.split(':')[1]));
  // テキストのモーションブラー/パーティクルを含むため完全一致ではなく PSNR で評価
  check('プレビュー描画と書き出しの一致 (PSNR)', val(psnr5) > 24 && val(psnr16) > 24, `t=5: ${psnr5}, t=16: ${psnr16}`);

  // ---- 8. 保存 → 再読み込み → 再開 ----
  const snap = await page.evaluate(() => JSON.stringify(window.__MVE__.store.useStore.getState().project.clips.map((c) => [c.id, c.start, c.duration])));
  await page.waitForTimeout(1500);
  await page.reload();
  await waitFor(page, () => !!window.__MVE__ && !!window.__MVE__.store.useStore.getState().project, null, 30000);
  const snap2 = await page.evaluate(() => JSON.stringify(window.__MVE__.store.useStore.getState().project.clips.map((c) => [c.id, c.start, c.duration])));
  check('再読み込み後に編集内容を復元', snap === snap2, `${JSON.parse(snap2).length} クリップ`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(OUT, 'after_reload.png') });

  // プロキシ (プレビュー用低解像度動画) の生成
  const proxy = await page.evaluate(async () => {
    const { store, proxy, registry } = window.__MVE__;
    const S = store.useStore.getState();
    const a = S.project.assets.find((x) => x.name === 'video_v.mp4');
    const id = await proxy.createProxy(a, () => {});
    S.update((p) => (p.assets.find((x) => x.id === a.id).proxyId = id));
    const blob = await registry.blobFor(id);
    const v = document.createElement('video');
    v.muted = true;
    v.src = URL.createObjectURL(blob);
    await new Promise((r, j) => { v.onloadedmetadata = r; v.onerror = j; });
    return { w: v.videoWidth, h: v.videoHeight, d: v.duration, size: blob.size, orig: a.size };
  });
  check('プレビュー用プロキシの生成 (540p)', proxy.w === 540 && proxy.h === 960 && Math.abs(proxy.d - 12) < 0.1, JSON.stringify(proxy));

  // UI スモーク: 主要パネルが開けること
  const panels = ['add', 'presets', 'layers', 'project', 'export'];
  for (const pnl of panels) {
    await page.evaluate((pnl) => window.__MVE__.store.useStore.getState().setPanel(pnl), pnl);
    await page.waitForTimeout(250);
  }
  const clipPanels = ['edit', 'transform', 'animate', 'effects', 'color', 'compose', 'crop', 'transition', 'text', 'audio'];
  await page.evaluate(() => {
    const S = window.__MVE__.store.useStore.getState();
    const t = S.project.clips.find((c) => c.type === 'text');
    S.select([t.id]);
    S.setTime(t.start + 1);
  });
  for (const pnl of clipPanels) {
    await page.evaluate((pnl) => window.__MVE__.store.useStore.getState().setPanel(pnl), pnl);
    await page.waitForTimeout(250);
    if (pnl === 'text' || pnl === 'animate') await page.screenshot({ path: join(OUT, `panel_${pnl}.png`) });
  }
  check('全パネル表示でエラーなし', errors.length === 0, errors.slice(0, 3).join(' | '));

  // 横画面
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => window.__MVE__.store.useStore.getState().setPanel('effects'));
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, 'landscape.png') });

  if (LONG15) {
    // ---- 15 分・1080p30 の横型動画 ----
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => (location.hash = ''));
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: '新規プロジェクト' }).click();
    await page.getByRole('button', { name: /16:9/ }).click();
    await page.getByRole('button', { name: '30 fps' }).click();
    await page.getByRole('button', { name: '作成' }).click();
    await waitFor(page, () => !!window.__MVE__.store.useStore.getState().project);
    await page.getByRole('button', { name: '追加' }).click();
    await page.locator('input[type=file][multiple]').setInputFiles([f('long15.mp4'), f('bgm15.mp3')]);
    await waitFor(page, () => window.__MVE__.store.useStore.getState().project.assets.length >= 2, null, 300000);
    // 区間デコード: WebCodecs 方式と ADTS 方式 (古い iPhone 向け) が同じ音を同じ時刻で返すか
    const cmpAudio = await page.evaluate(async () => {
      const { store, decodeSegmentWith } = window.__MVE__;
      const a = store.useStore.getState().project.assets.find((x) => x.name === 'long15.mp4');
      const k = 120; // 600〜605 秒 (600 秒にビープ)
      const w = await decodeSegmentWith(a, k, 'webcodecs');
      const d = await decodeSegmentWith(a, k, 'adts');
      const x = w.getChannelData(0);
      const y = d.getChannelData(0);
      let best = { lag: 0, corr: -1 };
      for (let lag = -2400; lag <= 2400; lag += 8) {
        let sxy = 0, sxx = 0, syy = 0;
        for (let i = 4800; i < x.length - 4800; i += 3) {
          const a1 = x[i];
          const b1 = y[i + lag] ?? 0;
          sxy += a1 * b1; sxx += a1 * a1; syy += b1 * b1;
        }
        const c = sxy / Math.sqrt(sxx * syy + 1e-12);
        if (c > best.corr) best = { lag, corr: c };
      }
      return { lagMs: (best.lag / 48), corr: best.corr, len: [w.length, d.length] };
    });
    check('区間デコード: ADTS 方式と WebCodecs 方式の一致', cmpAudio.corr > 0.95 && Math.abs(cmpAudio.lagMs) <= 2, JSON.stringify(cmpAudio));
    await page.evaluate(() => {
      const { store, defaults } = window.__MVE__;
      store.useStore.getState().update((p) => {
        const tt = p.tracks.find((t) => t.name === 'テキスト');
        for (let i = 0; i < 30; i++) {
          const c = defaults.createClip(p, 'text', tt.id, i * 30 + 1, 6);
          c.text.content = `パート ${i + 1}`;
          c.text.anims = [{ kind: 'popIn', duration: 0.4, stagger: 0.04, order: 'forward', amount: 1, mode: 'in', ease: { kind: 'easeOut' } }];
          p.clips.push(c);
        }
        const bgm = p.clips.find((c) => c.type === 'audio');
        bgm.audio.volume = 0.5;
      });
      // createWritable が無い Safari を想定し、Worker の SyncAccessHandle 経路で書き出す
      window.__MVE__.targetDebug.disable = ['opfs'];
    });
    const rss = [];
    const sampler = setInterval(() => {
      try {
        const out = execFileSync('sh', ['-c', "ps -o rss=,args= -C chrome-headless-shell.real | grep -- '--type=renderer' | awk '{print $1}' | sort -n | tail -1"]).toString().trim();
        if (out) rss.push(Number(out) / 1024);
      } catch {}
    }, 10000);
    const heapBefore = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
    let heapAfter = 0;
    // メモリは書き出し中だけを計測 (テストが結果ファイルを取り出す処理は含めない)
    const ex3 = await exportAndSave(page, 'e2e_15min_1080p30.mp4', {
      res: '1080p',
      fps: 30,
      timeout: 180 * 60 * 1000,
      onDone: async () => {
        clearInterval(sampler);
        heapAfter = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
      },
    });
    const kind3 = await page.evaluate(() => window.__MVE_LAST_EXPORT__?.targetKind);
    const pr3 = probe(ex3.path);
    const v3 = pr3.streams.find((s) => s.codec_type === 'video');
    const ok3 = Math.abs(Number(pr3.format.duration) - 900) < 0.2 && Number(v3.nb_frames) === 27000 && v3.width === 1920 && v3.height === 1080;
    check('15 分 1080p30 の書き出し', ok3, `${Number(pr3.format.duration).toFixed(2)}s, ${v3.nb_frames} フレーム, ${(Number(pr3.format.size) / 1048576).toFixed(0)}MB, ${(ex3.seconds / 60).toFixed(1)} 分, 保存先 ${kind3}`);
    check('15 分: Worker 経由の逐次書き込み', kind3 === 'opfs-worker', String(kind3));
    const maxRss = Math.max(...rss);
    const firstRss = rss[0] ?? 0;
    check('15 分: メモリが増え続けない', maxRss - firstRss < 400, `レンダラー ${firstRss.toFixed(0)}→最大 ${maxRss.toFixed(0)}MB, JS ヒープ ${(heapBefore / 1e6).toFixed(0)}→${(heapAfter / 1e6).toFixed(0)}MB`);
    // 1kHz のビープだけを取り出し、鳴るべき 0.1 秒間とその前後 0.2 秒を比べる
    const beep = (t) => Number(execFileSync('sh', ['-c', `ffmpeg -v info -ss ${t} -t 0.1 -i "${ex3.path}" -af "bandpass=f=1000:width_type=h:w=150,volumedetect" -vn -f null - 2>&1 | grep max_volume || true`]).toString().match(/max_volume: (-?[\d.]+)/)?.[1] ?? -99);
    const res15 = [600, 840].map((t) => ({ t, on: beep(t), before: beep(t - 0.2), after: beep(t + 0.2) }));
    check('15 分: 終盤まで音ズレなし (600秒/840秒のビープ)', res15.every((r) => r.on > r.before + 20 && r.on > r.after + 20), res15.map((r) => `${r.t}s ${r.on}dB (前 ${r.before} / 後 ${r.after})`).join(', '));
    const derr3 = decodeErrors(ex3.path);
    check('15 分: MP4 が正常にデコードできる', derr3 === '', derr3.slice(0, 200));
  }

  if (LONG) {
    // ---- 9. 8 分以上の横型動画 ----
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => (location.hash = ''));
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: '新規プロジェクト' }).click();
    await page.getByRole('button', { name: /16:9/ }).click();
    await page.getByRole('button', { name: '30 fps' }).click();
    await page.getByRole('button', { name: '作成' }).click();
    await waitFor(page, () => !!window.__MVE__.store.useStore.getState().project);
    await page.getByRole('button', { name: '追加' }).click();
    await page.locator('input[type=file][multiple]').setInputFiles([f('long_h.mp4'), f('bgm.mp3')]);
    await waitFor(page, () => window.__MVE__.store.useStore.getState().project.assets.length >= 2, null, 120000);
    await page.evaluate(() => {
      const { store, defaults } = window.__MVE__;
      store.useStore.getState().update((p) => {
        const tt = p.tracks.find((t) => t.name === 'テキスト');
        for (let i = 0; i < 50; i++) {
          const c = defaults.createClip(p, 'text', tt.id, i * 10, 8);
          c.text.content = `チャプター ${i + 1}`;
          c.text.anims = [{ kind: 'fade', duration: 0.5, stagger: 0.05, order: 'forward', amount: 1, mode: 'in', ease: { kind: 'easeOut' } }];
          p.clips.push(c);
        }
      });
    });
    const memBefore = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
    const ex2 = await exportAndSave(page, 'e2e_long_720p30.mp4', { res: '720p', fps: 30, timeout: 120 * 60 * 1000 });
    const memAfter = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
    const pr2 = probe(ex2.path);
    check('8分以上の横型動画の書き出し', Number(pr2.format.duration) >= 480 && decodeErrors(ex2.path) === '', `${Number(pr2.format.duration).toFixed(1)}s, ${(Number(pr2.format.size) / 1048576).toFixed(0)}MB, ${ex2.seconds.toFixed(0)}秒, JSヒープ ${(memBefore / 1e6).toFixed(0)}→${(memAfter / 1e6).toFixed(0)}MB`);
  }

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} 合格`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
