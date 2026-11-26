import type {
  AudioSettings,
  ChartData,
  Clip,
  ClipType,
  ColorGrade,
  CounterData,
  Crop,
  Effect,
  EffectType,
  Mask,
  ParticleData,
  Project,
  ShapeData,
  SolidData,
  TextData,
  TextStyle,
  Track,
  Transform,
} from './types';

export const uid = (): string => {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && 'randomUUID' in c) return c.randomUUID().replace(/-/g, '').slice(0, 16);
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-6);
};

export const PROJECT_VERSION = 1;

export const defaultTransform = (w: number, h: number): Transform => ({
  x: w / 2,
  y: h / 2,
  z: 0,
  scaleX: 100,
  scaleY: 100,
  rotation: 0,
  rotationX: 0,
  rotationY: 0,
  anchorX: 0,
  anchorY: 0,
  opacity: 100,
  skewX: 0,
});

export const defaultCrop = (): Crop => ({ left: 0, top: 0, right: 0, bottom: 0 });

export const defaultMask = (): Mask => ({
  enabled: false,
  shape: 'rect',
  cx: 0.5,
  cy: 0.5,
  w: 0.8,
  h: 0.8,
  roundness: 0,
  feather: 0.05,
  invert: false,
});

export const defaultCurves = () => ({
  master: [
    [0, 0],
    [1, 1],
  ] as [number, number][],
  r: [
    [0, 0],
    [1, 1],
  ] as [number, number][],
  g: [
    [0, 0],
    [1, 1],
  ] as [number, number][],
  b: [
    [0, 0],
    [1, 1],
  ] as [number, number][],
});

export const defaultGrade = (): ColorGrade => ({
  enabled: false,
  exposure: 0,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  vibrance: 0,
  temperature: 0,
  tint: 0,
  hue: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  fade: 0,
  vignette: 0,
  vignetteSize: 0.5,
  grain: 0,
  curves: defaultCurves(),
  lutIntensity: 1,
});

export const defaultAudio = (): AudioSettings => ({
  volume: 1,
  muted: false,
  fadeIn: 0,
  fadeOut: 0,
  eq: { low: 0, mid: 0, high: 0 },
  compressor: { enabled: false, threshold: -18, ratio: 4 },
  pan: 0,
});

export const JP_FONT_STACK = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic",sans-serif';

export const defaultTextStyle = (): TextStyle => ({
  fontFamily: 'Noto Sans JP',
  fontWeight: 900,
  italic: false,
  fontSize: 96,
  letterSpacing: 0,
  lineHeight: 1.25,
  align: 'center',
  vertical: false,
  fill: { type: 'solid', color: '#ffffff', color2: '#ffd400', angle: 90 },
  strokes: [
    { enabled: true, color: '#000000', width: 10 },
    { enabled: false, color: '#ffffff', width: 6 },
    { enabled: false, color: '#ff2a6d', width: 6 },
  ],
  shadow: { enabled: false, color: '#000000aa', blur: 12, offsetX: 6, offsetY: 6 },
  glow: { enabled: false, color: '#00e5ff', blur: 30, strength: 1 },
  extrude: { enabled: false, depth: 12, angle: 45, color: '#333333' },
  gloss: { enabled: false, opacity: 0.5 },
  background: {
    enabled: false,
    color: '#000000',
    opacity: 0.6,
    paddingX: 30,
    paddingY: 14,
    radius: 10,
    skew: 0,
  },
});

export const defaultText = (content = 'テキスト'): TextData => ({
  content,
  style: defaultTextStyle(),
  anims: [],
});

export const defaultShape = (kind: ShapeData['kind'] = 'rect'): ShapeData => ({
  kind,
  width: 400,
  height: 400,
  radius: 0,
  sides: 6,
  innerRatio: 0.45,
  fill: { enabled: kind !== 'line' && kind !== 'ring', type: 'solid', color: '#00c2ff', color2: '#7a00ff', angle: 90 },
  stroke: { enabled: kind === 'line' || kind === 'arrow' || kind === 'ring', color: '#ffffff', width: 12, cap: 'round', dash: 0 },
  trimStart: 0,
  trimEnd: 1,
  progress: 75,
  thickness: 30,
  arrowHead: 40,
});

