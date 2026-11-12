"""ep001 の編集：タイムライン、字幕、図解オーバーレイ、サムネイル、字幕ファイル。

実行（shorts/ から）:
  ../.venv/bin/python episodes/ep001-earth-ring/edit.py video   [--prefer preview|final] [--out PATH] [--half]
  ../.venv/bin/python episodes/ep001-earth-ring/edit.py stills  # 冒頭・要点・結論の代表フレームPNG
  ../.venv/bin/python episodes/ep001-earth-ring/edit.py thumb
  ../.venv/bin/python episodes/ep001-earth-ring/edit.py srt
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))
from PIL import Image  # noqa: E402

import compose as C  # noqa: E402

EP = json.loads((HERE / "episode.json").read_text())
FPS = EP["fps"]
BUILD = HERE / "build"
OUT = HERE / "output"
W, H = C.W, C.H

# ------------------------------------------------------------------ 字幕（上部・2行以内）
SUBS = [
    (0.00, 2.50, "同じ輪なのに、\n見え方がちがう？"),
    (2.50, 5.60, "もし地球に、土星と\n同じ比率の輪があったら"),
    (5.60, 9.00, "輪は赤道の真上。\nこの2地点から空を見る"),
    (9.00, 10.50, "まずは北緯35°へ"),
    (10.50, 14.50, "南の空に、\n巨大なアーチ"),
    (14.50, 16.50, "同じ時刻・同じ向きで\n赤道を見ると…"),
    (16.50, 19.50, "真上に、\n細い線が1本だけ"),
    (19.50, 24.50, "真上に向けたカメラで比べると\n中緯度は「帯」、赤道は「線」"),
    (24.50, 28.00, "横から見ると、赤道の人は\n輪と同じ面の中にいる"),
    (28.00, 31.00, "輪を見る角度を\n浅くしていくと…"),
    (31.00, 33.00, "真横では、\n輪はほぼ見えない"),
    (33.00, 37.00, "赤道は輪を真横から見る場所。\nだから細い線になる"),
    (37.00, 40.00, "あなたの街からは、\nどう見える？"),
]

# 効果音のタイミング（秒, 種類）。映像の変化と同期させる。
SFX = [
    (0.00, "boom"), (0.05, "shimmer"), (2.50, "whoosh"), (5.60, "pop"), (5.75, "pop"),
    (9.00, "whoosh_long"), (10.45, "flash"), (12.00, "chime"), (15.20, "tick"), (16.20, "rise"),
    (18.20, "chime_hi"), (19.50, "whoosh"), (21.20, "pop"), (22.40, "pop"), (24.50, "whoosh"),
    (25.60, "pop"), (28.00, "rise_long"), (31.20, "chime_low"), (33.00, "pop"), (37.00, "shimmer"),
]

# ------------------------------------------------------------------ タイムライン
# 区間: (開始秒, 終了秒, 種類, パラメータ)
TIMELINE = [
    (0.0, 2.5, "hook", {}),
    (2.5, 9.0, "space", {}),
    (9.0, 10.5, "descent", {}),
    (10.5, 14.5, "mid_ground", {}),
    (14.5, 19.5, "eq_ground", {}),
    (19.5, 24.5, "allsky", {}),
    (24.5, 28.0, "section", {}),
    (28.0, 37.0, "edgeon", {}),
    (37.0, 40.0, "hook", {"ending": True}),
]
DURATION = TIMELINE[-1][1]


def anchor_xy(anc, name, z=1.0, cx=0.5, cy=0.5, size=(W, H)):
    if name not in anc:
        return None
    x, y, depth = anc[name]
    x = (x - cx) * z + cx
    y = (y - cy) * z + cy
    return (x * size[0], y * size[1])


def anchors_at(anc_all, f):
    """フレーム f の投影座標。間引きレンダー（preview）では最も近いフレームの値を使う。"""
    if str(f) in anc_all:
        return anc_all[str(f)]
    keys = [int(k) for k in anc_all]
    return anc_all[str(min(keys, key=lambda k: abs(k - f)))] if keys else {}


def edge_angle(f):
    """c08 のカメラが輪の面となす角（scene.py と同じ式）。"""
    t = (f - 1) / 119
    te = 1 - (1 - min(1.0, t / 0.85)) ** 3
    return 38 * (1 - te)


class Editor:
    def __init__(self, prefer="final"):
        self.fr = C.Frames(BUILD, prefer)

    # -------------------------------------------------------------- 区間ごとの絵
    def hook(self, t, lt, p):
        z = 1.0 + 0.04 * C.ease(lt / 2.5)
        top = C.zoom(self.fr.get("c01_hook_mid", 1, (W, 960)), z)
        bot = C.zoom(self.fr.get("c01_hook_eq", 1, (W, 960)), z)
        im = Image.new("RGB", (W, H))
        im.paste(top, (0, 0))
        im.paste(bot, (0, 960))
        C.line(im, (0, 960), (W, 960), (0, 0, 0), 6)
        a = C.fade_alpha(lt, 0.15, 99, 0.25)
        C.tag(im, (C.SAFE["left"], 845), "北緯35°（東京付近）", C.ORANGE, 40, a, anchor="lb")
        C.tag(im, (C.SAFE["left"], 1080), "赤道（同じ経度）", C.CYAN, 40, C.fade_alpha(lt, 0.35, 99, 0.25))
        C.arrow(im, (700, 1330), (565, 1330), C.CYAN, 6, C.fade_alpha(lt, 0.6, 99, 0.25))
        C.draw_text(im, (720, 1330), "輪", 44, C.CYAN, anchor="lm", alpha=C.fade_alpha(lt, 0.6, 99, 0.25))
        C.arrow(im, (840, 600), (700, 420), C.CREAM, 6, C.fade_alpha(lt, 0.4, 99, 0.25))
        C.draw_text(im, (860, 625), "輪", 44, C.CREAM, anchor="lm", alpha=C.fade_alpha(lt, 0.4, 99, 0.25))
        return im

    def space(self, t, lt, p):
        f = 1 + int(round(lt * FPS))
        f = min(195, max(1, f))
        im = self.fr.get("c02_space", f)
        anc = anchors_at(self.fr.anchors("c02_space"), f)
        a = C.fade_alpha(lt, 3.0, 99, 0.3)
        for key, label, col, dx in (("mid", "北緯35°", C.ORANGE, 150), ("eq", "赤道", C.CYAN, 150)):
            pxy = anchor_xy(anc, f"A_{key}_dot")
            if pxy and a > 0:
                end = (pxy[0] + dx, pxy[1] - 120)
                C.line(im, pxy, end, col, 4, a)
                C.circle(im, pxy, 16, col, 4, a)
                C.tag(im, (end[0] - 10, end[1]), label, col, 38, a, anchor="lb")
        b = C.fade_alpha(lt, 0.4, 99, 0.3)
        C.note(im, (C.SAFE["left"], 1300), "仮定：輪は赤道面にある、ごく薄い円盤", 32, b)
        C.note(im, (C.SAFE["left"], 1345), "半径は地球の1.24〜2.27倍（土星のC環〜A環と同じ比率）", 30, b)
        C.note(im, (C.SAFE["left"], 1390), "地点マーカーは見やすく拡大表示", 26, b, color=(190, 190, 200))
        return im

    def descent(self, t, lt, p):
        f = min(45, 1 + int(round(lt * FPS)))
        im = self.fr.get("c03_descent", f)
        if lt > 1.2:
            im = C.flash(im, (lt - 1.2) / 0.3)
        return im

    def mid_ground(self, t, lt, p):
        z = 1.0 + 0.05 * C.ease(lt / 4.0)
        im = C.zoom(self.fr.get("c04_mid_ground", 1), z)
        if lt < 0.25:
            im = C.flash(im, 1 - lt / 0.25)
        anc = self.fr.anchors("c04_mid_ground").get("1", {})
        C.tag(im, (C.SAFE["left"], 470), "北緯35°｜南の空・夕方前", C.ORANGE, 38, C.fade_alpha(lt, 0.2, 99))
        a = C.fade_alpha(lt, 1.4, 99, 0.35)
        hz = anchor_xy(anc, "A_hz_S", z)
        a30 = anchor_xy(anc, "A_alt30_S", z)
        top = anchor_xy(anc, "A_ring_out_S", z)
        if hz and a30 and top and a > 0:
            x = 120
            C.line(im, (x, hz[1]), (x, a30[1] - 160), C.WHITE, 4, a)
            for yy, lab in ((hz[1], "0°"), (a30[1], "30°")):
                C.line(im, (x - 16, yy), (x + 16, yy), C.WHITE, 4, a)
                C.note(im, (x + 26, yy), lab, 30, a, anchor="lm")
            C.line(im, (x, top[1]), (top[0] - 20, top[1]), C.ORANGE, 3, a, dash=14)
            C.circle(im, top, 12, C.ORANGE, 4, a)
            C.tag(im, (top[0] + 40, top[1] - 110), "いちばん高い所 約33°", C.ORANGE, 40, a, anchor="mb")
            C.note(im, (W // 2, hz[1] + 40), "南", 34, a, anchor="mm")
        return im

    def eq_ground(self, t, lt, p):
        i = int(round(lt * FPS))
        f = 1 if i < 30 else (min(90, i - 29) if i < 120 else 90)
        im = self.fr.get("c05_eq_ground", f)
        C.tag(im, (C.SAFE["left"], 470), "赤道｜同じ向き・同じ時刻", C.CYAN, 38, C.fade_alpha(lt, 0.1, 99))
        if i < 30:
            anc = self.fr.anchors("c05_eq_ground").get("1", {})
            hz = anchor_xy(anc, "A_hz_S")
            if hz:
                C.note(im, (W // 2, hz[1] + 40), "南", 34, C.fade_alpha(lt, 0.2, 1.0))
        a = C.fade_alpha(lt, 3.9, 99, 0.3)
        if a > 0:
            y = H // 2  # 天頂ビューでは線は画面中央を水平に通る（照合済み）
            C.arrow(im, (W // 2 + 40, y + 190), (W // 2, y + 18), C.CYAN, 6, a)
            C.tag(im, (W // 2 + 40, y + 190), "輪（真横から見た姿）", C.CYAN, 40, a)
            C.note(im, (C.SAFE["left"], 1400), "※線の太さは見やすく誇張（実際の主な輪の厚さは約10m級）", 26, a)
            C.note(im, (W // 2, y - 60), "真上（天頂）", 30, a, anchor="mm")
        return im

    def allsky(self, t, lt, p):
        im = Image.new("RGB", (W, H), (6, 8, 16))
        D = 600
        R = D // 2
        centers = {"mid": (W // 2, 790), "eq": (W // 2, 1420)}
        for key, cut in (("mid", "c06_allsky_mid"), ("eq", "c06_allsky_eq")):
            src = self.fr.get(cut, 1, (D, D))
            mask = Image.new("L", (D, D), 0)
            from PIL import ImageDraw
            ImageDraw.Draw(mask).ellipse((0, 0, D - 1, D - 1), fill=255)
            cx, cy = centers[key]
            im.paste(src, (cx - R, cy - R), mask)
            a = C.fade_alpha(lt, 0.3, 99)
            for alt in (30, 60):
                C.circle(im, (cx, cy), int(R * (90 - alt) / 90), C.WHITE, 2, 0.45 * a, dash_deg=4)
            C.circle(im, (cx, cy), R, (200, 200, 210), 3, a)
            for lab, dx, dy in (("北", 0, -R - 26), ("南", 0, R + 26), ("東", -R - 30, 0), ("西", R + 30, 0)):
                C.note(im, (cx + dx, cy + dy), lab, 30, a, anchor="mm")
            col = C.ORANGE if key == "mid" else C.CYAN
            C.tag(im, (C.SAFE["left"], cy - R + 10), "北緯35°" if key == "mid" else "赤道", col, 38, a)
        b = C.fade_alpha(lt, 1.7, 99, 0.3)
        cx, cy = centers["mid"]
        y33 = cy + R * (90 - 33.4) / 90
        C.arrow(im, (cx + 330, y33 - 150), (cx + 40, y33 + 30), C.ORANGE, 5, b)
        C.tag(im, (cx + 330, y33 - 150), "帯", C.ORANGE, 44, b, anchor="mb")
        c = C.fade_alpha(lt, 2.9, 99, 0.3)
        cx, cy = centers["eq"]
        C.arrow(im, (cx + 330, cy - 120), (cx + 160, cy - 8), C.CYAN, 5, c)
        C.tag(im, (cx + 330, cy - 120), "線", C.CYAN, 44, c, anchor="mb")
        C.note(im, (W // 2, 1790), "全天カメラ（真上向き・上が北）　点線は高度30°・60°", 26, C.fade_alpha(lt, 0.3, 99), anchor="mm")
        return im

    def section(self, t, lt, p):
        z = 1.0 + 0.04 * C.ease(lt / 3.5)
        im = C.zoom(self.fr.get("c07_section", 1), z)
        anc = self.fr.anchors("c07_section").get("1", {})
        P = {k: anchor_xy(anc, k, z) for k in ("A_sec_mid", "A_sec_eq", "A_sec_in", "A_sec_out", "A_sec_hz_mid_s", "A_earth")}
        a = C.fade_alpha(lt, 0.2, 99)
        if P["A_sec_in"] and P["A_sec_out"]:
            mx = (P["A_sec_in"][0] + P["A_sec_out"][0]) / 2
            C.tag(im, (mx, P["A_sec_out"][1] + 50), "輪（断面）", C.CREAM, 38, a, anchor="mt")
        if P["A_sec_mid"]:
            x, y = P["A_sec_mid"]
            C.tag(im, (x - 30, y - 70), "北緯35°", C.ORANGE, 38, C.fade_alpha(lt, 0.5, 99), anchor="rb")
            C.note(im, (x + 70, y - 30), "約33°", 34, C.fade_alpha(lt, 1.6, 99), anchor="lm", color=C.ORANGE)
        if P["A_sec_eq"]:
            x, y = P["A_sec_eq"]
            C.tag(im, (x - 20, y + 30), "赤道", C.CYAN, 38, C.fade_alpha(lt, 1.1, 99), anchor="rt")
        if P["A_sec_hz_mid_s"] and P["A_sec_mid"]:
            sx, sy = P["A_sec_hz_mid_s"]
            mx_, my_ = P["A_sec_mid"]
            nx, ny = 2 * mx_ - sx, 2 * my_ - sy  # 接線の北側の端
            C.note(im, (nx + 14, ny + 10), "北緯35°の地平線", 28, C.fade_alpha(lt, 0.8, 99), anchor="lm")
        C.note(im, (C.SAFE["left"], 1400), "※輪の厚み・線の太さは誇張。図は子午面の断面", 26, a)
        C.tag(im, (C.SAFE["left"], 470), "地球を横から見た断面", C.WHITE, 36, a)
        return im

    def edgeon(self, t, lt, p):
        i = int(round(lt * FPS))
        f = min(120, i + 1)
        z = 1.0 + (0.05 * C.ease((lt - 5.0) / 4.0) if lt > 5.0 else 0.0)
        im = C.zoom(self.fr.get("c08_edgeon", f), z)
        ang = edge_angle(f)
        a = C.fade_alpha(lt, 0.2, 99)
        C.tag(im, (C.SAFE["left"], 470), f"輪を見る角度  {ang:4.1f}°", C.CREAM, 40, a)
        if lt > 5.0:
            b = C.fade_alpha(lt, 5.2, 99, 0.4)
            C.note(im, (C.SAFE["left"], 1260), "実際の土星の輪も、地球から真横に見える時期は", 30, b)
            C.note(im, (C.SAFE["left"], 1305), "消えたように見えます（NASA）", 30, b)
            C.note(im, (C.SAFE["left"], 1350), "主な輪の厚さは約10m級。真横からはごく細い", 28, b, color=(200, 200, 210))
        return im

    # -------------------------------------------------------------- 1フレーム
    def frame(self, t):
        for t0, t1, kind, p in TIMELINE:
            if t0 <= t < t1 or (t >= t1 and t1 == DURATION and kind == TIMELINE[-1][2]):
                im = getattr(self, kind)(t, t - t0, p)
                break
        # 区切りの短いディゾルブ（hook→space, section→edgeon など）
        for t0, t1, kind, p in TIMELINE[1:]:
            if t0 - 0.0 <= t < t0 + 0.2 and kind in ("space", "allsky", "section", "edgeon"):
                prev = [x for x in TIMELINE if x[1] == t0][0]
                pim = getattr(self, prev[2])(t0 - 1e-3, prev[1] - prev[0] - 1e-3, prev[3])
                im = C.blend(pim, im, (t - t0) / 0.2)
        # 常設の注記（仮想であることの明示）
        C.note(im, (C.SAFE["left"], 215), "※仮想シミュレーション", 26, 0.85, color=(235, 235, 240))
        for s0, s1, txt in SUBS:
            if s0 <= t < s1 or (t >= s1 and s1 == DURATION and txt == SUBS[-1][2]):
                C.subtitle(im, txt, y=960 if (s0 < 2.5 or s0 >= 37.0) else 340, size=60, alpha=C.fade_alpha(t, s0, s1 + 0.001, 0.12, 0.08) if s0 > 0 else 1.0)
        return im


# ナレーション原稿（VOICEVOX が使える環境で tts コマンドを実行すると音声化される）
NARRATION = [
    (0.10, "同じ輪なのに、見え方がちがう？"),
    (2.60, "もし地球に、土星と同じ比率の輪があったら。"),
    (5.70, "輪は赤道の真上。この二つの地点から空を見上げます。"),
    (10.6, "北緯35度。南の空に、巨大なアーチ。高さはおよそ33度。"),
    (14.6, "同じ時刻、同じ向きで、赤道を見ると…"),
    (16.6, "真上に、細い線が一本だけ。"),
    (19.6, "真上に向けたカメラで比べると、中緯度は帯、赤道は線。"),
    (24.6, "横から見ると、赤道の人は輪と同じ面の中にいます。"),
    (28.1, "輪を見る角度を浅くしていくと、真横では、ほぼ見えなくなります。"),
    (33.1, "赤道は、輪を真横から見る場所。だから細い線になるんです。"),
    (37.1, "あなたの街からは、どう見える？"),
]


def narration_clips():
    d = HERE / "audio" / "narration"
    clips = []
    for i, (t, _) in enumerate(NARRATION):
        p = d / f"{i:02d}.wav"
        if p.exists():
            clips.append((t, str(p)))
    return clips


def make_audio():
    import audio_synth
    OUT.mkdir(parents=True, exist_ok=True)
    p = OUT / "ep001_mix.wav"
    info = audio_synth.build_mix(DURATION, SFX, p, narration=narration_clips())
    print("AUDIO", p, info)
    return p, info


def mux(video, audio, out):
    import subprocess
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(video), "-i", str(audio),
           "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy",
           "-af", "loudnorm=I=-15:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
           "-shortest", "-movflags", "+faststart", str(out)]
    subprocess.run(cmd, check=True)
    print("FINAL", out)


def make_video(prefer, out, half=False):
    ed = Editor(prefer)
    OUT.mkdir(parents=True, exist_ok=True)
    n = int(round(DURATION * FPS))
    size = (W // 2, H // 2) if half else (W, H)
    w = C.Writer(out, FPS, size, crf=18 if not half else 26, preset="medium" if not half else "veryfast")
    for i in range(n):
        im = ed.frame(i / FPS)
        if half:
            im = im.resize(size, Image.BILINEAR)
        w.write(im)
    rc = w.close()
    used = {k: sorted(v) for k, v in ed.fr.used.items()}
    print("VIDEO", out, "frames", n, "rc", rc)
    print("SOURCES", json.dumps(used, ensure_ascii=False))
    return used


def stills(prefer):
    ed = Editor(prefer)
    d = OUT / "stills"
    d.mkdir(parents=True, exist_ok=True)
    for name, t in (("01_hook", 1.5), ("02_space", 7.5), ("03_mid", 13.5), ("04_eq_zenith", 19.0),
                    ("05_allsky", 24.0), ("06_section", 27.5), ("07_edgeon", 31.5), ("08_conclusion", 36.0)):
        ed.frame(t).save(d / f"{name}.png")
    print("STILLS", d)


def srt():
    def ts(x):
        ms = int(round(x * 1000))
        return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"
    lines = []
    for i, (a, b, txt) in enumerate(SUBS, 1):
        lines += [str(i), f"{ts(a)} --> {ts(b)}", txt, ""]
    p = OUT / "ep001.ja.srt"
    OUT.mkdir(parents=True, exist_ok=True)
    p.write_text("\n".join(lines), encoding="utf-8")
    print("SRT", p)


def thumb(prefer):
    ed = Editor(prefer)
    im = Image.new("RGB", (W, H))
    top = ed.fr.get("c01_hook_mid", 1, (W, 960))
    bot = ed.fr.get("c01_hook_eq", 1, (W, 960))
    im.paste(top, (0, 0)); im.paste(bot, (0, 960))
    C.line(im, (0, 960), (W, 960), (0, 0, 0), 8)
    C.draw_text(im, (W // 2, 330), "もし地球に", 84, C.WHITE, stroke=8)
    C.draw_text(im, (W // 2, 450), "輪があったら", 96, C.CREAM, stroke=9)
    C.tag(im, (C.SAFE["left"], 930), "北緯35° → 帯", C.ORANGE, 56, anchor="lb")
    C.tag(im, (C.SAFE["left"], 1000), "赤道 → 線！？", C.CYAN, 56)
    C.arrow(im, (760, 1330), (565, 1330), C.CYAN, 8)
    OUT.mkdir(parents=True, exist_ok=True)
    im.save(OUT / "thumbnail_1080x1920.png")
    im.convert("RGB").save(OUT / "thumbnail_1080x1920.jpg", quality=90)
    print("THUMB", OUT / "thumbnail_1080x1920.jpg")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["video", "stills", "thumb", "srt", "audio", "final", "preview"])
    ap.add_argument("--prefer", default="final")
    ap.add_argument("--out", default=None)
    ap.add_argument("--half", action="store_true")
    a = ap.parse_args()
    if a.cmd == "video":
        make_video(a.prefer, a.out or str(OUT / ("ep001_video_only.mp4")), a.half)
    elif a.cmd == "audio":
        make_audio()
    elif a.cmd == "preview":
        v = OUT / "ep001_preview_video.mp4"
        make_video("preview", str(v), half=True)
        ap_, _ = make_audio()
        mux(v, ap_, OUT / "ep001_preview.mp4")
    elif a.cmd == "final":
        v = OUT / "ep001_video_only.mp4"
        used = make_video("final", str(v))
        bad = {k: v_ for k, v_ in used.items() if any(x != "final" for x in v_)}
        if bad:
            print("WARNING_NON_FINAL_SOURCES", json.dumps(bad, ensure_ascii=False))
        ap_, _ = make_audio()
        mux(v, ap_, OUT / "ep001.mp4")
        srt()
        thumb("final")
    elif a.cmd == "stills":
        stills(a.prefer)
    elif a.cmd == "thumb":
        thumb(a.prefer)
    else:
        srt()
