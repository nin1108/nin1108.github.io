import { describe, expect, it } from 'vitest';
import { applyEase, cubicBezier, interpolate, lerpColor, evalNum, setByPath, getByPath } from '../../src/model/keyframes';
import { parseSRT, buildSRT, decodeText } from '../../src/model/srt';
import { createClip, createProject, createEffect, normalizeProject } from '../../src/model/defaults';
import { splitClip, trimClipStart, trimClipEnd, setClipSpeed, sourceTime, duplicateClip, closeGaps, snapValue, canParent, findFreeTrack, formatTime, parseTimecode } from '../../src/model/ops';
import { buildCurve, parseCube } from '../../src/render/compositor-math';
import type { Keyframe } from '../../src/model/types';

const kf = (t: number, v: number | string, kind: any = 'linear'): Keyframe => ({ id: String(t), t, v, ease: { kind } });

describe('イージング', () => {
  it('端点は 0 と 1', () => {
    for (const kind of ['linear', 'easeIn', 'easeOut', 'easeInOut', 'bounce', 'spring', 'overshoot'] as const) {
      expect(applyEase({ kind }, 0)).toBeCloseTo(0, 5);
      expect(applyEase({ kind }, 1)).toBeCloseTo(1, 5);
    }
  });
  it('cubic-bezier は CSS の ease と一致', () => {
    const ease = cubicBezier(0.25, 0.1, 0.25, 1);
    expect(ease(0.5)).toBeCloseTo(0.8024, 3);
  });
  it('オーバーシュートは 1 を超える', () => {
    let max = 0;
    for (let i = 0; i <= 100; i++) max = Math.max(max, applyEase({ kind: 'overshoot' }, i / 100));
    expect(max).toBeGreaterThan(1.05);
  });
  it('ホールドは次のキーまで値を保持', () => {
    expect(interpolate([kf(0, 10, 'hold'), kf(1, 20)], 0.99)).toBe(10);
    expect(interpolate([kf(0, 10, 'hold'), kf(1, 20)], 1)).toBe(20);
  });
});

describe('キーフレーム補間', () => {
  const list = [kf(0, 0), kf(1, 100), kf(3, 50)];
  it('範囲外はクランプ', () => {
    expect(interpolate(list, -1)).toBe(0);
    expect(interpolate(list, 10)).toBe(50);
  });
  it('線形補間', () => {
    expect(interpolate(list, 0.5)).toBeCloseTo(50);
    expect(interpolate(list, 2)).toBeCloseTo(75);
  });
  it('色の補間', () => {
    expect(interpolate([kf(0, '#000000'), kf(1, '#ffffff')], 0.5)).toBe('#808080');
    expect(lerpColor('#ff000080', '#ff0000ff', 0)).toBe('#ff000080');
  });
  it('パス指定でエフェクトのパラメーターを取得・設定', () => {
    const p = createProject('t', 1080, 1920, 30);
    const c = createClip(p, 'text', p.tracks[0].id, 0, 5);
    const e = createEffect('glow');
    c.effects.push(e);
    setByPath(c, `effects.${e.id}.radius`, 42);
    expect(getByPath(c, `effects.${e.id}.radius`)).toBe(42);
    c.keyframes[`effects.${e.id}.radius`] = [kf(0, 0), kf(2, 20)];
    expect(evalNum(c, `effects.${e.id}.radius`, 1)).toBeCloseTo(10);
  });
});