export const defaultParticles = (kind: ParticleData['kind'] = 'particles', w = 1080, h = 1920): ParticleData => {
  const base: ParticleData = {
    kind,
    count: 120,
    speed: 200,
    size: 8,
    spread: 360,
    direction: -90,
    gravity: 0,
    lifetime: 3,
    colors: ['#ffffff', '#7fdcff', '#ffd27f'],
    emitterX: 0.5,
    emitterY: 0.5,
    emitterW: 0,
    emitterH: 0,
    width: w,
    height: h,
    seed: Math.floor(Math.random() * 100000),
    glow: 0.5,
    burst: false,
  };
  switch (kind) {
    case 'confetti':
      return { ...base, count: 160, speed: 900, size: 16, spread: 70, direction: -90, gravity: 900, lifetime: 4, emitterY: 1, colors: ['#ff3b6b', '#ffd400', '#2ee6a6', '#3fa9ff', '#b36bff'], glow: 0, burst: true };
    case 'sparks':
      return { ...base, count: 140, speed: 700, size: 4, spread: 120, direction: -90, gravity: 800, lifetime: 1.2, colors: ['#fff2a8', '#ffb340', '#ff6a00'], glow: 1 };
    case 'snow':
      return { ...base, count: 160, speed: 60, size: 6, spread: 30, direction: 90, gravity: 0, lifetime: 12, emitterX: 0.5, emitterY: -0.02, emitterW: 1.1, colors: ['#ffffff'], glow: 0.3 };
    case 'stars':
      return { ...base, count: 220, speed: 4, size: 3, spread: 360, lifetime: 6, emitterW: 1, emitterH: 1, colors: ['#ffffff', '#cfe3ff', '#fff1c9'], glow: 0.8 };
    case 'bokeh':
      return { ...base, count: 40, speed: 20, size: 60, spread: 360, lifetime: 8, emitterW: 1, emitterH: 1, colors: ['#ffcf7f', '#ff7fbf', '#7fbfff'], glow: 0.2 };
    case 'fireflies':
      return { ...base, count: 60, speed: 30, size: 6, spread: 360, lifetime: 6, emitterW: 1, emitterH: 0.6, emitterY: 0.6, colors: ['#e6ff7f', '#ffe97f'], glow: 1 };
    case 'rain':
      return { ...base, count: 260, speed: 1400, size: 3, spread: 4, direction: 100, lifetime: 1.6, emitterY: -0.05, emitterW: 1.2, colors: ['#bcd6ff'], glow: 0 };
    default:
      return base;
  }
};

export const defaultCounter = (): CounterData => ({
  mode: 'number',
  from: 0,
  to: 100,
  progress: 1,
  decimals: 0,
  thousands: true,
  prefix: '',
  suffix: '',
  timerFormat: 'mm:ss',
  style: { ...defaultTextStyle(), fontSize: 140, fontFamily: 'Noto Sans JP' },
});

export const defaultChart = (): ChartData => ({
  kind: 'bar',
  labels: ['A', 'B', 'C', 'D'],
  values: [30, 70, 45, 90],
  colors: ['#00c2ff', '#7a5cff', '#ff4d8d', '#ffc531'],
  width: 800,
  height: 500,
  progress: 1,
  stagger: 0.3,
  showValues: true,
  showLabels: true,
  textColor: '#ffffff',
  gridColor: '#ffffff33',
  fontFamily: 'Noto Sans JP',
  maxValue: 0,
  lineWidth: 8,
});

export const defaultSolid = (w: number, h: number, color = '#101018'): SolidData => ({
  color,
  width: w,
  height: h,
  fill: { type: 'solid', color, color2: '#2a0a4a', angle: 90 },
  animated: 'none',
  animSpeed: 1,
});

export const EFFECT_DEFS: Record<
  EffectType,
  { label: string; params: Record<string, { label: string; min?: number; max?: number; step?: number; def: number | string | boolean; type?: 'color' | 'bool' | 'select'; options?: [string, string][] }> }
