"""ep001「もし地球に土星みたいな輪ができたら？」のBlenderシーンを生成し .blend に保存する。

実行: ../../.venv/bin/python scene.py  （shorts/sk.py build ep001-earth-ring から呼ばれる）
シーン:
  SPACE       単位 1 = 1000 km。地球・輪・2地点マーカー・断面図・宇宙カメラ
  GROUND_MID  単位 km。北緯35°の観測者の局所座標（x=東, y=北, z=天頂）
  GROUND_EQ   単位 km。赤道の観測者の局所座標
"""
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "lib"))

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import blender_kit as bk  # noqa: E402
import geom  # noqa: E402

EP = json.loads((HERE / "episode.json").read_text())
SCI = EP["science"]
R_KM = SCI["earth_radius_km"]
RIN, ROUT = SCI["ring_inner_ratio"], SCI["ring_outer_ratio"]
OBS = SCI["observers"]
DEC = math.radians(SCI["sun"]["declination_deg"])
HA = math.radians(SCI["sun"]["hour_angle_deg"])
TEX = ROOT / "assets" / "textures" / "bluemarble_bmng.jpg"
OUT = HERE / "build" / "ep001.blend"

ORANGE = (1.0, 0.45, 0.08)
CYAN = (0.15, 0.75, 1.0)


def sun_in_meridian_frame():
    """観測者の子午線を X、東を Y、北極を Z とする系での太陽方向（午後: 西=-Y）。"""
    return Vector((math.cos(DEC) * math.cos(HA), -math.cos(DEC) * math.sin(HA), math.sin(DEC)))


