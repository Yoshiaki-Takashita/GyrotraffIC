# 日本の交通データ 入手先と利用条件（調査 2026-10-18・一次情報で確かめ直した版）

記号：**確**＝公式のページで確認（URL を付記）／**推**＝推測・未確認／**不明**＝分からない

## 結論（非エンジニア向け・10 行以内）
1. ODPT のデータは無料の登録で使える（確）。ただしライセンスは「基本ライセンス」「チャレンジ限定ライセンス」「CC BY 4.0」の 3 種類が混ざっている（確）。限定ライセンスは名前のとおりコンテスト用とみられ、商用には使えない見込み（推）。
2. 「基本ライセンス」の本文（商用に使えるか・出典の書き方）は、今回、公式の本文を取得できなかった（不明）。
3. 国交省は、バスのデータを公開するとき CC0 か CC BY 4.0 を推奨し、非営利限定（NC）は適切でないとしている（確）。ただし、各事業者が実際にどのライセンスで出しているかは、データごとに見る必要がある。
4. JR 各社が時刻表を自由に使えるデータとして公開した、という公式の発表は見つからなかった（不明。「公開していない」とは断定しない）。
5. 経路探索の部品は OpenTripPlanner（LGPL-3.0、確）。公式の導入事例の一覧に日本の例は無い（確）。日本では個人による検証例だけ見つかった。
6. OSM は帰属表示と ODbL の明示が必須で、改変したデータは同じライセンスでしか配れない（確）。
7. 空港の位置は OurAirports がパブリックドメインで、出典の表示も義務ではない（確）。
8. 全世界の GTFS は Mobility Database（中身のライセンスは各フィードの持ち主に従う、確）と Transitland（帰属表示が必須、確）で集められる。
9. 全国の鉄道を確実に網羅するには、駅すぱあと・NAVITIME の有料 API が現実的な選択肢（どちらも 90 日の無料お試しがあり、料金は公開されていない＝要問い合わせ、確）。

## データ源の表
| データ源 | 範囲 | 形式 | ライセンス | 商用 | 費用 | 確度・URL |
|---|---|---|---|---|---|---|
| ODPT（公共交通オープンデータセンター） | 鉄道・バス・フェリーなど。例：京都市営バス、関東バス、小田急バス、東海汽船、阪九フェリー、名門大洋フェリー（確） | API・GTFS など | 3 種類が混在：公共交通オープンデータ基本ライセンス（165 件）、公共交通オープンデータチャレンジ限定ライセンス（74 件）、CC BY 4.0（111 件）（確、件数は閲覧時点） | CC BY は可（確）。基本ライセンスは不明。限定ライセンスは不可の見込み（推） | 登録は無料（確） | 確：https://www.odpt.org/ ・ https://ckan.odpt.org/ ・ https://ckan.odpt.org/dataset/?license_id=odpt-ptodbl ／ 規約の本文：不明（https://developer.odpt.org/ は取得できず） |
| ODPT へのデータの提供（事業者側） | — | — | 「利用には入会が必要、無償で提供する場合は無料」と国交省の資料に記載（確） | — | — | 確：https://www.mlit.go.jp/maritime/content/001477478.pdf |
| 国交省 GTFS-JP（標準的なバス情報フォーマット） | 全国のバス。フェリー・旅客船の航路の情報の形式もある（Ver 5.1.2、2025 年 8 月）（確） | GTFS-JP（最新は v4）（確） | 仕様のページにはデータのライセンスの記載が無い（確）。国交省のガイドライン（案）は CC0 1.0 か CC BY 4.0 を推奨し、NC・ND は不適切としている（確） | データごとに違う | 無料（推） | 確：https://www.mlit.go.jp/sogoseisaku/transport/sosei_transport_tk_000067.html ・ https://www.mlit.go.jp/common/001281281.pdf |
| GTFS データリポジトリ | 全国の GTFS-JP の集約 | GTFS-JP | 不明（ページの本文を取得できず） | 不明 | 不明 | 不明：https://gtfs-data.jp/ |
| JR 各社 | 全国の鉄道 | — | 時刻表の公開の公式発表は見つからず（不明）。2017 年には JR 東日本が協議会の理事社だった（確・国交省の資料）。2024 年の ODPT のチャレンジで JR 東日本の一部路線のリアルタイム情報が GTFS-RT で配信された（推・個人の記事） | 不明 | 不明 | https://www.mlit.go.jp/common/001179849.pdf ・ 参考：https://zenn.dev/takoyaki3/articles/25c036daaf0d75 |
| 駅すぱあと API（ヴァル研究所） | 全国（推） | API | 利用規約は PDF で公開（確） | 可（契約、推） | 90 日の無料お試しあり、料金は掲載なし＝要問い合わせ（確） | 確：http://docs.ekispert.com/v1/ |
| NAVITIME API | 全国（推） | API | 不明 | 可（契約、推） | 90 日の無料お試しあり、料金は掲載なし＝要問い合わせ（確） | 確：https://api-sdk.navitime.co.jp/ |
| 航空：OAG / Cirium | 世界 | API | 商用契約（推） | 可（推） | 有料（推） | 推：https://www.oag.com/ ・ https://www.cirium.com/ |
| 航空：国内線の時刻表のオープンデータ | — | — | 不明（ODPT の 2024 年のチャレンジに航空のデータがあった、推・個人の記事） | 不明 | 不明 | 不明 |
| OurAirports | 世界の空港 | CSV | パブリックドメイン。正確さの保証は無い。出典の表示は望ましいが義務ではない（確） | 可（確） | 無料 | 確：https://ourairports.com/data/ |
| 国土数値情報 | 駅・バス停・空港・港 | GML ほか | データごとに違う（推） | 項目ごと（推） | 無料（推） | 推：https://nlftp.mlit.go.jp/ksj/ |
| OpenStreetMap | 世界 | PBF | ODbL。帰属表示と ODbL の明示が必須（通常は /copyright へのリンクで足りる）。改変・派生したデータは同じライセンスでのみ配布できる（確） | 可（確） | 無料 | 確：https://www.openstreetmap.org/copyright ・ 細則：https://osmfoundation.org/wiki/Licence/Attribution_Guidelines |
| Mobility Database | 世界の GTFS の一覧 | カタログ・API | API のコードは Apache-2.0、メタデータは CC0、フィードの中身は各データの持ち主のライセンスに従い、守る責任は利用者（確）。API は予告なく停止・変更されうる（確） | フィードごと（確） | 登録制（確）、料金の記載なし | 確：https://mobilitydatabase.org/terms-and-conditions ・ カタログの GitHub は Apache-2.0（確）：https://github.com/MobilityData/mobility-database-catalogs |
| Transitland | 世界の GTFS と API | API | Interline の規約に同意が必要。名称・ロゴの表示と /terms へのリンクが必須。フィードのライセンスを守る責任は利用者（確） | 規約による（確）。上位プランでは個別契約（確） | 料金は料金ページを参照（無料の枠があるかは未確認） | 確：https://www.transit.land/terms ・ https://www.transit.land/plans-pricing/ |

