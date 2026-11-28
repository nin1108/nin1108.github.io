// 日本語 Web フォント (Google Fonts, 無料) をオンデマンドで読み込む。
// 端末内蔵フォント (ヒラギノ / Noto Sans CJK) はフォールバックとして常に利用可能。
export const WEB_FONTS: { family: string; label: string; weights: string }[] = [
  { family: 'Noto Sans JP', label: 'Noto Sans JP (ゴシック)', weights: '100..900' },
  { family: 'Noto Serif JP', label: 'Noto Serif JP (明朝)', weights: '200..900' },
  { family: 'M PLUS Rounded 1c', label: 'M PLUS Rounded (丸ゴ)', weights: '100;300;400;500;700;800;900' },
  { family: 'M PLUS 1 Code', label: 'M PLUS 1 Code (等幅)', weights: '100..700' },
  { family: 'Zen Maru Gothic', label: 'Zen 丸ゴシック', weights: '300;400;500;700;900' },
  { family: 'Zen Kaku Gothic New', label: 'Zen 角ゴシック', weights: '300;400;500;700;900' },
  { family: 'Shippori Mincho', label: 'しっぽり明朝', weights: '400;500;600;700;800' },
  { family: 'Kaisei Decol', label: '解星デコール', weights: '400;500;700' },
  { family: 'Dela Gothic One', label: 'デラゴシック (極太)', weights: '400' },
  { family: 'Mochiy Pop One', label: 'モッチーポップ', weights: '400' },
  { family: 'RocknRoll One', label: 'ロックンロール', weights: '400' },
  { family: 'Reggae One', label: 'レゲエ', weights: '400' },
  { family: 'Rampart One', label: 'ランパート (立体)', weights: '400' },
  { family: 'Train One', label: 'トレイン', weights: '400' },
  { family: 'Potta One', label: 'ぽってり', weights: '400' },
  { family: 'Yusei Magic', label: '油性マジック', weights: '400' },
  { family: 'Hachi Maru Pop', label: 'はちまるポップ', weights: '400' },
  { family: 'DotGothic16', label: 'ドットゴシック', weights: '400' },
  { family: 'Kosugi Maru', label: '小杉丸ゴシック', weights: '400' },
  { family: 'Stick', label: 'スティック', weights: '400' },
  { family: 'Yuji Syuku', label: '佑字 肅 (毛筆)', weights: '400' },
  { family: 'Yuji Boku', label: '佑字 朴 (筆文字)', weights: '400' },
  { family: 'Yuji Mai', label: '佑字 舞 (行書)', weights: '400' },
  { family: 'Zen Antique', label: 'Zen アンチック', weights: '400' },
  { family: 'Shippori Mincho B1', label: 'しっぽり明朝 B1', weights: '400;500;600;700;800' },
  { family: 'Zen Old Mincho', label: 'Zen オールド明朝', weights: '400;500;600;700;900' },
  { family: 'Kaisei Tokumin', label: '解星 特ミン', weights: '400;500;700;800' },
  { family: 'Murecho', label: 'ムレチョ (極太)', weights: '100..900' },
];

export const SYSTEM_FONTS: { family: string; label: string }[] = [
  { family: 'Hiragino Sans', label: 'ヒラギノ角ゴ (iPhone)' },
  { family: 'Hiragino Mincho ProN', label: 'ヒラギノ明朝 (iPhone)' },
  { family: 'Hiragino Maru Gothic ProN', label: 'ヒラギノ丸ゴ (iPhone)' },
  { family: 'sans-serif', label: '端末標準ゴシック' },
  { family: 'serif', label: '端末標準明朝' },
];

/**
 * アプリに同梱しているフォント (public/fonts)。選ばれたときだけ読み込む。
 * ライセンス: 各フォントの *-OFL.txt (SIL Open Font License 1.1)
 */
export const BUNDLED_FONTS: { family: string; label: string; file: string }[] = [{ family: 'AbashiriMincho', label: '網走明朝 (極太明朝)', file: 'fonts/AbashiriMincho.woff2' }];

const loaded = new Map<string, Promise<void>>();
const done = new Set<string>();

function loadBundled(def: { family: string; file: string }): Promise<void> {
  return (async () => {
    try {
      const res = await fetch(new URL(def.file, document.baseURI).href);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = await res.arrayBuffer();
      // どの太さで指定されても同じ字形を使う (疑似ボールドを防ぐ)
      const face = new FontFace(def.family, buf, { weight: '100 900' });
      await face.load();
      (document.fonts as any).add(face);
    } catch (e) {
      console.warn('同梱フォントを読み込めませんでした', def.family, e);
    }
    done.add(def.family);
  })();
}

export function ensureWebFont(family: string): Promise<void> {
  const bundled = BUNDLED_FONTS.find((f) => f.family === family);
  if (bundled) {
    let p = loaded.get(family);
    if (!p) {
      p = loadBundled(bundled);
      loaded.set(family, p);
    }
    return p;
  }
  const def = WEB_FONTS.find((f) => f.family === family);
  if (!def) return Promise.resolve();
  let p = loaded.get(family);
  if (p) return p;
  p = new Promise<void>((resolve) => {
    if (!navigator.onLine) {
      // オフライン時は Service Worker のキャッシュがあれば読み込まれる
    }
    const w = def.weights.includes('..') ? `wght@${def.weights}` : def.weights.includes(';') ? `wght@${def.weights}` : '';
    const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}${w ? ':' + w : ''}&display=swap`;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.crossOrigin = 'anonymous';
    link.onload = () => resolve();
    link.onerror = () => resolve();
    document.head.appendChild(link);
    setTimeout(resolve, 8000);
  });
  loaded.set(family, p);
  return p;
}

export function webFontReady(family: string): boolean {
  if (BUNDLED_FONTS.some((f) => f.family === family)) return done.has(family);
  return !WEB_FONTS.some((f) => f.family === family) || loaded.has(family);
}
