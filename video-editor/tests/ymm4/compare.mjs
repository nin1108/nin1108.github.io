// YMM4 テンプレの再現結果を、参照画像と同じ 9 列グリッドで描画して並べる
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(join(execFileSync('npm', ['root', '-g']).toString().trim(), 'playwright'));
const [ref, out] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
await p.goto('http://localhost:4173/');
await p.waitForFunction(() => !!window.__MVE__);
const url = await p.evaluate(async () => {
  const { renderText, ensureWebFont, YMM4_TEMPLATES } = window.__MVE__;
  for (const t of YMM4_TEMPLATES) await ensureWebFont(t.style.fontFamily);
  for (const t of YMM4_TEMPLATES) await document.fonts.load(`${t.style.italic ? 'italic ' : ''}${t.style.fontWeight} 64px "${t.style.fontFamily}"`, 'あア');
  const c = document.createElement('canvas');
  c.width = 1036; c.height = 579;
  const g = c.getContext('2d');
  g.fillStyle = '#212121'; g.fillRect(0, 0, c.width, c.height);
  YMM4_TEMPLATES.forEach((t, i) => {
    const col = i % 9, row = Math.floor(i / 9);
    const x = 15 + col * 114.5, y = 20 + row * 114.3;
    g.fillStyle = '#262626'; g.strokeStyle = '#3a3a3a'; g.lineWidth = 1;
    g.beginPath(); g.roundRect(x, y, 95, 95, 5); g.fill(); g.stroke();
    const r = renderText(undefined, 'あア', t.style, [], 0, 1, 0.4);
    g.drawImage(r.canvas, x + 47.5 - r.canvas.width / 2, y + 47.5 - r.canvas.height / 2);
  });
  return c.toDataURL('image/png');
});
writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
await b.close();
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', ref, '-i', out, '-filter_complex', '[0][1]vstack', out.replace('.png', '_vs.png')]);