describe('タイムライン操作', () => {
  const setup = () => {
    const p = createProject('t', 1080, 1920, 30);
    p.assets.push({ id: 'a', name: 'v.mp4', kind: 'video', mime: 'video/mp4', size: 1, duration: 10, width: 1080, height: 1920, hasAudio: true, createdAt: 0 });
    const c = createClip(p, 'video', p.tracks[0].id, 2, 6, { assetId: 'a', inPoint: 1 });
    p.clips.push(c);
    return { p, c };
  };
  it('分割で素材位置が連続する', () => {
    const { p, c } = setup();
    const id = splitClip(p, c.id, 5)!;
    const r = p.clips.find((x) => x.id === id)!;
    expect(c.duration).toBeCloseTo(3);
    expect(r.start).toBe(5);
    expect(r.inPoint).toBeCloseTo(4);
    expect(sourceTime(c, 4.999)).toBeCloseTo(sourceTime(r, 5), 2);
  });
  it('逆再生クリップの分割', () => {
    const { p, c } = setup();
    c.reverse = true;
    const before = sourceTime(c, 6);
    const id = splitClip(p, c.id, 5)!;
    const r = p.clips.find((x) => x.id === id)!;
    expect(sourceTime(r, 6)).toBeCloseTo(before, 5);
    expect(sourceTime(c, 3)).toBeCloseTo(sourceTime({ ...c, start: 2, duration: 6, inPoint: 1, reverse: true } as any, 3), 5);
  });
  it('分割時にキーフレームが保たれる', () => {
    const { p, c } = setup();
    c.keyframes['transform.x'] = [kf(0, 0), kf(6, 600)];
    const id = splitClip(p, c.id, 5)!;
    const r = p.clips.find((x) => x.id === id)!;
    expect(evalNum(c, 'transform.x', 2.9)).toBeCloseTo(290, 0);
    expect(evalNum(r, 'transform.x', 0)).toBeCloseTo(300, 0);
    expect(evalNum(r, 'transform.x', 3)).toBeCloseTo(600, 0);
  });
  it('トリムは素材範囲を超えない', () => {
    const { p, c } = setup();
    trimClipStart(p, c, -5);
    expect(c.start).toBeCloseTo(1);
    expect(c.inPoint).toBeCloseTo(0);
    trimClipEnd(p, c, 100);
    expect(c.start + c.duration).toBeCloseTo(11);
  });
  it('速度変更で長さが変わる', () => {
    const { p, c } = setup();
    setClipSpeed(p, c, 2);
    expect(c.duration).toBeCloseTo(3);
    expect(sourceTime(c, c.start + 1)).toBeCloseTo(c.inPoint + 2);
  });
  it('複製はエフェクトのキーフレームパスを付け替える', () => {
    const { p, c } = setup();
    const e = createEffect('glow');
    c.effects.push(e);
    c.keyframes[`effects.${e.id}.radius`] = [kf(0, 1)];
    const id = duplicateClip(p, c.id)!;
    const d = p.clips.find((x) => x.id === id)!;
    expect(d.effects[0].id).not.toBe(e.id);
    expect(Object.keys(d.keyframes)[0]).toBe(`effects.${d.effects[0].id}.radius`);
  });
  it('隙間を詰める', () => {
    const { p, c } = setup();
    const c2 = createClip(p, 'image', c.trackId, 20, 3);
    p.clips.push(c2);
    closeGaps(p, c.trackId);
    expect(c.start).toBe(0);
    expect(c2.start).toBeCloseTo(6);
  });
  it('重なり時は別トラックを使う', () => {
    const { p, c } = setup();
    const t = findFreeTrack(p, 'visual', 3, 4, c.trackId);
    expect(t.id).not.toBe(c.trackId);
  });
  it('スナップ', () => {
    expect(snapValue(1.02, [0, 1, 2], 0.05).v).toBe(1);
    expect(snapValue(1.2, [0, 1, 2], 0.05).snapped).toBe(false);
  });
  it('親子付けの循環を防ぐ', () => {
    const { p, c } = setup();
    const c2 = createClip(p, 'text', c.trackId, 0, 1);
    p.clips.push(c2);
    c2.parentId = c.id;
    expect(canParent(p, c.id, c2.id)).toBe(false);
  });
  it('タイムコード', () => {
    expect(formatTime(61.5, 30)).toBe('01:01:15');
    expect(parseTimecode('01:01:15', 30)).toBeCloseTo(61.5);
  });
  it('破損データの補正', () => {
    const p = createProject('t', 1080, 1920, 30);
    const bad: any = { ...p, clips: [{ id: 'x', trackId: p.tracks[0].id, type: 'text', start: 0, duration: 2 }, { id: 'y', trackId: 'nope', type: 'text', start: 0, duration: 1 }, null] };
    const n = normalizeProject(bad);
    expect(n.clips.length).toBe(1);
    expect(n.clips[0].transform.scaleX).toBe(100);
    expect(n.clips[0].text?.style.fontSize).toBeGreaterThan(0);
  });
});

