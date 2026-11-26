// プリセット: すべて実際にクリップへ適用される (見た目だけのものは無い)
import type { CharAnimation, Clip, Ease, EffectType, Project, TextStyle, TransitionType } from '../model/types';
import { createClip, createEffect, defaultCurves, defaultParticles, defaultShape, defaultTextStyle, uid } from '../model/defaults';
import { findFreeTrack } from '../model/ops';

export type PresetCategory = 'tv' | 'science' | 'space' | 'neon' | 'news' | 'cinema' | 'gold' | 'kinetic' | 'shorts' | 'tiktok';
export type PresetKind = 'text' | 'anim' | 'effect' | 'look' | 'template';

export const CATEGORY_LABELS: Record<PresetCategory, string> = {
  tv: 'テレビ番組風',
  science: '科学解説風',
  space: '宇宙ドキュメンタリー風',
  neon: 'ネオン',
  news: 'ニュース番組風',
  cinema: '映画風',
  gold: '豪華な金色',
  kinetic: 'キネティック',
  shorts: 'YouTube Shorts',
  tiktok: 'TikTok',
};

export const KIND_LABELS: Record<PresetKind, string> = {
  text: 'テロップ',
  anim: 'アニメーション',
  effect: 'エフェクト',
  look: 'カラー',
  template: 'テンプレート',
};

export interface Preset {
  id: string;
  name: string;
  category: PresetCategory;
  kind: PresetKind;
  /** 選択中クリップに適用 */
  apply?: (c: Clip, p: Project) => void;
  /** 新しいクリップ群を追加 (テンプレート) */
  build?: (p: Project, t: number) => void;
  /** 一覧表示用のサンプル文字色など */
  swatch?: string;
}

// ---------- ヘルパー ----------
type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends any[] ? T[K] : DeepPartial<T[K]>) : T[K] };

function ts(o: DeepPartial<TextStyle>): TextStyle {
  const d = defaultTextStyle();
  const s: any = { ...d, ...o };
  for (const k of ['fill', 'shadow', 'glow', 'extrude', 'gloss', 'background'] as const) s[k] = { ...(d as any)[k], ...((o as any)[k] ?? {}) };
  s.strokes = (o.strokes as any) ?? d.strokes.map((x) => ({ ...x, enabled: false }));
  while (s.strokes.length < 3) s.strokes.push({ enabled: false, color: '#000000', width: 4 });
  return s as TextStyle;
}
const st = (color: string, width: number) => ({ enabled: true, color, width });
const E = (kind: Ease['kind'], amount?: number): Ease => ({ kind, amount });
const ca = (kind: CharAnimation['kind'], o: Partial<CharAnimation> = {}): CharAnimation => ({ kind, duration: 0.4, stagger: 0.05, order: 'forward', amount: 1, mode: 'in', ease: E('easeOut'), ...o });

function setKeys(c: Clip, path: string, keys: [number, number | string, Ease?][]) {
  c.keyframes[path] = keys
    .map(([t, v, e]) => ({ id: uid(), t: Math.max(0, Math.min(c.duration, t)), v, ease: e ?? E('easeOut') }))
    .sort((a, b) => a.t - b.t);
}

function applyStyle(c: Clip, style: TextStyle, anims?: CharAnimation[]) {
  if (c.type === 'text' && c.text) {
    const keepSize = c.text.style.fontSize;
    c.text.style = { ...style, fontSize: style.fontSize || keepSize };
    if (anims) c.text.anims = anims;
  } else if (c.type === 'counter' && c.counter) {
    c.counter.style = { ...style, fontSize: c.counter.style.fontSize };
  }
}

const textPreset = (id: string, name: string, category: PresetCategory, style: TextStyle, anims?: CharAnimation[]): Preset => ({
  id,
  name,
  category,
  kind: 'text',
  swatch: style.fill.color,
  apply: (c) => applyStyle(c, JSON.parse(JSON.stringify(style)), anims && JSON.parse(JSON.stringify(anims))),
});

// ---------- テロップ (テキストスタイル) ----------
const SANS = 'Noto Sans JP';
const SERIF = 'Noto Serif JP';
const ROUND = 'M PLUS Rounded 1c';
const DELA = 'Dela Gothic One';
const POP = 'Mochiy Pop One';

