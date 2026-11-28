// 「YMM4テンプレ」: ゆっくりMovieMaker4 で定番のテキストテンプレート (39 種類) を再現したテロップ
import type { Fill, Stroke, TextStyle } from '../model/types';
import { defaultTextStyle } from '../model/defaults';

/** 毛筆風の極太明朝 (斜体で使う) */
const BRUSH = 'Kaisei Tokumin';
/** 丸ゴシック極太 */
const ROUND = 'M PLUS Rounded 1c';
/** 角ゴシック極太 */
const SANS = 'Noto Sans JP';
/** 細い行書風 */
const CALLI = 'Shippori Mincho B1';

type Opt = {
  font: 'brush' | 'round' | 'sans' | 'calli';
  fill: Fill;
  strokes?: [string, number][];
  glow?: [string, number, number]; // 色, 広がり, 強さ
  shadow?: [string, number, number, number]; // 色, ぼかし, X, Y
  extrude?: [string, number, number]; // 色, 厚み, 角度
  size?: number;
  italic?: boolean;
  gloss?: number;
};

const solid = (c: string): Fill => ({ type: 'solid', color: c, color2: c, angle: 90 });
/** 上 → 下のグラデーション */
const grad = (...stops: string[]): Fill => ({ type: 'linear', color: stops[0], color2: stops[stops.length - 1], angle: 90, stops });
const gradA = (angle: number, ...stops: string[]): Fill => ({ type: 'linear', color: stops[0], color2: stops[stops.length - 1], angle, stops });

function style(o: Opt): TextStyle {
  const s = defaultTextStyle();
  const font = { brush: [BRUSH, 800], round: [ROUND, 900], sans: [SANS, 900], calli: [CALLI, 600] }[o.font] as [string, number];
  s.fontFamily = font[0];
  s.fontWeight = font[1];
  s.italic = o.italic ?? (o.font === 'brush' || o.font === 'calli');
  s.fontSize = o.size ?? 96;
  s.letterSpacing = 0;
  s.fill = o.fill;
  const strokes: Stroke[] = (o.strokes ?? []).map(([color, width]) => ({ enabled: true, color, width }));
  while (strokes.length < 3) strokes.push({ enabled: false, color: '#000000', width: 4 });
  s.strokes = strokes;
  s.glow = o.glow ? { enabled: true, color: o.glow[0], blur: o.glow[1], strength: o.glow[2] } : { ...s.glow, enabled: false };
  s.shadow = o.shadow ? { enabled: true, color: o.shadow[0], blur: o.shadow[1], offsetX: o.shadow[2], offsetY: o.shadow[3] } : { ...s.shadow, enabled: false };
  s.extrude = o.extrude ? { enabled: true, color: o.extrude[0], depth: o.extrude[1], angle: o.extrude[2] } : { ...s.extrude, enabled: false };
  s.gloss = o.gloss ? { enabled: true, opacity: o.gloss } : { ...s.gloss, enabled: false };
  s.background = { ...s.background, enabled: false };
  return s;
}

export interface YmmTemplate {
  id: string;
  name: string;
  style: TextStyle;
}

