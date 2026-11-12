"""各回で再利用する Blender (bpy) ユーティリティ。

- レンダー設定（Cycles CPU / デノイズ / AgX）
- カメラ・視線・ライト
- 円環メッシュ、線分（細い円柱）、発光マテリアル
- アンカー（2D投影座標）の書き出し
- カット単位・連番・途中再開つきのレンダーループ
"""
from __future__ import annotations

import json
import math
import os
import time
from pathlib import Path

import bpy  # noqa: F401  (bmesh より先に読み込む)
import bmesh
import bpy
from mathutils import Matrix, Vector


# ---------------------------------------------------------------- 基本
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def new_scene(name: str):
    sc = bpy.data.scenes.new(name)
    setup_render(sc)
    return sc


def setup_render(sc, samples=32):
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.02
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 4
    sc.cycles.diffuse_bounces = 2
    sc.cycles.glossy_bounces = 1
    sc.cycles.transparent_max_bounces = 16
    sc.render.resolution_x, sc.render.resolution_y = 1080, 1920
    sc.render.resolution_percentage = 100
    sc.render.fps = 30
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGB"
    sc.render.film_transparent = False
    for vt in ("AgX", "Filmic", "Standard"):
        try:
            sc.view_settings.view_transform = vt
            break
        except TypeError:
            continue
    try:
        sc.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass


def collection(sc, name: str, parent=None):
    col = bpy.data.collections.new(name)
    (parent or sc.collection).children.link(col)
    return col


def link(obj, col):
    col.objects.link(obj)
    return obj


# ---------------------------------------------------------------- マテリアル
def emission_mat(name, color, strength=5.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*color, 1)
    em.inputs["Strength"].default_value = strength
    nt.links.new(em.outputs[0], out.inputs[0])
    return m


def diffuse_mat(name, color, rough=0.9):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    return m