const TEXT_PRESETS: Preset[] = [
  // テレビ番組風
  textPreset('tv-yellow', 'バラエティ 黄色二重縁', 'tv', ts({ fontFamily: SANS, fontWeight: 900, fill: { type: 'solid', color: '#ffe600' }, strokes: [st('#000000', 9), st('#ffffff', 7)], shadow: { enabled: true, color: '#00000099', blur: 8, offsetX: 5, offsetY: 6 } })),
  textPreset('tv-white-red', 'バラエティ 白×赤縁', 'tv', ts({ fontFamily: SANS, fontWeight: 900, fill: { type: 'solid', color: '#ffffff' }, strokes: [st('#e60023', 9), st('#ffffff', 6), st('#00000055', 4)] })),
  textPreset('tv-tsukkomi', 'ツッコミ 赤文字三重縁', 'tv', ts({ fontFamily: DELA, fontWeight: 400, fill: { type: 'linear', color: '#ff4d4d', color2: '#b30000', angle: 90 }, strokes: [st('#ffffff', 8), st('#000000', 6), st('#ffffff', 4)], extrude: { enabled: true, depth: 6, angle: 60, color: '#550000' } })),
  textPreset('tv-pink-round', 'ほのぼの 丸文字ピンク', 'tv', ts({ fontFamily: ROUND, fontWeight: 800, fill: { type: 'solid', color: '#ff7eb6' }, strokes: [st('#ffffff', 10), st('#ff7eb6', 4)], shadow: { enabled: true, color: '#ff7eb666', blur: 16, offsetX: 0, offsetY: 6 } })),
  textPreset('tv-blue-pop', 'ポップ 青グラデ', 'tv', ts({ fontFamily: POP, fontWeight: 400, fill: { type: 'linear', color: '#7ad7ff', color2: '#1c5cff', angle: 90 }, strokes: [st('#ffffff', 9), st('#0b1d5c', 6)] })),
  textPreset('tv-black-zabuton', '黒座布団テロップ', 'tv', ts({ fontFamily: SANS, fontWeight: 700, fontSize: 64, fill: { type: 'solid', color: '#ffffff' }, background: { enabled: true, color: '#000000', opacity: 0.65, paddingX: 28, paddingY: 12, radius: 6, skew: 0 } })),
  textPreset('tv-whisper', '心の声 (薄青)', 'tv', ts({ fontFamily: ROUND, fontWeight: 700, fontSize: 72, fill: { type: 'solid', color: '#cfe8ff' }, strokes: [st('#2c5d8a', 6)], italic: false })),
  textPreset('tv-shock', '衝撃 白黒反転', 'tv', ts({ fontFamily: DELA, fontWeight: 400, fontSize: 120, fill: { type: 'solid', color: '#000000' }, strokes: [st('#ffffff', 12), st('#000000', 6)] }), [ca('popIn', { duration: 0.35, stagger: 0.03 })]),
  // 科学解説風
  textPreset('sci-cyan', '科学 シアン細縁', 'science', ts({ fontFamily: SANS, fontWeight: 700, fontSize: 80, fill: { type: 'solid', color: '#e9fbff' }, strokes: [st('#00b8d9', 4)], glow: { enabled: true, color: '#00d9ff', blur: 18, strength: 0.6 } })),
  textPreset('sci-marker', 'ポイント 黄色マーカー', 'science', ts({ fontFamily: SANS, fontWeight: 900, fontSize: 76, fill: { type: 'solid', color: '#111111' }, background: { enabled: true, color: '#ffe14d', opacity: 1, paddingX: 18, paddingY: 4, radius: 2, skew: -12 } })),
  textPreset('sci-label', '解説ラベル (白座布団)', 'science', ts({ fontFamily: SANS, fontWeight: 700, fontSize: 56, fill: { type: 'solid', color: '#0d2a3a' }, background: { enabled: true, color: '#ffffff', opacity: 0.92, paddingX: 24, paddingY: 10, radius: 14, skew: 0, borderColor: '#00b8d9', borderWidth: 4 } })),
  textPreset('sci-formula', '数式・データ (等幅風)', 'science', ts({ fontFamily: 'M PLUS 1 Code', fontWeight: 600, fontSize: 64, letterSpacing: 4, fill: { type: 'solid', color: '#a8ffcf' }, glow: { enabled: true, color: '#2bff88', blur: 12, strength: 0.5 } })),
  textPreset('sci-warning', '注意 赤枠', 'science', ts({ fontFamily: SANS, fontWeight: 900, fontSize: 70, fill: { type: 'solid', color: '#ffffff' }, background: { enabled: true, color: '#d7263d', opacity: 0.95, paddingX: 24, paddingY: 10, radius: 8, skew: 0, borderColor: '#ffffff', borderWidth: 4 } })),
  textPreset('sci-chapter', '章見出し (左寄せ・下線風)', 'science', ts({ fontFamily: SANS, fontWeight: 900, fontSize: 90, align: 'left', fill: { type: 'linear', color: '#ffffff', color2: '#9be7ff', angle: 0 }, shadow: { enabled: true, color: '#00000088', blur: 10, offsetX: 4, offsetY: 4 } })),
  // 宇宙ドキュメンタリー風
  textPreset('space-glow', '宇宙 白グロー', 'space', ts({ fontFamily: SANS, fontWeight: 300, fontSize: 88, letterSpacing: 18, fill: { type: 'solid', color: '#ffffff' }, glow: { enabled: true, color: '#9fc8ff', blur: 34, strength: 1 } }), [ca('fade', { duration: 1.2, stagger: 0.08, ease: E('easeInOut') })]),
  textPreset('space-blue', '宇宙 青発光 太字', 'space', ts({ fontFamily: SANS, fontWeight: 900, fontSize: 110, fill: { type: 'linear', color: '#ffffff', color2: '#58a6ff', angle: 90 }, glow: { enabled: true, color: '#1f6fff', blur: 40, strength: 1.5 } })),
  textPreset('space-wide', 'SF ワイド細字', 'space', ts({ fontFamily: SANS, fontWeight: 200, fontSize: 72, letterSpacing: 40, fill: { type: 'solid', color: '#dfe9ff' } }), [ca('blurIn', { duration: 1, stagger: 0.06 })]),
  textPreset('space-planet', '天体名 プラチナ', 'space', ts({ fontFamily: SERIF, fontWeight: 700, fontSize: 100, letterSpacing: 10, fill: { type: 'metal', color: '#c9d6e8', color2: '#ffffff', angle: 90 }, shadow: { enabled: true, color: '#000000aa', blur: 20, offsetX: 0, offsetY: 6 } })),
  textPreset('space-narration', 'ナレーション字幕 (宇宙)', 'space', ts({ fontFamily: SANS, fontWeight: 500, fontSize: 54, fill: { type: 'solid', color: '#ffffff' }, shadow: { enabled: true, color: '#000000cc', blur: 14, offsetX: 0, offsetY: 3 } })),
  // ネオン
  textPreset('neon-pink', 'ネオン ピンク', 'neon', ts({ fontFamily: ROUND, fontWeight: 800, fill: { type: 'solid', color: '#ffe6f6' }, strokes: [st('#ff2fb3', 5)], glow: { enabled: true, color: '#ff2fb3', blur: 36, strength: 2 } })),
  textPreset('neon-cyan', 'ネオン シアン', 'neon', ts({ fontFamily: ROUND, fontWeight: 800, fill: { type: 'solid', color: '#e6ffff' }, strokes: [st('#00f0ff', 5)], glow: { enabled: true, color: '#00f0ff', blur: 36, strength: 2 } })),
  textPreset('neon-green', 'ネオン グリーン', 'neon', ts({ fontFamily: SANS, fontWeight: 900, fill: { type: 'solid', color: '#eaffea' }, strokes: [st('#39ff14', 5)], glow: { enabled: true, color: '#39ff14', blur: 34, strength: 2 } })),
  textPreset('neon-purple', 'ネオン パープル (点滅)', 'neon', ts({ fontFamily: SANS, fontWeight: 900, fill: { type: 'solid', color: '#f3e6ff' }, strokes: [st('#b44bff', 5)], glow: { enabled: true, color: '#b44bff', blur: 40, strength: 2 } }), [ca('fade', { mode: 'loop', duration: 0.25, stagger: 0.37, order: 'random' })]),
  textPreset('neon-orange', 'ネオン オレンジ 筆記体風', 'neon', ts({ fontFamily: 'Yusei Magic', fontWeight: 400, fill: { type: 'solid', color: '#fff3e0' }, strokes: [st('#ff8a00', 5)], glow: { enabled: true, color: '#ff6a00', blur: 34, strength: 2 } })),
  textPreset('neon-rainbow', 'ネオン レインボー波', 'neon', ts({ fontFamily: SANS, fontWeight: 900, fill: { type: 'solid', color: '#ff3d7f' }, strokes: [st('#ffffff', 3)], glow: { enabled: true, color: '#ffffff', blur: 24, strength: 1 } }), [ca('colorWave', { mode: 'loop', duration: 2, stagger: 0.08, amount: 3 })]),
  // ニュース番組風
  textPreset('news-headline', 'ニュース 見出し', 'news', ts({ fontFamily: SANS, fontWeight: 900, fontSize: 70, align: 'left', fill: { type: 'solid', color: '#ffffff' }, background: { enabled: true, color: '#0a3d91', color2: '#0f63d6', opacity: 1, paddingX: 30, paddingY: 14, radius: 0, skew: 0 } })),
  textPreset('news-sub', 'ニュース 下部字幕', 'news', ts({ fontFamily: SANS, fontWeight: 700, fontSize: 52, fill: { type: 'solid', color: '#111111' }, background: { enabled: true, color: '#ffffff', opacity: 0.95, paddingX: 26, paddingY: 10, radius: 0, skew: 0 } })),
  textPreset('news-breaking', 'ニュース速報', 'news', ts({ fontFamily: SANS, fontWeight: 900, fontSize: 72, fill: { type: 'solid', color: '#ffffff' }, background: { enabled: true, color: '#c8102e', opacity: 1, paddingX: 30, paddingY: 12, radius: 0, skew: -8 } })),
  textPreset('news-name', '名前テロップ', 'news', ts({ fontFamily: SANS, fontWeight: 700, fontSize: 58, align: 'left', fill: { type: 'solid', color: '#ffffff' }, strokes: [st('#00000088', 4)], background: { enabled: true, color: '#1a1a1a', opacity: 0.75, paddingX: 24, paddingY: 10, radius: 0, skew: 0, borderColor: '#e0a800', borderWidth: 0 } })),
  textPreset('news-location', '中継・場所表示', 'news', ts({ fontFamily: SANS, fontWeight: 900, fontSize: 48, fill: { type: 'solid', color: '#ffffff' }, background: { enabled: true, color: '#e60012', opacity: 1, paddingX: 18, paddingY: 6, radius: 4, skew: 0 } })),
  // 映画風
  textPreset('cine-sub', '映画字幕 (白)', 'cinema', ts({ fontFamily: SANS, fontWeight: 500, fontSize: 50, fill: { type: 'solid', color: '#f5f5f5' }, shadow: { enabled: true, color: '#000000dd', blur: 6, offsetX: 0, offsetY: 2 } })),
  textPreset('cine-title', '映画タイトル 明朝ワイド', 'cinema', ts({ fontFamily: SERIF, fontWeight: 600, fontSize: 96, letterSpacing: 30, fill: { type: 'solid', color: '#f0ece2' } }), [ca('fade', { duration: 2, stagger: 0.1, ease: E('easeInOut') })]),
  textPreset('cine-trailer', '予告編 金属', 'cinema', ts({ fontFamily: SERIF, fontWeight: 900, fontSize: 120, letterSpacing: 8, fill: { type: 'metal', color: '#9aa5b1', color2: '#f4f7fa', angle: 90 }, shadow: { enabled: true, color: '#000000', blur: 30, offsetX: 0, offsetY: 10 } })),
  textPreset('cine-credit', 'エンドクレジット', 'cinema', ts({ fontFamily: SANS, fontWeight: 300, fontSize: 44, letterSpacing: 6, lineHeight: 1.8, fill: { type: 'solid', color: '#dddddd' } })),
  textPreset('cine-horror', 'ホラー 赤にじみ', 'cinema', ts({ fontFamily: SERIF, fontWeight: 900, fontSize: 110, fill: { type: 'linear', color: '#ff1a1a', color2: '#5a0000', angle: 90 }, glow: { enabled: true, color: '#8b0000', blur: 30, strength: 1.5 } }), [ca('jitter', { mode: 'loop', amount: 0.6 })]),
  // 豪華な金色
  textPreset('gold-main', '豪華 金文字', 'gold', ts({ fontFamily: SERIF, fontWeight: 900, fontSize: 120, fill: { type: 'metal', color: '#d4a017', color2: '#fff4b0', color3: '#7a5200', angle: 90 }, strokes: [st('#3d2a00', 5), st('#ffe9a3', 3)], shadow: { enabled: true, color: '#000000aa', blur: 16, offsetX: 4, offsetY: 8 }, gloss: { enabled: true, opacity: 0.35 } })),
  textPreset('gold-3d', '金 立体文字', 'gold', ts({ fontFamily: DELA, fontWeight: 400, fontSize: 120, fill: { type: 'metal', color: '#e0b030', color2: '#fff6c0', angle: 90 }, strokes: [st('#5a3d00', 6)], extrude: { enabled: true, depth: 16, angle: 50, color: '#6b4a00' } })),
  textPreset('gold-black', '金 黒縁 光沢', 'gold', ts({ fontFamily: SANS, fontWeight: 900, fontSize: 110, fill: { type: 'metal', color: '#f2c14e', color2: '#fffbe0', angle: 90 }, strokes: [st('#000000', 10), st('#f2c14e', 4)], gloss: { enabled: true, opacity: 0.5 } })),
  textPreset('gold-glow', '金 発光', 'gold', ts({ fontFamily: SERIF, fontWeight: 700, fontSize: 110, letterSpacing: 12, fill: { type: 'metal', color: '#ffcc33', color2: '#fff8d6', angle: 90 }, glow: { enabled: true, color: '#ffb300', blur: 40, strength: 1.4 } })),
  textPreset('gold-plate', '金 座布団 (表彰風)', 'gold', ts({ fontFamily: SERIF, fontWeight: 900, fontSize: 80, fill: { type: 'solid', color: '#2b1d00' }, background: { enabled: true, color: '#f7d774', color2: '#b8860b', opacity: 1, paddingX: 40, paddingY: 16, radius: 10, skew: 0, borderColor: '#fff2b3', borderWidth: 4 } })),
  // キネティック
  textPreset('kin-pop', 'キネティック ポップイン', 'kinetic', ts({ fontFamily: DELA, fontWeight: 400, fontSize: 130, fill: { type: 'solid', color: '#ffffff' }, strokes: [st('#111111', 8)] }), [ca('popIn', { duration: 0.4, stagger: 0.05 })]),
  textPreset('kin-drop', 'キネティック 落下', 'kinetic', ts({ fontFamily: SANS, fontWeight: 900, fontSize: 130, fill: { type: 'solid', color: '#ffd400' }, strokes: [st('#000000', 8)] }), [ca('drop', { duration: 0.6, stagger: 0.06, ease: E('bounce') })]),
  textPreset('kin-type', 'タイプライター', 'kinetic', ts({ fontFamily: 'M PLUS 1 Code', fontWeight: 600, fontSize: 72, align: 'left', fill: { type: 'solid', color: '#ffffff' } }), [ca('typewriter', { duration: 0.01, stagger: 0.07 })]),
  textPreset('kin-wave', 'ウェーブ (継続)', 'kinetic', ts({ fontFamily: ROUND, fontWeight: 800, fontSize: 110, fill: { type: 'linear', color: '#ff7ad9', color2: '#7a5cff', angle: 0 }, strokes: [st('#ffffff', 6)] }), [ca('slideUp', { duration: 0.4 }), ca('wave', { mode: 'loop', duration: 1.2, stagger: 0.08 })]),
  textPreset('kin-shake', '振動 (ドドド)', 'kinetic', ts({ fontFamily: DELA, fontWeight: 400, fontSize: 130, fill: { type: 'solid', color: '#ff3333' }, strokes: [st('#000000', 8), st('#ffffff', 5)] }), [ca('shake', { mode: 'loop', amount: 0.7 })]),
  textPreset('kin-rotate', '回転イン', 'kinetic', ts({ fontFamily: SANS, fontWeight: 900, fontSize: 120, fill: { type: 'linear', color: '#00e0ff', color2: '#0066ff', angle: 90 }, strokes: [st('#ffffff', 6)] }), [ca('rotateIn', { duration: 0.5, stagger: 0.04, ease: E('overshoot') })]),
  textPreset('kin-center', '中央から展開', 'kinetic', ts({ fontFamily: SANS, fontWeight: 900, fontSize: 120, letterSpacing: 10, fill: { type: 'solid', color: '#ffffff' } }), [ca('scaleIn', { duration: 0.45, stagger: 0.05, order: 'center', ease: E('overshoot') })]),
  // YouTube Shorts
  textPreset('shorts-big', 'Shorts 大見出し', 'shorts', ts({ fontFamily: SANS, fontWeight: 900, fontSize: 110, lineHeight: 1.15, fill: { type: 'solid', color: '#ffffff' }, strokes: [st('#000000', 12)], shadow: { enabled: true, color: '#000000aa', blur: 0, offsetX: 6, offsetY: 8 } })),
  textPreset('shorts-yellow', 'Shorts 強調 (黄)', 'shorts', ts({ fontFamily: SANS, fontWeight: 900, fontSize: 110, fill: { type: 'solid', color: '#ffe600' }, strokes: [st('#000000', 12)] }), [ca('popIn', { duration: 0.3, stagger: 0.02 })]),
  textPreset('shorts-caption', 'Shorts 字幕', 'shorts', ts({ fontFamily: SANS, fontWeight: 800, fontSize: 70, fill: { type: 'solid', color: '#ffffff' }, strokes: [st('#000000', 9)] })),
  textPreset('shorts-hook', 'Shorts フック (赤帯)', 'shorts', ts({ fontFamily: SANS, fontWeight: 900, fontSize: 90, fill: { type: 'solid', color: '#ffffff' }, background: { enabled: true, color: '#ff0033', opacity: 1, paddingX: 26, paddingY: 10, radius: 12, skew: 0 } }), [ca('scaleIn', { duration: 0.3, stagger: 0.02, ease: E('overshoot') })]),
  // TikTok
  textPreset('tt-caption', 'TikTok 字幕 (白黒縁)', 'tiktok', ts({ fontFamily: SANS, fontWeight: 800, fontSize: 66, fill: { type: 'solid', color: '#ffffff' }, strokes: [st('#000000', 7)] })),
  textPreset('tt-bubble', 'TikTok 白背景', 'tiktok', ts({ fontFamily: SANS, fontWeight: 800, fontSize: 64, fill: { type: 'solid', color: '#000000' }, background: { enabled: true, color: '#ffffff', opacity: 1, paddingX: 22, paddingY: 10, radius: 16, skew: 0 } })),
  textPreset('tt-glitchy', 'TikTok シアン×ピンク', 'tiktok', ts({ fontFamily: DELA, fontWeight: 400, fontSize: 110, fill: { type: 'solid', color: '#ffffff' }, shadow: { enabled: true, color: '#25f4ee', blur: 0, offsetX: -6, offsetY: 0 }, glow: { enabled: true, color: '#fe2c55', blur: 2, strength: 0.5 } })),
  textPreset('tt-gradient', 'TikTok グラデ', 'tiktok', ts({ fontFamily: POP, fontWeight: 400, fontSize: 100, fill: { type: 'linear', color: '#25f4ee', color2: '#fe2c55', angle: 0 }, strokes: [st('#ffffff', 6), st('#000000', 4)] }), [ca('slideUp', { duration: 0.35, stagger: 0.03 })]),
];

