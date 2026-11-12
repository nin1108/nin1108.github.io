# 素材台帳（チャンネル共通）

新しい素材を足すときは、この表と各回の `episodes/<ep>/rights.json` の両方に記録する。
YouTubeでの商用利用条件を確認できない素材は使わない（rights.json の status が ok でない回は投稿されない）。

| 素材 | ファイル | 出典 | ライセンス / 条件 | 必要な表記 | 確認日 |
|---|---|---|---|---|---|
| 地球テクスチャ（5400×2700） | assets/textures/bluemarble_bmng.jpg | NASA Blue Marble Next Generation。PyPI `basemap-data` 2.0.0 の `mpl_toolkits/basemap_data/bmng.jpg` から抽出 | NASA画像は原則著作権なし（NASAクレジット、NASAの推奨と誤認させない） | 「地球の画像: NASA Blue Marble」 | 2026-11-12（現行ポリシーページは環境から未到達。要一度確認） |
| BGM | lib/audio_synth.py `music()` | 自作（乱数シード固定の合成音） | 自作 | 不要 | 2026-11-12 |
| 効果音 | lib/audio_synth.py `sfx()` | 自作 | 自作 | 不要 | 2026-11-12 |
| フォント | /usr/share/fonts/opentype/ipafont-gothic/ipagp.ttf | IPA（Debian fonts-ipafont-gothic） | IPAフォントライセンスv1.0（商用可） | 任意 | 2026-11-12 |
| 3Dソフト | .venv の bpy 5.3.0 | Blender Foundation | GPL（出力映像には及ばない） | 任意 | 2026-11-12 |
| 音声合成（任意） | VOICEVOX ENGINE（ローカル） | https://voicevox.hiroshiba.jp/product/aoyama_ryusei/ | 青山龍星：利用規約に従い「VOICEVOX:青山龍星」の表記が必要 | 使用回のみ説明欄に記載 | 未使用（この環境では未導入） |
