# YouTube Shorts 制作・運用（チャンネル「宇宙を知る」）

ジャンル「3Dで見る、もしも科学」（`config/channel.toml` で変更可）の縦動画を、Blender・Python・FFmpeg だけで
企画 → 3D → 編集 → 品質確認 → 投稿 → 集計まで回すための作業場です。有料API・生成サービス・クラウド課金は使いません。

## セットアップ（初回のみ）
```bash
bash shorts/setup.sh
```
- `.venv/` に Blender のPythonモジュール `bpy==5.3.0`（Python 3.13 用）と numpy / Pillow を入れます
- FFmpeg（libx264 / aac / libass）と日本語フォント（IPAフォント）が必要です
- ナレーションを入れる場合は、手元で VOICEVOX ENGINE を起動（`http://127.0.0.1:50021`）してから `python3 sk.py tts <ep>`

## 入口（すべて `shorts/` で実行）
| 目的 | コマンド |
|---|---|
| 状態と次の1コマンド | `python3 sk.py status`（`state/TODO.md` にも書き出し） |
| シーン生成（.blend） | `python3 sk.py build ep001` |
| 科学の照合（3D投影 vs 解析値） | `python3 sk.py verify ep001` |
| preview（低解像度の通し映像＋代表フレーム） | `python3 sk.py preview ep001` |
| render（本番・カット単位の連番、止まっても欠けたフレームから再開） | `python3 sk.py render ep001` |
| ナレーション（任意） | `python3 sk.py tts ep001` |
| 合成（MP4・字幕・サムネイル） | `python3 sk.py compose ep001` |
| 品質確認 | `python3 sk.py qc ep001` |
| publish（投稿・予約） | `python3 sk.py publish ep001 [--mode private\|schedule] [--dry-run]` |
| analytics（公開後24時間・7日） | `python3 sk.py analytics` / 比較表 `python3 sk.py analytics --report` |
| YouTube認証（手元PCで） | `python3 sk.py auth` |

工程の状態は各回の `episodes/<ep>/state.json` に保存されます。`production`（制作）と `publish`（投稿）・`analytics`（集計）は
別々に記録され、途中で止まっても同じコマンドで続きから再開できます。レンダーは完成済みのPNGを飛ばし、
アップロードは保存したセッションURLで再開、成否が不明なら投稿済み動画と照合できるまで新規アップロードしません。

## 運用モード（`config/channel.toml` の `[publish] mode`）
- `local`（初期値）: 制作のみ。投稿しない
- `private`: `privacyStatus=private` で非公開アップロード
- `schedule`: `privacyStatus=private` + `publishAt`（日本時間の投稿枠。初期案は水・日 20:30、仮説として変更可）

投稿前の確認（どれか欠ければその回は保留し、理由を state.json に記録）:
品質確認の合格とファイルハッシュ一致 / `rights.json` の全素材OK / タイトル・説明欄 / 視聴者設定（子ども向けか）/
AI開示（`containsSyntheticMedia`）の判断 / 設定の `channel_id` と OAuth 認証チャンネルの一致 / schedule は設定で有効化済み。
予約枠は実行直前に計算し、過去の日時・他の回と重複する枠は使いません。保存後にAPIから動画ID・公開状態・予約日時を読み戻します。
サムネイルは処理完了後に設定し、失敗しても本体は再アップロードしません（再実行で設定だけやり直し）。

### YouTube認証の準備（手元PCで1回）
1. Google Cloud で YouTube Data API v3 と YouTube Analytics API を有効化し、OAuth クライアント（デスクトップアプリ）を作成
2. JSON を `~/.config/shorts-youtube/client_secret.json` に保存（Gitに入れない）
3. `python3 sk.py auth` → 表示された認証チャンネルIDを `config/channel.toml` の `channel_id` に書く
4. トークンは `~/.config/shorts-youtube/token.json`（権限600）。会話・ログ・Gitには出しません
使うスコープ: `youtube.upload` / `youtube` / `yt-analytics.readonly`

## 定期実行について
この作業場には常駐の仕組みがないため、自動で新作制作や集計が始まることはありません。
手元やサーバーで定期実行する場合の例（cron、日本時間）:
```
# 投稿枠の6時間前に、完成済みの回を予約（キューが空・確認待ちなら何もしない）
30 14 * * 3,0  cd /path/to/shorts && python3 sk.py publish ep001 --mode schedule
# 毎日1回、公開後24時間・7日に達した動画の数値を記録
10 9 * * *     cd /path/to/shorts && python3 sk.py analytics
```
APIで取れない指標（Shortsの「視聴を継続した割合」など）は `state/analytics.csv` の `studio_*` 列に YouTube Studio から手入力します。
未取得の値は空欄のままにし、0 では埋めません。

## 新しい回の作り方（AIの使用量を抑える流れ）
1. `episodes/epNNN-<slug>/plan.md` に企画メモ（問い・証明カット・仮定・冒頭1秒・既存回との違い・制作コスト）
2. `episode.json`（仮定の数値・カット一覧）、`scene.py`（3D）、`edit.py`（タイムライン・字幕・図解）を作る。
   `lib/blender_kit.py`（カメラ・光・レンダー）、`lib/compose.py`（字幕スタイル・図解部品）、`lib/audio_synth.py`、`lib/qc.py`、`youtube/` は共通
3. `sources.md`（参照URLと支える主張、仮定/概算/事実の区別）、`metadata.json`、`rights.json`
4. 以降は `sk.py` の各コマンドで再実行。変更のあったカットだけ PNG を消して `render` すれば、そこだけ描き直されます

## 構成
```
shorts/
  sk.py                  入口
  config/channel.toml    ジャンル・形式・投稿枠・モード・TTS
  lib/                   geom.py（解析） blender_kit.py render_cuts.py compose.py audio_synth.py qc.py tts_voicevox.py
  youtube/yt.py          Data API / Analytics API（再開可能アップロード・読み戻し・サムネイル・字幕）
  assets/                LEDGER.md（素材台帳） textures/
  episodes/ep001-earth-ring/
    plan.md storyboard.md sources.md metadata.json rights.json episode.json
    scene.py verify_projection.py edit.py render_final.sh
    build/ep001.blend    編集できる .blend（3シーン: SPACE / GROUND_MID / GROUND_EQ）
    output/              ep001.mp4 ep001.ja.srt thumbnail_1080x1920.jpg stills/ qc.json
  state/                 TODO.md analytics.csv
```