// ---------- アニメーション (キーフレーム) ----------
const animPreset = (id: string, name: string, category: PresetCategory, fn: (c: Clip, p: Project) => void): Preset => ({ id, name, category, kind: 'anim', apply: fn });

function baseXY(c: Clip) {
  const x = c.keyframes['transform.x']?.[0]?.v ?? c.transform.x;
  const y = c.keyframes['transform.y']?.[0]?.v ?? c.transform.y;
  return { x: Number(x), y: Number(y) };
}

const ANIM_PRESETS: Preset[] = [
  animPreset('a-fadein', 'フェードイン', 'cinema', (c) => setKeys(c, 'transform.opacity', [[0, 0], [0.6, 100]])),
  animPreset('a-fadeout', 'フェードアウト', 'cinema', (c) => setKeys(c, 'transform.opacity', [[c.duration - 0.6, 100], [c.duration, 0]])),
  animPreset('a-fadeinout', 'フェードイン＋アウト', 'cinema', (c) => setKeys(c, 'transform.opacity', [[0, 0], [0.5, 100], [c.duration - 0.5, 100], [c.duration, 0]])),
  animPreset('a-slide-left', '左からスライドイン', 'tv', (c, p) => {
    const { x } = baseXY(c);
    setKeys(c, 'transform.x', [[0, x - p.width * 0.6, E('easeOut')], [0.5, x]]);
    setKeys(c, 'transform.opacity', [[0, 0], [0.25, 100]]);
  }),
  animPreset('a-slide-right', '右からスライドイン', 'tv', (c, p) => {
    const { x } = baseXY(c);
    setKeys(c, 'transform.x', [[0, x + p.width * 0.6, E('easeOut')], [0.5, x]]);
    setKeys(c, 'transform.opacity', [[0, 0], [0.25, 100]]);
  }),
  animPreset('a-slide-up', '下からスライドイン', 'news', (c, p) => {
    const { y } = baseXY(c);
    setKeys(c, 'transform.y', [[0, y + p.height * 0.15, E('easeOut')], [0.45, y]]);
    setKeys(c, 'transform.opacity', [[0, 0], [0.3, 100]]);
  }),
  animPreset('a-pop', 'ポップイン (オーバーシュート)', 'shorts', (c) => {
    setKeys(c, 'transform.scaleX', [[0, 0, E('overshoot', 1.4)], [0.35, c.transform.scaleX]]);
    setKeys(c, 'transform.scaleY', [[0, 0, E('overshoot', 1.4)], [0.35, c.transform.scaleY]]);
  }),
  animPreset('a-spring', 'スプリングイン', 'kinetic', (c) => {
    setKeys(c, 'transform.scaleX', [[0, 30, E('spring', 1)], [0.9, c.transform.scaleX]]);
    setKeys(c, 'transform.scaleY', [[0, 30, E('spring', 1)], [0.9, c.transform.scaleY]]);
    setKeys(c, 'transform.opacity', [[0, 0], [0.15, 100]]);
  }),
  animPreset('a-drop', '上から落下 (バウンス)', 'tv', (c, p) => {
    const { y } = baseXY(c);
    setKeys(c, 'transform.y', [[0, y - p.height * 0.6, E('bounce')], [0.8, y]]);
  }),
  animPreset('a-zoom-punch', 'ズームパンチ', 'tiktok', (c) => {
    const s = c.transform.scaleX;
    setKeys(c, 'transform.scaleX', [[0, s * 1.6, E('easeOut')], [0.25, s]]);
    setKeys(c, 'transform.scaleY', [[0, s * 1.6, E('easeOut')], [0.25, s]]);
    c.motionBlur = { enabled: true, shutterAngle: 180, samples: 10 };
  }),
  animPreset('a-kenburns', 'ケン・バーンズ (ゆっくりズーム)', 'cinema', (c) => {
    const s = c.transform.scaleX;
    setKeys(c, 'transform.scaleX', [[0, s, E('linear')], [c.duration, s * 1.15]]);
    setKeys(c, 'transform.scaleY', [[0, s, E('linear')], [c.duration, s * 1.15]]);
  }),
  animPreset('a-spin', '360°回転', 'kinetic', (c) => setKeys(c, 'transform.rotation', [[0, c.transform.rotation - 360, E('easeInOut')], [0.8, c.transform.rotation]])),
  animPreset('a-flip', '3D フリップイン', 'space', (c) => {
    setKeys(c, 'transform.rotationY', [[0, 90, E('easeOut')], [0.6, 0]]);
    setKeys(c, 'transform.opacity', [[0, 0], [0.2, 100]]);
  }),
  animPreset('a-tilt', '3D 奥から起き上がる', 'space', (c) => {
    setKeys(c, 'transform.rotationX', [[0, 75, E('easeOut')], [0.8, 0]]);
    setKeys(c, 'transform.z', [[0, 800, E('easeOut')], [0.8, 0]]);
    setKeys(c, 'transform.opacity', [[0, 0], [0.3, 100]]);
  }),
  animPreset('a-fly-z', '奥から飛来 (Z)', 'space', (c) => {
    setKeys(c, 'transform.z', [[0, 4000, E('easeOut')], [1.2, 0]]);
    setKeys(c, 'transform.opacity', [[0, 0], [0.4, 100]]);
    c.motionBlur = { enabled: true, shutterAngle: 270, samples: 12 };
  }),
  animPreset('a-float', 'ふわふわ浮遊 (継続)', 'science', (c) => {
    const { y } = baseXY(c);
    const keys: [number, number, Ease][] = [];
    for (let t = 0; t <= c.duration + 0.01; t += 1) keys.push([t, y + (Math.round(t) % 2 ? -14 : 14), E('easeInOut')]);
    setKeys(c, 'transform.y', keys);
  }),
  animPreset('a-pulse', '鼓動 (継続)', 'neon', (c) => {
    const s = c.transform.scaleX;
    const keys: [number, number, Ease][] = [];
    for (let t = 0; t <= c.duration + 0.01; t += 0.5) keys.push([t, Math.round(t * 2) % 2 ? s * 1.08 : s, E('easeInOut')]);
    setKeys(c, 'transform.scaleX', keys);
    setKeys(c, 'transform.scaleY', keys);
  }),
  animPreset('a-blur-in', 'ブラーイン', 'cinema', (c) => {
    const e = createEffect('gaussianBlur', { radius: 40 });
    c.effects.push(e);
    setKeys(c, `effects.${e.id}.radius`, [[0, 40, E('easeOut')], [0.7, 0]]);
    setKeys(c, 'transform.opacity', [[0, 0], [0.4, 100]]);
  }),
  animPreset('a-glitch-in', 'グリッチイン', 'tiktok', (c) => {
    const e = createEffect('glitch', { amount: 1, speed: 20 });
    c.effects.push(e);
    setKeys(c, `effects.${e.id}.amount`, [[0, 1, E('linear')], [0.5, 0]]);
  }),
  animPreset('a-flash-in', 'フラッシュイン', 'tv', (c) => {
    const e = createEffect('flash', { amount: 1 });
    c.effects.push(e);
    setKeys(c, `effects.${e.id}.amount`, [[0, 1, E('easeOut')], [0.4, 0]]);
  }),
  animPreset('a-stretch', '横に伸びて登場', 'news', (c) => {
    setKeys(c, 'transform.scaleX', [[0, 0, E('easeOut')], [0.4, c.transform.scaleX]]);
  }),
  animPreset('a-shake', '揺れ (衝撃)', 'tv', (c) => {
    const e = createEffect('cameraShake', { amount: 30, rotation: 3, frequency: 14 });
    c.effects.push(e);
    setKeys(c, `effects.${e.id}.amount`, [[0, 40, E('easeOut')], [0.8, 0]]);
  }),
  animPreset('a-draw', '線を描く (図形)', 'science', (c) => {
    if (c.shape) {
      c.shape.stroke.enabled = true;
      setKeys(c, 'shape.trimEnd', [[0, 0, E('easeInOut')], [1, 1]]);
    } else if (c.chart) setKeys(c, 'chart.progress', [[0, 0, E('easeOut')], [1.5, 1]]);
    else if (c.counter) setKeys(c, 'counter.progress', [[0, 0, E('easeOut')], [2, 1]]);
  }),
  animPreset('a-count', 'カウントアップ', 'science', (c) => {
    if (c.counter) setKeys(c, 'counter.progress', [[0, 0, E('easeOut')], [Math.min(2.5, c.duration), 1]]);
    else if (c.shape?.kind === 'ring') setKeys(c, 'shape.progress', [[0, 0, E('easeOut')], [Math.min(2.5, c.duration), c.shape.progress]]);
  }),
];