> = {
  gaussianBlur: { label: 'ガウシアンブラー', params: { radius: { label: '半径', min: 0, max: 100, def: 12 } } },
  radialBlur: {
    label: '放射状ブラー',
    params: { amount: { label: '強度', min: 0, max: 1, step: 0.01, def: 0.25 }, cx: { label: '中心X', min: 0, max: 1, step: 0.01, def: 0.5 }, cy: { label: '中心Y', min: 0, max: 1, step: 0.01, def: 0.5 } },
  },
  directionalBlur: { label: '方向ブラー', params: { length: { label: '長さ', min: 0, max: 200, def: 40 }, angle: { label: '角度', min: -180, max: 180, def: 0 } } },
  glow: {
    label: 'グロー',
    params: {
      threshold: { label: 'しきい値', min: 0, max: 1, step: 0.01, def: 0.5 },
      radius: { label: '半径', min: 0, max: 100, def: 24 },
      intensity: { label: '強度', min: 0, max: 5, step: 0.05, def: 1.5 },
      color: { label: '色', type: 'color', def: '#ffffff' },
      tint: { label: '色の適用', min: 0, max: 1, step: 0.01, def: 0 },
    },
  },
  neon: {
    label: 'ネオン',
    params: {
      color: { label: '色', type: 'color', def: '#00e5ff' },
      radius: { label: '広がり', min: 0, max: 100, def: 30 },
      intensity: { label: '強度', min: 0, max: 5, step: 0.05, def: 2 },
      core: { label: '芯の白さ', min: 0, max: 1, step: 0.01, def: 0.6 },
      flicker: { label: '点滅', min: 0, max: 1, step: 0.01, def: 0 },
    },
  },
  lensFlare: {
    label: 'レンズフレア',
    params: {
      x: { label: '位置X', min: 0, max: 1, step: 0.01, def: 0.3 },
      y: { label: '位置Y', min: 0, max: 1, step: 0.01, def: 0.3 },
      intensity: { label: '強度', min: 0, max: 3, step: 0.01, def: 1 },
      color: { label: '色', type: 'color', def: '#ffd9a0' },
      size: { label: 'サイズ', min: 0.1, max: 3, step: 0.01, def: 1 },
    },
  },
  rgbSplit: { label: 'RGB分離', params: { amount: { label: 'ずれ量', min: 0, max: 60, def: 8 }, angle: { label: '角度', min: -180, max: 180, def: 0 } } },
  chromaticAberration: { label: '色収差', params: { amount: { label: '強度', min: 0, max: 1, step: 0.01, def: 0.3 } } },
  glitch: {
    label: 'グリッチ',
    params: {
      amount: { label: '強度', min: 0, max: 1, step: 0.01, def: 0.5 },
      speed: { label: '速度', min: 0, max: 30, step: 0.5, def: 10 },
      blocks: { label: 'ブロック数', min: 2, max: 60, def: 16 },
      rgb: { label: 'RGBずれ', min: 0, max: 1, step: 0.01, def: 0.5 },
    },
  },
  noise: { label: 'ノイズ', params: { amount: { label: '強度', min: 0, max: 1, step: 0.01, def: 0.2 }, mono: { label: 'モノクロ', type: 'bool', def: true }, speed: { label: '速度', min: 0, max: 60, def: 24 } } },
  echo: {
    label: '残像',
    params: {
      count: { label: '数', min: 1, max: 12, def: 5 },
      delay: { label: '間隔(秒)', min: 0.01, max: 0.5, step: 0.01, def: 0.05 },
      decay: { label: '減衰', min: 0, max: 1, step: 0.01, def: 0.6 },
    },
  },
  cameraShake: {
    label: 'カメラシェイク',
    params: {
      amount: { label: '揺れ幅', min: 0, max: 200, def: 20 },
      rotation: { label: '回転', min: 0, max: 30, step: 0.1, def: 2 },
      frequency: { label: '速さ', min: 0.1, max: 30, step: 0.1, def: 8 },
    },
  },
  shadow: {
    label: 'シャドウ',
    params: {
      color: { label: '色', type: 'color', def: '#000000' },
      opacity: { label: '不透明度', min: 0, max: 1, step: 0.01, def: 0.7 },
      distance: { label: '距離', min: 0, max: 200, def: 20 },
      angle: { label: '角度', min: -180, max: 180, def: 45 },
      softness: { label: 'ぼかし', min: 0, max: 100, def: 20 },
    },
  },
  tiltShift: {
    label: '被写界深度風',
    params: {
      focus: { label: 'ピント位置', min: 0, max: 1, step: 0.01, def: 0.5 },
      range: { label: 'ピント範囲', min: 0, max: 1, step: 0.01, def: 0.2 },
      blur: { label: 'ボケ量', min: 0, max: 60, def: 20 },
      angle: { label: '角度', min: -90, max: 90, def: 0 },
      radial: { label: '円形', type: 'bool', def: false },
    },
  },
  lightRays: {
    label: '光線',
    params: {
      x: { label: '光源X', min: 0, max: 1, step: 0.01, def: 0.5 },
      y: { label: '光源Y', min: 0, max: 1, step: 0.01, def: 0.3 },
      length: { label: '長さ', min: 0, max: 1, step: 0.01, def: 0.5 },
      intensity: { label: '強度', min: 0, max: 3, step: 0.01, def: 1 },
      threshold: { label: 'しきい値', min: 0, max: 1, step: 0.01, def: 0.4 },
      color: { label: '色', type: 'color', def: '#fff2cc' },
    },
  },
  flash: { label: 'フラッシュ', params: { amount: { label: '強度', min: 0, max: 1, step: 0.01, def: 0.8 }, color: { label: '色', type: 'color', def: '#ffffff' } } },
  ripple: {
    label: '波紋',
    params: {
      amplitude: { label: '振幅', min: 0, max: 60, def: 12 },
      wavelength: { label: '波長', min: 4, max: 300, def: 60 },
      speed: { label: '速度', min: -10, max: 10, step: 0.1, def: 2 },
      cx: { label: '中心X', min: 0, max: 1, step: 0.01, def: 0.5 },
      cy: { label: '中心Y', min: 0, max: 1, step: 0.01, def: 0.5 },
    },
  },
  wave: {
    label: 'ウェーブ変形',
    params: { amplitude: { label: '振幅', min: 0, max: 100, def: 15 }, wavelength: { label: '波長', min: 4, max: 600, def: 120 }, speed: { label: '速度', min: -10, max: 10, step: 0.1, def: 1 }, vertical: { label: '縦方向', type: 'bool', def: false } },
  },
  gradientOverlay: {
    label: 'グラデーション',
    params: {
      color1: { label: '色1', type: 'color', def: '#ff2a6d' },
      color2: { label: '色2', type: 'color', def: '#05d9e8' },
      angle: { label: '角度', min: -180, max: 180, def: 90 },
      opacity: { label: '不透明度', min: 0, max: 1, step: 0.01, def: 1 },
      mode: { label: 'モード', type: 'select', def: 'fill', options: [['fill', '塗りつぶし'], ['multiply', '乗算'], ['screen', 'スクリーン'], ['overlay', 'オーバーレイ']] },
      radial: { label: '円形', type: 'bool', def: false },
    },
  },
  chromaKey: {
    label: 'クロマキー',
    params: {
      color: { label: 'キー色', type: 'color', def: '#00ff00' },
      tolerance: { label: '許容値', min: 0, max: 1, step: 0.01, def: 0.3 },
      softness: { label: '境界の柔らかさ', min: 0, max: 1, step: 0.01, def: 0.1 },
      spill: { label: '色かぶり除去', min: 0, max: 1, step: 0.01, def: 0.5 },
    },
  },
  pixelate: { label: 'モザイク', params: { size: { label: 'ブロック', min: 1, max: 100, def: 16 } } },
  mirror: { label: 'ミラー', params: { mode: { label: '方向', type: 'select', def: 'h', options: [['h', '左右'], ['v', '上下'], ['quad', '4分割']] } } },
  invert: { label: '色反転', params: { amount: { label: '強度', min: 0, max: 1, step: 0.01, def: 1 } } },
  posterize: { label: 'ポスタリゼーション', params: { levels: { label: '階調', min: 2, max: 32, def: 6 } } },
  sharpen: { label: 'シャープ', params: { amount: { label: '強度', min: 0, max: 3, step: 0.01, def: 0.8 } } },
  scanlines: { label: '走査線', params: { amount: { label: '強度', min: 0, max: 1, step: 0.01, def: 0.35 }, density: { label: '密度', min: 1, max: 12, def: 3 } } },
  fisheye: { label: '魚眼・3D風変形', params: { amount: { label: '強度', min: -1, max: 1, step: 0.01, def: 0.4 } } },
};

