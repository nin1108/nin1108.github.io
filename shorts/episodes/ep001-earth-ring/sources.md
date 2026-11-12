# 出典と、それが支える主張（ep001）

区分: 【事実】確認できる資料の値 / 【仮定】この回で置いた設定 / 【計算】仮定と事実から導いた値（3Dで照合済み）

## 実際に参照したURL
| # | URL | 支える主張 | 区分 |
|---|---|---|---|
| 1 | https://science.nasa.gov/saturn/facts/ | 土星の主な輪はA・B・C環。主な輪の厚さは典型的に約10 m（30フィート）。輪系は惑星から最大28.2万kmまで。土星の赤道直径 約12万500 km | 事実 |
| 2 | https://science.nasa.gov/resource/saturns-rings-2/ | 主な輪（A・B・C）の幅は 62,120 km | 事実 |
| 3 | https://science.nasa.gov/image-article/apod-2025-november-16-crossing-saturns-ring-plane/ | 地球が輪の面を横切るとき、真横になった輪は消えたように見える。輪は比率でいえばカミソリの刃よりずっと薄い | 事実 |
| 4 | https://arxiv.org/html/2311.17344v1 （Miller et al. 2023, "The composition of Saturn's rings"） | C環は内側へ 74,490 km（約1.25 R_S）まで、A環外縁は 136,770 km、土星赤道半径 60,268 km → 比率 1.236 / 2.269 | 事実 |
| 5 | https://science.nasa.gov/earth/facts/ | 地球の赤道直径 12,756 km（半径 約6,378 km）。計算には WGS84 の赤道半径 6,378.137 km を使用 | 事実 |
| 6 | https://developers.google.com/youtube/v3/docs/videos | publishAt は privacyStatus=private かつ未公開の動画にだけ設定可。containsSyntheticMedia、selfDeclaredMadeForKids | 実装仕様 |
| 7 | https://developers.google.com/youtube/v3/docs/thumbnails/set | Shortsのカスタムサムネイルは処理完了後に設定。最大50MB、JPEG/PNG | 実装仕様 |
| 8 | https://support.google.com/youtube/answer/14328491?hl=ja | AI開示の対象（リアルなAI生成・改変）と対象外（アニメーション・非現実的な内容・制作支援） | 運用判断 |
| 9 | https://developers.google.com/youtube/analytics/metrics | engagedViews、averageViewDuration、averageViewPercentage 等の定義。Shortsの「視聴を継続」はAPIに記載なし→Studioで手入力 | 実装仕様 |

検索結果の要約のみで本文に到達できなかった資料（この環境のネットワーク設定で遮断）:
- JPL Saturn Fact Sheet（www2.jpl.nasa.gov/saturn/fact.html）: C環内縁 74.5千km = 1.24 R_S、A環外縁 136.8千km（検索要約）。#4 と整合するため補助扱い。
- NASA Earth Fact Sheet（nssdc.gsfc.nasa.gov）、NASA 画像利用ガイドライン（www.nasa.gov / earthobservatory.nasa.gov）: 到達不可。画像の扱いは assets/LEDGER.md の注記を参照。

## 仮定（画面と説明欄に明記）
- 輪は地球の赤道面にある薄い円環。内縁・外縁は #4 の比率（1.24 / 2.27）を地球に当てはめる → 7,909 km / 14,478 km
- 季節: 6月下旬（太陽赤緯 +23.44°）、時刻: 両地点とも地方時16時ごろ。目の高さ 1.6 m。地球は球
- 地上カットの輪の厚みは 8 km に誇張（#1 の約10 m に対して）

## 計算（lib/geom.py、verify_result.json で3Dと照合）
- 北緯35°: 外縁の南中高度 33.43°（3D 33.66°）、内縁 1.27°（3D 1.26°）、外縁が地平線に入る方位 110.1° と 249.9°
- 赤道: 輪は天頂を通る東西の線（3Dで画像中央の行に一致）
- 現実に地球に輪ができる条件（ロッシュ限界・寿命など）は検討していない