## 経路探索のオープンソース
| 部品 | 乗り換え | ライセンス | 計算資源 | 日本での実績 | 確度・URL |
|---|---|---|---|---|---|
| OpenTripPlanner 2 | できる（GTFS＋OSM、GTFS-RT も可） | LGPL-3.0（確：リポジトリに lgpl-3.0.txt） | 首都圏で 8〜16GB 程度（推） | 公式の導入事例の一覧は欧米だけで、日本は無い（確）。個人の検証例はある（ODPT＋OTP2 を Docker で動かす記事、確・ただし個人の記事）。ノルウェーの Entur は国全体で運用している（確） | https://github.com/opentripplanner/OpenTripPlanner ・ https://docs.opentripplanner.org/en/latest/Deployments/ ・ https://zenn.dev/takoyaki3/articles/25c036daaf0d75 |
| MOTIS | できる | MIT（推） | 推 | 不明 | 推：https://github.com/motis-project/motis |
| R5 | できる（主に分析用） | MIT（推） | 推 | 不明 | 推：https://github.com/conveyal/r5 |
| Valhalla | 部分的（推） | MIT（推） | 推 | 不明 | 推：https://github.com/valhalla/valhalla |
| OSRM | できない（道路だけ） | BSD-2（推） | 推 | — | 推：https://project-osrm.org/ |

## 推奨の組み合わせ（最小の構成）
1. OpenTripPlanner 2（LGPL-3.0、確）を自分のサーバーで動かす。
2. OSM の日本の抜粋を使い、アプリに「© OpenStreetMap contributors」と /copyright へのリンクを表示する（確）。
3. ODPT から **CC BY 4.0 のデータを優先して**入れる（確）。基本ライセンスのデータは、本文を読んでから入れる（不明）。チャレンジ限定ライセンスのデータは入れない（推）。
4. JR・未公開の私鉄は、駅すぱあと／NAVITIME の 90 日のお試しで評価し、料金を問い合わせる（確）。
5. 空港の位置は OurAirports（確）。国内線の時刻表は入手先が未確定（不明）。
6. フェリーは ODPT にある事業者（東海汽船・阪九フェリーなど、確）から入れる。

## 法的・運用上の注意
- フィードのライセンスを守る責任は利用者にある。集約サービスは保証しない（確：Mobility Database・Transitland）。
- Transitland の API を使う場合は、Transitland の帰属表示も必要（確）。
- OSM を改変したデータベースを配るときは ODbL で配る（確）。
- 過去の ODPT のコンテストのデータは、応募以外の目的と営利目的での利用が禁止されていた（確・2017 年の報道。https://internet.watch.impress.co.jp/docs/news/1095776.html）。限定ライセンスにも同じような制限があるとみられる（推）。
- 国交省の検討会では、無償のデータでも商用利用が禁止されている例があることが議論されている（確・検索の要約経由。原文の PDF の該当ページは未読）。
- リアルタイム情報のキャッシュ・再配信の制限（推）。

## 確認できなかった項目（不明）
- ODPT の「公共交通オープンデータ基本ライセンス」「チャレンジ限定ライセンス」の本文（商用に使えるか・出典の書き方）。developer.odpt.org は本文が取れなかった。次は odpt.org の入会案内や会員規約の PDF を探す。
- GTFS データリポジトリ（gtfs-data.jp）の利用条件（ページの本文が取れなかった）。
- JR 各社の時刻表の公開の有無と、使える条件。
- 国内線の時刻表のオープンデータ。
- 駅すぱあと・NAVITIME・Transitland の料金。
- MOTIS・R5・Valhalla・OSRM のライセンス（今回は再確認していない。既知の情報）。
- 日本全国で OTP を動かすのに必要なメモリ。