const T: [string, Opt][] = [
  // 1 行目
  ['赤黒グロー', { font: 'brush', fill: grad('#d01010', '#500000', '#0a0000'), strokes: [['#ff1a1a', 3]], glow: ['#ff0000', 24, 1.5] }],
  ['オレンジ立体', { font: 'round', italic: false, fill: grad('#ff1a00', '#ff7a00', '#ffcc00'), strokes: [['#ffffff', 4]], extrude: ['#d06000', 8, 60], glow: ['#ff8c00', 22, 1] }],
  ['紫の影', { font: 'round', size: 82, italic: false, fill: grad('#c878e8', '#7a2ab0'), strokes: [['#2a0838', 4]], extrude: ['#3a0a50', 6, 45], shadow: ['#000000aa', 10, 0, 4] }],
  ['シルバー', { font: 'brush', fill: grad('#ffffff', '#d0d0d0', '#7a7a7a', '#c4c4c4'), strokes: [['#2a2a2a', 3]], shadow: ['#000000cc', 8, 2, 3] }],
  ['紺の白縁', { font: 'brush', fill: grad('#2a2aff', '#1010a0', '#000040'), strokes: [['#ffffff', 4], ['#14143a', 3]], shadow: ['#000000', 8, 2, 3] }],
  ['青の白縁・黒影', { font: 'brush', size: 84, fill: grad('#4a4aff', '#1a1aa0', '#000060'), strokes: [['#ffffff', 5]], glow: ['#000000', 16, 1.2] }],
  ['山吹の茶縁', { font: 'round', italic: false, fill: grad('#ffd070', '#ffa020'), strokes: [['#5a2a00', 7]], shadow: ['#000000aa', 6, 3, 4] }],
  ['赤の黒縁', { font: 'round', italic: false, fill: solid('#ff2020'), strokes: [['#000000', 9]], glow: ['#000000', 18, 1] }],
  ['赤の白縁グロー', { font: 'brush', fill: grad('#ff4a4a', '#e00000'), strokes: [['#ffffff', 4]], glow: ['#ffffff', 12, 0.8] }],
  // 2 行目
  ['緑の白・桃縁', { font: 'brush', size: 88, fill: grad('#30c030', '#108010'), strokes: [['#ffffff', 3], ['#ff40ff', 3]], glow: ['#ff40ff', 14, 1] }],
  ['青の白黒縁', { font: 'brush', fill: grad('#4050ff', '#2030e0'), strokes: [['#ffffff', 4], ['#000020', 3]] }],
  ['白黄グラデ', { font: 'round', italic: false, fill: grad('#ffffff', '#fff0a0', '#ffd000'), shadow: ['#000000cc', 6, 4, 5] }],
  ['赤の橙グロー', { font: 'round', italic: false, fill: grad('#ff5050', '#ff0000'), strokes: [['#ffffff', 3]], extrude: ['#505050', 6, 50], glow: ['#ffb000', 18, 1] }],
  ['白の黒影', { font: 'brush', fill: solid('#ffffff'), strokes: [['#000000', 4]], glow: ['#000000', 14, 1.2] }],
  ['赤から白・赤発光', { font: 'round', italic: false, fill: grad('#ff2020', '#ff8080', '#ffe0e0'), glow: ['#ff1a1a', 20, 1.4] }],
  ['黒赤・白発光', { font: 'brush', size: 84, fill: grad('#000000', '#400000', '#c01010'), glow: ['#ffffff', 16, 1.2] }],
  ['黒赤の白赤縁', { font: 'brush', fill: grad('#000000', '#600000', '#d00000'), strokes: [['#ffffff', 3], ['#e00000', 3]], glow: ['#ff0000', 10, 0.8] }],
  ['緑の赤影・黄縁', { font: 'round', italic: false, fill: grad('#50e050', '#108010'), strokes: [['#ffffff', 3]], extrude: ['#e03030', 5, 90], glow: ['#ffe000', 14, 1] }],
  // 3 行目
  ['シルバー黒影', { font: 'brush', size: 88, fill: grad('#ffffff', '#c8c8c8', '#8a8a8a', '#e0e0e0'), glow: ['#000000', 18, 1.4] }],
  ['赤グラデ黒影', { font: 'brush', size: 88, fill: grad('#ff7070', '#d00000'), glow: ['#000000', 18, 1.4] }],
  ['ゴールド黒影', { font: 'brush', size: 88, fill: grad('#fff0a0', '#d8b040', '#8a6a10', '#e0c060'), glow: ['#000000', 16, 1.2] }],
  ['レインボー', { font: 'round', italic: false, fill: gradA(100, '#ff2020', '#ff9a00', '#ffee00', '#30e030', '#20c0ff', '#3040ff', '#c030ff'), strokes: [['#ffffff', 3], ['#000000', 7], ['#ffd000', 4]] }],
  ['金橙グロー', { font: 'brush', size: 88, fill: grad('#ffc860', '#ff8a20', '#c04000'), strokes: [['#4a1800', 3]], glow: ['#ffb000', 22, 1.2] }],
  ['ラベンダー茶縁', { font: 'brush', fill: grad('#f0e8ff', '#a080ff', '#6a40e0'), strokes: [['#ffffff', 2], ['#c04a10', 5]], shadow: ['#000000', 6, 2, 3] }],
  ['青の白縁ゴシック', { font: 'sans', italic: false, fill: solid('#3050ff'), strokes: [['#ffffff', 5]], shadow: ['#000000aa', 4, 3, 4] }],
  ['赤グラデ白縁ゴシック', { font: 'sans', italic: false, fill: grad('#ff0000', '#ff6a6a'), strokes: [['#ffffff', 5]], shadow: ['#000000aa', 4, 3, 4] }],
  ['紺青の白縁・黒影', { font: 'brush', size: 84, fill: grad('#3060ff', '#001a80'), strokes: [['#ffffff', 4]], glow: ['#000000', 14, 1.2] }],
  // 4 行目
  ['赤の白黒縁', { font: 'brush', size: 88, fill: grad('#ff5050', '#c01010'), strokes: [['#ffffff', 2], ['#1a1a1a', 5]], glow: ['#000000', 14, 1] }],
  ['ピンクの黄発光', { font: 'round', italic: false, size: 88, fill: grad('#ffa0f0', '#ff2a8a'), glow: ['#ffe000', 18, 1.5] }],
  ['白黄の赤発光', { font: 'brush', fill: grad('#ffffff', '#ffe060', '#ffb000'), strokes: [['#ff0000', 3]], glow: ['#ff0000', 18, 1.6] }],
  ['白桃の青発光', { font: 'brush', size: 88, fill: gradA(135, '#ffffff', '#ffc0f0', '#d060ff'), glow: ['#2020ff', 20, 1.6] }],
  ['黄色の灰影', { font: 'brush', size: 104, fill: solid('#fff000'), shadow: ['#5a5a5a', 0, 6, 6] }],
  ['オレンジグラデ', { font: 'sans', italic: false, size: 88, fill: grad('#ffd000', '#ff8000', '#ff2000'), shadow: ['#000000aa', 4, 3, 4] }],
  ['緑の白縁ゴシック', { font: 'sans', italic: false, fill: grad('#40c040', '#0a5a0a'), strokes: [['#ffffff', 4]], shadow: ['#000000', 4, 4, 5] }],
  ['水色の黒縁', { font: 'brush', fill: grad('#a0f0ff', '#2090ff'), strokes: [['#000000', 9]], shadow: ['#000000', 6, 3, 4] }],
  ['緑の白ぼかし縁', { font: 'sans', italic: false, fill: solid('#20c020'), strokes: [['#103010', 3]], glow: ['#ffffff', 12, 1] }],
  // 5 行目
  ['白金の行書', { font: 'calli', size: 84, fill: grad('#ffffff', '#e0a800'), glow: ['#ffb800', 16, 1.2] }],
  ['黄赤の行書', { font: 'calli', size: 88, fill: grad('#ffe600', '#ff4000'), glow: ['#ff3000', 14, 1.2] }],
  ['桃金の行書', { font: 'calli', size: 92, fill: grad('#fff4e8', '#ffc080', '#ff9a00'), glow: ['#ff7a00', 8, 0.6] }],
];

export const YMM4_TEMPLATES: YmmTemplate[] = T.map(([name, o], i) => ({ id: `ymm4-${String(i + 1).padStart(2, '0')}`, name: `${String(i + 1).padStart(2, '0')} ${name}`, style: style(o) }));