def ring_material(name, planet_radius_units: float, inner_ratio: float, outer_ratio: float,
                  atmosphere_fade: bool = False):
    """土星の主な輪の光学的厚さの並び（C環→B環→カッシーニの間隙→A環）を
    惑星半径比で再現する半透明マテリアル。物体座標の半径から決める。"""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.blend_method = "HASHED" if hasattr(m, "blend_method") else None
    nt = m.node_tree
    nt.nodes.clear()
    N = nt.nodes.new
    L = nt.links.new
    out = N("ShaderNodeOutputMaterial")
    tc = N("ShaderNodeTexCoord")
    sep = N("ShaderNodeSeparateXYZ")
    L(tc.outputs["Object"], sep.inputs[0])
    comb = N("ShaderNodeCombineXYZ")
    L(sep.outputs[0], comb.inputs[0])
    L(sep.outputs[1], comb.inputs[1])
    ln = N("ShaderNodeVectorMath"); ln.operation = "LENGTH"
    L(comb.outputs[0], ln.inputs[0])
    div = N("ShaderNodeMath"); div.operation = "DIVIDE"
    div.inputs[1].default_value = planet_radius_units
    L(ln.outputs["Value"], div.inputs[0])  # r / Rp
    # 0..1 に正規化
    mr = N("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = inner_ratio
    mr.inputs["From Max"].default_value = outer_ratio
    L(div.outputs[0], mr.inputs["Value"])
    # 不透明度プロファイル（土星半径比での境界を 0..1 に変換）
    def t(x):
        return (x - inner_ratio) / (outer_ratio - inner_ratio)
    ramp = N("ShaderNodeValToRGB")
    cr = ramp.color_ramp
    cr.interpolation = "LINEAR"
    stops = [
        (0.0, 0.10), (t(1.45), 0.18), (t(1.52), 0.22),
        (t(1.53), 0.70), (t(1.75), 0.92), (t(1.94), 0.88),
        (t(1.955), 0.07), (t(2.02), 0.10),
        (t(2.03), 0.62), (t(2.20), 0.55), (t(2.212), 0.05), (t(2.218), 0.05), (t(2.225), 0.5),
        (t(2.265), 0.45), (1.0, 0.0),
    ]
    cr.elements[0].position = stops[0][0]
    cr.elements[0].color = (stops[0][1],) * 3 + (1,)
    cr.elements[1].position = stops[-1][0]
    cr.elements[1].color = (stops[-1][1],) * 3 + (1,)
    for p, a in stops[1:-1]:
        e = cr.elements.new(p)
        e.color = (a, a, a, 1)
    L(mr.outputs["Result"], ramp.inputs[0])
    # 細かな同心円の濃淡
    noise = N("ShaderNodeTexNoise")
    noise.noise_dimensions = "1D"
    noise.inputs["Scale"].default_value = 60.0
    noise.inputs["Detail"].default_value = 6.0
    L(mr.outputs["Result"], noise.inputs["W"])
    nmul = N("ShaderNodeMapRange")
    nmul.inputs["To Min"].default_value = 0.7
    nmul.inputs["To Max"].default_value = 1.25
    L(noise.outputs["Fac"], nmul.inputs["Value"])
    alpha = N("ShaderNodeMath"); alpha.operation = "MULTIPLY"; alpha.use_clamp = True
    L(ramp.outputs["Color"], alpha.inputs[0])
    L(nmul.outputs["Result"], alpha.inputs[1])
    alpha_out = alpha
    if atmosphere_fade:
        # 視線が地平線に近いほど大気で薄れる（見た目の近似）。Incoming は表面→カメラ。
        geo = N("ShaderNodeNewGeometry")
        sepi = N("ShaderNodeSeparateXYZ")
        L(geo.outputs["Incoming"], sepi.inputs[0])
        neg = N("ShaderNodeMath"); neg.operation = "MULTIPLY"; neg.inputs[1].default_value = -1.0
        L(sepi.outputs[2], neg.inputs[0])
        fade = N("ShaderNodeMapRange")
        fade.inputs["From Min"].default_value = 0.0
        fade.inputs["From Max"].default_value = 0.25
        fade.inputs["To Min"].default_value = 0.35
        fade.inputs["To Max"].default_value = 1.0
        L(neg.outputs[0], fade.inputs["Value"])
        a2 = N("ShaderNodeMath"); a2.operation = "MULTIPLY"; a2.use_clamp = True
        L(alpha.outputs[0], a2.inputs[0])
        L(fade.outputs["Result"], a2.inputs[1])
        alpha_out = a2
    # 色：C環は灰褐色、B環はクリーム、A環はやや灰色
    cramp = N("ShaderNodeValToRGB")
    cc = cramp.color_ramp
    cc.elements[0].position = 0.0
    cc.elements[0].color = (0.55, 0.50, 0.44, 1)
    cc.elements[1].position = 1.0
    cc.elements[1].color = (0.72, 0.70, 0.66, 1)
    e = cc.elements.new(t(1.6)); e.color = (0.86, 0.80, 0.68, 1)
    e = cc.elements.new(t(1.9)); e.color = (0.90, 0.84, 0.72, 1)
    L(mr.outputs["Result"], cramp.inputs[0])
    dif = N("ShaderNodeBsdfDiffuse")
    L(cramp.outputs["Color"], dif.inputs["Color"])
    tra = N("ShaderNodeBsdfTranslucent")
    L(cramp.outputs["Color"], tra.inputs["Color"])
    mixs = N("ShaderNodeMixShader")
    mixs.inputs[0].default_value = 0.25
    L(dif.outputs[0], mixs.inputs[1])
    L(tra.outputs[0], mixs.inputs[2])
    tr = N("ShaderNodeBsdfTransparent")
    mix = N("ShaderNodeMixShader")
    L(alpha_out.outputs[0], mix.inputs[0])
    L(tr.outputs[0], mix.inputs[1])
    L(mixs.outputs[0], mix.inputs[2])
    L(mix.outputs[0], out.inputs[0])
    return m


def ring_rim_material(name, color=(0.86, 0.80, 0.68)):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    d = nt.nodes.new("ShaderNodeBsdfDiffuse"); d.inputs["Color"].default_value = (*color, 1)
    t = nt.nodes.new("ShaderNodeBsdfTranslucent"); t.inputs["Color"].default_value = (*color, 1)
    mx = nt.nodes.new("ShaderNodeMixShader"); mx.inputs[0].default_value = 0.5
    nt.links.new(d.outputs[0], mx.inputs[1]); nt.links.new(t.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], out.inputs[0])
    return m


# ---------------------------------------------------------------- 形状
def annulus(name, r_in, r_out, segments=2048, rings=8):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    verts = []
    for j in range(rings + 1):
        r = r_in + (r_out - r_in) * j / rings
        row = []
        for i in range(segments):
            a = 2 * math.pi * i / segments
            row.append(bm.verts.new((r * math.cos(a), r * math.sin(a), 0.0)))
        verts.append(row)
    for j in range(rings):
        for i in range(segments):
            i2 = (i + 1) % segments
            bm.faces.new((verts[j][i], verts[j][i2], verts[j + 1][i2], verts[j + 1][i]))
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    return bpy.data.objects.new(name, me)