// ---------- エフェクトスタック ----------
const fxPreset = (id: string, name: string, category: PresetCategory, list: [EffectType, Record<string, number | string | boolean>][], extra?: (c: Clip) => void): Preset => ({
  id,
  name,
  category,
  kind: 'effect',
  apply: (c) => {
    for (const [type, params] of list) c.effects.push(createEffect(type, params));
    extra?.(c);
  },
});

const EFFECT_PRESETS: Preset[] = [
  fxPreset('fx-neon-glow', 'ネオングロー', 'neon', [['neon', { color: '#00e5ff', radius: 30, intensity: 2.2 }]]),
  fxPreset('fx-neon-pink', 'ネオン ピンク点滅', 'neon', [['neon', { color: '#ff2fb3', radius: 34, intensity: 2.4, flicker: 0.5 }]]),
  fxPreset('fx-bloom', '映画的ブルーム', 'cinema', [['glow', { threshold: 0.65, radius: 40, intensity: 0.9 }]]),
  fxPreset('fx-dreamy', 'ドリーミー', 'tv', [['glow', { threshold: 0.3, radius: 50, intensity: 0.8, color: '#ffd9f2', tint: 0.4 }]]),
  fxPreset('fx-vhs', 'VHS', 'tiktok', [['chromaticAberration', { amount: 0.35 }], ['noise', { amount: 0.18, mono: true }], ['scanlines', { amount: 0.25, density: 3 }], ['wave', { amplitude: 2, wavelength: 300, speed: 3 }]]),
  fxPreset('fx-glitch', 'グリッチ', 'tiktok', [['glitch', { amount: 0.6, speed: 12, blocks: 20 }], ['rgbSplit', { amount: 6 }]]),
  fxPreset('fx-cyber', 'サイバー', 'neon', [['rgbSplit', { amount: 5, angle: 0 }], ['scanlines', { amount: 0.3, density: 2 }], ['glow', { threshold: 0.4, radius: 30, intensity: 1.2, color: '#00ffe0', tint: 0.5 }]]),
  fxPreset('fx-godrays', '光線 (ゴッドレイ)', 'space', [['lightRays', { x: 0.5, y: 0.2, length: 0.6, intensity: 1.2 }]]),
  fxPreset('fx-flare', 'レンズフレア', 'space', [['lensFlare', { x: 0.25, y: 0.25, intensity: 1.1 }]]),
  fxPreset('fx-star-glow', '星の輝き', 'space', [['glow', { threshold: 0.5, radius: 20, intensity: 2, color: '#9fc8ff', tint: 0.6 }], ['lensFlare', { x: 0.7, y: 0.3, intensity: 0.6, size: 0.6 }]]),
  fxPreset('fx-echo', '残像トレイル', 'kinetic', [['echo', { count: 6, delay: 0.04, decay: 0.65 }]]),
  fxPreset('fx-motion', 'モーションブラー強', 'kinetic', [], (c) => (c.motionBlur = { enabled: true, shutterAngle: 360, samples: 16 })),
  fxPreset('fx-shake', 'カメラシェイク (地震)', 'tv', [['cameraShake', { amount: 25, rotation: 2, frequency: 12 }]]),
  fxPreset('fx-water', '水面ゆらぎ', 'science', [['ripple', { amplitude: 8, wavelength: 80, speed: 1.5 }]]),
  fxPreset('fx-miniature', 'ミニチュア (被写界深度)', 'cinema', [['tiltShift', { focus: 0.55, range: 0.18, blur: 22 }]], (c) => {
    c.grade.enabled = true;
    c.grade.saturation = 0.35;
    c.grade.contrast = 0.12;
  }),
  fxPreset('fx-chroma-green', 'クロマキー (グリーンバック)', 'tv', [['chromaKey', { color: '#00ff00', tolerance: 0.3, softness: 0.1, spill: 0.6 }]]),
  fxPreset('fx-chroma-blue', 'クロマキー (ブルーバック)', 'tv', [['chromaKey', { color: '#0047ff', tolerance: 0.3, softness: 0.1, spill: 0.6 }]]),
  fxPreset('fx-shadow', 'ドロップシャドウ', 'news', [['shadow', { distance: 14, softness: 18, opacity: 0.75 }]]),
  fxPreset('fx-gold-glow', '金色の輝き', 'gold', [['glow', { threshold: 0.45, radius: 30, intensity: 1.4, color: '#ffc94d', tint: 0.8 }], ['lensFlare', { x: 0.75, y: 0.25, intensity: 0.5, color: '#ffd36b', size: 0.7 }]]),
];

