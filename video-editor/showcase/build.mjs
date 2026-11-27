// 紹介動画「できることガイド」をアプリで組み立てる。
// 使い方: (ビルド済み + vite preview 起動) node showcase/build.mjs [--export]
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
mkdirSync(OUT, { recursive: true });
const URL_BASE = process.env.APP_URL ?? 'http://localhost:4173/';
const EXPORT = process.argv.includes('--export');

if (!existsSync(join(MEDIA, 'guide_bgm.m4a'))) {
  execFileSync('python3', [join(here, 'make_audio.py'), MEDIA], { stdio: 'inherit' });
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', join(MEDIA, 'guide_bgm.wav'), '-c:a', 'aac', '-b:a', '192k', join(MEDIA, 'guide_bgm.m4a')]);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], userAgent: devices['Pixel 7'].userAgent });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(URL_BASE);
await page.waitForFunction(() => !!window.__MVE__);

// UI 操作でプロジェクトを作る
await page.getByRole('button', { name: '新規プロジェクト' }).click();
await page.getByPlaceholder('無題のプロジェクト').fill('できることガイド');
await page.getByRole('button', { name: /9:16/ }).click();
await page.getByRole('button', { name: '30 fps' }).click();
await page.getByRole('button', { name: '作成' }).click();
await page.waitForFunction(() => !!window.__MVE__.store.useStore.getState().project);
await page.getByRole('button', { name: '追加' }).click();
await page.locator('input[type=file][multiple]').setInputFiles([join(MEDIA, 'guide_bgm.m4a'), join(MEDIA, 'guide_whoosh.wav'), join(MEDIA, 'guide_pop.wav')]);
await page.waitForFunction(() => window.__MVE__.store.useStore.getState().project.assets.length >= 3, null, { timeout: 60000 });

await page.addScriptTag({ path: join(here, 'scenes.js') });
const scenes = await page.evaluate(() => {
  const r = window.__buildGuide();
  const S = window.__MVE__.store.useStore.getState();
  S.select([]);
  S.setPanel(null);
  return r;
});
const info = await page.evaluate(() => {
  const p = window.__MVE__.store.useStore.getState().project;
  return { clips: p.clips.length, tracks: p.tracks.length, dur: Math.max(...p.clips.map((c) => c.start + c.duration)), keys: p.clips.reduce((n, c) => n + Object.values(c.keyframes).flat().length, 0), effects: p.clips.reduce((n, c) => n + c.effects.length, 0) };
});
console.log('構成:', JSON.stringify(info));

// 各場面のプレビュー画像 (書き出しと同じ描画処理で 540x960 に描く)
const times = scenes.map((sc, i) => sc.t + Math.min(3.2, ((scenes[i + 1]?.t ?? info.dur) - sc.t) * 0.6));
const shots = await page.evaluate(async (times) => {
  const { Compositor, ExportFrameSource, store } = window.__MVE__;
  const p = store.useStore.getState().project;
  const c = document.createElement('canvas');
  const comp = new Compositor(c, { preserve: true });
  comp.setSize(540, 960);
  const src = new ExportFrameSource(true);
  const out = [];
  for (const t of times) {
    await src.prefetch(Compositor.videoNeeds(p, t));
    for (let i = 0; i < 60; i++) {
      const r = comp.render(p, t, src, { scale: 0.5, imageMaxDim: 4096, frame: i, final: true });
      if (!r.incomplete) break;
      await new Promise((r2) => setTimeout(r2, 100));
    }
    out.push(c.toDataURL('image/jpeg', 0.9));
  }
  src.dispose();
  comp.dispose();
  return out;
}, times);
shots.forEach((u, i) => {
  writeFileSync(join(OUT, `scene_${String(i).padStart(2, '0')}.png`), Buffer.from(u.split(',')[1], 'base64'));
  console.log(`  場面 ${i}: ${scenes[i].title.replace(/\n/g, '')} (${times[i].toFixed(1)}s)`);
});
const list = scenes.map((_, i) => join(OUT, `scene_${String(i).padStart(2, '0')}.png`));
const args = [];
for (const f of list) args.push('-i', f);
const n = list.length;
const filter = list.map((_, i) => `[${i}]scale=216:384[s${i}]`).join(';') + ';' + list.map((_, i) => `[s${i}]`).join('') + `xstack=inputs=${n}:layout=` + list.map((_, i) => `${(i % 6) * 216}_${Math.floor(i / 6) * 384}`).join('|') + ':fill=black';
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args, '-filter_complex', filter, join(OUT, 'contact.png')]);
console.log('一覧画像:', join(OUT, 'contact.png'));

if (EXPORT) {
  await page.evaluate(() => window.__MVE__.store.useStore.getState().set({ previewQuality: 'auto' }));
  await page.evaluate(() => window.__MVE__.store.useStore.getState().setPanel('export'));
  await page.getByRole('button', { name: /^1080p/ }).first().click();
  await page.getByRole('button', { name: '30fps', exact: true }).click();
  await page.getByRole('button', { name: '書き出し開始' }).click();
  const t0 = Date.now();
  for (;;) {
    await page.waitForTimeout(5000);
    const st = await page.evaluate(() => ({
      info: [...document.querySelectorAll('.export-progress .row-info')].map((e) => e.textContent).join(' '),
      done: !!document.querySelector('.result-video'),
      err: [...document.querySelectorAll('.warn')].map((e) => e.textContent).join(' | '),
    }));
    process.stdout.write(`  … ${st.info.slice(0, 80)}\r`);
    if (st.done) break;
    if (/失敗|キャンセル/.test(st.err)) throw new Error(st.err);
  }
  console.log(`\n書き出し完了 (${((Date.now() - t0) / 60000).toFixed(1)} 分)`);
  const size = await page.evaluate(async () => {
    window.__B__ = await (await fetch(document.querySelector('.result-video').src)).blob();
    return window.__B__.size;
  });
  const path = join(OUT, 'できることガイド_1080p30.mp4');
  writeFileSync(path, Buffer.alloc(0));
  for (let off = 0; off < size; off += 16 * 1024 * 1024) {
    const b64 = await page.evaluate(async (off) => {
      const buf = new Uint8Array(await window.__B__.slice(off, off + 16 * 1024 * 1024).arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    }, off);
    appendFileSync(path, Buffer.from(b64, 'base64'));
  }
  const warns = await page.evaluate(() => [...document.querySelectorAll('.export-result .warn')].map((e) => e.textContent));
  if (warns.length) console.log('警告:', warns.join(' / '));
  console.log('動画:', path);
}

// プロジェクトファイル (アプリの「プロジェクトファイルを読み込む」で開ける)
const json = await page.evaluate(() => JSON.stringify(window.__MVE__.store.useStore.getState().project));
writeFileSync(join(OUT, 'できることガイド.mve.json'), json);
if (errors.length) console.log('ページのエラー:', errors.slice(0, 5));
await browser.close();