def smooth(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


# ======================================================================= SPACE
def build_space():
    sc = bk.new_scene("SPACE")
    U = 1000.0  # km per unit
    R = R_KM / U
    lon0 = math.radians(OBS["mid"]["lon"])
    M = Vector((math.cos(lon0), math.sin(lon0), 0))
    E = Vector((-math.sin(lon0), math.cos(lon0), 0))
    Z = Vector((0, 0, 1))
    s_m = sun_in_meridian_frame()
    S = (s_m.x * M + s_m.y * E + s_m.z * Z).normalized()

    sc.world = bk.star_world("W_space")
    main = bk.collection(sc, "EARTH_RING")
    bk.sun_lamp("SUN", main, S, strength=4.5)

    # 地球（Blue Marble を経緯度で貼る）
    earth = bk.link(bk.uv_sphere("Earth", R, 256, 128), main)
    m = bpy.data.materials.new("M_earth")
    m.use_nodes = True
    nt = m.node_tree
    N, L = nt.nodes.new, nt.links.new
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.8
    tc = N("ShaderNodeTexCoord")
    sep = N("ShaderNodeSeparateXYZ"); L(tc.outputs["Object"], sep.inputs[0])
    at2 = N("ShaderNodeMath"); at2.operation = "ARCTAN2"
    L(sep.outputs[1], at2.inputs[0]); L(sep.outputs[0], at2.inputs[1])
    u = N("ShaderNodeMapRange"); u.inputs["From Min"].default_value = -math.pi; u.inputs["From Max"].default_value = math.pi
    L(at2.outputs[0], u.inputs["Value"])
    ln = N("ShaderNodeVectorMath"); ln.operation = "LENGTH"; L(tc.outputs["Object"], ln.inputs[0])
    dv = N("ShaderNodeMath"); dv.operation = "DIVIDE"; L(sep.outputs[2], dv.inputs[0]); L(ln.outputs["Value"], dv.inputs[1])
    asn = N("ShaderNodeMath"); asn.operation = "ARCSINE"; L(dv.outputs[0], asn.inputs[0])
    v = N("ShaderNodeMapRange"); v.inputs["From Min"].default_value = -math.pi / 2; v.inputs["From Max"].default_value = math.pi / 2
    L(asn.outputs[0], v.inputs["Value"])
    cmb = N("ShaderNodeCombineXYZ"); L(u.outputs["Result"], cmb.inputs[0]); L(v.outputs["Result"], cmb.inputs[1])
    img = N("ShaderNodeTexImage")
    img.image = bpy.data.images.load(str(TEX))
    img.extension = "EXTEND"
    L(cmb.outputs[0], img.inputs["Vector"])
    L(img.outputs["Color"], bsdf.inputs["Base Color"])
    earth.data.materials.append(m)

    # 大気のふち（見た目用の薄い発光シェル）
    atm = bk.link(bk.uv_sphere("Atmosphere", R * 1.012, 128, 64), main)
    am = bpy.data.materials.new("M_atmo")
    am.use_nodes = True
    nt = am.node_tree; nt.nodes.clear(); N, L = nt.nodes.new, nt.links.new
    out = N("ShaderNodeOutputMaterial")
    lw = N("ShaderNodeLayerWeight"); lw.inputs["Blend"].default_value = 0.35
    pw = N("ShaderNodeMath"); pw.operation = "POWER"; pw.inputs[1].default_value = 2.5
    L(lw.outputs["Facing"], pw.inputs[0])
    em = N("ShaderNodeEmission"); em.inputs["Color"].default_value = (0.25, 0.5, 1.0, 1); em.inputs["Strength"].default_value = 1.2
    L(pw.outputs[0], em.inputs["Strength"])
    tr = N("ShaderNodeBsdfTransparent")
    add = N("ShaderNodeAddShader"); L(tr.outputs[0], add.inputs[0]); L(em.outputs[0], add.inputs[1])
    L(add.outputs[0], out.inputs[0])
    atm.data.materials.append(am)
    atm.visible_shadow = False

    # 輪（厚さ0の円環。宇宙からの見た目用）
    ring = bk.link(bk.annulus("Ring", RIN * R, ROUT * R, 1024, 16), main)
    ring.data.materials.append(bk.ring_material("M_ring_space", R, RIN, ROUT))

    # 観測地点マーカー（大きさは説明用に誇張）
    mk = bk.collection(sc, "MARKERS")
    pins = bk.collection(sc, "MARKERS_PIN", parent=mk)
    anchors = bk.collection(sc, "ANCHORS")
    for key, col in (("mid", ORANGE), ("eq", CYAN)):
        lat, lon = math.radians(OBS[key]["lat"]), math.radians(OBS[key]["lon"])
        n = Vector((math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat)))
        mat = bk.emission_mat(f"M_mk_{key}", col, 2.2)
        bk.link(bk.segment(f"Pin_{key}", n * R, n * (R + 0.55), 0.035, mat), pins)
        head = bk.link(bk.uv_sphere(f"Head_{key}", 0.11, 24, 12, location=n * (R + 0.6)), pins)
        head.data.materials.append(mat)
        dot = bk.link(bk.uv_sphere(f"Dot_{key}", 0.10, 24, 12, location=n * (R + 0.02)), mk)
        dot.data.materials.append(mat)
        bk.empty(f"A_{key}_head", n * (R + 0.75), anchors)
        bk.empty(f"A_{key}_dot", n * R, anchors)
    bk.empty("A_earth", (0, 0, 0), anchors)

    # ---- 断面図（子午面での図解。輪の厚みと線の太さは誇張）
    sec = bk.collection(sc, "SECTION")
    m_ring = bk.emission_mat("M_sec_ring", (1.0, 0.80, 0.50), 0.9)
    m_mid = bk.emission_mat("M_sec_mid", ORANGE, 1.6)
    m_eq = bk.emission_mat("M_sec_eq", CYAN, 1.6)
    m_hz = bk.emission_mat("M_sec_hz", (0.9, 0.9, 0.9), 0.6)
    depth = E * 0.0
    bk.link(bk.box("SecRingBar", M * ((RIN + ROUT) / 2 * R), (1, 1, 1), m_ring), sec)
    bar = bpy.data.objects["SecRingBar"]
    bar.rotation_euler = (0, 0, lon0)
    bar.scale = ((ROUT - RIN) * R, 0.2, 0.45)
    O_mid = M * (R * math.cos(math.radians(OBS["mid"]["lat"]))) + Z * (R * math.sin(math.radians(OBS["mid"]["lat"])))
    O_eq = M * R
    p_in, p_out = M * (RIN * R), M * (ROUT * R)
    bk.link(bk.segment("SecLine_mid_in", O_mid + depth, p_in, 0.045, m_mid), sec)
    bk.link(bk.segment("SecLine_mid_out", O_mid + depth, p_out, 0.045, m_mid), sec)
    bk.link(bk.segment("SecLine_eq", O_eq + Z * 0.0, p_in, 0.06, m_eq), sec)
    # 地平線（接平面の断面 = 接線）
    up_mid = O_mid.normalized()
    north_mid = Z - up_mid * Z.dot(up_mid)
    north_mid.normalize()
    bk.link(bk.segment("SecHz_mid", O_mid - north_mid * 4.0, O_mid + north_mid * 4.0, 0.03, m_hz), sec)
    bk.link(bk.segment("SecHz_eq", O_eq - Z * 4.0, O_eq + Z * 4.0, 0.03, m_hz), sec)
    for nm, p in (("A_sec_mid", O_mid), ("A_sec_eq", O_eq), ("A_sec_in", p_in), ("A_sec_out", p_out),
                  ("A_sec_hz_mid_s", O_mid - north_mid * 4.0), ("A_sec_hz_eq_top", O_eq + Z * 4.0)):
        bk.empty(nm, p, anchors)
    for o in sec.objects:
        o.visible_shadow = False

    # ---- カメラ
    cams = bk.collection(sc, "CAMERAS")
    # c02: 宇宙から2地点と輪を1カットで（ゆっくり回り込み）
    cam = bk.camera("CAM_orbit", cams, 62.0, clip=(0.05, 5000))
    n_frames = 195
    for f in range(1, n_frames + 1):
        t = smooth((f - 1) / (n_frames - 1))
        az = lon0 + math.radians(-34 + 16 * t)
        el = math.radians(30 - 6 * t)
        d = 46 - 4 * t
        pos = Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el))) * d
        tgt = Vector((0, 0, 0)) + Z * 0.8
        cam.location = pos
        cam.rotation_euler = bk.look_rot(tgt - pos)
        cam.keyframe_insert("location", frame=f)
        cam.keyframe_insert("rotation_euler", frame=f)
    end_pos = Vector(cam.location)

    # c03: 北緯35°の地点へ降下
    cam = bk.camera("CAM_descent", cams, 62.0, clip=(0.001, 5000))
    n_mid = O_mid.normalized()
    nf = 45
    # 終点: 北緯35°地点の北側上空 約1200 km から、南（赤道・輪の方向）を見下ろす
    p1 = O_mid + n_mid * 2.6 + north_mid * 1.6
    look1 = O_mid - north_mid * 1.4
    d0, d1 = end_pos.length, p1.length
    for f in range(1, nf + 1):
        ts = smooth((f - 1) / (nf - 1))
        dirv = end_pos.normalized().slerp(p1.normalized(), ts)
        d = math.exp(math.log(d0) * (1 - ts) + math.log(d1) * ts)
        pos = dirv * d
        tgt = (Z * 0.8) * (1 - ts) + look1 * ts
        cam.location = pos
        cam.rotation_euler = bk.look_rot(tgt - pos, up=(north_mid * ts + Z * (1 - ts)).normalized())
        cam.keyframe_insert("location", frame=f)
        cam.keyframe_insert("rotation_euler", frame=f)

    # c07: 断面（子午面を西側から正射影で見る。右=赤道側、上=北）
    cam = bk.camera("CAM_section", cams, clip=(0.1, 500))
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 36.0
    center = M * 5.4 + Z * 3.0
    cam.location = center - E * 80
    cam.rotation_euler = bk.look_rot(E, up=Z)

    # c08: 輪を真横に近づく（見る角度が浅いほど細くなる）
    cam = bk.camera("CAM_edgeon", cams, 27.0, sensor_fit="HORIZONTAL", clip=(0.1, 5000))
    sun_az = math.atan2(S.y, S.x)
    az = sun_az + math.radians(38)
    nf = 120
    for f in range(1, nf + 1):
        t = (f - 1) / (nf - 1)
        te = 1 - (1 - min(1.0, t / 0.85)) ** 3  # 終盤は真横(0°)で静止
        el = math.radians(38 * (1 - te))
        pos = Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el))) * 78
        cam.location = pos
        cam.rotation_euler = bk.look_rot(-pos)
        cam.keyframe_insert("location", frame=f)
        cam.keyframe_insert("rotation_euler", frame=f)
        if f == nf:
            pass

    bk.set_collection_excluded(sc, "SECTION", True)
    return sc