// ---------- カラールック ----------
const lookPreset = (id: string, name: string, category: PresetCategory, g: Partial<Clip['grade']>): Preset => ({
  id,
  name,
  category,
  kind: 'look',
  apply: (c) => {
    c.grade = { ...c.grade, ...JSON.parse(JSON.stringify(g)), enabled: true };
  },
});
const curve = (pts: [number, number][]) => pts;
const LOOK_PRESETS: Preset[] = [
  lookPreset('l-teal-orange', 'ティール＆オレンジ', 'cinema', { contrast: 0.15, saturation: 0.1, temperature: 0.1, curves: { ...defaultCurves(), r: curve([[0, 0], [0.25, 0.2], [0.75, 0.8], [1, 1]]), b: curve([[0, 0.06], [0.3, 0.33], [0.75, 0.7], [1, 0.92]]) } }),
  lookPreset('l-film-warm', 'フィルム (暖色)', 'cinema', { temperature: 0.25, fade: 0.25, contrast: 0.08, grain: 0.15, vignette: 0.25 }),
  lookPreset('l-vintage', 'ビンテージ', 'tv', { temperature: 0.3, saturation: -0.3, fade: 0.4, grain: 0.25, vignette: 0.4, curves: { ...defaultCurves(), master: curve([[0, 0.08], [0.5, 0.5], [1, 0.92]]) } }),
  lookPreset('l-mono', 'モノクロ', 'cinema', { saturation: -1, contrast: 0.1 }),
  lookPreset('l-noir', 'ノワール (高コントラスト)', 'cinema', { saturation: -1, contrast: 0.45, vignette: 0.55, grain: 0.2, curves: { ...defaultCurves(), master: curve([[0, 0], [0.3, 0.18], [0.7, 0.85], [1, 1]]) } }),
  lookPreset('l-bleach', 'ブリーチバイパス', 'cinema', { saturation: -0.45, contrast: 0.35, highlights: 0.1 }),
  lookPreset('l-space-blue', '宇宙ブルー', 'space', { temperature: -0.35, contrast: 0.2, blacks: 0.3, saturation: 0.15, vignette: 0.35 }),
  lookPreset('l-deep-space', '深宇宙 (締まった黒)', 'space', { contrast: 0.3, blacks: 0.5, shadows: -0.3, saturation: 0.25, vibrance: 0.3 }),
  lookPreset('l-neon-night', 'ネオンナイト', 'neon', { tint: 0.3, temperature: -0.15, saturation: 0.35, contrast: 0.2, hue: -8 }),
  lookPreset('l-sunset', '夕焼け', 'tv', { temperature: 0.45, tint: 0.15, saturation: 0.2, highlights: -0.1 }),
  lookPreset('l-pastel', 'パステル', 'tiktok', { saturation: -0.15, brightness: 0.12, fade: 0.2, contrast: -0.15 }),
  lookPreset('l-cool', 'クール', 'science', { temperature: -0.25, contrast: 0.08 }),
  lookPreset('l-warm', 'ウォーム', 'tv', { temperature: 0.25, saturation: 0.08 }),
  lookPreset('l-news-clear', 'ニュース (クリア)', 'news', { contrast: 0.08, vibrance: 0.2, shadows: 0.15, highlights: -0.1 }),
  lookPreset('l-hdr', 'HDR風', 'shorts', { shadows: 0.45, highlights: -0.4, vibrance: 0.4, contrast: 0.12 }),
  lookPreset('l-vivid', 'ビビッド (SNS向け)', 'tiktok', { saturation: 0.3, vibrance: 0.3, contrast: 0.12 }),
  lookPreset('l-gold-hour', 'ゴールデンアワー', 'gold', { temperature: 0.35, highlights: 0.1, saturation: 0.15, vignette: 0.2, curves: { ...defaultCurves(), r: curve([[0, 0.03], [0.5, 0.56], [1, 1]]), b: curve([[0, 0], [0.5, 0.44], [1, 0.9]]) } }),
];

