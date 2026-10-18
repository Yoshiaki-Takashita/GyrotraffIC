# 乗り場の位置を正確に出す：Google Maps と代替の調査（2026-10-18・調査）

印の意味：無印＝一次情報で確認。**推**＝推測・記憶による（要確認）。**不明**＝確認できていない。

## 結論（先に）
1. **「拡張機能で Google Maps のページを読み取る」方式はやってはいけない。**Google Maps Platform 規約の「スクレイピング禁止」（抜き出し・保存・再利用の禁止）に正面から当たる。
2. **日本では Google の経路 API（Routes / Directions の transit）が電車の結果を返さない**という報告が複数ある（2025-08 時点・**推**／公式の対応表では未確認）。「Google の経路で日本の乗換」は前提にできない。
3. Google の駅・バス停の座標（Places API）は使えるが、**Google の地図の上に出すときだけ**。他社の地図との組み合わせは禁止、座標の保存は 30 日まで。
4. 推奨：**時刻表・停留所・出入口は日本の公開データ（GTFS-JP・ODPT 公共交通オープンデータ）を自前で持ち、経路は OpenTripPlanner 等で自前計算、地図は OSM 由来のタイル（自前か有料業者）か MapKit JS。**Google を使うなら「Google の地図＋Places で乗り場を見せる」部分に限る。

## 非エンジニア向け要約（10 行以内）
- 「Google マップの画面を拡張機能で読む」は、Google が明確に禁じる“抜き取り”にあたり、アプリ停止や鍵の停止の危険がある。
- Google の正規の窓口（API）なら駅やバス停の位置は取れるが、Google の地図の上でしか見せられず、保存も 30 日まで。
- しかも日本の電車の乗換案内は、Google の API からは出てこないという報告が多い。
- 日本は国や鉄道・バス会社が時刻表と停留所の位置を公開している（無料のものが多い）。
- これを使って自分で乗換を計算すれば、規約の縛りが少なく、利用量が増えても料金が膨らみにくい。
- 「ホームの何番線」「出入口」の精度は、データの出し手によってまちまち（**推**）。
- 地図の見た目は Apple の地図や OSM 由来の地図で十分に作れる。

