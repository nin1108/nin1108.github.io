import type { Clip, Project } from '../model/types';
import { evalNum, resolveClipAt } from '../model/keyframes';
import { mat4, type Mat4 } from './gl';
import { clipEnd } from '../model/ops';

const DEG = Math.PI / 180;

/** なめらかな 1D ノイズ (カメラシェイク用) */
function smoothNoise(x: number, seed: number) {
  return (
    Math.sin(x * 1.0 + seed * 1.3) * 0.5 +
    Math.sin(x * 2.17 + seed * 2.1) * 0.3 +
    Math.sin(x * 4.31 + seed * 0.7) * 0.2
  );
}

export function localTime(c: Clip, t: number) {
  return t - c.start;
}

export function clipShake(c: Clip, l: number): { dx: number; dy: number; rot: number } {
  let dx = 0;
  let dy = 0;
  let rot = 0;
  for (const e of c.effects) {
    if (!e.enabled || e.type !== 'cameraShake') continue;
    const amt = evalNum(c, `effects.${e.id}.amount`, l, Number(e.params.amount) || 0);
    const r = evalNum(c, `effects.${e.id}.rotation`, l, Number(e.params.rotation) || 0);
    const f = evalNum(c, `effects.${e.id}.frequency`, l, Number(e.params.frequency) || 8);
    dx += smoothNoise(l * f, 1) * amt;
    dy += smoothNoise(l * f, 7) * amt;
    rot += smoothNoise(l * f, 13) * r;
  }
  return { dx, dy, rot };
}

/** クリップのローカル行列 (親を含まない) */
export function localMatrix(c: Clip, l: number): Mat4 {
  const tr = (k: string, d: number) => evalNum(c, 'transform.' + k, l, d);
  const sh = clipShake(c, l);
  const x = tr('x', c.transform.x) + sh.dx;
  const y = tr('y', c.transform.y) + sh.dy;
  const z = tr('z', c.transform.z);
  const sx = tr('scaleX', c.transform.scaleX) / 100;
  const sy = tr('scaleY', c.transform.scaleY) / 100;
  const rz = (tr('rotation', c.transform.rotation) + sh.rot) * DEG;
  const rx = tr('rotationX', c.transform.rotationX) * DEG;
  const ry = tr('rotationY', c.transform.rotationY) * DEG;
  const ax = tr('anchorX', c.transform.anchorX);
  const ay = tr('anchorY', c.transform.anchorY);
  const sk = tr('skewX', c.transform.skewX) * DEG;
  let m = mat4.translate(x, y, z);
  if (rx) m = mat4.mul(m, mat4.rotX(rx));
  if (ry) m = mat4.mul(m, mat4.rotY(ry));
  if (rz) m = mat4.mul(m, mat4.rotZ(rz));
  if (sk) m = mat4.mul(m, mat4.skewX(sk));
  m = mat4.mul(m, mat4.scale(sx, sy, 1));
  if (ax || ay) m = mat4.mul(m, mat4.translate(-ax, -ay, 0));
  return m;
}

/**
 * ワールド行列。親子付けは「親の現在の変形 × 親の基準状態(親クリップ先頭時点)の逆行列 × 子」とし、
 * 親が基準状態のとき子はそのままの位置に表示される (After Effects の親子付けと同じ考え方)。
 */
export function worldMatrix(p: Project, c: Clip, t: number, depth = 0): Mat4 {
  let m = localMatrix(c, localTime(c, t));
  if (c.parentId && depth < 16) {
    const parent = p.clips.find((x2) => x2.id === c.parentId);
    if (parent) {
      const pw = worldMatrix(p, parent, t, depth + 1);
      const rest = localMatrix(parent, 0);
      m = mat4.mul(pw, mat4.mul(mat4.invert(rest), m));
    }
  }
  return m;
}

export function activeCamera(p: Project, t: number): Clip | undefined {
  let cam: Clip | undefined;
  for (const track of p.tracks) {
    if (track.kind !== 'visual' || track.hidden) continue;
    for (const c of p.clips) if (c.trackId === track.id && c.type === 'camera' && t >= c.start && t < clipEnd(c)) cam = c;
  }
  return cam;
}

export function viewMatrix(p: Project, t: number): Mat4 | null {
  const cam = activeCamera(p, t);
  if (!cam) return null;
  const l = localTime(cam, t);
  const tr = (k: string, d: number) => evalNum(cam, 'transform.' + k, l, d);
  const sh = clipShake(cam, l);
  const cx = tr('x', cam.transform.x) + sh.dx;
  const cy = tr('y', cam.transform.y) + sh.dy;
  const cz = tr('z', cam.transform.z);
  const zoom = tr('scaleX', cam.transform.scaleX) / 100;
  const roll = (tr('rotation', cam.transform.rotation) + sh.rot) * DEG;
  const tilt = tr('rotationX', cam.transform.rotationX) * DEG;
  const pan = tr('rotationY', cam.transform.rotationY) * DEG;
  let v = mat4.translate(p.width / 2, p.height / 2, 0);
  v = mat4.mul(v, mat4.scale(zoom, zoom, 1));
  v = mat4.mul(v, mat4.rotZ(-roll));
  v = mat4.mul(v, mat4.rotX(-tilt));
  v = mat4.mul(v, mat4.rotY(-pan));
  v = mat4.mul(v, mat4.translate(-cx, -cy, -cz));
  return v;
}

export function mvpFor(p: Project, c: Clip, t: number): Mat4 {
  const P = mat4.perspective(p.width, p.height, p.cameraFocal);
  let m = worldMatrix(p, c, t);
  if (c.is3D) {
    const v = viewMatrix(p, t);
    if (v) m = mat4.mul(v, m);
  }
  return mat4.mul(P, m);
}

/** レイヤーの四隅をコンポジション座標に投影 (ギズモ表示用) */
export function projectQuad(p: Project, c: Clip, t: number, rect: [number, number, number, number]): [number, number][] | null {
  const mvp = mvpFor(p, c, t);
  const pts: [number, number][] = [];
  const corners: [number, number][] = [
    [rect[0], rect[1]],
    [rect[2], rect[1]],
    [rect[2], rect[3]],
    [rect[0], rect[3]],
  ];
  for (const [x, y] of corners) {
    const r = mat4.transformPoint(mvp, x, y, 0);
    if (r[3] <= 0.0001) return null;
    const nx = r[0] / r[3];
    const ny = r[1] / r[3];
    pts.push([((nx + 1) / 2) * p.width, ((1 - ny) / 2) * p.height]);
  }
  return pts;
}

export { resolveClipAt };