// ---------- テンプレート ----------
function addClip(p: Project, c: Clip, preferTrackKind: 'visual' | 'audio' = 'visual') {
  // 背景は背面トラック、それ以外は前面トラックから空きを探す (テキストが背景に隠れないように)
  const tr = findFreeTrack(p, preferTrackKind, c.start, c.start + c.duration, undefined, undefined, c.type === 'solid' ? 'bottom' : 'top');
  c.trackId = tr.id;
  p.clips.push(c);
  return c;
}

function textClip(p: Project, t: number, dur: number, content: string, style: TextStyle, x: number, y: number, anims: CharAnimation[] = []): Clip {
  const c = createClip(p, 'text', '', t, dur, { name: content.slice(0, 12) });
  c.text = { content, style: JSON.parse(JSON.stringify(style)), anims };
  c.transform.x = x;
  c.transform.y = y;
  return c;
}

function shapeClip(p: Project, t: number, dur: number, kind: Clip['shape'] extends infer S ? (S extends { kind: infer K } ? K : never) : never, w: number, h: number, x: number, y: number, color: string): Clip {
  const c = createClip(p, 'shape', '', t, dur, { name: '図形' });
  c.shape = { ...defaultShape(kind), width: w, height: h };
  c.shape.fill.color = color;
  c.transform.x = x;
  c.transform.y = y;
  return c;
}

function findText(id: string) {
  const pr = TEXT_PRESETS.find((x) => x.id === id)!;
  const c = { type: 'text', text: { content: '', style: defaultTextStyle(), anims: [] } } as unknown as Clip;
  pr.apply!(c, {} as Project);
  return { style: c.text!.style, anims: c.text!.anims };
}

const tpl = (id: string, name: string, category: PresetCategory, build: (p: Project, t: number) => void): Preset => ({ id, name, category, kind: 'template', build });
const ANIM = (id: string) => ANIM_PRESETS.find((a) => a.id === id)!.apply!;