describe('SRT', () => {
  it('解析と書き出し (往復)', () => {
    const src = '﻿1\r\n00:00:01,000 --> 00:00:02,500\r\nこんにちは\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\n<i>二行</i>\r\n目\r\n';
    const cues = parseSRT(src);
    expect(cues).toEqual([
      { start: 1, end: 2.5, text: 'こんにちは' },
      { start: 3, end: 4, text: '二行\n目' },
    ]);
    expect(parseSRT(buildSRT(cues))).toEqual(cues);
  });
  it('不正なブロックを無視', () => {
    expect(parseSRT('garbage\n\n1\n00:00:05,000 --> 00:00:01,000\nx')).toEqual([]);
  });
  it('Shift_JIS を判定', () => {
    // 「あ」= 0x82 0xA0 (Shift_JIS)
    const sjis = new Uint8Array([0x82, 0xa0]).buffer;
    expect(decodeText(sjis)).toBe('あ');
    expect(decodeText(new TextEncoder().encode('日本語').buffer)).toBe('日本語');
  });
});

describe('カラー', () => {
  it('恒等カーブ', () => {
    const c = buildCurve([
      [0, 0],
      [1, 1],
    ]);
    expect(c[128]).toBeCloseTo(128 / 255, 3);
  });
  it('カーブは単調・範囲内', () => {
    const c = buildCurve([
      [0, 0],
      [0.3, 0.6],
      [0.7, 0.65],
      [1, 1],
    ]);
    for (let i = 1; i < 256; i++) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1] - 1e-6);
  });
  it('.cube の解析', () => {
    let txt = 'TITLE "t"\nLUT_3D_SIZE 2\n';
    for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) txt += `${r} ${g} ${b}\n`;
    const l = parseCube(txt)!;
    expect(l.size).toBe(2);
    expect(Array.from(l.data.slice(-3))).toEqual([1, 1, 1]);
    expect(parseCube('LUT_3D_SIZE 4\n0 0 0')).toBeNull();
  });
});

describe('プリセット', async () => {
  const { PRESETS } = await import('../../src/presets/presets');
  it('100 種類以上・ID 重複なし', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(100);
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
  });
  it('全カテゴリーが揃っている', () => {
    const cats = new Set(PRESETS.map((p) => p.category));
    for (const c of ['tv', 'science', 'space', 'neon', 'news', 'cinema', 'gold', 'kinetic', 'shorts', 'tiktok']) expect(cats.has(c as any)).toBe(true);
  });
  it('すべてのプリセットが実際に適用できる', () => {
    for (const pr of PRESETS) {
      const p = createProject('t', 1080, 1920, 30);
      if (pr.build) {
        const n = p.clips.length;
        pr.build(p, 1);
        expect(p.clips.length, pr.id).toBeGreaterThan(n);
        continue;
      }
      const type = pr.kind === 'text' ? 'text' : pr.id === 'a-count' ? 'counter' : 'shape';
      const c = createClip(p, type, p.tracks[0].id, 0, 5);
      const before = JSON.stringify(c);
      pr.apply!(c, p);
      expect(JSON.stringify(c), pr.id).not.toBe(before);
    }
  });
});
