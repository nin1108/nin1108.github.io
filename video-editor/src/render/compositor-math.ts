// 純粋関数 (DOM 非依存): カーブ・LUT
// ---- カーブ / LUT ----
export function buildCurve(pts0: [number, number][]): Float32Array {
  const pts = [...pts0].sort((a, b) => a[0] - b[0]);
  const out = new Float32Array(256);
  const n = pts.length;
  if (n < 2) {
    for (let i = 0; i < 256; i++) out[i] = i / 255;
    return out;
  }
  // 単調 3 次エルミート補間 (Fritsch-Carlson)
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const d: number[] = [];
  const m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const tt = 3 / Math.sqrt(s);
      m[i] = tt * a * d[i];
      m[i + 1] = tt * b * d[i];
    }
  }
  for (let k = 0; k < 256; k++) {
    const x = k / 255;
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    if (x <= xs[0]) {
      out[k] = ys[0];
      continue;
    }
    if (x >= xs[n - 1]) {
      out[k] = ys[n - 1];
      continue;
    }
    const h = xs[i + 1] - xs[i];
    const tt = (x - xs[i]) / h;
    const t2 = tt * tt;
    const t3 = t2 * tt;
    out[k] = Math.max(0, Math.min(1, (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + tt) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1]));
  }
  return out;
}

export function parseCube(txt: string): { size: number; data: Float32Array } | null {
  const lines = txt.split(/\r?\n/);
  let size = 0;
  const vals: number[] = [];
  let dmin = [0, 0, 0];
  let dmax = [1, 1, 1];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('LUT_3D_SIZE')) size = parseInt(line.split(/\s+/)[1], 10);
    else if (line.startsWith('DOMAIN_MIN')) dmin = line.split(/\s+/).slice(1).map(Number);
    else if (line.startsWith('DOMAIN_MAX')) dmax = line.split(/\s+/).slice(1).map(Number);
    else if (/^[-\d.]/.test(line)) {
      const p = line.split(/\s+/).map(Number);
      if (p.length >= 3) vals.push((p[0] - dmin[0]) / (dmax[0] - dmin[0]), (p[1] - dmin[1]) / (dmax[1] - dmin[1]), (p[2] - dmin[2]) / (dmax[2] - dmin[2]));
    }
  }
  if (!size || size < 2 || size > 128 || vals.length < size * size * size * 3) return null;
  return { size, data: new Float32Array(vals.slice(0, size * size * size * 3)) };
}