const TEMPLATE_PRESETS: Preset[] = [
  tpl('t-news-lower', 'ニュース ローワーサード', 'news', (p, t) => {
    const W = p.width;
    const H = p.height;
    const y = H * 0.8;
    const bar = addClip(p, shapeClip(p, t, 5, 'rect', W * 0.8, H * 0.075, W * 0.45, y, '#0f63d6'));
    bar.shape!.fill = { enabled: true, type: 'linear', color: '#0a3d91', color2: '#1478ff', angle: 0 };
    ANIM('a-stretch')(bar, p);
    bar.transform.anchorX = -W * 0.4;
    bar.transform.x = W * 0.05;
    const accent = addClip(p, shapeClip(p, t + 0.15, 4.85, 'rect', W * 0.012, H * 0.075, W * 0.05, y, '#ffcc00'));
    ANIM('a-fadein')(accent, p);
    const s = findText('news-sub');
    const tx = addClip(p, textClip(p, t + 0.3, 4.7, '見出しテキストを入力', { ...s.style, background: { ...s.style.background, enabled: false }, fill: { ...s.style.fill, color: '#ffffff' }, fontSize: Math.round(H * 0.035), align: 'left' }, W * 0.08, y));
    ANIM('a-slide-up')(tx, p);
  }),
  tpl('t-name', '名前テロップ (肩書き付き)', 'tv', (p, t) => {
    const W = p.width;
    const H = p.height;
    const s = findText('news-name');
    const a = addClip(p, textClip(p, t, 4, '肩書き', { ...s.style, fontSize: Math.round(H * 0.022), background: { ...s.style.background, color: '#e0a800', opacity: 1 }, fill: { ...s.style.fill, color: '#111111' } }, W * 0.07, H * 0.74));
    ANIM('a-slide-left')(a, p);
    const b = addClip(p, textClip(p, t + 0.15, 3.85, '山田 太郎', { ...s.style, fontSize: Math.round(H * 0.04) }, W * 0.07, H * 0.8));
    ANIM('a-slide-left')(b, p);
  }),
  tpl('t-subscribe', 'チャンネル登録ボタン', 'shorts', (p, t) => {
    const W = p.width;
    const H = p.height;
    const btn = addClip(p, shapeClip(p, t, 4, 'rect', W * 0.5, H * 0.07, W / 2, H * 0.78, '#ff0033'));
    btn.shape!.radius = H * 0.035;
    ANIM('a-pop')(btn, p);
    btn.effects.push(createEffect('shadow', { distance: 10, softness: 20, opacity: 0.5 }));
    const tx = addClip(p, textClip(p, t + 0.1, 3.9, 'チャンネル登録', ts({ fontFamily: SANS, fontWeight: 900, fontSize: Math.round(H * 0.032), fill: { type: 'solid', color: '#ffffff' } }), W / 2, H * 0.78));
    ANIM('a-pop')(tx, p);
    const bell = addClip(p, shapeClip(p, t + 0.4, 3.6, 'icon', H * 0.05, H * 0.05, W * 0.82, H * 0.78, '#ffffff'));
    bell.shape!.iconId = 'bell';
    ANIM('a-spring')(bell, p);
  }),
  tpl('t-chapter', '章タイトル (番号付き)', 'science', (p, t) => {
    const W = p.width;
    const H = p.height;
    const num = addClip(p, textClip(p, t, 3, '01', ts({ fontFamily: SANS, fontWeight: 900, fontSize: Math.round(H * 0.12), fill: { type: 'linear', color: '#00d9ff', color2: '#0066ff', angle: 90 } }), W / 2, H * 0.42, [ca('slideUp', { duration: 0.5 })]));
    void num;
    const line = addClip(p, shapeClip(p, t + 0.2, 2.8, 'line', W * 0.5, 10, W / 2, H * 0.5, '#ffffff'));
    line.shape!.stroke.width = 6;
    ANIM('a-draw')(line, p);
    addClip(p, textClip(p, t + 0.4, 2.6, '章のタイトル', findText('sci-chapter').style, W / 2, H * 0.57, [ca('fade', { duration: 0.6, stagger: 0.04 })]));
  }),
  tpl('t-space-title', '宇宙タイトル (星空背景)', 'space', (p, t) => {
    const W = p.width;
    const H = p.height;
    const bg = createClip(p, 'solid', '', t, 6, { name: '星空' });
    bg.solid = { color: '#02030a', width: W, height: H, fill: { type: 'radial', color: '#0b1640', color2: '#000000', angle: 0 }, animated: 'starfield', animSpeed: 1 };
    bg.transform.x = W / 2;
    bg.transform.y = H / 2;
    addClip(p, bg);
    const s = findText('space-glow');
    const tx = addClip(p, textClip(p, t + 0.5, 5.5, '宇宙の果て', { ...s.style, fontSize: Math.round(Math.min(W, H) * 0.09) }, W / 2, H / 2, s.anims));
    tx.effects.push(createEffect('lensFlare', { x: 0.3, y: 0.45, intensity: 0.8 }));
    const fl = tx.effects[tx.effects.length - 1];
    setKeys(tx, `effects.${fl.id}.x`, [[0, 0.1, E('easeInOut')], [5.5, 0.9]]);
  }),
  tpl('t-gauge', '円形ゲージ＋数値', 'science', (p, t) => {
    const W = p.width;
    const H = p.height;
    const size = Math.min(W, H) * 0.45;
    const ring = addClip(p, shapeClip(p, t, 5, 'ring', size, size, W / 2, H / 2, '#00d9ff'));
    ring.shape!.stroke.color = '#00d9ff';
    ring.shape!.progress = 78;
    ring.shape!.thickness = size * 0.09;
    ANIM('a-count')(ring, p);
    ring.effects.push(createEffect('glow', { threshold: 0.2, radius: 20, intensity: 1 }));
    const ctr = createClip(p, 'counter', '', t, 5, { name: 'カウンター' });
    ctr.counter!.to = 78;
    ctr.counter!.suffix = '%';
    ctr.counter!.style = ts({ fontFamily: SANS, fontWeight: 900, fontSize: Math.round(size * 0.28), fill: { type: 'solid', color: '#ffffff' } });
    ctr.transform.x = W / 2;
    ctr.transform.y = H / 2;
    ANIM('a-count')(ctr, p);
    addClip(p, ctr);
  }),
  tpl('t-bar-chart', '棒グラフ解説', 'science', (p, t) => {
    const W = p.width;
    const H = p.height;
    const ch = createClip(p, 'chart', '', t, 6, { name: 'グラフ' });
    ch.chart!.width = W * 0.75;
    ch.chart!.height = H * 0.4;
    ch.chart!.labels = ['水星', '金星', '地球', '火星'];
    ch.chart!.values = [0.38, 0.91, 1, 0.38];
    ch.transform.x = W / 2;
    ch.transform.y = H * 0.55;
    ANIM('a-draw')(ch, p);
    addClip(p, ch);
    addClip(p, textClip(p, t, 6, '惑星の重力比較', findText('sci-label').style, W / 2, H * 0.2, [ca('fade', { duration: 0.5 })]));
  }),
  tpl('t-neon-title', 'ネオンタイトル', 'neon', (p, t) => {
    const W = p.width;
    const H = p.height;
    const bg = createClip(p, 'solid', '', t, 5, { name: 'グリッド背景' });
    bg.solid = { color: '#08001a', width: W, height: H, fill: { type: 'linear', color: '#08001a', color2: '#ff2fb3', angle: 90 }, animated: 'grid', animSpeed: 1 };
    bg.solid.fill.color2 = '#ff2fb3';
    bg.transform.x = W / 2;
    bg.transform.y = H / 2;
    addClip(p, bg);
    const s = findText('neon-cyan');
    addClip(p, textClip(p, t + 0.3, 4.7, 'NEON NIGHT', { ...s.style, fontSize: Math.round(Math.min(W, H) * 0.12) }, W / 2, H * 0.32, [ca('fade', { duration: 0.15, stagger: 0.08, order: 'random' })]));
  }),
  tpl('t-cinema-open', '映画オープニング (シネスコ)', 'cinema', (p, t) => {
    const W = p.width;
    const H = p.height;
    const barH = Math.max(0, (H - W / 2.39) / 2);
    const top = addClip(p, shapeClip(p, t, 8, 'rect', W, Math.max(2, barH), W / 2, barH / 2, '#000000'));
    const bot = addClip(p, shapeClip(p, t, 8, 'rect', W, Math.max(2, barH), W / 2, H - barH / 2, '#000000'));
    void top;
    void bot;
    const s = findText('cine-title');
    addClip(p, textClip(p, t + 1, 6, 'タイトル', { ...s.style, fontSize: Math.round(Math.min(W, H) * 0.08) }, W / 2, H / 2, s.anims));
  }),
  tpl('t-gold-title', '金色タイトル＋輝き', 'gold', (p, t) => {
    const W = p.width;
    const H = p.height;
    const s = findText('gold-main');
    const tx = addClip(p, textClip(p, t, 5, '祝 100万回再生', { ...s.style, fontSize: Math.round(Math.min(W, H) * 0.1) }, W / 2, H / 2));
    ANIM('a-spring')(tx, p);
    tx.effects.push(createEffect('glow', { threshold: 0.55, radius: 30, intensity: 1.2, color: '#ffc94d', tint: 0.7 }));
    const sp = createClip(p, 'particles', '', t, 5, { name: 'きらめき' });
    sp.particles = { ...defaultParticles('fireflies', W, H), colors: ['#fff3b0', '#ffd24d', '#ffffff'], count: 70, size: 7, emitterH: 0.5, emitterY: 0.5 };
    sp.transform.x = W / 2;
    sp.transform.y = H / 2;
    addClip(p, sp);
  }),
  tpl('t-shorts-hook', 'Shorts フック＋字幕', 'shorts', (p, t) => {
    const W = p.width;
    const H = p.height;
    const s = findText('shorts-hook');
    addClip(p, textClip(p, t, 3, '最後まで見て！', { ...s.style, fontSize: Math.round(W * 0.075) }, W / 2, H * 0.18, s.anims));
    const c = findText('shorts-caption');
    addClip(p, textClip(p, t, 3, 'ここに字幕を入力', { ...c.style, fontSize: Math.round(W * 0.06) }, W / 2, H * 0.72));
  }),
  tpl('t-tiktok-caption', 'TikTok 字幕セット', 'tiktok', (p, t) => {
    const W = p.width;
    const H = p.height;
    const c = findText('tt-bubble');
    const a = addClip(p, textClip(p, t, 2.5, 'POVで見てね', { ...c.style, fontSize: Math.round(W * 0.055) }, W / 2, H * 0.3));
    ANIM('a-pop')(a, p);
    const b = findText('tt-caption');
    addClip(p, textClip(p, t, 2.5, '字幕テキスト', { ...b.style, fontSize: Math.round(W * 0.055) }, W / 2, H * 0.7, [ca('popIn', { duration: 0.25, stagger: 0.03 })]));
  }),
  tpl('t-breaking', 'ニュース速報バナー', 'news', (p, t) => {
    const W = p.width;
    const H = p.height;
    const bar = addClip(p, shapeClip(p, t, 5, 'rect', W, H * 0.09, W / 2, H * 0.12, '#c8102e'));
    ANIM('a-stretch')(bar, p);
    ANIM('a-flash-in')(bar, p);
    const s = findText('news-breaking');
    addClip(p, textClip(p, t + 0.2, 4.8, 'ニュース速報', { ...s.style, background: { ...s.style.background, enabled: false }, fontSize: Math.round(H * 0.045) }, W / 2, H * 0.12, [ca('fade', { duration: 0.2, stagger: 0.03 })]));
  }),
  tpl('t-countdown', 'カウントダウン 3-2-1', 'tv', (p, t) => {
    const W = p.width;
    const H = p.height;
    const ring = addClip(p, shapeClip(p, t, 3, 'ring', Math.min(W, H) * 0.5, Math.min(W, H) * 0.5, W / 2, H / 2, '#ffffff'));
    ring.shape!.progress = 100;
    ring.shape!.stroke.color = '#ffffff';
    ring.shape!.thickness = 16;
    setKeys(ring, 'shape.progress', [[0, 100, E('linear')], [1, 0, E('hold')], [1.0001, 100, E('linear')], [2, 0, E('hold')], [2.0001, 100, E('linear')], [3, 0]]);
    const ctr = createClip(p, 'counter', '', t, 3, { name: 'カウントダウン' });
    // 3.4→0.4 を四捨五入表示すると 3,2,1 と切り替わる (ホールド補間で段階的に変化)
    ctr.counter = { ...ctr.counter!, from: 3.4, to: 0.4, progress: 0, decimals: 0, thousands: false, style: ts({ fontFamily: DELA, fontWeight: 400, fontSize: Math.round(Math.min(W, H) * 0.25), fill: { type: 'solid', color: '#ffffff' } }) };
    setKeys(ctr, 'counter.progress', [[0, 0, E('hold')], [1, 1 / 3, E('hold')], [2, 2 / 3, E('hold')], [3, 1]]);
    ctr.transform.x = W / 2;
    ctr.transform.y = H / 2;
    addClip(p, ctr);
  }),
  tpl('t-celebrate', 'お祝い (紙吹雪)', 'tv', (p, t) => {
    const W = p.width;
    const H = p.height;
    const cf = createClip(p, 'particles', '', t, 4, { name: '紙吹雪' });
    cf.particles = defaultParticles('confetti', W, H);
    cf.transform.x = W / 2;
    cf.transform.y = H / 2;
    addClip(p, cf);
    const s = findText('tv-yellow');
    const tx = addClip(p, textClip(p, t, 4, 'おめでとう！', { ...s.style, fontSize: Math.round(Math.min(W, H) * 0.12) }, W / 2, H * 0.45));
    ANIM('a-pop')(tx, p);
  }),
  tpl('t-kinetic-3', 'キネティック 3行タイトル', 'kinetic', (p, t) => {
    const W = p.width;
    const H = p.height;
    const fs = Math.round(Math.min(W, H) * 0.11);
    const lines = ['知らないと', '損する', '雑学'];
    const presets = ['kin-drop', 'kin-pop', 'kin-shake'];
    lines.forEach((l, i) => {
      const s = findText(presets[i]);
      addClip(p, textClip(p, t + i * 0.35, 4 - i * 0.35, l, { ...s.style, fontSize: i === 2 ? Math.round(fs * 1.4) : fs }, W / 2, H * (0.35 + i * 0.13), s.anims));
    });
  }),
  tpl('t-planet-label', '天体ラベル (指示線)', 'space', (p, t) => {
    const W = p.width;
    const H = p.height;
    const dot = addClip(p, shapeClip(p, t, 5, 'ellipse', 24, 24, W * 0.4, H * 0.55, '#ffffff'));
    ANIM('a-pop')(dot, p);
    dot.effects.push(createEffect('glow', { threshold: 0.1, radius: 16, intensity: 1.5 }));
    const line = addClip(p, shapeClip(p, t + 0.2, 4.8, 'line', W * 0.25, 10, W * 0.525, H * 0.55, '#ffffff'));
    line.shape!.stroke.width = 4;
    line.transform.rotation = -25;
    line.transform.anchorX = -W * 0.125;
    line.transform.x = W * 0.4;
    ANIM('a-draw')(line, p);
    const s = findText('space-planet');
    addClip(p, textClip(p, t + 0.7, 4.3, '木星', { ...s.style, fontSize: Math.round(Math.min(W, H) * 0.06), align: 'left' }, W * 0.68, H * 0.47, [ca('fade', { duration: 0.5, stagger: 0.1 })]));
  }),
];