def uv_sphere(name, radius, seg=128, rings=64, location=(0, 0, 0)):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=radius)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    ob.location = location
    return ob


def segment(name, p0, p1, radius, mat=None, verts=12):
    """p0→p1 の細い円柱（図解の線として使う）。"""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=verts, radius1=radius, radius2=radius, depth=d.length)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    ob.location = (p0 + p1) / 2
    ob.rotation_mode = "QUATERNION"
    ob.rotation_quaternion = d.to_track_quat("Z", "Y")
    if mat:
        ob.data.materials.append(mat)
    return ob


def box(name, center, size, mat=None):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    ob.location = center
    ob.scale = size
    if mat:
        ob.data.materials.append(mat)
    return ob


def empty(name, loc, col):
    e = bpy.data.objects.new(name, None)
    e.location = loc
    col.objects.link(e)
    return e


# ---------------------------------------------------------------- カメラ・光
def camera(name, col, lens_fov_deg=None, sensor_fit="AUTO", clip=(0.001, 1e6)):
    cd = bpy.data.cameras.new(name)
    cd.sensor_fit = sensor_fit
    if lens_fov_deg:
        cd.lens_unit = "FOV"
        cd.angle = math.radians(lens_fov_deg)
    cd.clip_start, cd.clip_end = clip
    ob = bpy.data.objects.new(name, cd)
    col.objects.link(ob)
    return ob


def set_fisheye(cam_ob, fov_deg=180.0):
    cd = cam_ob.data
    cd.type = "PANO"
    cd.panorama_type = "FISHEYE_EQUIDISTANT"
    cd.fisheye_fov = math.radians(fov_deg)


def look_rot(direction, up=(0, 0, 1)):
    """カメラ -Z を direction に、+Y をなるべく up に向ける回転（Euler）。"""
    f = Vector(direction).normalized()
    u = Vector(up)
    back = -f
    right = u.cross(back)
    if right.length < 1e-9:
        right = Vector((1, 0, 0))
    right.normalize()
    upv = back.cross(right).normalized()
    m = Matrix((right, upv, back)).transposed()
    return m.to_euler()


def altaz_dir(alt_deg, az_deg):
    a, z = math.radians(alt_deg), math.radians(az_deg)
    return Vector((math.cos(a) * math.sin(z), math.cos(a) * math.cos(z), math.sin(a)))


def cam_altaz_rot(pitch_deg, az_deg, roll_up=(0, 0, 1)):
    return look_rot(altaz_dir(pitch_deg, az_deg), roll_up)


def sun_lamp(name, col, to_sun_dir, strength=4.0, angle_deg=0.53):
    ld = bpy.data.lights.new(name, "SUN")
    ld.energy = strength
    ld.angle = math.radians(angle_deg)
    ob = bpy.data.objects.new(name, ld)
    ob.rotation_mode = "QUATERNION"
    ob.rotation_quaternion = (-Vector(to_sun_dir)).to_track_quat("-Z", "Y")
    col.objects.link(ob)
    return ob


def sky_world(name, sun_alt_deg, sun_az_deg, strength=1.0, sun_disc=False):
    w = bpy.data.worlds.new(name)
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    sky = nt.nodes.new("ShaderNodeTexSky")
    sky.sky_type = "MULTIPLE_SCATTERING"
    sky.sun_elevation = math.radians(sun_alt_deg)
    sky.sun_rotation = math.radians(sun_az_deg)  # 実測: 0=+Y(北), 90=+X(東)
    sky.sun_disc = sun_disc
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = strength
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(sky.outputs[0], bg.inputs[0])
    nt.links.new(bg.outputs[0], out.inputs[0])
    return w