# ======================================================================= GROUND
def build_ground(key: str):
    o = OBS[key]
    lat = o["lat"]
    sc = bk.new_scene("GROUND_" + key.upper())
    h = SCI["camera_height_m"] / 1000.0
    # ECEF(子午線=X) -> ENU の剛体変換
    Ev, Nv, Uv = (Vector(v) for v in geom.enu_basis(lat))
    Ov = Vector(geom.observer_pos(lat, R_KM))
    rot = Matrix((Ev, Nv, Uv))  # 行ベクトル
    T = rot.to_4x4()
    T.translation = -(rot @ Ov)

    s_m = sun_in_meridian_frame()
    s_enu = rot @ s_m
    sun_alt, sun_az = geom.enu_to_altaz(tuple(s_enu))
    sc["sun_alt_az"] = (sun_alt, sun_az)

    sc.world = bk.sky_world("W_sky_" + key, sun_alt, sun_az, strength=0.35, sun_disc=True)
    main = bk.collection(sc, "WORLD")
    bk.sun_lamp("SUN", main, s_enu, strength=3.2)

    # 輪（局所座標へ。厚みは見やすさのため誇張）
    ring = bk.link(bk.annulus("Ring", RIN * R_KM, ROUT * R_KM, 4096, 24), main)
    ring.matrix_world = T
    ring.data.materials.append(bk.ring_material("M_ring_" + key, R_KM, RIN, ROUT, atmosphere_fade=True))
    sol = ring.modifiers.new("thickness", "SOLIDIFY")
    sol.thickness = SCI["ring_render_thickness_km"]
    sol.offset = 0.0
    sol.use_even_offset = True
    sol.use_rim = True
    sol.material_offset_rim = 1
    # 縁(リム)は不透明: 真横からの視線は輪の中を数千km通るので、実際にはほぼ不透明な線になる
    ring.data.materials.append(bk.ring_rim_material("M_ring_rim_" + key))
    sc.view_settings.exposure = EP["render"].get("ground_exposure", -2.5)

    # 地球本体（影だけ落とす）と、見える地面（局所の地平面）
    occ = bk.link(bk.uv_sphere("EarthShadow", R_KM - 0.005, 512, 256, location=(0, 0, -R_KM)), main)
    bk.shadow_only(occ)
    me = bpy.data.meshes.new("Ground")
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, segments=128, radius=1500.0)
    bm.to_mesh(me); bm.free()
    gnd = bk.link(bpy.data.objects.new("Ground", me), main)
    gm = bpy.data.materials.new("M_ground")
    gm.use_nodes = True
    nt = gm.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = 1.0
    noise = nt.nodes.new("ShaderNodeTexNoise"); noise.inputs["Scale"].default_value = 900.0
    cr = nt.nodes.new("ShaderNodeValToRGB")
    cr.color_ramp.elements[0].color = (0.035, 0.05, 0.025, 1)
    cr.color_ramp.elements[1].color = (0.09, 0.10, 0.05, 1)
    nt.links.new(noise.outputs["Fac"], cr.inputs[0])
    nt.links.new(cr.outputs["Color"], b.inputs["Base Color"])
    gnd.data.materials.append(gm)
    gnd.visible_shadow = False

    # アンカー（2D投影の照合と図解の位置合わせ用）
    anc = bk.collection(sc, "ANCHORS")
    far = 3000.0
    for nm, alt, az in (("A_hz_S", 0, 180), ("A_alt30_S", 30, 180), ("A_alt60_S", 60, 180),
                        ("A_zenith", 90, 180), ("A_hz_E", 0, 90), ("A_hz_W", 0, 270), ("A_alt30_E", 30, 90)):
        bk.empty(nm, bk.altaz_dir(alt, az) * far + Vector((0, 0, h)), anc)
    for nm, r in (("A_ring_in_S", RIN * R_KM), ("A_ring_out_S", ROUT * R_KM)):
        p = T @ Vector((r, 0, 0))
        bk.empty(nm, p, anc)
    sc["ring_meridian_alt_deg"] = [geom.meridian_altitude(RIN * R_KM, lat), geom.meridian_altitude(ROUT * R_KM, lat)]

    # カメラ（2地点で同じ設定 = 地平線と視点をそろえる）
    cams = bk.collection(sc, "CAMERAS")
    eye = Vector((0, 0, h))
    PITCH, AZ, VFOV = 25.0, 180.0, 100.0
    c = bk.camera("CAM_ground", cams, VFOV, sensor_fit="VERTICAL", clip=(0.0005, 1e5))
    c.location = eye
    c.rotation_euler = bk.cam_altaz_rot(PITCH, AZ)

    c = bk.camera("CAM_tilt", cams, VFOV, sensor_fit="VERTICAL", clip=(0.0005, 1e5))
    c.location = eye
    nf = 90
    for f in range(1, nf + 1):
        t = (f - 1) / (nf - 1)
        p = PITCH + (90.0 - PITCH) * smooth(min(1.0, max(0.0, (t - 0.25) / 0.65)))
        if p >= 89.999:
            c.rotation_euler = bk.look_rot((0, 0, 1), up=(0, 1, 0))  # 天頂（画面上=北）
        else:
            c.rotation_euler = bk.cam_altaz_rot(p, AZ)
        c.keyframe_insert("rotation_euler", frame=f)

    c = bk.camera("CAM_allsky", cams, clip=(0.0005, 1e5))
    bk.set_fisheye(c, 180.0)
    c.location = eye
    c.rotation_euler = bk.look_rot((0, 0, 1), up=(0, 1, 0))  # 真上。画面上=北、左=東

    c = bk.camera("CAM_hook", cams, 96.0, sensor_fit="HORIZONTAL", clip=(0.0005, 1e5))
    c.location = eye
    if key == "mid":
        c.rotation_euler = bk.cam_altaz_rot(17.0, 180.0)
    else:
        c.rotation_euler = bk.cam_altaz_rot(38.0, 90.0)  # 東を見上げる：輪は地平線から天頂へ縦に
    return sc


def main():
    bk.reset()
    build_space()
    build_ground("mid")
    build_ground("eq")
    # 既定シーンを SPACE に
    OUT.parent.mkdir(parents=True, exist_ok=True)
    for s in list(bpy.data.scenes):
        if s.name not in ("SPACE", "GROUND_MID", "GROUND_EQ"):
            bpy.data.scenes.remove(s)
    bpy.context.window.scene = bpy.data.scenes["SPACE"] if bpy.context.window else None
    bpy.ops.file.pack_all() if False else None
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT), compress=True)
    info = {s.name: {k: (list(v) if hasattr(v, "__len__") else v) for k, v in s.items()} for s in bpy.data.scenes}
    print("SCENE_INFO", json.dumps(info, ensure_ascii=False, default=str))
    print("SAVED", OUT)


if __name__ == "__main__":
    main()