export const PRESETS: Preset[] = [...TEXT_PRESETS, ...ANIM_PRESETS, ...EFFECT_PRESETS, ...LOOK_PRESETS, ...TEMPLATE_PRESETS];

export const TRANSITION_LABELS: Record<TransitionType, string> = {
  crossfade: 'クロスフェード',
  fadeBlack: '黒フェード',
  fadeWhite: '白フェード',
  wipeLeft: 'ワイプ ←',
  wipeRight: 'ワイプ →',
  wipeUp: 'ワイプ ↑',
  wipeDown: 'ワイプ ↓',
  slideLeft: 'スライド ←',
  slideRight: 'スライド →',
  slideUp: 'スライド ↑',
  slideDown: 'スライド ↓',
  zoomIn: 'ズームイン',
  zoomOut: 'ズームアウト',
  circle: '円形',
  blur: 'ブラー',
  glitch: 'グリッチ',
  flash: 'フラッシュ',
  spin: 'スピン',
  pixelize: 'モザイク',
};

/** 利用者が保存したテロッププリセットはローカル DB に保存する (presetStore.ts) */
export function textStyleOf(c: Clip): { style: TextStyle; anims: CharAnimation[] } | null {
  if (c.type === 'text' && c.text) return { style: JSON.parse(JSON.stringify(c.text.style)), anims: JSON.parse(JSON.stringify(c.text.anims)) };
  if (c.type === 'counter' && c.counter) return { style: JSON.parse(JSON.stringify(c.counter.style)), anims: [] };
  return null;
}