def star_world(name, ambient=0.002):
    w = bpy.data.worlds.new(name)
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    N, L = nt.nodes.new, nt.links.new
    tc = N("ShaderNodeTexCoord")
    vor = N("ShaderNodeTexVoronoi")
    vor.inputs["Scale"].default_value = 420.0
    L(tc.outputs["Generated"], vor.inputs["Vector"])
    mr = N("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = 0.035
    mr.inputs["From Max"].default_value = 0.0
    L(vor.outputs["Distance"], mr.inputs["Value"])
    pw = N("ShaderNodeMath"); pw.operation = "POWER"; pw.inputs[1].default_value = 3.0
    L(mr.outputs["Result"], pw.inputs[0])
    gate = N("ShaderNodeMath"); gate.operation = "GREATER_THAN"; gate.inputs[1].default_value = 0.82
    L(vor.outputs["Color"], gate.inputs[0])
    mul = N("ShaderNodeMath"); mul.operation = "MULTIPLY"
    L(pw.outputs[0], mul.inputs[0]); L(gate.outputs[0], mul.inputs[1])
    s = N("ShaderNodeMath"); s.operation = "MULTIPLY"; s.inputs[1].default_value = 3.0
    L(mul.outputs[0], s.inputs[0])
    add = N("ShaderNodeMath"); add.operation = "ADD"; add.inputs[1].default_value = ambient
    L(s.outputs[0], add.inputs[0])
    bg = N("ShaderNodeBackground")
    bg.inputs["Color"].default_value = (0.8, 0.85, 1.0, 1)
    L(add.outputs[0], bg.inputs["Strength"])
    out = N("ShaderNodeOutputWorld")
    L(bg.outputs[0], out.inputs[0])
    return w


def shadow_only(ob):
    ob.visible_camera = False
    ob.visible_diffuse = False
    ob.visible_glossy = False
    ob.visible_transmission = False
    ob.visible_volume_scatter = False
    ob.visible_shadow = True


# ---------------------------------------------------------------- 書き出し・レンダー
def set_collection_excluded(sc, name: str, excluded: bool):
    """コレクションをレンダーから外す/戻す（hide_render。シーン固有のコレクションに使う）。"""
    col = bpy.data.collections.get(name)
    if col is None:
        raise KeyError(name)
    col.hide_render = excluded


def project_anchors(sc, cam_ob):
    from bpy_extras.object_utils import world_to_camera_view
    res = {}
    if cam_ob.data.type == "PANO":
        return res
    for ob in sc.objects:
        if ob.type == "EMPTY" and ob.name.startswith("A_"):
            co = world_to_camera_view(sc, cam_ob, ob.matrix_world.translation)
            res[ob.name.split(".")[0]] = [round(co.x, 5), round(1 - co.y, 5), round(co.z, 4)]  # x右, y下, z奥行
    return res


def render_cut(blend_path: str, cut: dict, out_dir: str, scale: float = 1.0, samples: int = 32,
               frame_step: int = 1, log=print):
    """1カットを連番PNGでレンダー。既存の完成フレームはスキップ（途中再開）。"""
    bpy.ops.wm.open_mainfile(filepath=blend_path)
    sc = bpy.data.scenes[cut["scene"]]
    bpy.context.window.scene = sc if bpy.context.window else None
    cam = next(o for o in sc.objects if o.type == "CAMERA" and o.name.split(".")[0] == cut["camera"])
    sc.camera = cam
    for name in cut.get("show", []):
        set_collection_excluded(sc, name, False)
    for name in cut.get("hide", []):
        set_collection_excluded(sc, name, True)
    rx, ry = cut.get("res", [1080, 1920])
    sc.render.resolution_x = max(2, int(round(rx * scale / 2)) * 2)
    sc.render.resolution_y = max(2, int(round(ry * scale / 2)) * 2)
    sc.cycles.samples = samples
    f0, f1 = cut["frames"]
    os.makedirs(out_dir, exist_ok=True)
    anchors_path = Path(out_dir) / "anchors.json"
    anchors = json.loads(anchors_path.read_text()) if anchors_path.exists() else {}
    times = []
    for f in range(f0, f1 + 1, frame_step):
        dst = Path(out_dir) / f"{f:04d}.png"
        sc.frame_set(f)
        anchors[str(f)] = project_anchors(sc, cam)
        if dst.exists() and dst.stat().st_size > 0:
            continue
        tmp = Path(out_dir) / f".tmp_{f:04d}.png"
        sc.render.filepath = str(tmp)
        t = time.time()
        bpy.ops.render.render(write_still=True, scene=sc.name)
        os.replace(tmp, dst)
        times.append(time.time() - t)
        log(f"{cut['id']} frame {f}/{f1} {times[-1]:.1f}s")
    anchors_path.write_text(json.dumps(anchors))
    return times
