"""ローカル VOICEVOX ENGINE でナレーションを音声化する（標準ライブラリのみ）。

使い方: python3 lib/tts_voicevox.py <episode_dir>
  - episode の edit.py にある NARRATION を読み、audio/narration/NN.wav を作る
  - 既にある wav は作り直さない（原稿を変えたら該当ファイルを消す）
  - エンジンに接続できなければ何もせず終了コード 2（字幕＋BGM/効果音だけで成立する構成）
利用規約: 青山龍星の音声を使う場合は動画の説明欄に「VOICEVOX:青山龍星」と表記する。
"""
from __future__ import annotations

import ast
import json
import sys
import tomllib
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def cfg():
    return tomllib.loads((ROOT / "config" / "channel.toml").read_text())["tts"]


def _get(url, timeout=3):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return r.read()


def _post(url, body=b"", ctype="application/json", timeout=60):
    req = urllib.request.Request(url, data=body, method="POST", headers={"Content-Type": ctype})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def available(base) -> bool:
    try:
        _get(base + "/version")
        return True
    except Exception:
        return False


def speaker_id(base, name, style):
    sp = json.loads(_get(base + "/speakers"))
    for s in sp:
        if s["name"] == name:
            for st in s["styles"]:
                if st["name"] == style:
                    return st["id"]
    raise LookupError(f"{name}/{style} が見つかりません")


def load_narration(ep_dir: Path):
    src = (ep_dir / "edit.py").read_text()
    tree = ast.parse(src)
    for node in tree.body:
        if isinstance(node, ast.Assign) and getattr(node.targets[0], "id", "") == "NARRATION":
            return ast.literal_eval(node.value)
    return []


def main(ep_dir: Path):
    c = cfg()
    base = c["url"].rstrip("/")
    if not available(base):
        print("VOICEVOX ENGINE に接続できません:", base, "→ 字幕と音楽・効果音のみで制作します")
        return 2
    sid = speaker_id(base, c["speaker_name"], c["style_name"])
    out = ep_dir / "audio" / "narration"
    out.mkdir(parents=True, exist_ok=True)
    for i, (t, text) in enumerate(load_narration(ep_dir)):
        p = out / f"{i:02d}.wav"
        if p.exists():
            continue
        q = json.loads(_post(f"{base}/audio_query?" + urllib.parse.urlencode({"text": text, "speaker": sid})))
        q["speedScale"] = c.get("speed", 1.0)
        q["outputSamplingRate"] = 48000
        q["outputStereo"] = False
        wav = _post(f"{base}/synthesis?speaker={sid}", json.dumps(q).encode())
        p.write_bytes(wav)
        print("TTS", p.name, text)
    (out / "credit.txt").write_text(f"VOICEVOX:{c['speaker_name']}\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1]).resolve()))
