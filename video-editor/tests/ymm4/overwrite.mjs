// プリセットの上書き保存・新規保存・標準に戻す の動作確認
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium, devices } = require(join(execFileSync('npm', ['root', '-g']).toString().trim(), 'playwright'));
const shot = process.argv[2];
const results = [];
const check = (n, ok, d = '') => {
  results.push(ok);
  console.log(`${ok ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`);
};
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['iPhone 13'] });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto('http://localhost:4173/');
await p.waitForFunction(() => !!window.__MVE__);
await p.getByRole('button', { name: '新規プロジェクト' }).click();
await p.getByRole('button', { name: '作成' }).click();
await p.waitForFunction(() => !!window.__MVE__.store.useStore.getState().project);
const S = (fn, arg) => p.evaluate(fn, arg);
const clipState = () => S(() => {
  const s = window.__MVE__.store.useStore.getState();
  const c = s.project.clips.find((x) => x.id === s.selection[0]);
  return c && { presetId: c.text.presetId, stroke0: c.text.style.strokes[0].color, fill: c.text.style.fill.stops?.[0] ?? c.text.style.fill.color };
});

// 1. YMM4 05 を適用
await p.getByRole('button', { name: 'プリセット' }).click();
await p.getByRole('button', { name: 'YMM4テンプレ', exact: true }).click();
await p.getByRole('button', { name: /05 紺の白縁/ }).click();
let c = await clipState();
check('プリセット適用で元のプリセットを記録', c?.presetId === 'ymm4-05', JSON.stringify(c));

// 2. 編集して上書き保存
await S(() => {
  const s = window.__MVE__.store.useStore.getState();
  s.update((pr) => {
    const t = pr.clips.find((x) => x.id === s.selection[0]).text;
    t.style.strokes[0].color = '#ff0000';
    t.style.fill.stops = ['#00ff00', '#004400'];
  });
  s.setPanel('text');
});
await p.getByRole('button', { name: /「05 紺の白縁」に上書き保存/ }).click();
await p.getByRole('button', { name: '上書き保存', exact: true }).click();
await p.waitForTimeout(500);
await p.screenshot({ path: shot });

// 3. 新しいテキストに同じプリセットを適用すると上書き後のデザインになる
await S(() => {
  const s = window.__MVE__.store.useStore.getState();
  s.select([]);
  s.setPanel('presets');
});
await p.waitForTimeout(300);
const badge = await p.locator('.preset', { hasText: '05 紺の白縁' }).locator('.badge').count();
check('一覧に「編集済み」と表示', badge === 1);
await p.screenshot({ path: shot.replace('.png', '_list.png') });
await p.getByRole('button', { name: /05 紺の白縁/ }).click();
c = await clipState();
check('上書き保存したデザインが次から使われる', c?.stroke0 === '#ff0000' && c?.fill === '#00ff00', JSON.stringify(c));

// 4. 新しいプリセットとして保存 → それを上書き
await S(() => window.__MVE__.store.useStore.getState().setPanel('text'));
await p.getByRole('button', { name: '新しいプリセットとして保存' }).click();
await p.locator('#dialog-input').fill('わたしの紺');
await p.getByRole('button', { name: '保存', exact: true }).click();
await p.waitForTimeout(400);
c = await clipState();
check('新規保存でマイプリセットになり、以後の上書き対象が切り替わる', c?.presetId?.startsWith('user:'), JSON.stringify(c));
await S(() => {
  const s = window.__MVE__.store.useStore.getState();
  s.update((pr) => (pr.clips.find((x) => x.id === s.selection[0]).text.style.strokes[0].color = '#0000ff'));
});
await p.getByRole('button', { name: /「わたしの紺」に上書き保存/ }).click();
await p.getByRole('button', { name: '上書き保存', exact: true }).click();
await p.waitForTimeout(400);
await S(() => {
  const s = window.__MVE__.store.useStore.getState();
  s.select([]);
  s.setPanel('presets');
});
await p.getByRole('button', { name: 'マイプリセット', exact: true }).click();
await p.getByRole('button', { name: /わたしの紺/ }).click();
c = await clipState();
check('マイプリセットの上書き保存', c?.stroke0 === '#0000ff' && c?.presetId?.startsWith('user:'), JSON.stringify(c));

// 5. 再読み込み後も残る
await p.waitForTimeout(1200);
await p.reload();
await p.waitForFunction(() => !!window.__MVE__ && !!window.__MVE__.store.useStore.getState().project);
await p.waitForTimeout(800);
await S(() => {
  const s = window.__MVE__.store.useStore.getState();
  s.select([]);
  s.setPanel('presets');
});
await p.getByRole('button', { name: 'YMM4テンプレ', exact: true }).click();
await p.getByRole('button', { name: /05 紺の白縁/ }).click();
c = await clipState();
check('再読み込み後も上書き内容を保持', c?.stroke0 === '#ff0000', JSON.stringify(c));

// 6. 標準に戻す
await S(() => window.__MVE__.store.useStore.getState().setPanel('text'));
await p.getByRole('button', { name: '標準のデザインに戻す' }).click();
await p.getByRole('button', { name: '標準に戻す', exact: true }).click();
await p.waitForTimeout(400);
await S(() => {
  const s = window.__MVE__.store.useStore.getState();
  s.select([]);
  s.setPanel('presets');
});
await p.getByRole('button', { name: /05 紺の白縁/ }).click();
c = await clipState();
check('標準のデザインに戻す', c?.stroke0 === '#ffffff', JSON.stringify(c));
check('ページエラーなし', errors.length === 0, errors.join(' | '));
await b.close();
console.log(`${results.filter(Boolean).length}/${results.length} 合格`);
process.exit(results.every(Boolean) ? 0 : 1);
