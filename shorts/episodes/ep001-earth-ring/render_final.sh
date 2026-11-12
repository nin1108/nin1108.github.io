#!/usr/bin/env bash
# 本番レンダー（途中で止まっても同じコマンドで欠けたフレームから再開）
set -euo pipefail
cd "$(dirname "$0")/../.."
PY=../.venv/bin/python
EP=episodes/ep001-earth-ring
$PY lib/render_cuts.py $EP final c01_hook_mid c01_hook_eq c04_mid_ground c06_allsky_mid c06_allsky_eq --samples 32
$PY lib/render_cuts.py $EP final c05_eq_ground --samples 16
$PY lib/render_cuts.py $EP final c07_section c08_edgeon c03_descent c02_space --scale 0.75 --samples 16
echo ALL_RENDER_DONE