## 1. Google Maps Platform で乗り場を出せる機能
| 機能 | 乗り場について出せるもの | 日本 | 根拠 |
|---|---|---|---|
| Places API (New) | 種類 `train_station` `subway_station` `bus_stop` `bus_station` `light_rail_station` `transit_station` `tram_stop` `platform` 等で検索、座標と名前 | 駅・バス停は出る（**推**：精度は駅の代表点。出入口・番線ごとの点は保証なし） | [Place types](https://developers.google.com/maps/documentation/places/web-service/place-types) |
| Routes API（TRANSIT） | `transitDetails.stopDetails` に乗車・降車の停留所名と緯度経度、路線名・色・事業者 | **電車は ZERO_RESULTS との報告（推）** | [Transit route](https://developers.google.com/maps/documentation/routes/transit-route)／[Zenn 2025-08](https://zenn.dev/nnnwa/articles/6974e3799829ca)／[Google 開発者フォーラム](https://discuss.google.dev/t/directions-api-transit-mode-returns-zero-results/378267) |
| Maps JavaScript API | 地図表示。地図上に駅アイコン・路線の層（Transit Layer）を描ける | 可 | [料金表](https://developers.google.com/maps/billing-and-pricing/pricing) |
| Static Maps | 画像の地図にピンを打つだけ | 可 | 同上 |
| Geocoding | 住所・駅名→座標。乗り場単位の精度は期待できない（**推**） | 可 | 同上 |
| 出入口（station entrance） | 公式 API で出入口を個別に返す機能は**確認できず（不明）**。Google マップのアプリ上には出入口表示があるが、API で同等に取れるかは不明 | 不明 | — |

## 2. 料金（0〜10 万件／月の帯・USD・1,000 件あたり）
出典：[Google Maps Platform 料金表](https://developers.google.com/maps/billing-and-pricing/pricing)（2026-10-18 取得）
| SKU | 毎月の無料件数 | 単価 |
|---|---|---|
| Places Text Search Pro | 5,000 | $32 |
| Places Nearby Search Pro | 5,000 | $32 |
| Place Details Essentials / Pro | 10,000 / 5,000 | $5 / $17 |
| Autocomplete | 10,000 | $2.83 |
| Compute Routes Pro | 5,000 | $10 |
| Compute Routes Essentials（TRANSIT はこちらか**不明**） | **推** 10,000 | **推** $5 |
| Dynamic Maps（地図の読み込み） | 10,000 | $7 |
| Static Maps | 10,000 | $2 |
| Geocoding | 10,000 | $5 |

概算（1 回の検索＝地図 1 枚＋Nearby Search 1 回＋経路 1 回と仮定・**推**）
| 1 日の検索 | 月の件数 | 地図 | Nearby | 経路(Pro) | 月額の目安 |
|---|---|---|---|---|---|
| 100 | 約 3,000 | 無料枠内 | 無料枠内 | 無料枠内 | **$0** |
| 1,000 | 約 30,000 | (30k−10k)×$7=$140 | (30k−5k)×$32=$800 | (30k−5k)×$10=$250 | **約 $1,190（約 18 万円）** |
自前データで駅を探し Google は地図だけにすると、1,000/日でも約 $140。

## 3. 利用規約の制約
出典：[Google Maps Platform Terms](https://cloud.google.com/maps-platform/terms)、[Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms)
| 項目 | 内容 |
|---|---|
| 他社の地図との組み合わせ | 禁止。「Places の内容を Google 以外の地図に表示しない」「Google の地図を他社の地図や他社の地図の内容にリンクしない」（No Use With Non-Google Maps）。Places・Routes・Geocoding それぞれに「No use with a non-Google map」 |
| 地図なしでの利用 | Places・Routes・Geocoding は Google の地図なしで使ってよい（Use without a Google Map） |
| 保存（キャッシュ） | 緯度経度は**30 日まで**、その後削除（Places 14.3・Routes 19.3・Geocoding 6.3）。place ID は無期限に保存可（**推**：本文で個別確認していない） |
| 抜き出し | No Scraping：事前取得・索引化・保存・再配布、場所情報の一括取得を禁止 |
| 内容の作成 | Google の内容をもとに新しいデータを作ってはいけない（No Creating Content） |
| 自前の経路探索との組み合わせ | Google の座標で自前の駅データベースを作るのは上記で不可。Google の経路と自前経路を並べて出すことの明文の禁止は**不明** |
| 帰属表示 | Google のロゴ・著作権表示を消さない。transit は事業者名の表示が必要（**推**：本文で個別条文を確認していない） |
| AI 学習 | Google の内容を AI の学習・評価に使わない |

## 4. 拡張機能で Google マップのページを操作・読み取る方式
- **勧めない（やってはいけない）。**
- Google Maps Platform 規約の No Scraping は API 利用者向けだが、Google の一般利用規約・Google マップ追加規約も自動取得や内容の抜き出しを禁じている（**推**：一般規約の条文は今回取得していない）。
- Chrome ウェブストアの方針は、他者の権利や規約を侵す拡張を拒否の対象にしている（**推**：条文未取得）。
- Google のページ構造は予告なく変わり、壊れやすい。利用者の Google アカウントでの閲覧を流用する形になり、アカウント停止の危険を利用者に負わせる。
- 比較：正規の API は料金と保存・表示の縛りがあるが、合法で安定。拡張方式は無料に見えるだけで、規約違反・停止・審査落ちの危険が大きい。
- 唯一許される近い形：利用者が自分で Google マップを開けるよう**リンク（URL）で渡す**こと（Google Maps URLs は無料・**推**）。

## 5. 代替の比較
| | 乗り場の精度 | 料金 | 規約 |
|---|---|---|---|
| Apple MapKit JS | 地図の駅表示は良好（**推**）。乗り場単位の座標 API は不明 | Apple Developer Program（年 $99）で 1 日あたり無料枠が大きい（**推**：地図表示 25 万・サービス呼び出し 2.5 万／日） | Apple の地図上で使う前提（**推**） |
| Mapbox | 地図の質は高い。乗り場データは OSM 由来（**推**） | 無料枠あり（**推**：Web の地図読み込み 5 万／月） | Mapbox の検索結果の保存に制限あり（**推**） |
| OSM（公式タイル・Nominatim） | OSM の駅・出入口（`railway=subway_entrance` 等）は日本の都市部で充実（**推**） | 無料だが公式サーバーは大量利用不可 | タイル：大量取得・オフライン用の事前取得禁止、帰属表示必須（[タイル方針](https://operations.osmfoundation.org/policies/tiles/)）。Nominatim：**最大 1 秒 1 回**、アプリ名の明示、帰属表示、ODbL（[Nominatim 方針](https://operations.osmfoundation.org/policies/nominatim/)）。製品では自前サーバーか有料業者を使う |
| 日本の公開データ（GTFS-JP・ODPT） | 停留所・駅の座標、時刻表。一部は出入口・番線も（**推**：事業者ごとに差） | 無料が多い（利用登録が必要なものあり・**推**） | 事業者ごとの利用条件に従う（**推**） |

## 6. 経路：Google（Routes transit）か自前（GTFS＋OpenTripPlanner）か
| | Google Routes TRANSIT | 自前（GTFS-JP/ODPT＋OpenTripPlanner 等） |
|---|---|---|
| 日本の電車 | **出ない報告あり（推）** | 公開データがある範囲で可。JR 各社など未公開の事業者は欠ける（**推**） |
| 費用 | 1,000/日で経路だけ約 $250/月（Pro の場合） | サーバー代のみ。月数千〜数万円（**推**） |
| 規約 | 他社地図不可・30 日保存・帰属 | データごとのライセンスと帰属表示のみ |
| 品質 | 世界の多くの国で高い | データ次第。遅延情報は GTFS-RT がある事業者だけ |
| 補完 | — | 全国の網羅が必要なら駅すぱあと・NAVITIME 等の有料 API（**推**） |

## 推奨の方式
1. 停留所・駅・出入口の位置：GTFS-JP・ODPT・OSM を自前で取り込む（保存の期限なし、他の地図に自由に出せる）。
2. 経路：OpenTripPlanner 等で自前計算。足りない事業者は有料の国内 API で補う。
3. 地図：MapKit JS か、OSM 由来のタイル（自前または有料業者）。
4. Google を使うなら「Google の地図＋Places で乗り場の写真やクチコミを見せる画面」に限り、自前の地図とは別画面にする。または Google マップへのリンクで渡す。

## やってはいけない方式
- 拡張機能で Google マップのページを読む・操作する。
- Google の座標を 30 日を超えて保存する／自前の駅データベースにする。
- Google の Places や経路の結果を OSM・Mapbox・Apple の地図の上に出す。
- 公式 OSM タイルや Nominatim を製品の本番で大量に使う。

## 不明点（次に確かめること）
- Google の公式「対応国・transit 対応表」での日本の扱い（報告ベースのみ）。実際に API キーで 1 回試すのが確実。
- TRANSIT の SKU が Essentials か Pro か（料金ページで明記を見つけられず）。
- Google の API で駅の出入口・番線ごとの座標が取れるか。
- MapKit JS・Mapbox の最新の無料枠（今回は記憶ベース）。
- ODPT・各事業者のデータの利用条件（商用・再配布）と、JR 各社のデータの有無。
- Chrome ウェブストア方針と Google 一般規約の該当条文（今回未取得）。
