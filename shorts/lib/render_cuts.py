"""カット単位レンダー（bpy で実行）。

使い方: .venv/bin/python lib/render_cuts.py <episode_dir> <preview|final> [cut_id ...] [--step N] [--frames a-b]
出力: <episode_dir>/build/<preview|final>/<cut_id>/NNNN.png と anchors.json
既存の完成フレームはスキップするので、止まっても同じコマンドで欠けた所から再開できる。
"""
import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import blender_kit as bk  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("episode_dir")
    ap.add_argument("quality", choices=["preview", "final", "verify"])
    ap.add_argument("cuts", nargs="*")
    ap.add_argument("--step", type=int, default=1)
    ap.add_argument("--frames", default=None, help="例 1-10")
    ap.add_argument("--scale", type=float, default=None)
    ap.add_argument("--samples", type=int, default=None)
    a = ap.parse_args()
    ep_dir = Path(a.episode_dir).resolve()
    ep = json.loads((ep_dir / "episode.json").read_text())
    rc = ep["render"]
    blend = ep_dir / "build" / f"{ep['id'].split('-')[0]}.blend"
    if a.quality == "preview":
        scale, samples = rc["preview_scale"], rc["preview_samples"]
    else:
        scale, samples = 1.0, rc["final_samples"]
    scale = a.scale or scale
    samples = a.samples or samples
    cuts = [c for c in ep["cuts"] if not a.cuts or c["id"] in a.cuts]
    log_path = ep_dir / "build" / f"render_{a.quality}.log"
    summary = {}
    for c in cuts:
        c = dict(c)
        if a.frames:
            lo, hi = (int(x) for x in a.frames.split("-"))
            c["frames"] = [max(lo, c["frames"][0]), min(hi, c["frames"][1])]
        out = ep_dir / "build" / a.quality / c["id"]
        t0 = time.time()
        times = bk.render_cut(str(blend), c, str(out), scale=scale, samples=samples, frame_step=a.step,
                              log=lambda m: open(log_path, "a").write(m + "\n"))
        summary[c["id"]] = {"rendered": len(times), "avg_s": round(sum(times) / len(times), 2) if times else 0,
                            "wall_s": round(time.time() - t0, 1)}
        print("CUT_DONE", c["id"], json.dumps(summary[c["id"]]), flush=True)
    print("SUMMARY", json.dumps(summary))


if __name__ == "__main__":
    main()
