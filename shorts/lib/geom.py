"""地球の輪（仮想）と観測者の幾何計算。Blender不要の純Python。

座標系
- 地球中心系 ECEF風: Z=自転軸(北), X=観測者の子午線方向。単位 km。
- 局所系 ENU: x=東, y=北, z=天頂。観測者の足元が原点。
輪は地球の赤道面(Z=0)にある薄い円環と仮定する。
"""
from __future__ import annotations

import math
from dataclasses import dataclass

R_EARTH_EQ_KM = 6378.137  # 地球赤道半径（NASA Earth Fact Sheet の値）


@dataclass(frozen=True)
class Ring:
    inner_ratio: float  # 惑星半径に対する内縁半径
    outer_ratio: float  # 惑星半径に対する外縁半径
    planet_radius_km: float = R_EARTH_EQ_KM

    @property
    def inner_km(self) -> float:
        return self.inner_ratio * self.planet_radius_km

    @property
    def outer_km(self) -> float:
        return self.outer_ratio * self.planet_radius_km


def observer_pos(lat_deg: float, R: float = R_EARTH_EQ_KM):
    p = math.radians(lat_deg)
    return (R * math.cos(p), 0.0, R * math.sin(p))


def enu_basis(lat_deg: float):
    """観測者子午線(経度差0)での E, N, U 単位ベクトル（地球中心系）。"""
    p = math.radians(lat_deg)
    E = (0.0, 1.0, 0.0)
    N = (-math.sin(p), 0.0, math.cos(p))
    U = (math.cos(p), 0.0, math.sin(p))
    return E, N, U


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def ecef_to_enu(P, lat_deg: float, R: float = R_EARTH_EQ_KM):
    O = observer_pos(lat_deg, R)
    E, N, U = enu_basis(lat_deg)
    d = (P[0] - O[0], P[1] - O[1], P[2] - O[2])
    return (_dot(d, E), _dot(d, N), _dot(d, U))


def enu_to_altaz(v):
    """局所ベクトル -> (高度deg, 方位deg; 北=0, 東=90, 南=180)。"""
    x, y, z = v
    h = math.hypot(x, y)
    alt = math.degrees(math.atan2(z, h))
    az = math.degrees(math.atan2(x, y)) % 360.0
    return alt, az


def ring_point(r_km: float, theta_deg: float):
    """赤道面上、観測者子午線から経度差 theta の点。"""
    t = math.radians(theta_deg)
    return (r_km * math.cos(t), r_km * math.sin(t), 0.0)


def ring_altaz(r_km: float, theta_deg: float, lat_deg: float, R: float = R_EARTH_EQ_KM):
    return enu_to_altaz(ecef_to_enu(ring_point(r_km, theta_deg), lat_deg, R))


def meridian_altitude(r_km: float, lat_deg: float, R: float = R_EARTH_EQ_KM) -> float:
    """真南（観測者子午線上）に見える輪の点の高度。解析式。
    tan(alt) = (r cosφ - R) / (r sinφ)   （φ>0）
    """
    p = math.radians(lat_deg)
    if abs(p) < 1e-12:
        return 90.0 if r_km > R else -90.0
    return math.degrees(math.atan2(r_km * math.cos(p) - R, r_km * math.sin(p)))


def visible_theta_limit(r_km: float, lat_deg: float, R: float = R_EARTH_EQ_KM):
    """輪の半径 r の円のうち地平線より上にある経度差の範囲 |theta|<limit。
    条件: r cosθ cosφ > R。見えなければ None。
    """
    c = R / (r_km * math.cos(math.radians(lat_deg)))
    if c >= 1:
        return None
    return math.degrees(math.acos(c))


def horizon_crossings(r_km: float, lat_deg: float, R: float = R_EARTH_EQ_KM):
    """円が地平線と交わる点の方位（東側, 西側）。"""
    lim = visible_theta_limit(r_km, lat_deg, R)
    if lim is None:
        return None
    _, az_e = ring_altaz(r_km, lim - 1e-9, lat_deg, R)
    _, az_w = ring_altaz(r_km, -lim + 1e-9, lat_deg, R)
    return az_e, az_w


def angular_thickness_deg(thickness_km: float, distance_km: float) -> float:
    return math.degrees(2 * math.atan(thickness_km / 2 / distance_km))


def summary(ring: Ring, lats=(0.0, 35.0)):
    out = {}
    for lat in lats:
        d = {}
        for name, r in (("inner", ring.inner_km), ("outer", ring.outer_km)):
            alt_m = meridian_altitude(r, lat)
            lim = visible_theta_limit(r, lat)
            hc = horizon_crossings(r, lat)
            d[name] = {
                "radius_km": round(r, 1),
                "altitude_km_above_surface": round(r - ring.planet_radius_km, 1),
                "meridian_alt_deg": round(alt_m, 2),
                "visible_theta_limit_deg": None if lim is None else round(lim, 2),
                "horizon_az_deg": None if hc is None else [round(a, 2) for a in hc],
            }
        if abs(lat) < 1e-9:
            # 赤道: 観測者は輪の面内。輪は天頂を通る東西の大円上に並ぶ（真横から見る）
            d["note"] = "observer in ring plane -> edge-on line through zenith (E-W)"
            d["zenith_distance_inner_km"] = round(ring.inner_km - ring.planet_radius_km, 1)
            d["line_width_deg_if_10m"] = angular_thickness_deg(0.01, ring.inner_km - ring.planet_radius_km)
        out[f"lat{lat:g}"] = d
    return out


if __name__ == "__main__":
    import json

    print(json.dumps(summary(Ring(1.24, 2.27)), ensure_ascii=False, indent=2))
