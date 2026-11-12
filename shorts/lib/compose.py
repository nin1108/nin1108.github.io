"""編集（合成）の共通部品。PIL でフレームを作り、ffmpeg に生のRGBを流し込む。

- レンダー済みフレームの取得（final があれば final、なければ preview、欠けていれば最も近いフレーム）
- 文字（縁取り・座布団）、タグ、引き出し線、矢印
- Shorts のセーフエリア（上部 ~200px、下部 ~430px、右列 ~170px は重要情報を避ける）
"""
from __future__ import annotations

import json
import math
import subprocess
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1080, 1920
SAFE = {"top": 200, "bottom": 1490, "left": 60, "right": 910}
FONT_PATHS = [
    "/usr/share/fonts/opentype/ipafont-gothic/ipagp.ttf",
    "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf",
]
ORANGE = (255, 150, 40)
CYAN = (70, 200, 255)
CREAM = (255, 228, 180)
WHITE = (255, 255, 255)


@lru_cache(maxsize=64)
def font(size: int):
    for p in FONT_PATHS:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


class Frames:
    def __init__(self, build_dir: Path, prefer: str = "final"):
        self.build = Path(build_dir)
        self.order = [prefer, "preview"] if prefer == "final" else ["preview", "final"]
        self._index = {}
        self.used = {}

    def _list(self, q, cut):
        key = (q, cut)
        if key not in self._index:
            d = self.build / q / cut
            self._index[key] = sorted(int(p.stem) for p in d.glob("[0-9]*.png")) if d.exists() else []
        return self._index[key]

    def path(self, cut: str, frame: int):
        for q in self.order:
            fr = self._list(q, cut)
            if not fr:
                continue
            best = min(fr, key=lambda x: abs(x - frame))
            self.used.setdefault(cut, set()).add(q if best == frame else q + "~nearest")
            return self.build / q / cut / f"{best:04d}.png"
        self.used.setdefault(cut, set()).add("missing")
        return None

    @lru_cache(maxsize=8)
    def _load(self, p: str, size):
        im = Image.open(p).convert("RGB")
        if im.size != size:
            im = cover(im, size)
        return im

    def get(self, cut: str, frame: int, size=(W, H)):
        p = self.path(cut, frame)
        if p is None:
            im = Image.new("RGB", size, (20, 20, 28))
            d = ImageDraw.Draw(im)
            d.text((40, size[1] // 2), f"[未レンダー] {cut} #{frame}", fill=(200, 80, 80), font=font(40))
            return im
        return self._load(str(p), size).copy()

    def anchors(self, cut: str):
        for q in self.order:
            p = self.build / q / cut / "anchors.json"
            if p.exists():
                return json.loads(p.read_text())
        return {}


def cover(im: Image.Image, size):
    tw, th = size
    s = max(tw / im.width, th / im.height)
    im = im.resize((max(tw, round(im.width * s)), max(th, round(im.height * s))), Image.LANCZOS)
    x = (im.width - tw) // 2
    y = (im.height - th) // 2
    return im.crop((x, y, x + tw, y + th))


def zoom(im: Image.Image, z: float, cx=0.5, cy=0.5):
    if abs(z - 1) < 1e-4:
        return im
    w, h = im.size
    cw, ch = w / z, h / z
    x0 = min(max(0, cx * w - cw / 2), w - cw)
    y0 = min(max(0, cy * h - ch / 2), h - ch)
    return im.resize((w, h), Image.BICUBIC, box=(x0, y0, x0 + cw, y0 + ch))


def ease(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def fade_alpha(t, t0, t1, fin=0.25, fout=0.2):
    if t < t0 or t > t1:
        return 0.0
    a = min(1.0, (t - t0) / fin) if fin > 0 else 1.0
    b = min(1.0, (t1 - t) / fout) if fout > 0 else 1.0
    return max(0.0, min(a, b))


# --------------------------------------------------------------------- 描画
def text_size(txt, f):
    l, t, r, b = f.getbbox(txt)
    return r - l, b - t


def draw_text(base: Image.Image, xy, txt, size=56, fill=WHITE, anchor="mm", stroke=6,
              stroke_fill=(0, 0, 0), alpha=1.0, shadow=True):
    if alpha <= 0:
        return
    f = font(size)
    if alpha >= 0.999 and not shadow:
        ImageDraw.Draw(base).text(xy, txt, font=f, anchor=anchor, fill=fill, stroke_width=stroke, stroke_fill=stroke_fill)
        return
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    if shadow:
        sh = Image.new("RGBA", base.size, (0, 0, 0, 0))
        ImageDraw.Draw(sh).text((xy[0] + 3, xy[1] + 4), txt, font=f, anchor=anchor, fill=(0, 0, 0, 150),
                                stroke_width=stroke, stroke_fill=(0, 0, 0, 150))
        sh = sh.filter(ImageFilter.GaussianBlur(4))
        layer.alpha_composite(sh)
    d.text(xy, txt, font=f, anchor=anchor, fill=fill + (255,), stroke_width=stroke, stroke_fill=stroke_fill + (255,))
    if alpha < 1:
        a = layer.getchannel("A").point(lambda v: int(v * alpha))
        layer.putalpha(a)
    base.alpha_composite(layer) if base.mode == "RGBA" else base.paste(layer, (0, 0), layer)


def subtitle(base, lines, y=330, size=64, alpha=1.0, color=WHITE):
    """画面上部の字幕（最大2行）。座布団つき。"""
    if alpha <= 0:
        return
    if isinstance(lines, str):
        lines = lines.split("\n")
    assert len(lines) <= 2, lines
    f = font(size)
    lh = int(size * 1.32)
    widths = [text_size(l, f)[0] for l in lines]
    bw = max(widths) + 70
    bh = lh * len(lines) + 34
    x0 = W // 2 - bw // 2
    y0 = y - bh // 2
    _box(base, (x0, y0, x0 + bw, y0 + bh), 26, (8, 12, 24, int(165 * alpha)))
    for i, l in enumerate(lines):
        cy = y - (len(lines) - 1) * lh / 2 + i * lh
        draw_text(base, (W // 2, int(cy)), l, size=size, fill=color, stroke=5, alpha=alpha, shadow=False)


def _box(base, box, radius, fill, outline=None, width=0):
    """半透明の角丸四角を、その範囲だけのレイヤーで合成する。"""
    x0, y0, x1, y1 = (int(round(v)) for v in box)
    w, h = x1 - x0 + width + 2, y1 - y0 + width + 2
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(layer).rounded_rectangle((0, 0, x1 - x0, y1 - y0), radius=radius, fill=fill, outline=outline, width=width)
    base.paste(layer, (x0, y0), layer)


def tag(base, xy, txt, color, size=40, alpha=1.0, anchor="lt"):
    if alpha <= 0:
        return
    f = font(size)
    tw, th = text_size(txt, f)
    pad = 16
    x, y = xy
    if anchor[0] == "r":
        x -= tw + 2 * pad
    if anchor[0] == "m":
        x -= (tw + 2 * pad) // 2
    if anchor[1] == "b":
        y -= th + 2 * pad
    if anchor[1] == "m":
        y -= (th + 2 * pad) // 2
    _box(base, (x, y, x + tw + 2 * pad, y + th + 2 * pad + 6), 14, (10, 14, 26, int(200 * alpha)),
         outline=color + (int(255 * alpha),), width=4)
    draw_text(base, (x + pad + tw // 2, y + pad + th // 2 + 3), txt, size=size, fill=color, stroke=3,
              alpha=alpha, shadow=False)


def line(base, p0, p1, color, width=4, alpha=1.0, dash=None):
    if alpha <= 0:
        return
    direct = alpha >= 0.999
    layer = base if direct else Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    c = color if direct else color + (int(255 * alpha),)
    if dash:
        x0, y0 = p0
        x1, y1 = p1
        L = math.hypot(x1 - x0, y1 - y0)
        n = max(1, int(L / dash))
        for i in range(0, n, 2):
            a, b = i / n, min(1, (i + 1) / n)
            d.line((x0 + (x1 - x0) * a, y0 + (y1 - y0) * a, x0 + (x1 - x0) * b, y0 + (y1 - y0) * b), fill=c, width=width)
    else:
        d.line((*p0, *p1), fill=c, width=width)
    if not direct:
        base.paste(layer, (0, 0), layer)


def arrow(base, p0, p1, color, width=5, alpha=1.0, head=22):
    line(base, p0, p1, color, width, alpha)
    ang = math.atan2(p1[1] - p0[1], p1[0] - p0[0])
    pts = [p1, (p1[0] - head * math.cos(ang - 0.45), p1[1] - head * math.sin(ang - 0.45)),
           (p1[0] - head * math.cos(ang + 0.45), p1[1] - head * math.sin(ang + 0.45))]
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).polygon(pts, fill=color + (int(255 * alpha),))
    base.paste(layer, (0, 0), layer)


def circle(base, c, r, color, width=3, alpha=1.0, fill=None, dash_deg=None):
    if alpha <= 0:
        return
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    box = (c[0] - r, c[1] - r, c[0] + r, c[1] + r)
    if dash_deg:
        for a in range(0, 360, dash_deg * 2):
            d.arc(box, a, a + dash_deg, fill=color + (int(255 * alpha),), width=width)
    else:
        d.ellipse(box, outline=color + (int(255 * alpha),), width=width,
                  fill=None if fill is None else fill + (int(255 * alpha),))
    base.paste(layer, (0, 0), layer)


def note(base, xy, txt, size=30, alpha=1.0, anchor="lt", color=(230, 230, 235)):
    draw_text(base, xy, txt, size=size, fill=color, anchor=anchor, stroke=3, alpha=alpha, shadow=False)


def flash(im, a):
    if a <= 0:
        return im
    return Image.blend(im, Image.new("RGB", im.size, (255, 255, 255)), min(1.0, a))


def blend(a, b, t):
    return Image.blend(a, b, max(0.0, min(1.0, t)))


# --------------------------------------------------------------------- 書き出し
class Writer:
    def __init__(self, path, fps=30, size=(W, H), crf=18, preset="medium"):
        self.p = subprocess.Popen(
            ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{size[0]}x{size[1]}",
             "-r", str(fps), "-i", "-", "-c:v", "libx264", "-preset", preset, "-crf", str(crf),
             "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(path)],
            stdin=subprocess.PIPE)

    def write(self, im):
        self.p.stdin.write(im.convert("RGB").tobytes())

    def close(self):
        self.p.stdin.close()
        return self.p.wait()
