// 紹介動画「できることガイド」の構成。ブラウザ内 (アプリのページ) で実行し、
// アプリ自身の機能 (クリップ・キーフレーム・エフェクト・プリセット) だけで組み立てる。
// 戻り値: 場面の一覧 [{ t, title }]
window.__buildGuide = function () {
  const { store, defaults, presets } = window.__MVE__;
  const S = store.useStore.getState();
  const scenes = [];
  S.update((p) => {
    const W = p.width;
    const H = p.height;
    const audioAssets = p.assets.filter((a) => a.kind === 'audio');
    const asset = (name) => audioAssets.find((a) => a.name.startsWith(name));
    p.clips = [];
    p.tracks = [];
    const mk = (kind, name) => {
      const t = defaults.createTrack(kind, name);
      p.tracks.push(t);
      return t;
    };
    // 背面 → 前面
    const BG = mk('visual', '背景');
    const FXA = mk('visual', '演出A');
    const LOW = mk('visual', '演出B・調整');
    const DEMO = mk('visual', 'デモ');
    const DEMO2 = mk('visual', 'デモ2');
    const DEMO3 = mk('visual', 'デモ3');
    const CAM = mk('visual', 'カメラ');
    const TITLE = mk('visual', '見出し');
    const GUIDE = mk('visual', '操作ガイド');
    const FADE = mk('visual', 'フェード');
    const MUS = mk('audio', 'BGM');
    const SE = mk('audio', '効果音');

    let kid = 0;
    const E = (k, amount) => (typeof k === 'object' ? k : { kind: k || 'easeInOut', amount });
    const key = (c, path, arr) => {
      c.keyframes[path] = arr.map(([t, v, e]) => ({ id: 'k' + kid++, t: Math.max(0, Math.min(c.duration, t)), v, ease: E(e) })).sort((a, b) => a.t - b.t);
    };
    const clip = (type, track, start, dur, extra) => {
      const c = defaults.createClip(p, type, track.id, start, dur, extra);
      p.clips.push(c);
      return c;
    };
    const fx = (c, type, params) => {
      const e = defaults.createEffect(type, params);
      c.effects.push(e);
      return e;
    };
    const fade = (c, inD = 0.35, outD = 0.35) => {
      if (c.keyframes['transform.opacity']) return;
      const arr = [];
      if (inD > 0) arr.push([0, 0, 'easeOut'], [inD, 100, 'linear']);
      else arr.push([0, 100, 'linear']);
      if (outD > 0) arr.push([c.duration - outD, 100, 'easeIn'], [c.duration, 0]);
      key(c, 'transform.opacity', arr);
    };
    const presetStyle = (id) => {
      const pr = presets.PRESETS.find((x) => x.id === id);
      const tmp = defaults.createClip(p, 'text', BG.id, 0, 1);
      pr.apply(tmp, p);
      return { style: tmp.text.style, anims: tmp.text.anims };
    };
    const baseStyle = (o = {}) => {
      const s = defaults.defaultTextStyle();
      s.fontFamily = 'Noto Sans JP';
      s.fontWeight = 900;
      s.strokes = [
        { enabled: true, color: '#0b0b14', width: 8 },
        { enabled: false, color: '#ffffff', width: 4 },
        { enabled: false, color: '#ffffff', width: 4 },
      ];
      s.shadow = { enabled: true, color: '#00000099', blur: 18, offsetX: 0, offsetY: 6 };
      return Object.assign(s, o);
    };
    const text = (track, start, dur, content, style, x, y, anims = []) => {
      const c = clip('text', track, start, dur, { name: content.replace(/\n/g, ' ').slice(0, 14) });
      c.text = { content, style: JSON.parse(JSON.stringify(style)), anims: JSON.parse(JSON.stringify(anims)) };
      c.transform.x = x;
      c.transform.y = y;
      return c;
    };
    const shape = (track, start, dur, kind, w, h, x, y, color, o = {}) => {
      const c = clip('shape', track, start, dur, { name: '図形' });
      c.shape = Object.assign(defaults.defaultShape(kind), { width: w, height: h }, o);
      c.shape.fill.color = color;
      c.transform.x = x;
      c.transform.y = y;
      return c;
    };
    const bg = (start, dur, animated, fill, speed = 1) => {
      const c = clip('solid', BG, start, dur, { name: '背景' });
      c.solid = { color: fill.color, width: W, height: H, fill, animated, animSpeed: speed };
      c.transform.x = W / 2;
      c.transform.y = H / 2;
      return c;
    };
    const particles = (track, start, dur, kind, o = {}) => {
      const c = clip('particles', track, start, dur, { name: 'パーティクル' });
      c.particles = Object.assign(defaults.defaultParticles(kind, W, H), o);
      c.transform.x = W / 2;
      c.transform.y = H / 2;
      return c;
    };
    const ca = (kind, o = {}) => Object.assign({ kind, duration: 0.4, stagger: 0.04, order: 'forward', amount: 1, mode: 'in', ease: { kind: 'easeOut' } }, o);

    // 各場面の共通要素: 番号チップ・見出し・操作ガイド
    const TOTAL = 15;
    const header = (n, start, dur, title, guide, color = '#3d8bff') => {
      scenes.push({ t: start, title });
      if (n > 0) {
        const chip = text(TITLE, start + 0.1, dur - 0.1, `機能 ${n} / ${TOTAL}`, baseStyle({ fontSize: 34, fontWeight: 700, strokes: [{ enabled: false, color: '#000', width: 0 }, { enabled: false, color: '#000', width: 0 }, { enabled: false, color: '#000', width: 0 }], shadow: { enabled: false, color: '#000', blur: 0, offsetX: 0, offsetY: 0 }, background: { enabled: true, color, opacity: 1, paddingX: 22, paddingY: 8, radius: 30, skew: 0 } }), W / 2, 190);
        fade(chip, 0.3, 0.3);
      }
      const tt = text(TITLE, start + 0.15, dur - 0.15, title, baseStyle({ fontSize: title.length > 9 ? 72 : 88, lineHeight: 1.2 }), W / 2, 330, [ca('slideUp', { duration: 0.35, stagger: 0.03 })]);
      fade(tt, 0, 0.35);
      if (guide) {
        const g = text(GUIDE, start + 0.5, dur - 0.5, guide, baseStyle({ fontSize: 38, fontWeight: 700, lineHeight: 1.45, fill: { type: 'solid', color: '#111118', color2: '#000', angle: 90 }, strokes: [{ enabled: false, color: '#000', width: 0 }, { enabled: false, color: '#000', width: 0 }, { enabled: false, color: '#000', width: 0 }], shadow: { enabled: true, color: '#00000066', blur: 24, offsetX: 0, offsetY: 8 }, background: { enabled: true, color: '#ffffff', opacity: 0.94, paddingX: 30, paddingY: 16, radius: 22, skew: 0 } }), W / 2, 1690);
        key(g, 'transform.y', [[0, 1740, 'easeOut'], [0.4, 1690]]);
        fade(g, 0.3, 0.3);
      }
    };
    const whoosh = (t) => {
      const a = asset('guide_whoosh');
      if (!a) return;
      const c = clip('audio', SE, Math.max(0, t - 0.25), a.duration, { assetId: a.id, name: '効果音' });
      c.audio.volume = 0.45;
    };
    const pop = (t, vol = 0.5) => {
      const a = asset('guide_pop');
      if (!a) return;
      // 効果音トラックが重ならないよう、空いている音声トラックを使う
      const busy = p.clips.some((c) => c.trackId === SE.id && c.start < t + a.duration && c.start + c.duration > t);
      let tr = SE;
      if (busy) {
        tr = p.tracks.find((x) => x.kind === 'audio' && x.name === '効果音2') || mk('audio', '効果音2');
      }
      const c = clip('audio', tr, t, a.duration, { assetId: a.id, name: 'ポン' });
      c.audio.volume = vol;
    };

    let t = 0;
    const bgs = [];
    const next = (d) => {
      const s = t;
      t += d;
      return s;
    };

    // ---- 0. オープニング ----
    {
      const s = next(6);
      bgs.push(bg(s, 6, 'nebula', { type: 'radial', color: '#0a0f2e', color2: '#6f2dbd', color3: '#ff3d9a', angle: 0 }, 1.2));
      particles(FXA, s, 6, 'stars');
      particles(LOW, s + 0.8, 5.2, 'fireflies', { colors: ['#fff3b0', '#ffd24d', '#ffffff'], count: 50, emitterY: 0.5, emitterH: 0.6 });
      const sub = text(DEMO, s + 0.3, 5.7, 'モバイル動画エディター', presetStyle('space-wide').style, W / 2, 640, [ca('blurIn', { duration: 0.9, stagger: 0.05 })]);
      sub.text.style.fontSize = 50;
      sub.text.style.letterSpacing = 16;
      fade(sub, 0, 0.4);
      const gold = presetStyle('gold-main');
      const title = text(DEMO2, s + 0.8, 5.2, 'できること\nガイド', gold.style, W / 2, 900);
      title.text.style.fontSize = 170;
      title.text.style.lineHeight = 1.15;
      key(title, 'transform.scaleX', [[0, 40, E('spring', 1)], [1.1, 100]]);
      key(title, 'transform.scaleY', [[0, 40, E('spring', 1)], [1.1, 100]]);
      fade(title, 0.2, 0.4);
      fx(title, 'glow', { threshold: 0.55, radius: 30, intensity: 1.1, color: '#ffc94d', tint: 0.7 });
      const fl = fx(title, 'lensFlare', { x: 0.1, y: 0.3, intensity: 0.55, color: '#ffd9a0', size: 0.8 });
      key(title, `effects.${fl.id}.x`, [[0, 0.05, 'easeInOut'], [5.2, 0.95]]);
      const tag = text(GUIDE, s + 2.0, 4.0, 'この動画は、このアプリだけで作りました', baseStyle({ fontSize: 40, fontWeight: 700 }), W / 2, 1420, [ca('fade', { duration: 0.5, stagger: 0.03 })]);
      fade(tag, 0, 0.4);
      scenes.push({ t: s, title: 'オープニング' });
      pop(s + 0.8, 0.45);
    }

    // ---- 1. キーフレーム ----
    {
      const s = next(8);
      const b = bg(s, 8, 'grid', { type: 'linear', color: '#06001a', color2: '#00b8ff', angle: 90 }, 0.6);
      b.transitionIn = { type: 'crossfade', duration: 0.6, ease: { kind: 'easeInOut' } };
      bgs.push(b);
      header(1, s, 8, 'キーフレームと\n動きの緩急', '操作｜［変形］で値の横の ◆ をタップ\n→［アニメ］で補間方法を選ぶ');
      const lanes = [
        ['リニア (一定の速さ)', 'linear', '#ffffff'],
        ['イーズインアウト', 'easeInOut', '#3dd5ff'],
        ['バウンス', 'bounce', '#ffd23d'],
        ['スプリング', 'spring', '#ff5fa2'],
        ['オーバーシュート', 'overshoot', '#7dff8a'],
      ];
      lanes.forEach(([label, ease, color], i) => {
        const y = 640 + i * 175;
        const lab = text(DEMO, s + 0.4, 7.6, label, baseStyle({ fontSize: 36, fontWeight: 700, align: 'left', fill: { type: 'solid', color, color2: color, angle: 90 }, strokes: [{ enabled: true, color: '#000', width: 6 }, { enabled: false, color: '#000', width: 0 }, { enabled: false, color: '#000', width: 0 }] }), 90, y - 58);
        fade(lab, 0.3, 0.3);
        const rail = shape(LOW, s + 0.4, 7.6, 'line', 760, 10, W / 2, y, color, { stroke: { enabled: true, color: color + '40', width: 6, cap: 'round', dash: 0 } });
        fade(rail, 0.3, 0.3);
        const ball = shape(DEMO2, s + 0.4, 7.6, 'ellipse', 76, 76, 160, y, color);
        fx(ball, 'glow', { threshold: 0.2, radius: 14, intensity: 1.1 });
        key(ball, 'transform.x', [[0.6, 160, E(ease)], [3.0, 920, 'linear'], [4.0, 920, E(ease)], [6.4, 160, 'linear']]);
        fade(ball, 0.3, 0.3);
      });
      whoosh(s);
    }

    // ---- 2. モーションブラー ----
    {
      const s = next(6);
      const b = bg(s, 6, 'gradientShift', { type: 'linear', color: '#0f2027', color2: '#2c5364', color3: '#203a43', angle: 90 }, 0.8);
      b.transitionIn = { type: 'slideLeft', duration: 0.5, ease: { kind: 'easeInOut' } };
      bgs.push(b);
      header(2, s, 6, 'モーションブラー', '操作｜［合成］→ モーションブラー\n動きの量から自動でブレを付けます');
      [
        ['OFF', 290, false],
        ['ON', 790, true],
      ].forEach(([label, x, on]) => {
        const st = shape(DEMO, s + 0.4, 5.6, 'star', 300, 300, x, 820, '#ffd23d', { sides: 5, innerRatio: 0.45 });
        st.shape.fill = { enabled: true, type: 'linear', color: '#ffe66b', color2: '#ff8a00', angle: 90 };
        key(st, 'transform.rotation', [[0.3, 0, 'easeIn'], [1.3, 360, 'linear'], [4.6, 2160, 'easeOut'], [5.4, 2340]]);
        if (on) st.motionBlur = { enabled: true, shutterAngle: 360, samples: 16 };
        fade(st, 0.3, 0.3);
        const lab = text(DEMO2, s + 0.4, 5.6, label, baseStyle({ fontSize: 64, fill: { type: 'solid', color: on ? '#7dff8a' : '#ff6b6b', color2: '#fff', angle: 90 } }), x, 1080);
        fade(lab, 0.3, 0.3);
      });
      const bar = shape(DEMO, s + 0.4, 5.6, 'rect', 260, 110, 0, 1320, '#3dd5ff', { radius: 55 });
      bar.motionBlur = { enabled: true, shutterAngle: 360, samples: 16 };
      key(bar, 'transform.x', [[0.4, -200, 'easeInOut'], [1.6, 1280, 'linear'], [2.4, 1280, 'easeInOut'], [3.6, -200, 'linear'], [4.2, -200, 'easeInOut'], [5.4, 1280]]);
      whoosh(s);
    }

    // ---- 3. グロー・ネオン ----
    {
      const s = next(6);
      const b = bg(s, 6, 'hexagon', { type: 'solid', color: '#07000f', color2: '#ff2fb3', angle: 0 }, 0.8);
      b.transitionIn = { type: 'fadeBlack', duration: 0.6, ease: { kind: 'easeInOut' } };
      bgs.push(b);
      header(3, s, 6, 'グロー・ネオン', '操作｜［エフェクト］→ エフェクトを追加\n→ グロー / ネオン', '#ff2fb3');
      const neon = presetStyle('neon-pink');
      const nt = text(DEMO, s + 0.5, 5.5, 'NEON', neon.style, W / 2, 780, [ca('fade', { duration: 0.12, stagger: 0.12, order: 'random' })]);
      nt.text.style.fontSize = 230;
      nt.text.style.fontFamily = 'Dela Gothic One';
      nt.text.style.fontWeight = 400;
      fx(nt, 'neon', { color: '#ff2fb3', radius: 36, intensity: 2.2, core: 0.6, flicker: 0.35 });
      fade(nt, 0, 0.3);
      const ring = shape(DEMO2, s + 0.8, 5.2, 'ring', 420, 420, W / 2, 1260, '#00f0ff', { progress: 100, thickness: 26 });
      ring.shape.stroke.color = '#00f0ff';
      key(ring, 'shape.progress', [[0, 0, 'easeOut'], [2.2, 100]]);
      fx(ring, 'glow', { threshold: 0.1, radius: 34, intensity: 2.0, color: '#00f0ff', tint: 1 });
      fade(ring, 0.2, 0.3);
      const gt = text(DEMO3, s + 1.2, 4.8, 'GLOW', baseStyle({ fontSize: 96, fontFamily: 'Dela Gothic One', fontWeight: 400, fill: { type: 'solid', color: '#e6ffff', color2: '#fff', angle: 90 }, strokes: [{ enabled: false, color: '#000', width: 0 }, { enabled: false, color: '#000', width: 0 }, { enabled: false, color: '#000', width: 0 }], shadow: { enabled: false, color: '#000', blur: 0, offsetX: 0, offsetY: 0 } }), W / 2, 1260);
      fx(gt, 'glow', { threshold: 0.3, radius: 28, intensity: 1.8, color: '#00f0ff', tint: 0.8 });
      fade(gt, 0.4, 0.3);
      whoosh(s);
    }

    // ---- 4. パーティクル ----
    {
      const s = next(7);
      const b = bg(s, 7, 'starfield', { type: 'radial', color: '#0b1640', color2: '#000000', angle: 0 }, 0.6);
      b.transitionIn = { type: 'zoomIn', duration: 0.6, ease: { kind: 'easeInOut' } };
      bgs.push(b);
      header(4, s, 7, 'パーティクル', '操作｜［追加］→［演出］→ パーティクル\n紙吹雪・火花・雪・星など 8 種類', '#ffb020');
      particles(FXA, s + 0.3, 6.7, 'confetti', { count: 220, emitterY: 1.02, speed: 1300, burst: true, lifetime: 5 });
      particles(LOW, s + 2.4, 4.6, 'sparks', { emitterY: 0.72, count: 170, speed: 800 });
      particles(DEMO, s + 4.4, 2.6, 'snow', { count: 220, speed: 220, size: 9 });
      [['紙吹雪', 0.3], ['火花', 2.4], ['雪', 4.4]].forEach(([label, off], i) => {
        const l = text(DEMO2, s + off, i === 2 ? 2.6 : 2.0, label, baseStyle({ fontSize: 120, fontFamily: 'Dela Gothic One', fontWeight: 400, fill: { type: 'linear', color: '#ffffff', color2: '#ffd23d', angle: 90 } }), W / 2, 960, [ca('popIn', { duration: 0.35, stagger: 0.06 })]);
        fade(l, 0, 0.25);
      });
      pop(s + 0.3, 0.55);
      whoosh(s);
    }

    // ---- 5. グリッチ ----
    {
      const s = next(5);
      const b = bg(s, 5, 'grid', { type: 'linear', color: '#12001f', color2: '#ff2a6d', angle: 90 }, 1.2);
      b.transitionIn = { type: 'glitch', duration: 0.5, ease: { kind: 'linear' } };
      bgs.push(b);
      header(5, s, 5, 'グリッチ・RGB分離', '操作｜［エフェクト］→ グリッチ / RGB分離\n/ 色収差 / ノイズ / 走査線', '#ff2a6d');
      const g = text(DEMO, s + 0.3, 4.7, 'GLITCH', baseStyle({ fontSize: 200, fontFamily: 'Dela Gothic One', fontWeight: 400, fill: { type: 'solid', color: '#ffffff', color2: '#fff', angle: 90 } }), W / 2, 820);
      fx(g, 'glitch', { amount: 0.8, speed: 12, blocks: 22, rgb: 0.8 });
      fx(g, 'rgbSplit', { amount: 10, angle: 0 });
      fade(g, 0.2, 0.3);
      const v = text(DEMO2, s + 0.8, 4.2, 'VHS風・レトロ', baseStyle({ fontSize: 110, fill: { type: 'linear', color: '#25f4ee', color2: '#fe2c55', angle: 0 } }), W / 2, 1180);
      presets.PRESETS.find((x) => x.id === 'fx-vhs').apply(v, p);
      fade(v, 0.3, 0.3);
      whoosh(s);
    }

    // ---- 6. ブラー ----
    {
      const s = next(6);
      const b = bg(s, 6, 'aurora', { type: 'linear', color: '#04101f', color2: '#00ffa2', color3: '#3d7bff', angle: 90 }, 1);
      b.transitionIn = { type: 'blur', duration: 0.7, ease: { kind: 'easeInOut' } };
      bgs.push(b);
      header(6, s, 6, 'ブラー (ぼかし)', '操作｜［エフェクト］→ ガウシアンブラー\n/ 放射状ブラー / 被写界深度風', '#00c48c');
      const bl = text(DEMO, s + 0.3, 5.7, 'ぼかしイン', baseStyle({ fontSize: 130 }), W / 2, 760);
      const gb = fx(bl, 'gaussianBlur', { radius: 60 });
      key(bl, `effects.${gb.id}.radius`, [[0, 60, 'easeOut'], [1.4, 0, 'linear'], [4.2, 0, 'easeIn'], [5.7, 50]]);
      fade(bl, 0.4, 0.3);
      const st = shape(DEMO2, s + 0.6, 5.4, 'star', 360, 360, W / 2, 1230, '#ffffff', { sides: 8, innerRatio: 0.5 });
      st.shape.fill = { enabled: true, type: 'radial', color: '#ffffff', color2: '#00ffa2', angle: 0 };
      key(st, 'transform.rotation', [[0, 0, 'linear'], [5.4, 540]]);
      const rb = fx(st, 'radialBlur', { amount: 0.35, cx: 0.5, cy: 0.64 });
      key(st, `effects.${rb.id}.amount`, [[0, 0, 'easeInOut'], [2.0, 0.45, 'easeInOut'], [4.0, 0.0]]);
      fade(st, 0.3, 0.3);
      const lab = text(DEMO3, s + 0.6, 5.4, '放射状ブラー', baseStyle({ fontSize: 44, fontWeight: 700 }), W / 2, 1490);
      fade(lab, 0.3, 0.3);
      whoosh(s);
    }

    // ---- 7. 光線・レンズフレア ----
    {
      const s = next(5);
      const b = bg(s, 5, 'none', { type: 'radial', color: '#1a1030', color2: '#000000', angle: 0 });
      b.transitionIn = { type: 'fadeBlack', duration: 0.5, ease: { kind: 'easeInOut' } };
      bgs.push(b);
      header(7, s, 5, '光線・レンズフレア', '操作｜［エフェクト］→ 光線 / レンズフレア', '#ffb020');
      const lt = text(DEMO, s + 0.3, 4.7, 'LIGHT', baseStyle({ fontSize: 240, fontFamily: 'Dela Gothic One', fontWeight: 400, fill: { type: 'linear', color: '#ffffff', color2: '#ffd9a0', angle: 90 }, strokes: [{ enabled: false, color: '#000', width: 0 }, { enabled: false, color: '#000', width: 0 }, { enabled: false, color: '#000', width: 0 }], shadow: { enabled: false, color: '#000', blur: 0, offsetX: 0, offsetY: 0 } }), W / 2, 980);
      const rays = fx(lt, 'lightRays', { x: 0.5, y: 0.3, length: 0.7, intensity: 1.6, threshold: 0.3, color: '#fff2cc' });
      key(lt, `effects.${rays.id}.x`, [[0, 0.2, 'easeInOut'], [4.7, 0.8]]);
      const fl = fx(lt, 'lensFlare', { x: 0.2, y: 0.3, intensity: 1.1, color: '#ffd9a0', size: 1 });
      key(lt, `effects.${fl.id}.x`, [[0, 0.2, 'easeInOut'], [4.7, 0.8]]);
      fade(lt, 0.4, 0.3);
      whoosh(s);
    }

    // ---- 8. 変形エフェクト (調整レイヤー) ----
    {
      const s = next(6);
      const b = bg(s, 6, 'hexagon', { type: 'linear', color: '#001a2e', color2: '#00e5ff', angle: 90 }, 0.7);
      b.transitionIn = { type: 'wipeLeft', duration: 0.5, ease: { kind: 'easeInOut' } };
      bgs.push(b);
      header(8, s, 6, '波紋・ウェーブ・魚眼', '操作｜［追加］→［演出］→ 調整レイヤー\n→［エフェクト］で下の映像全体に適用', '#00b8d9');
      const grid = shape(FXA, s, 6, 'icon', 520, 520, W / 2, 1000, '#ffffff', { iconId: 'globe' });
      grid.shape.fill = { enabled: true, type: 'linear', color: '#ffffff', color2: '#7fe9ff', angle: 90 };
      [['波紋', 'ripple', { amplitude: 16, wavelength: 70, speed: 1.5, cx: 0.5, cy: 0.52 }], ['ウェーブ', 'wave', { amplitude: 26, wavelength: 220, speed: 1 }], ['魚眼', 'fisheye', { amount: 0.7 }]].forEach(([label, type, params], i) => {
        const adj = clip('adjustment', LOW, s + i * 2, 2, { name: '調整レイヤー' });
        adj.grade.enabled = false;
        const e = fx(adj, type, params);
        if (type === 'fisheye') key(adj, `effects.${e.id}.amount`, [[0, 0, 'easeInOut'], [1.0, 0.8, 'easeInOut'], [2, 0]]);
        const l = text(DEMO, s + i * 2, 2, label, baseStyle({ fontSize: 64, fontWeight: 900, fill: { type: 'solid', color: '#7fe9ff', color2: '#fff', angle: 90 } }), W / 2, 1450, [ca('popIn', { duration: 0.3 })]);
        fade(l, 0, 0.15);
      });
      whoosh(s);
    }

    // ---- 9. テロップ ----
    {
      const s = next(9);
      const b = bg(s, 9, 'gradientShift', { type: 'linear', color: '#1b2a49', color2: '#3a6073', color3: '#16222a', angle: 90 }, 0.5);
      b.transitionIn = { type: 'slideUp', duration: 0.5, ease: { kind: 'easeInOut' } };
      bgs.push(b);
      header(9, s, 9, 'テロップ', '操作｜［追加］→［テキスト］\n→［プリセット］で 55 種類のデザイン', '#e0a800');
      const items = [
        ['tv-yellow', 'バラエティ風テロップ', 78, 560],
        ['news-headline', 'ニュース見出し', 58, 730],
        ['gold-main', '豪華な金文字', 110, 900],
        ['neon-cyan', 'ネオン文字', 96, 1090],
        ['tv-tsukkomi', '三重の縁取り', 84, 1280],
      ];
      items.forEach(([id, content, size, y], i) => {
        const ps = presetStyle(id);
        const c = text(DEMO, s + 0.5 + i * 0.7, 8.5 - i * 0.7, content, ps.style, id === 'news-headline' ? 120 : W / 2, y, ps.anims.length ? ps.anims : [ca('popIn', { duration: 0.3, stagger: 0.04 })]);
        c.text.style.fontSize = size;
        fade(c, 0, 0.3);
        pop(s + 0.5 + i * 0.7, 0.3);
      });
      const vt = presetStyle('tv-white-red');
      const v = text(DEMO2, s + 4.0, 5.0, '縦書きも', vt.style, 960, 1200, [ca('drop', { duration: 0.5, stagger: 0.08, ease: { kind: 'bounce' } })]);
      v.text.style.vertical = true;
      v.text.style.fontSize = 64;
      fade(v, 0, 0.3);
      whoosh(s);
    }

    // ---- 10. 一文字アニメーション ----
    {
      const s = next(6);
      const b = bg(s, 6, 'none', { type: 'radial', color: '#20203a', color2: '#0b0b12', angle: 0 });
      b.transitionIn = { type: 'pixelize', duration: 0.6, ease: { kind: 'linear' } };
      bgs.push(b);
      header(10, s, 6, '一文字アニメーション', '操作｜［テキスト］→ 一文字アニメーション\n登場・退場・継続の 13 種類', '#7a5cff');
      const lines = [
        ['kin-drop', '一文字ずつ', 120, 680, 0.3],
        ['kin-pop', '動かせる', 140, 880, 1.0],
        ['kin-shake', 'テキスト！', 160, 1100, 1.7],
      ];
      lines.forEach(([id, content, size, y, off]) => {
        const ps = presetStyle(id);
        const c = text(DEMO, s + off, 6 - off, content, ps.style, W / 2, y, ps.anims);
        c.text.style.fontSize = size;
        fade(c, 0, 0.3);
      });
      const tw = presetStyle('kin-type');
      const c = text(DEMO2, s + 2.6, 3.4, 'タイプライター演出も可能_', tw.style, 110, 1350, tw.anims);
      c.text.style.fontSize = 56;
      fade(c, 0, 0.3);
      whoosh(s);
    }

    // ---- 11. モーショングラフィックス ----
    {
      const s = next(9);
      const b = bg(s, 9, 'grid', { type: 'linear', color: '#020b1a', color2: '#1e90ff', angle: 90 }, 0.4);
      b.transitionIn = { type: 'circle', duration: 0.6, ease: { kind: 'easeInOut' } };
      bgs.push(b);
      header(11, s, 9, '図形・グラフ・数値', '操作｜［追加］→［図形］→ 円形ゲージ\n/ グラフ / ピクトグラム ほか', '#1e90ff');
      const ring = shape(DEMO, s + 0.4, 8.6, 'ring', 330, 330, 290, 720, '#00d9ff', { progress: 82, thickness: 32 });
      ring.shape.stroke.color = '#00d9ff';
      key(ring, 'shape.progress', [[0, 0, 'easeOut'], [2.4, 82]]);
      fx(ring, 'glow', { threshold: 0.2, radius: 18, intensity: 1.2 });
      fade(ring, 0.3, 0.3);
      const ctr = clip('counter', DEMO2, s + 0.4, 8.6, { name: 'カウンター' });
      ctr.counter.to = 82;
      ctr.counter.suffix = '%';
      ctr.counter.style = baseStyle({ fontSize: 84 });
      ctr.transform.x = 290;
      ctr.transform.y = 720;
      key(ctr, 'counter.progress', [[0, 0, 'easeOut'], [2.4, 1]]);
      fade(ctr, 0.3, 0.3);
      const rocket = shape(DEMO, s + 1.0, 8.0, 'icon', 210, 210, 790, 660, '#ffffff', { iconId: 'rocket' });
      rocket.shape.fill = { enabled: true, type: 'linear', color: '#ffffff', color2: '#ffb020', angle: 90 };
      key(rocket, 'transform.scaleX', [[0, 0, E('overshoot', 1.5)], [0.5, 100]]);
      key(rocket, 'transform.scaleY', [[0, 0, E('overshoot', 1.5)], [0.5, 100]]);
      key(rocket, 'transform.y', [[0.5, 660, 'easeInOut'], [2.0, 630, 'easeInOut'], [3.5, 660, 'easeInOut'], [5.0, 630, 'easeInOut'], [6.5, 660]]);
      fade(rocket, 0, 0.3);
      const arrow = shape(DEMO2, s + 1.4, 7.6, 'arrow', 300, 60, 790, 830, '#ffffff', { arrowHead: 46 });
      arrow.shape.stroke = { enabled: true, color: '#ffb020', width: 14, cap: 'round', dash: 0 };
      key(arrow, 'shape.trimEnd', [[0, 0, 'easeInOut'], [1.0, 1]]);
      fade(arrow, 0, 0.3);
      const ch = clip('chart', DEMO, s + 2.0, 7.0, { name: 'グラフ' });
      Object.assign(ch.chart, { kind: 'bar', labels: ['月', '火', '水', '木', '金'], values: [32, 58, 45, 80, 96], colors: ['#00c2ff', '#7a5cff', '#ff4d8d', '#ffc531', '#2ee6a6'], width: 860, height: 430, stagger: 0.4, textColor: '#ffffff', gridColor: '#ffffff26' });
      ch.transform.x = W / 2;
      ch.transform.y = 1180;
      key(ch, 'chart.progress', [[0, 0, 'easeOut'], [2.2, 1]]);
      fade(ch, 0.2, 0.3);
      const cnt = clip('counter', DEMO3, s + 2.5, 6.5, { name: '再生回数' });
      Object.assign(cnt.counter, { from: 0, to: 1234567, prefix: '再生 ', suffix: ' 回', thousands: true });
      cnt.counter.style = baseStyle({ fontSize: 58, fill: { type: 'linear', color: '#ffffff', color2: '#7fe9ff', angle: 90 } });
      cnt.transform.x = W / 2;
      cnt.transform.y = 1490;
      key(cnt, 'counter.progress', [[0, 0, 'easeOut'], [3.0, 1]]);
      fade(cnt, 0.3, 0.3);
      whoosh(s);
    }

    // ---- 12. 3D・仮想カメラ ----
    {
      const s = next(7);
      const b = bg(s, 7, 'starfield', { type: 'radial', color: '#101c40', color2: '#02030a', angle: 0 }, 0.4);
      b.transitionIn = { type: 'spin', duration: 0.7, ease: { kind: 'easeInOut' } };
      bgs.push(b);
      header(12, s, 7, '3D 空間・仮想カメラ', '操作｜［変形］→ 3D レイヤーを ON\n＋［追加］→［演出］→ 仮想カメラ', '#8b5cff');
      const cards = [
        ['手前', -350, 330, 1150, '#ff4d8d', '#ffb020'],
        ['中間', 300, 560, 950, '#3d8bff', '#8b5cff'],
        ['奥', 1100, 760, 780, '#00c48c', '#00e5ff'],
      ];
      cards.forEach(([label, z, x, y, c1, c2]) => {
        const card = shape(DEMO, s + 0.3, 6.7, 'rect', 340, 440, x, y, c1, { radius: 36 });
        card.shape.fill = { enabled: true, type: 'linear', color: c1, color2: c2, angle: 135 };
        card.shape.stroke = { enabled: true, color: '#ffffffcc', width: 6, cap: 'round', dash: 0 };
        card.transform.z = z;
        card.is3D = true;
        fade(card, 0.4, 0.3);
        const lt = text(DEMO2, s + 0.3, 6.7, label, baseStyle({ fontSize: 84 }), x, y);
        lt.transform.z = z - 1;
        lt.is3D = true;
        fade(lt, 0.4, 0.3);
      });
      const cam = clip('camera', CAM, s, 7, { name: '仮想カメラ' });
      key(cam, 'transform.rotationY', [[0, -18, 'easeInOut'], [6.8, 18]]);
      key(cam, 'transform.z', [[0, -200, 'easeInOut'], [6.8, 500]]);
      key(cam, 'transform.rotationX', [[0, 6, 'easeInOut'], [6.8, -6]]);
      whoosh(s);
    }

    // ---- 13. トランジション ----
    {
      const s = next(9);
      const types = [
        ['circle', '円形', '#ff4d8d', '#ffb020'],
        ['wipeLeft', 'ワイプ', '#3d8bff', '#00e5ff'],
        ['slideUp', 'スライド', '#00c48c', '#d4ff3d'],
        ['zoomIn', 'ズーム', '#8b5cff', '#ff2fb3'],
        ['glitch', 'グリッチ', '#ff2a6d', '#05d9e8'],
        ['spin', 'スピン', '#ffb020', '#ff5f1f'],
        ['pixelize', 'モザイク', '#1e90ff', '#7a5cff'],
        ['flash', 'フラッシュ', '#2ee6a6', '#3d8bff'],
      ];
      const seg = 9 / types.length;
      header(13, s, 9, 'トランジション', '操作｜タイムラインのつなぎ目のボタン\n→ 19 種類から選ぶ', '#2ee6a6');
      types.forEach(([type, label, c1, c2], i) => {
        const b = bg(s + i * seg, seg, 'none', { type: 'linear', color: c1, color2: c2, angle: 135 });
        b.transitionIn = { type: i === 0 ? 'crossfade' : type, duration: 0.5, ease: { kind: 'easeInOut' } };
        bgs.push(b);
        const l = text(DEMO, s + i * seg, seg, label, baseStyle({ fontSize: 150, fontFamily: 'Dela Gothic One', fontWeight: 400 }), W / 2, 960, [ca('scaleIn', { duration: 0.25, ease: { kind: 'overshoot' } })]);
        fade(l, 0.15, 0.12);
        if (i > 0) whoosh(s + i * seg);
      });
    }

    // ---- 14. カラー ----
    {
      const s = next(7);
      const b = bg(s, 7, 'aurora', { type: 'linear', color: '#1c2b4a', color2: '#ff9a3d', color3: '#3dd5ff', angle: 90 }, 0.8);
      b.transitionIn = { type: 'crossfade', duration: 0.6, ease: { kind: 'easeInOut' } };
      bgs.push(b);
      header(14, s, 7, 'カラー補正', '操作｜［カラー］→ 明るさ・色温度・カーブ・LUT\n全体なら調整レイヤーに適用', '#ff9a3d');
      [['#ff4d4d', 300, 820, 260], ['#ffd23d', 760, 900, 300], ['#3dd5ff', 450, 1220, 280], ['#7dff8a', 820, 1300, 220]].forEach(([color, x, y, size], i) => {
        const c = shape(FXA, s, 7, 'ellipse', size, size, x, y, color);
        c.shape.fill = { enabled: true, type: 'radial', color: '#ffffff', color2: color, angle: 0 };
        key(c, 'transform.y', [[0, y, 'easeInOut'], [3.5, y - 40 + i * 20, 'easeInOut'], [7, y]]);
      });
      const adj = clip('adjustment', LOW, s + 0.8, 6.2, { name: '調整レイヤー' });
      adj.grade = Object.assign(adj.grade, { enabled: true, temperature: 0.55, tint: 0.1, contrast: 0.35, saturation: 0.45, vibrance: 0.2, vignette: 0.6, vignetteSize: 0.3, fade: 0.12, grain: 0.12 });
      adj.mask = { enabled: true, shape: 'rect', cx: 0.75, cy: 0.5, w: 0.5, h: 1.2, roundness: 0, feather: 0, invert: false };
      key(adj, 'mask.cx', [[0, 1.25, 'easeInOut'], [0.8, 0.75]]);
      const line = shape(DEMO, s + 1.4, 5.6, 'line', 1500, 10, W / 2, 1000, '#ffffff', { stroke: { enabled: true, color: '#ffffff', width: 6, cap: 'butt', dash: 0 } });
      line.transform.rotation = 90;
      fade(line, 0.3, 0.3);
      [['補正前', 270], ['補正後', 810]].forEach(([l, x]) => {
        const c = text(DEMO2, s + 1.4, 5.6, l, baseStyle({ fontSize: 58, fontWeight: 900 }), x, 560);
        fade(c, 0.3, 0.3);
      });
      whoosh(s);
    }

    // ---- 15. 合成 ----
    {
      const s = next(6);
      const b = bg(s, 6, 'nebula', { type: 'radial', color: '#0a0f2e', color2: '#3d1d6e', color3: '#1d4e6e', angle: 0 }, 0.6);
      b.transitionIn = { type: 'zoomOut', duration: 0.6, ease: { kind: 'easeInOut' } };
      bgs.push(b);
      header(15, s, 6, 'ブレンド・マスク', '操作｜［合成］→ ブレンドモード (13 種類)\n／［マスク］→ 形・ぼかし・反転', '#ff4d8d');
      [['#ff0000', 470, 740], ['#00ff00', 610, 740], ['#0000ff', 540, 860]].forEach(([color, x, y], i) => {
        const c = shape([DEMO, DEMO2, DEMO3][i], s + 0.3, 5.7, 'ellipse', 280, 280, x, y, color);
        c.blendMode = 'screen';
        const ang = (i / 3) * Math.PI * 2;
        key(c, 'transform.x', [[0, 540 + Math.cos(ang) * 300, 'easeOut'], [1.4, x]]);
        key(c, 'transform.y', [[0, 800 + Math.sin(ang) * 300, 'easeOut'], [1.4, y]]);
        fade(c, 0.3, 0.3);
      });
      const sc = text(DEMO3, s + 1.6, 4.4, 'スクリーン合成', baseStyle({ fontSize: 44, fontWeight: 700 }), W / 2, 1040);
      fade(sc, 0.3, 0.3);
      const m = text(DEMO, s + 2.0, 4.0, 'MASK', baseStyle({ fontSize: 230, fontFamily: 'Dela Gothic One', fontWeight: 400, fill: { type: 'linear', color: '#ffd23d', color2: '#ff4d8d', angle: 0 } }), W / 2, 1310);
      m.mask = { enabled: true, shape: 'ellipse', cx: 0.5, cy: 0.5, w: 0.05, h: 0.05, roundness: 0, feather: 0.25, invert: false };
      key(m, 'mask.w', [[0, 0.05, 'easeInOut'], [1.6, 1.6]]);
      key(m, 'mask.h', [[0, 0.05, 'easeInOut'], [1.6, 1.6]]);
      fade(m, 0, 0.3);
      whoosh(s);
    }

    // ---- 16. エンディング ----
    {
      const s = next(8);
      const b = bg(s, 8, 'gradientShift', { type: 'linear', color: '#1b0f4a', color2: '#d63384', color3: '#0d6efd', angle: 45 }, 0.6);
      b.transitionIn = { type: 'flash', duration: 0.6, ease: { kind: 'easeInOut' } };
      bgs.push(b);
      scenes.push({ t: s, title: 'エンディング' });
      particles(FXA, s + 0.3, 7.7, 'confetti', { count: 200, burst: true, lifetime: 6, speed: 1200 });
      const g = presetStyle('gold-3d');
      const a = text(DEMO, s + 0.4, 7.6, 'プリセット\n132 種類', g.style, W / 2, 620);
      a.text.style.fontSize = 120;
      a.text.style.lineHeight = 1.15;
      key(a, 'transform.scaleX', [[0, 30, E('spring', 1)], [1.0, 100]]);
      key(a, 'transform.scaleY', [[0, 30, E('spring', 1)], [1.0, 100]]);
      const b2 = text(DEMO2, s + 1.2, 6.8, 'MP4 書き出し\n最大 4K・60fps', baseStyle({ fontSize: 76, lineHeight: 1.3 }), W / 2, 1000, [ca('slideUp', { duration: 0.35, stagger: 0.03 })]);
      fade(b2, 0, 0.4);
      const c3 = presetStyle('shorts-hook');
      const c = text(DEMO3, s + 2.4, 5.6, 'まずは［追加］から！', c3.style, W / 2, 1360, c3.anims);
      c.text.style.fontSize = 76;
      fade(c, 0, 0.4);
      const blk = clip('solid', FADE, s + 7.0, 1.0, { name: '暗転' });
      blk.solid = { color: '#000000', width: W, height: H, fill: { type: 'solid', color: '#000000', color2: '#000', angle: 0 }, animated: 'none', animSpeed: 1 };
      blk.transform.x = W / 2;
      blk.transform.y = H / 2;
      key(blk, 'transform.opacity', [[0, 0, 'easeIn'], [0.9, 100]]);
      pop(s + 0.3, 0.55);
      whoosh(s);
    }

    // BGM (全体)
    const bgmA = asset('guide_bgm');
    if (bgmA) {
      const m = clip('audio', MUS, 0, Math.min(t, bgmA.duration), { assetId: bgmA.id, name: 'BGM' });
      m.audio.volume = 0.6;
      m.audio.fadeIn = 0.8;
      m.audio.fadeOut = 2.0;
    }
    p.name = 'できることガイド';
  });
  return scenes;
};