export function createEffect(type: EffectType, overrides: Record<string, number | string | boolean> = {}): Effect {
  const params: Record<string, number | string | boolean> = {};
  for (const [k, d] of Object.entries(EFFECT_DEFS[type].params)) params[k] = d.def;
  return { id: uid(), type, enabled: true, params: { ...params, ...overrides } };
}

export function createTrack(kind: Track['kind'], name: string): Track {
  return { id: uid(), kind, name, hidden: false, muted: false, locked: false, volume: 1 };
}

export function createClip(project: Pick<Project, 'width' | 'height'>, type: ClipType, trackId: string, start: number, duration: number, extra: Partial<Clip> = {}): Clip {
  const names: Record<ClipType, string> = {
    video: '動画',
    image: '画像',
    audio: '音声',
    text: 'テキスト',
    shape: '図形',
    solid: '背景',
    particles: 'パーティクル',
    counter: 'カウンター',
    chart: 'グラフ',
    adjustment: '調整レイヤー',
    camera: 'カメラ',
  };
  const clip: Clip = {
    id: uid(),
    trackId,
    type,
    name: names[type],
    start,
    duration,
    inPoint: 0,
    speed: 1,
    reverse: false,
    transform: defaultTransform(project.width, project.height),
    crop: defaultCrop(),
    mask: defaultMask(),
    blendMode: 'normal',
    grade: defaultGrade(),
    effects: [],
    motionBlur: { enabled: false, shutterAngle: 180, samples: 8 },
    audio: defaultAudio(),
    keyframes: {},
    is3D: false,
    ...extra,
  };
  if (type === 'text' && !clip.text) clip.text = defaultText();
  if (type === 'shape' && !clip.shape) clip.shape = defaultShape();
  if (type === 'particles' && !clip.particles) clip.particles = defaultParticles('particles', project.width, project.height);
  if (type === 'counter' && !clip.counter) clip.counter = defaultCounter();
  if (type === 'chart' && !clip.chart) clip.chart = defaultChart();
  if (type === 'solid' && !clip.solid) clip.solid = defaultSolid(project.width, project.height);
  return clip;
}

