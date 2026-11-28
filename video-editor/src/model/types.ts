// プロジェクトのデータモデル。すべて JSON シリアライズ可能であること（IndexedDB 保存・Undo 用）。
// 素材のバイナリ（動画・画像・音声・フォント）は Asset として別ストアに保存し、ここでは id で参照する。

export type ID = string;

export type EaseKind =
  | 'linear'
  | 'hold'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'
  | 'bezier'
  | 'bounce'
  | 'spring'
  | 'overshoot';

export interface Ease {
  kind: EaseKind;
  /** cubic-bezier 制御点 (kind === 'bezier' のとき使用) */
  bezier?: [number, number, number, number];
  /** spring / overshoot / bounce の強さ (0.2〜3) */
  amount?: number;
}

export type KeyValue = number | string; // string は #rrggbb / #rrggbbaa の色

export interface Keyframe {
  id: ID;
  /** クリップ先頭からの秒数 */
  t: number;
  v: KeyValue;
  /** このキーフレームから次のキーフレームまでの補間 */
  ease: Ease;
}

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'add'
  | 'darken'
  | 'lighten'
  | 'softLight'
  | 'hardLight'
  | 'difference'
  | 'exclusion'
  | 'colorDodge'
  | 'colorBurn';

export interface Transform {
  x: number; // コンポジション座標 (px, 左上原点)
  y: number;
  z: number; // 奥行き (px, 正で奥)
  scaleX: number; // %
  scaleY: number; // %
  rotation: number; // deg (Z軸)
  rotationX: number; // deg
  rotationY: number; // deg
  anchorX: number; // レイヤー中心からのオフセット px
  anchorY: number;
  opacity: number; // 0..100
  skewX: number; // deg
}

export interface Crop {
  left: number; // 0..1 (素材幅に対する割合)
  top: number;
  right: number;
  bottom: number;
}

export interface Mask {
  enabled: boolean;
  shape: 'rect' | 'ellipse';
  /** 素材ローカル座標系 (0..1) の中心とサイズ */
  cx: number;
  cy: number;
  w: number;
  h: number;
  roundness: number; // 0..1 (rect の角丸)
  feather: number; // 0..1
  invert: boolean;
}

export interface ColorGrade {
  enabled: boolean;
  exposure: number; // -3..3 EV
  brightness: number; // -1..1
  contrast: number; // -1..1
  saturation: number; // -1..1
  vibrance: number; // -1..1
  temperature: number; // -1..1
  tint: number; // -1..1
  hue: number; // -180..180 deg
  highlights: number; // -1..1
  shadows: number; // -1..1
  whites: number; // -1..1
  blacks: number; // -1..1
  fade: number; // 0..1 (フィルム風の黒浮き)
  vignette: number; // 0..1
  vignetteSize: number; // 0..1
  grain: number; // 0..1
  /** RGB カーブ: 各チャンネルの制御点 [x,y] (0..1) */
  curves: { master: [number, number][]; r: [number, number][]; g: [number, number][]; b: [number, number][] };
  lutAssetId?: ID;
  lutIntensity: number; // 0..1
}

export type EffectType =
  | 'gaussianBlur'
  | 'radialBlur'
  | 'directionalBlur'
  | 'glow'
  | 'neon'
  | 'lensFlare'
  | 'rgbSplit'
  | 'chromaticAberration'
  | 'glitch'
  | 'noise'
  | 'echo'
  | 'cameraShake'
  | 'shadow'
  | 'tiltShift'
  | 'lightRays'
  | 'flash'
  | 'ripple'
  | 'wave'
  | 'gradientOverlay'
  | 'chromaKey'
  | 'pixelate'
  | 'mirror'
  | 'invert'
  | 'posterize'
  | 'sharpen'
  | 'scanlines'
  | 'fisheye';

export interface Effect {
  id: ID;
  type: EffectType;
  enabled: boolean;
  params: Record<string, number | string | boolean>;
}

export interface MotionBlur {
  enabled: boolean;
  shutterAngle: number; // 0..720
  samples: number; // 2..32
}

export type ClipType =
  | 'video'
  | 'image'
  | 'audio'
  | 'text'
  | 'shape'
  | 'solid'
  | 'particles'
  | 'counter'
  | 'chart'
  | 'adjustment'
  | 'camera';

