#!/usr/bin/env bash
# 初回セットアップ: .venv に Blender(bpy) と画像・数値ライブラリを入れる
set -euo pipefail
cd "$(dirname "$0")/.."
PY=${PYTHON:-python3}
"$PY" -c 'import sys; assert sys.version_info[:2]==(3,13), "bpy 5.3 は Python 3.13 が必要です"'
[ -d .venv ] || "$PY" -m venv .venv
.venv/bin/pip install -q "bpy==5.3.0" numpy pillow
python3 -c "import requests" 2>/dev/null || python3 -m pip install -q requests
command -v ffmpeg >/dev/null || { echo "ffmpeg が必要です"; exit 1; }
.venv/bin/python -c "import bpy; print('Blender', bpy.app.version_string)"