export function createProject(name: string, width: number, height: number, fps: number): Project {
  const v1 = createTrack('visual', 'ビデオ 1');
  const v2 = createTrack('visual', 'ビデオ 2');
  const t1 = createTrack('visual', 'テキスト');
  const a1 = createTrack('audio', 'オーディオ 1');
  const a2 = createTrack('audio', '効果音');
  const now = Date.now();
  return {
    id: uid(),
    version: PROJECT_VERSION,
    name,
    width,
    height,
    fps,
    background: '#000000',
    tracks: [v1, v2, t1, a1, a2],
    clips: [],
    assets: [],
    markers: [],
    createdAt: now,
    updatedAt: now,
    cameraFocal: Math.round(Math.max(width, height) * 1.2),
    masterVolume: 1,
    limiter: true,
  };
}

/** 読み込んだ古い/欠損データを現在のスキーマに補完する (破損データ対策) */
export function normalizeProject(p: Project): Project {
  const base = createProject(p.name || '無題', p.width || 1080, p.height || 1920, p.fps || 30);
  const proj: Project = { ...base, ...p, tracks: Array.isArray(p.tracks) ? p.tracks : base.tracks, clips: Array.isArray(p.clips) ? p.clips : [], assets: Array.isArray(p.assets) ? p.assets : [], markers: Array.isArray(p.markers) ? p.markers : [] };
  const trackIds = new Set(proj.tracks.map((t) => t.id));
  proj.clips = proj.clips
    .filter((c) => c && trackIds.has(c.trackId) && Number.isFinite(c.start) && Number.isFinite(c.duration) && c.duration > 0)
    .map((c) => {
      const d = createClip(proj, c.type, c.trackId, c.start, c.duration);
      return {
        ...d,
        ...c,
        transform: { ...d.transform, ...c.transform },
        crop: { ...d.crop, ...c.crop },
        mask: { ...d.mask, ...c.mask },
        grade: { ...d.grade, ...c.grade, curves: { ...d.grade.curves, ...(c.grade?.curves ?? {}) } },
        audio: { ...d.audio, ...c.audio, eq: { ...d.audio.eq, ...(c.audio?.eq ?? {}) }, compressor: { ...d.audio.compressor, ...(c.audio?.compressor ?? {}) } },
        motionBlur: { ...d.motionBlur, ...c.motionBlur },
        effects: Array.isArray(c.effects) ? c.effects : [],
        keyframes: c.keyframes && typeof c.keyframes === 'object' ? c.keyframes : {},
        text: c.text ? { ...d.text!, ...c.text, style: { ...defaultTextStyle(), ...c.text.style }, anims: c.text.anims ?? [] } : d.text,
      };
    });
  return proj;
}