export type CharAnimKind =
  | 'none'
  | 'typewriter'
  | 'fade'
  | 'slideUp'
  | 'slideDown'
  | 'scaleIn'
  | 'popIn'
  | 'rotateIn'
  | 'blurIn'
  | 'drop'
  | 'wave'
  | 'shake'
  | 'jitter'
  | 'colorWave';

export interface CharAnimation {
  kind: CharAnimKind;
  /** 1文字あたりのアニメ時間 (秒) */
  duration: number;
  /** 文字ごとの遅延 (秒) */
  stagger: number;
  order: 'forward' | 'backward' | 'center' | 'random';
  /** wave/shake など継続系の強さ */
  amount: number;
  /** 'in' は登場、'out' は退場 (クリップ末尾から逆算)、'loop' は継続 */
  mode: 'in' | 'out' | 'loop';
  ease: Ease;
}

export interface Stroke {
  enabled: boolean;
  color: string;
  width: number; // px
}

export interface Fill {
  type: 'solid' | 'linear' | 'radial' | 'metal';
  color: string;
  color2: string;
  color3?: string;
  angle: number; // deg (linear)
  /** 3 色以上のグラデーション (指定時は color/color2/color3 より優先し、等間隔に配置) */
  stops?: string[];
}

export interface TextStyle {
  fontFamily: string;
  fontWeight: number;
  italic: boolean;
  fontSize: number;
  letterSpacing: number; // px
  lineHeight: number; // 倍率
  align: 'left' | 'center' | 'right';
  vertical: boolean;
  fill: Fill;
  strokes: Stroke[]; // 内側→外側の順 (最大3)
  shadow: { enabled: boolean; color: string; blur: number; offsetX: number; offsetY: number };
  glow: { enabled: boolean; color: string; blur: number; strength: number };
  extrude: { enabled: boolean; depth: number; angle: number; color: string };
  gloss: { enabled: boolean; opacity: number };
  background: {
    enabled: boolean;
    color: string;
    color2?: string;
    opacity: number;
    paddingX: number;
    paddingY: number;
    radius: number;
    skew: number;
    borderColor?: string;
    borderWidth?: number;
  };
}

export interface TextData {
  content: string;
  style: TextStyle;
  anims: CharAnimation[];
  /** 元にしたプリセット (標準: プリセット ID / マイプリセット: "user:<id>")。上書き保存の対象 */
  presetId?: string;
}

export type ShapeKind =
  | 'rect'
  | 'ellipse'
  | 'polygon'
  | 'star'
  | 'line'
  | 'arrow'
  | 'ring'
  | 'path'
  | 'icon';

export interface ShapeData {
  kind: ShapeKind;
  width: number;
  height: number;
  radius: number; // 角丸 (rect)
  sides: number; // polygon / star
  innerRatio: number; // star
  /** SVG path d (path / icon のとき)。viewBox は pathViewBox */
  pathD?: string;
  pathViewBox?: [number, number, number, number];
  iconId?: string;
  fill: Fill & { enabled: boolean };
  stroke: Stroke & { cap: 'butt' | 'round' | 'square'; dash: number };
  /** 線の描画アニメーション (0..1) */
  trimStart: number;
  trimEnd: number;
  /** ring: 進捗 0..100, 太さ */
  progress: number;
  thickness: number;
  arrowHead: number;
}

export type ParticleKind = 'particles' | 'confetti' | 'sparks' | 'snow' | 'stars' | 'bokeh' | 'fireflies' | 'rain';

export interface ParticleData {
  kind: ParticleKind;
  count: number;
  speed: number;
  size: number;
  spread: number; // deg
  direction: number; // deg
  gravity: number;
  lifetime: number; // 秒
  colors: string[];
  emitterX: number; // 0..1 (レイヤー内)
  emitterY: number;
  emitterW: number; // 0..1
  emitterH: number;
  width: number;
  height: number;
  seed: number;
  glow: number; // 0..1
  burst: boolean;
}

export interface CounterData {
  mode: 'number' | 'timer';
  from: number;
  to: number;
  /** 0..1 の進捗 (キーフレーム可)。from→to の補間位置 */
  progress: number;
  decimals: number;
  thousands: boolean;
  prefix: string;
  suffix: string;
  timerFormat: 'mm:ss' | 'mm:ss.ff' | 'hh:mm:ss';
  style: TextStyle;
}

