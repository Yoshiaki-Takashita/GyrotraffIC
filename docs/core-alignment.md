# 中枢設計と実装（src/）の差　2026-10-19

> 印：**確**＝コードと試験で確かめた。**推**＝読んだ範囲からの推論。**不明**＝確かめていない。
> 比べたもの：`docs/core-design.md`（以下 CD）・`docs/router-design.md`・`docs/platform-precision.md`・`docs/review-architecture.md` と、`src/` の現在のコード。

## 1. 差の一覧

| # | 項目 | 中枢設計 | 実装（今回の変更前） | 今回 | 残り |
|---|---|---|---|---|---|
| 1 | 来歴：確信度（確／推／不明） | 値ごとに「確・推・不明」と出どころ（CD P3・P4、8.2「推定」の印） | 徒歩の区間に `source`（transfer/station/geo/change）だけ。推定かどうかは読み手が推すしかない | **済**：`src/provenance.ts`（`Confidence`・`Sourced<T>`・`weakest`）。徒歩の各つながりに確信度（`Network.fpConf`・`selfChangeConf`）、`WalkLeg.confidence` を付けた。transfers.txt の `min_transfer_time` だけ確、距離・既定値は推（確） | 乗車区間の時刻は「データ源の値」として確扱い（アダプタ）。補間した停車時刻（`load.ts`）は本来「推」だが区間に印が無い（未） |
| 2 | 来歴：データ源・版・ライセンス | 結果の各区間にデータ源 ID・版・ライセンス（CD 3.1 Provenance、roadmap 0-6） | 無し | **一部**：`FeedSource`（id・version・license・attribution、不明は null）を定義し、アダプタの結果に付けた | 取り込み（`load.ts`）で feed_info.txt を読み、区間ごとに源を付ける（複数フィード時）。スナップショット ID（CD 3.2）も未 |
| 3 | 不明を 0 で埋めない | CD P3 | 運賃は `null`。`sameStopChangeSec` の既定 0 は「推」だが印が無かった | **済**：既定の 0 秒は推の印つき。運賃は 3 値（#7） | — |
| 4 | 運行日（service days） | D−1・D・D+1 を同じ秒軸に重ねる（CD 6） | 済（`Network.day`）（確） | 変更なし | 祝日の展開（内閣府 CSV）・特別ダイヤ未反映の表示（CD 6）は未。`frequencies.txt` は無視（CD は展開を要求）。GTFS の「正午−12 時間」基準は 0 時扱い（日本では差なし） |
| 5 | 徒歩グラフ（footpath） | 推移閉包か上限（CD 4.2-3）。出入口・構内通路（pathways）を別グラフで。地点からの接続は別部品（CD 4.5） | 停留所間のみ。閉包なし（transfers が閉じていないと見落とす）。pathways 未。地点からの探索なし | 確信度だけ付けた | 閉包（上限つき）の実装と差分試験。pathways.txt の読み込み。Street Access 部品 |
| 6 | 乗換規則 | 同じ乗り場 0〜1 分・同じ駅は Pathway か距離＋固定加算・別駅は徒歩・便指定（type 4/5・block_id・ODPT 前後参照）は「座ったまま」（CD 4.5・5.1）。重複乗り場は疑わしきは別（5.2） | 同じ乗り場 0 秒（既定）・同じ駅 120 秒か距離（推）・transfers type 0〜3。type 4/5・block_id は未 | 変更なし | 直通の 3 通りの正規化（CD 5.1）。同じ駅の固定加算（CD は 2 分）と既定値の整合は決めていない（不明） |
| 7 | 運賃の不明扱い | Leg ごと `Known/Partial/Unknown`、合成規則、「安い」は Known だけ、McRAPTOR では比較不能（CD 4.4） | `FareEstimate | null` の差し込み口だけ | **済**：`FareValue`（3 値）・`combineFares`・`cheapestKnown`・`fareValueToEstimate`（Unknown→null、Partial→画面で「＋」）。試験あり | 実際の運賃データ（GTFS Fares v2 等）。Router に Leg ごとの運賃を流す口。画面の「安い順」は今 null を Infinity として並べる（ui 側。触っていない） |
| 8 | 到着時刻指定 | 逆向き RAPTOR（CD 4.3） | 二分探索の簡易版 | 終電用に逆向き RAPTOR を実装（`src/first-last.ts`）。到着時刻指定は簡易版と併存 | `docs/first-last.md` 0 章 |
| 9 | 飛行機の余裕 | 乗る前・降りた後、空港ごと・国内/国際・荷物（CD 7.2：国内 40/55 分） | 乗る前だけ・既定 30 分（推） | 変更なし | 既定値を CD 7.2 に合わせるか（数値の変更は試験の期待値も変わるので別作業） |
| 10 | 悪いデータの隔離と記録 | 隔離・理由の記録（CD 8） | 除外と警告の文字列のみ | 変更なし | `data-pipeline.md` 4 章と合わせて |
| 11 | 境界（Snapshot・Router・Street Access・Enricher） | CD 11 | Network ≒ Snapshot、Router あり。Enricher なし | **一部**：`src/ui-adapter/` が Enricher の最小版（経路ごとの来歴の要約） | Street Access |
| 12 | 乗り場の位置（platform-precision） | 位置ごとの来歴・確信度 | 中枢は持たない | アダプタの `stopAccess` は常に null（不明。推測で作らない） | 取り込みと確信度の段階（platform-precision 3 章） |

## 2. 画面との接続（`src/ui-adapter/`）

- `createCoreProvider(router, { feed, now?, maxTransfers?, modes? })` が `ui-variants/e-station3d/js/data/static-provider.js` と同じ関数（`name`・`places()`・`route(q)`・`stopAccess(id)`）を返す。
- `route` の戻り値は static と同じ `{ id, journeys, searchMs, sample }` に、`provenance`（エンジン・データ源・問いの運行日と秒）と、経路ごとの `provenance`（times・walks・fare の確信度）を足したもの。足した項目は画面が読まなくても壊れない（推：画面のコードは知らない項目を無視する書き方。試験は項目の上位集合であることを確かめた）。
- 運賃は計算しないので `fare: null`（画面は「運賃不明」）。
- 接続の試験は `test/core-alignment.test.ts`：画面側の static-provider.js と samples.js を読み取り専用で読み、関数の名前と経路の項目をくらべる。ブラウザでの表示は試していない（不明）。
- 試験の置き場：依頼文は `tests/` だったが、既存の試験の仕組み（`npm test` が `dist/test/*.test.js` を走らせる）に合わせて `test/` に置いた。
