"""完成MP4の品質確認（ffprobe / ffmpeg フィルタ / 字幕ファイル / UI重なり確認画像）。

使い方: python3 lib/qc.py <mp4> [--srt file] [--stills dir] [--out qc.json]
判定:
  - 画角 1080x1920、fps 30(または60)、尺 30〜45秒（設定値）、H.264 / yuv420p、AAC 音声トラックあり
  - 黒フレーム（0.3秒以上）なし、意図しない無音（1.0秒以上 -50dB）なし
  - 映像と音声の長さの差 < 0.1秒（音ズレの目安）
  - 字幕: 各項目2行以内・1行18文字以内、時間の重なり/すき間なし
  - 代表フレームに Shorts の UI 領域（上部・下部・右列）を重ねた確認画像を作る
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


def probe(p):
    r = run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(p)])
    return json.loads(r.stdout)


def detect(p, flt):
    r = run(["ffmpeg", "-hide_banner", "-i", str(p), "-vf" if "black" in flt or "freeze" in flt else "-af", flt,
             "-f", "null", "-"])
    return r.stderr


def parse_srt(path):
    blocks = Path(path).read_text(encoding="utf-8").strip().split("\n\n")
    out = []
    for b in blocks:
        ls = b.strip().split("\n")
        m = re.match(r"(\d+):(\d+):(\d+),(\d+) --> (\d+):(\d+):(\d+),(\d+)", ls[1])
        g = [int(x) for x in m.groups()]
        t0 = g[0] * 3600 + g[1] * 60 + g[2] + g[3] / 1000
        t1 = g[4] * 3600 + g[5] * 60 + g[6] + g[7] / 1000
        out.append((t0, t1, ls[2:]))
    return out


def ui_overlay(stills_dir: Path, out_dir: Path):
    from PIL import Image, ImageDraw
    out_dir.mkdir(parents=True, exist_ok=True)
    made = []
    for p in sorted(stills_dir.glob("*.png")):
        im = Image.open(p).convert("RGBA")
        ov = Image.new("RGBA", im.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(ov)
        W, H = im.size
        # Shorts の操作UIが重なりやすい領域（目安）
        d.rectangle((0, 0, W, 190), fill=(255, 0, 0, 70))            # 上部（検索・カメラ等）
        d.rectangle((0, H - 430, W, H), fill=(255, 0, 0, 70))        # 下部（タイトル・チャンネル名・音源）
        d.rectangle((W - 170, H - 1100, W, H - 430), fill=(255, 0, 0, 70))  # 右列（高評価・コメント等）
        im.alpha_composite(ov)
        q = out_dir / p.name
        im.convert("RGB").resize((W // 2, H // 2)).save(q)
        made.append(str(q))
    return made


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mp4")
    ap.add_argument("--srt")
    ap.add_argument("--stills")
    ap.add_argument("--out")
    ap.add_argument("--min", type=float, default=30)
    ap.add_argument("--max", type=float, default=45)
    a = ap.parse_args()
    res = {"file": a.mp4, "checks": {}}
    pr = probe(a.mp4)
    v = next(s for s in pr["streams"] if s["codec_type"] == "video")
    au = [s for s in pr["streams"] if s["codec_type"] == "audio"]
    num, den = (int(x) for x in v["r_frame_rate"].split("/"))
    fps = num / den
    dur = float(pr["format"]["duration"])
    vdur = float(v.get("duration", dur))
    adur = float(au[0].get("duration", dur)) if au else 0
    C = res["checks"]
    C["resolution"] = {"value": f"{v['width']}x{v['height']}", "ok": (v["width"], v["height"]) == (1080, 1920)}
    C["fps"] = {"value": round(fps, 3), "ok": abs(fps - 30) < 0.01 or abs(fps - 60) < 0.01}
    C["duration_s"] = {"value": round(dur, 3), "ok": a.min <= dur <= a.max}
    C["video_codec"] = {"value": f"{v['codec_name']}/{v.get('pix_fmt')}", "ok": v["codec_name"] == "h264" and v.get("pix_fmt") == "yuv420p"}
    C["audio_track"] = {"value": f"{au[0]['codec_name']} {au[0].get('sample_rate')}Hz ch{au[0].get('channels')}" if au else None,
                        "ok": bool(au) and au[0]["codec_name"] == "aac"}
    C["av_length_diff_s"] = {"value": round(abs(vdur - adur), 3), "ok": abs(vdur - adur) < 0.1}
    bl = detect(a.mp4, "blackdetect=d=0.3:pix_th=0.08")
    blacks = re.findall(r"black_start:([\d.]+) black_end:([\d.]+)", bl)
    C["black_frames"] = {"value": blacks, "ok": not blacks}
    si = detect(a.mp4, "silencedetect=n=-50dB:d=1.0")
    sil = re.findall(r"silence_start: ([\d.]+)", si)
    C["silence_over_1s"] = {"value": sil, "ok": not sil}
    lo = detect(a.mp4, "ebur128=peak=true")
    m = re.search(r"Integrated loudness:\s+I:\s+([-\d.]+) LUFS", lo)
    tp = re.findall(r"Peak:\s+([-\d.]+) dBFS", lo)
    C["loudness"] = {"value": {"integrated_lufs": float(m.group(1)) if m else None, "true_peak_dbfs": float(tp[-1]) if tp else None},
                     "ok": bool(m) and -18 <= float(m.group(1)) <= -12}
    if a.srt:
        subs = parse_srt(a.srt)
        bad_lines = [s for s in subs if len(s[2]) > 2 or any(len(x) > 18 for x in s[2])]
        gaps = [(subs[i][1], subs[i + 1][0]) for i in range(len(subs) - 1) if abs(subs[i][1] - subs[i + 1][0]) > 0.05]
        cover_end = subs[-1][1] if subs else 0
        C["subtitles"] = {"value": {"count": len(subs), "too_long": [s[2] for s in bad_lines], "gaps": gaps,
                                    "covers_until_s": cover_end},
                          "ok": not bad_lines and not gaps and subs and subs[0][0] <= 0.05 and cover_end >= dur - 0.1}
    if a.stills:
        res["ui_overlay_images"] = ui_overlay(Path(a.stills), Path(a.stills).parent / "qc_ui")
    res["pass"] = all(c["ok"] for c in C.values())
    js = json.dumps(res, ensure_ascii=False, indent=2)
    if a.out:
        Path(a.out).write_text(js, encoding="utf-8")
    print(js)


if __name__ == "__main__":
    main()