export interface ChartData {
  kind: 'bar' | 'hbar' | 'line' | 'pie' | 'donut';
  labels: string[];
  values: number[];
  colors: string[];
  width: number;
  height: number;
  progress: number; // 0..1 (グロー/伸長アニメーション)
  stagger: number; // 0..1
  showValues: boolean;
  showLabels: boolean;
  textColor: string;
  gridColor: string;
  fontFamily: string;
  maxValue: number; // 0 で自動
  lineWidth: number;
}

export interface SolidData {
  color: string;
  width: number;
  height: number;
  fill: Fill;
  /** 背景アニメーション */
  animated: 'none' | 'gradientShift' | 'starfield' | 'grid' | 'aurora' | 'hexagon' | 'nebula';
  animSpeed: number;
}

export interface AudioSettings {
  volume: number; // 0..2 (1 = 0dB)
  muted: boolean;
  fadeIn: number; // 秒
  fadeOut: number;
  eq: { low: number; mid: number; high: number }; // dB -12..12
  compressor: { enabled: boolean; threshold: number; ratio: number };
  pan: number; // -1..1
}

export type TransitionType =
  | 'crossfade'
  | 'fadeBlack'
  | 'fadeWhite'
  | 'wipeLeft'
  | 'wipeRight'
  | 'wipeUp'
  | 'wipeDown'
  | 'slideLeft'
  | 'slideRight'
  | 'slideUp'
  | 'slideDown'
  | 'zoomIn'
  | 'zoomOut'
  | 'circle'
  | 'blur'
  | 'glitch'
  | 'flash'
  | 'spin'
  | 'pixelize';

export interface Transition {
  type: TransitionType;
  duration: number; // 秒
  ease: Ease;
}

export interface Clip {
  id: ID;
  trackId: ID;
  type: ClipType;
  name: string;
  /** タイムライン上の開始 (秒) */
  start: number;
  /** タイムライン上の長さ (秒) */
  duration: number;
  assetId?: ID;
  /** 素材内の開始位置 (秒) */
  inPoint: number;
  speed: number;
  reverse: boolean;
  /** 静止画化 (フリーズ) */
  freeze?: boolean;
  transform: Transform;
  crop: Crop;
  mask: Mask;
  blendMode: BlendMode;
  grade: ColorGrade;
  effects: Effect[];
  motionBlur: MotionBlur;
  audio: AudioSettings;
  /** 動画クリップの音声を分離済み (このクリップからは音を出さない) */
  audioDetached?: boolean;
  text?: TextData;
  shape?: ShapeData;
  particles?: ParticleData;
  counter?: CounterData;
  chart?: ChartData;
  solid?: SolidData;
  transitionIn?: Transition;
  /** パラメーターパス → キーフレーム列 */
  keyframes: Record<string, Keyframe[]>;
  groupId?: ID;
  parentId?: ID;
  /** 3D レイヤー (カメラの影響を受ける) */
  is3D: boolean;
  color?: string; // タイムライン上のラベル色
}

export interface Track {
  id: ID;
  kind: 'visual' | 'audio';
  name: string;
  hidden: boolean;
  muted: boolean;
  locked: boolean;
  volume: number;
}

export interface AssetMeta {
  id: ID;
  name: string;
  kind: 'video' | 'image' | 'audio' | 'font' | 'lut' | 'svg';
  mime: string;
  size: number;
  duration?: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  fps?: number;
  /** フォント: CSS font-family 名 */
  fontFamily?: string;
  createdAt: number;
  /** プロキシ (低解像度プレビュー用) の asset id */
  proxyId?: ID;
}

export interface Marker {
  id: ID;
  t: number;
  label: string;
  color: string;
}

export interface Project {
  id: ID;
  version: number;
  name: string;
  width: number;
  height: number;
  fps: number;
  background: string;
  tracks: Track[]; // 配列の後ろほど上に重なる (visual)
  clips: Clip[];
  assets: AssetMeta[];
  markers: Marker[];
  createdAt: number;
  updatedAt: number;
  /** カメラのパースペクティブ (焦点距離 px) */
  cameraFocal: number;
  masterVolume: number;
  limiter: boolean;
}

export interface ProjectSummary {
  id: ID;
  name: string;
  width: number;
  height: number;
  updatedAt: number;
  duration: number;
  thumb?: string;
}
