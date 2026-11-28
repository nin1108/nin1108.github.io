import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(join(execFileSync('npm', ['root', '-g']).toString().trim(), 'playwright'));
const out = process.argv[2];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
await p.goto('http://localhost:4173/');
await p.waitForFunction(() => !!window.__MVE__);
const url = await p.evaluate(async () => {
  const { renderText, ensureWebFont, defaults } = window.__MVE__;
  const fonts = [['Yuji Syuku', 400], ['Yuji Boku', 400], ['Yuji Mai', 400], ['Zen Antique', 400], ['Shippori Mincho B1', 800], ['Zen Old Mincho', 900], ['Kaisei Tokumin', 800], ['Noto Serif JP', 900], ['M PLUS Rounded 1c', 900], ['Noto Sans JP', 900], ['Murecho', 900], ['Dela Gothic One', 400], ['RocknRoll One', 400], ['Mochiy Pop One', 400]];
  for (const [f] of fonts) await ensureWebFont(f);
  for (const [f, w] of fonts) await document.fonts.load(`${w} 64px "${f}"`, 'あア');
  const c = document.createElement('canvas');
  c.width = 4 * 300; c.height = Math.ceil(fonts.length / 2) * 110;
  const g = c.getContext('2d');
  g.fillStyle = '#222'; g.fillRect(0, 0, c.width, c.height);
  fonts.forEach(([f, w], i) => {
    for (const it of [false, true]) {
      const st = defaults.defaultTextStyle();
      Object.assign(st, { fontFamily: f, fontWeight: w, italic: it, fontSize: 70 });
      st.strokes = st.strokes.map((s) => ({ ...s, enabled: false }));
      st.fill = { type: 'solid', color: '#ffffff', color2: '#fff', angle: 90 };
      const r = renderText(undefined, 'あア', st, [], 0, 1, 1);
      const col = (i % 2) * 2 + (it ? 1 : 0), row = Math.floor(i / 2);
      g.drawImage(r.canvas, col * 300 + 150 - r.w / 2, row * 110 + 55 - r.h / 2);
      g.fillStyle = '#9a9'; g.font = '12px sans-serif'; g.fillText(`${f} ${w}${it ? ' i' : ''}`, col * 300 + 6, row * 110 + 14);
    }
  });
  return c.toDataURL('image/png');
});
writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
await b.close();
