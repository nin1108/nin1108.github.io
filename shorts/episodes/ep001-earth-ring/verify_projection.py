"""3Dレンダーの投影と解析値の照合（科学監修用）。

全天カメラ（等距離魚眼180°, 真上, 画面上=北）で「輪あり」「輪なし」を描き、差分から
輪が写っている範囲を測る。魚眼の半径 r は天頂角に比例するので高度に直せる。
- 北緯35°: 南の子午線（画像の中央列・下半分）での輪の上端/下端の高度
- 赤道   : 輪の線が画像のどの行・どの方向に通るか（東西に天頂を通るはず）
結果は build/verify/verify.json に保存。
"""
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))
import bpy  # noqa: E402
import numpy as np  # noqa: E402

import geom  # noqa: E402

EP = json.loads((HERE / "episode.json").read_text())
SCI = EP["science"]
BLEND = HERE / "build" / "ep001.blend"
OUT = HERE / "build" / "verify"
SIZE = 1000


def render(scene, ring_on):
    sc = bpy.data.scenes[scene]
    cam = next(o for o in sc.objects if o.type == "CAMERA" and o.name.split(".")[0] == "CAM_allsky")
    sc.camera = cam
    sc.render.resolution_x = sc.render.resolution_y = SIZE
    sc.cycles.samples = 16
    ring = next(o for o in sc.objects if o.name.split(".")[0] == "Ring")
    ring.hide_render = not ring_on
    p = OUT / f"{scene}_{'ring' if ring_on else 'noring'}.png"
    sc.render.filepath = str(p)
    bpy.ops.render.render(write_still=True, scene=sc.name)
    img = bpy.data.images.load(str(p), check_existing=False)
    a = np.array(img.pixels[:], dtype=np.float32).reshape(SIZE, SIZE, 4)[::-1, :, :3]  # 上から下へ
    return a


def px_to_alt(r_px):
    rc = SIZE / 2
    return 90.0 - (r_px / rc) * 90.0


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=str(BLEND))
    res = {"method": "fisheye equidistant 180deg, diff(ring)-diff(no ring) > threshold", "size": SIZE}
    R = SCI["earth_radius_km"]
    rin, rout = SCI["ring_inner_ratio"] * R, SCI["ring_outer_ratio"] * R

    # --- 北緯35°
    a1 = render("GROUND_MID", True)
    a0 = render("GROUND_MID", False)
    d = np.abs(a1 - a0).sum(axis=2)
    cx = SIZE // 2
    col = d[cx:, cx - 1:cx + 2].max(axis=1)  # 天頂(中心)→南(下)
    mask = col > 0.03
    idx = np.nonzero(mask)[0]
    lat = SCI["observers"]["mid"]["lat"]
    exp_in = geom.meridian_altitude(rin, lat)
    exp_out = geom.meridian_altitude(rout, lat)
    if idx.size:
        alt_top = px_to_alt(idx.min())
        alt_bottom = px_to_alt(idx.max() + 1)
    else:
        alt_top = alt_bottom = None
    # 輪の左右の端（地平線と交わる方位）: 円周付近で差分が出る角度範囲
    ang = []
    for deg in np.arange(0, 360, 0.5):
        t = math.radians(deg)
        rr = SIZE / 2 * (88.0 / 90.0)  # 高度2°の円周
        x = int(cx + rr * math.sin(t)); y = int(cx + rr * math.cos(t))
        if 0 <= x < SIZE and 0 <= y < SIZE and d[y, x] > 0.03:
            ang.append(deg)
    res["mid"] = {
        "expected_outer_alt_deg": round(exp_out, 2), "measured_outer_alt_deg": None if alt_top is None else round(alt_top, 2),
        "expected_inner_alt_deg": round(exp_in, 2), "measured_lower_edge_alt_deg": None if alt_bottom is None else round(alt_bottom, 2),
        "px_per_deg": round(SIZE / 2 / 90, 3),
        "note_inner": "内縁は高度約1°で、大気による減光の近似と地平線近くの解像度のため下端は粗い",
    }
    hz = geom.horizon_crossings(rout, lat)
    # 画像上の角度 deg は 下=南=0, 反時計回りに… 画面: 上=北, 左=東。sin->x(右=西), cos->y(下=南)
    if ang:
        # 角度→方位: 右(x+)=西, 下(y+)=南。t=0 は南(180°), t=90 は西(270°)
        azs = sorted(((180 + a) % 360) for a in ang)
        res["mid"]["measured_az_range_at_alt2_deg"] = [azs[0], azs[-1]]
    lim2 = None
    # 高度2°での解析方位（外縁の円が高度2°になる経度差を二分探索）
    lo, hi = 0.0, geom.visible_theta_limit(rout, lat)
    for _ in range(60):
        mid_t = (lo + hi) / 2
        alt, _ = geom.ring_altaz(rout, mid_t, lat)
        if alt > 2.0:
            lo = mid_t
        else:
            hi = mid_t
    _, az_e = geom.ring_altaz(rout, lo, lat)
    _, az_w = geom.ring_altaz(rout, -lo, lat)
    res["mid"]["expected_az_range_at_alt2_deg"] = [round(az_e, 1), round(az_w, 1)]
    res["mid"]["expected_horizon_az_outer_deg"] = [round(x, 1) for x in hz]

    # --- 赤道
    b1 = render("GROUND_EQ", True)
    b0 = render("GROUND_EQ", False)
    e = np.abs(b1 - b0).sum(axis=2)
    rows = np.nonzero(e[:, cx - 200:cx + 200].max(axis=1) > 0.03)[0]
    cols_hit = np.nonzero(e[cx - 3:cx + 4, :].max(axis=0) > 0.03)[0]
    res["eq"] = {
        "expected": "天頂を通る東西の線（画像中央の水平線, 行=%d）" % cx,
        "measured_rows": [int(rows.min()), int(rows.max())] if rows.size else None,
        "measured_horizontal_extent_px": [int(cols_hit.min()), int(cols_hit.max())] if cols_hit.size else None,
        "line_width_px": int(rows.max() - rows.min() + 1) if rows.size else None,
    }
    # 合否
    ok_mid = alt_top is not None and abs(alt_top - exp_out) < 1.0
    ok_eq = rows.size > 0 and abs((rows.min() + rows.max()) / 2 - cx) < 3
    res["pass"] = bool(ok_mid and ok_eq)
    (OUT / "verify.json").write_text(json.dumps(res, ensure_ascii=False, indent=2))
    print(json.dumps(res, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
