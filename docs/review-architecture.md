# 既存文書の批判的レビュー（`architecture.md`・`research-japan-data.md`・`research-maps.md`）　2026-10-19

> 印の意味：**[PROVEN]**＝一次資料で確認済み（URL を付記）。**[ARGUED]**＝根拠を示した推論。**[GUESS]**＝推測。**[UNKNOWN]**＝分かっていない（今回確かめられなかった）。
> 対象：`docs/architecture.md`（第 1 版・2026-10-18）、`docs/research-japan-data.md`（2026-10-18）、`docs/research-maps.md`（2026-10-18）。`docs/decisions.md`（2026-10-19）で既に決まったことは「決定済み」として扱い、蒸し返さない。
> 方法：疑わしい記述を一次資料（公式ページ・仕様・ライセンス本文・論文）で確かめ、確かめられなかったものは [UNKNOWN] と書く。確認の結果は 2 章の表に URL 付きで残す。

## 要約（非エンジニア向け・10 行）
1. 3 つの文書は方向として正しいが、**前提が 3 つ崩れている**：①「首都圏の地下鉄と私鉄は CC BY のデータ」は東京メトロには当てはまらず（基本ライセンス）、**大手私鉄 7 社と JR 東日本は「チャレンジ 2026 限定」でしか出ていない**（通常利用は不可、2027-03-12 で失効）。②「国内線の時刻表のオープンデータは無い」は誤りで、ODPT に全日空・日本航空の時刻表がある。③「JR は駅すぱあと等で評価」は変わらないが、**私鉄も同じ問題** を抱える。
2. 基本ライセンスの本文は今回取得できた（英語版。日本語が正文）。**商用利用は可**だが、**データの再配布は禁止**、**更新通知から 1 週間以内の反映が義務**。これは設計に直接響く（オフライン時刻表・公開 API・更新頻度）。
3. 飛行機を「別の層で 2 段に組む」案は、空港候補を絞る時に最適解を落とす。同じエンジンに「余裕つきの便」として入れる方が良い（`core-design.md` 7 章）。
4. 段階計画の「段階 2＝日本全国」は、JR のデータが無い以上 **実現できない順番**。首都圏の仕上げ → 飛行機 → アカウント → 全国 の順に組み直した（`roadmap.md`）。
5. 飛行機の余裕時間「国内 30〜45 分」は、航空会社の公式の締切（保安検査 20 分前・手荷物 30 分前・搭乗口 10 分前）から見て妥当な範囲。「国際 120 分」は根拠が無く、航空会社は「60 分前までに手続き」と言っている。
6. メモリ「全国で 8〜32 GB」は OTP を前提にした値。OTP 公式でもフィンランド全土で 10 GB 超、ドイツで 95 GB。自作 RAPTOR なら桁が小さい見込み（実測前）。
7. データモデルに **来歴（出どころ・版・ライセンス）** と **「不明」という値** が無い。両方とも後から足すと全データの作り直しになるので、最初から入れる。
8. アカウントの章に、App Store／Google Play の **アプリ内アカウント削除の義務**、**電気通信事業法の外部送信規律**、**Firebase Authentication が米国でのみ処理される** 事実が抜けている。
9. 地図の調査（`research-maps.md`）は概ね正しい。MapKit JS・Mapbox の無料枠は公式ページで裏付けが取れた。Google Maps URLs は「API キー不要」だが「無料」と明記したページは見つからなかった。
10. 直すべき箇所を 4 章に 23 件、優先順位付きで列挙した。

---

## 1. 文書ごとの総評

### 1.1 `architecture.md`
- **良い点**：答えを 1 本に絞らず複数案にする、乗り場の精度を差別化点にする、保存するのは「条件」であって経路ではない、履歴は端末だけ、という判断はいずれも正しい [ARGUED]。「推」「不明」を書き分けている点も良い。
- **崩れた前提**：OTP を土台にする推奨は `decisions.md` で自作に変わった（決定済み）。文書の 1 章・2 章・6 章の数値はすべて OTP 前提なので、読み直しが要る。
- **構造上の欠落**：①来歴とライセンスのモデル、②「不明」を表す値（運賃・位置精度）、③運行日（サービス日）と 24 時超えの扱い、④直通運転と重複乗り場の方針、⑤データ不良への耐性、⑥検証計画。いずれも `core-design.md`・`data-pipeline.md` で補った。
- **過大な点**：段階 2 で「日本全国」、乗り場 ±5 m、全国 2 秒。順番と根拠を 4 章で直す。
- **過小な点**：法務（削除義務・外部送信規律・個人情報保護法の位置づけ）。`accounts-privacy.md` で補った。

### 1.2 `research-japan-data.md`
- **良い点**：確／推／不明の区別、一次 URL の併記、Mobility Database・Transitland の責任分担の確認。
- **誤り・古い点**：①「国内線の時刻表のオープンデータ：不明」→ ODPT にある（2.1 表 #3）。②「基本ライセンスの本文：取得できず」→ 取得できた（#4〜#8）。③東京メトロのライセンスの種類を書いていない（#2）。④「MOTIS・R5・Valhalla・OSRM のライセンスは未確認」→ 確認した（#13）。
- **不足**：ODPT の事業者ごとのライセンス種別の一覧（JR 東日本と大手私鉄 7 社がチャレンジ限定のみ、という最重要の事実が抜けている。#10）。GTFS-JP 仕様の細部（#15）。gtfs-data.jp・国土数値情報の利用条件（#15b・#15d）。

### 1.3 `research-maps.md`
- **良い点**：「拡張機能で Google マップを読む」を明確に禁じた判断、Google の規約の要点（他社地図との併用禁止・30 日）、公式 OSM タイル・Nominatim の本番利用不可。
- **推のまま残っていたもの**：MapKit JS・Mapbox の無料枠（#16・#17：確認できた）、Google Maps URLs が無料（#18：部分的）。
- **今回再確認しなかったもの**：Google の規約の各条文、Routes API の日本の鉄道の挙動、Places の place ID の保存期間。いずれも Google を使わない方針（`decisions.md`・`roadmap.md` D3 の推奨）なら影響は小さい [ARGUED]。

## 2. 検証した記述の表

### 2.1 データとライセンス
| # | 文書の記述 | 結果 | 根拠 |
|---|---|---|---|
| 1 | 「ODPT のデータは 基本／チャレンジ限定／CC BY 4.0 の 3 種が混在」 | **正しい** | [PROVEN：ckan.odpt.org のライセンス絞り込み。`research-japan-data.md` の確認を踏襲] |
| 2 | （`decisions.md`）「首都圏の地下鉄と私鉄（CC BY のデータ）」 | **東京メトロには当てはまらない**。東京メトロの駅・路線・列車時刻表・運賃・運行情報の 10 データセットはすべて **基本ライセンス**。都営（東京都交通局）の列車時刻表は **CC BY 4.0** | [PROVEN：https://ckan.odpt.org/dataset/?q=東京メトロ（基本ライセンス 10 件）、https://ckan.odpt.org/dataset/r_train_timetable-tokyometro 、https://ckan.odpt.org/dataset/r_train_timetable-toei] |
| 3 | 「国内線の時刻表のオープンデータ：不明」 | **誤り**。ODPT に「全日空 フライト時刻表（国内線・国際線）」「日本航空 フライト時刻表（国内線）」があり、どちらも基本ライセンス。東京国際空港ターミナルの時刻表はチャレンジ 2026 限定 | [PROVEN：https://ckan.odpt.org/dataset/a_flightschedule-ana 、https://ckan.odpt.org/dataset/a_flightschedule-jal 、https://ckan.odpt.org/dataset/?q=フライト時刻表] |
| 4 | 「基本ライセンスの本文（商用・出典）は取得できず」 | **取得できた**（英語版。JS 描画のためテキスト化プロキシ経由）。日本語が正文（第 18 条 2 項） | [PROVEN：https://developer.odpt.org/terms/data_basic_license.html] |
| 5 | 基本ライセンスで商用利用できるか | **できる**：「営利・非営利を問わず利用できる」（第 4 条 7 項） | [PROVEN：同上] |
| 6 | 基本ライセンスで再配布できるか | **できない**：書面承諾なしに「データとその複製・派生物（元を実質的に復元できる加工物）の公開・再配布・公衆送信・譲渡」を禁止（第 8 条 4 項 1 号）。成果物以外への表示も禁止（第 4 条 2 項 3 号） | [PROVEN：同上] |
| 7 | 更新の義務 | 静的データは **更新通知から 1 週間以内** に成果物を更新（ガイドライン 2.2.2）。動的データは `odpt:frequency`・`dct:valid` に従う（2.1.2） | [PROVEN：https://developer.odpt.org/terms/data_basic_use_guideline.html] |
| 8 | 出典表示 | 「公共交通データは公共交通オープンデータセンターが提供するデータである」と表示。正確性・完全性を保証しない旨の告知と、連絡先メールの表示が必要（ガイドライン 3.1、ライセンス第 10 条 3 項） | [PROVEN：同上] |
| 9 | 「限定ライセンスはコンテスト用で商用不可（推）」 | **半分正しい**。「商用不可」ではなく **「チャレンジへの応募」と「期間中に誰でも無償で使える機能の公開」が必須**（企業のサービスでも可）。許諾は **2027-03-12 で終了**し、データは削除。再配布は禁止。JR 東日本の個別条件は「JR 東日本と競合するサービスを作らない」 | [PROVEN：https://developer.odpt.org/challenge_license（制定 2026-07-01、改定 2026-08-28。日本語正文は JS バンドル内）] |
| 10 | 「JR 各社の時刻表の公開は見つからず」 | **JR 東日本は ODPT に 8 データセットあるが、すべて「チャレンジ 2026 限定」**。基本ライセンス・CC BY では出ていない。さらに **小田急・東急・京王・西武・東武・京急・相鉄の鉄道データもすべてチャレンジ限定**。京成電鉄・東京モノレールは ODPT に無い。通常利用できる首都圏の鉄道は 東京メトロ（基本）・都営（CC BY）・つくばエクスプレス・りんかい線・横浜市営・多摩モノレール（基本）、ゆりかもめ（基本、時刻表なし） | [PROVEN：https://ckan.odpt.org/dataset/?organization=jreast 、`?license_id=odpt-ptodcll`、各社の組織別一覧（odakyu・tokyu・keio・seibu・tobu・keikyu・sotetsu）、`?q=京成`、`?q=東京モノレール`] |
| 11 | 「OTP は LGPL-3.0」 | **正しい**（LGPL-3.0 以降） | [PROVEN：https://raw.githubusercontent.com/opentripplanner/OpenTripPlanner/dev-2.x/LICENSE] |
| 12 | 「OurAirports はパブリックドメイン」 | **正しい**（Unlicense） | [PROVEN：https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/LICENSE] |
| 13 | 「MOTIS・R5・Valhalla：MIT（推）、OSRM：BSD-2（推）」 | **すべて正しい** | [PROVEN：各リポジトリの LICENSE／COPYING（MOTIS https://raw.githubusercontent.com/motis-project/motis/master/LICENSE 、R5 https://raw.githubusercontent.com/conveyal/r5/dev/LICENSE 、Valhalla https://raw.githubusercontent.com/valhalla/valhalla/master/COPYING 、OSRM https://raw.githubusercontent.com/Project-OSRM/osrm-backend/master/LICENSE.TXT）] |
| 14 | OSM は ODbL、改変は同じライセンスで | **正しい** | [PROVEN：https://www.openstreetmap.org/copyright] |
| 15 | 「GTFS-JP の最新は v4」 | **正しい**：「公共交通運行情報標準データ仕様（GTFS-JP）第 4.0 版」（2026 年 3 月、改版 2026-03-19）。Schedule・Realtime・GBFS を統合。`translations.txt` 必須、`pathways.txt` は任意の拡張、`levels.txt` はエレベーター時に必須、`stops.txt` の `location_type` 0〜4、`platform_code`、親 station は任意、標柱は歩道側に、複数路線が 1 本の標柱を使う時は乗り場は 1 つ、**直通は `block_id`**（別の便として続けて運行し客が乗り続けられる時に同じ `block_id`）。`office_jp.txt`・`pattern_jp.txt` 等は参考資料に降格 | [PROVEN：https://www.mlit.go.jp/sogoseisaku/transport/sosei_transport_tk_000067.html → https://www.mlit.go.jp/commmmons/document/007/] |
| 15b | gtfs-data.jp の利用条件 | 運営は AIGID（一般社団法人社会基盤情報流通推進協議会）。各フィードのライセンスは提供者が指定し、API の付帯データで取得できる。付帯データは CC BY 4.0 | [PROVEN：http://docs.gtfs-data.jp/site/kiyaku.pdf（2023-04-21 改訂）] |
| 15d | 国土数値情報の利用条件 | データごと：鉄道 N02（2020 年以降）CC BY 4.0、バス停留所 P11（2022 年）CC BY 4.0、空港 C28（2021 年）「商用可」（旧約款）、港湾 C02（2014 年）「非商用」。既定は公共データ利用規約 1.0 | [PROVEN：https://nlftp.mlit.go.jp/ksj/other/agreement.html と各データのページ] |
| 15e | 東京メトロの旧開発者サイト | 2022-03-31 に終了し、ODPT に移行（ODPT が 2022-02-24 に提供開始を告知） | [PROVEN：https://www.odpt.org/2022/02/24/news20220224_1/ ；旧サイトは 503、終了告知ページは 403 で直接は読めず] |
| 15f | ODPT の駅施設データ | `odpt:StationFacility` は API 仕様に無い（旧 API から移行時に廃止 [ARGUED：有志の記事]）。`odpt:Station` に `odpt:exit`（出入口の `ug:Poi` の ID）と `odpt:barrierfreeFacility` の語彙はあるが、出入口の独立したデータセットはカタログに無い。どの事業者が埋めているかは API キー無しでは分からない | [PROVEN：JS バンドル内の API 仕様、https://ckan.odpt.org/dataset/?q=駅出入口（0 件）] |
| 15c | 祝日の出どころ | 内閣府が「国民の祝日」CSV（1955〜2027 年）を公開。利用条件の記載はページに無い | [PROVEN：https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html] |

### 2.2 地図・外部サービス
| # | 文書の記述 | 結果 | 根拠 |
|---|---|---|---|
| 16 | 「MapKit JS：1 日 25 万の地図表示・2.5 万のサービス呼び出し（推）」 | **正しい** | [PROVEN：https://developer.apple.com/maps/mapkitjs/] |
| 17 | 「Mapbox：Web の地図読み込み 月 5 万まで無料（推）」 | **正しい** | [PROVEN：https://www.mapbox.com/pricing] |
| 18 | 「Google Maps URLs は無料（推）」 | **部分的**：「API キー不要」「URL は 2,048 文字まで」と明記。料金表に Maps URLs の項目は無い。「無料」と明記した文は見つからず | [PROVEN：https://developers.google.com/maps/documentation/urls/get-started ・ https://developers.google.com/maps/billing-and-pricing/pricing] |
| 19 | 「Nominatim は最大 1 秒 1 回」「公式タイルの一括取得禁止」 | **正しい**。加えて：アプリ名入りの User-Agent が必須、Nominatim は結果のキャッシュが必須、定期スクリプトは毎分 4 回まで | [PROVEN：https://operations.osmfoundation.org/policies/nominatim/ ・ https://operations.osmfoundation.org/policies/tiles/] |
| 20 | 「Google Routes の transit は日本の電車で結果が出ない（推）」 | [UNKNOWN：再確認していない。Google を使わない方針なら影響なし] | — |

### 2.3 エンジン・アルゴリズム・規模
| # | 文書の記述 | 結果 | 根拠 |
|---|---|---|---|
| 21 | 「RAPTOR は乗り換え回数ごとの最良解を自然に出せる」 | **正しい**。各ラウンドで各路線を高々 1 回走査し、K ラウンドで O(K(Σ|r| + |T| + |F|))。McRAPTOR（多基準）・rRAPTOR（範囲問い）も同じ論文 | [PROVEN：Delling, Pajor, Werneck, ALENEX 2012 https://www.microsoft.com/en-us/research/wp-content/uploads/2012/01/raptor_alenex.pdf ；誌上版 Transportation Science 49(3):591–604, 2015] |
| 22 | 「RAPTOR の計算量は 乗り換え回数 × 路線数 × 停留所 に比例」 | **おおむね正しいが不正確**。正しくは「ラウンド数 ×（全路線の停留所列の長さの合計 ＋ 便数 ＋ 徒歩の本数）」が上限 | [PROVEN：同論文] |
| 23 | 「GTFS の `pathways.txt`・`location_type`・`transfers.txt`」の扱い | **仕様どおり**：location_type 0〜4、pathway_mode 1〜7、transfer_type 0〜5（4＝座ったまま、5＝不可、from/to_trip_id 必須）、24 時超えの時刻（例 25:35:00）が許される、Fares v2 のファイル群 | [PROVEN：https://gtfs.org/documentation/schedule/reference/] |
| 24 | 「OTP は GTFS・徒歩・自転車を扱える」「飛行機も GTFS 化すれば入る（簡略版）」 | OTP 2 は pathways、transfers.txt の最小乗換時間、block_id による座ったまま乗り換え、Fares v2（実験的）、Flex に対応 | [PROVEN：https://docs.opentripplanner.org/en/latest/Changelog/ ・ BuildConfiguration ・ sandbox/Fares/ ・ sandbox/Flex/] |
| 25 | 「全国で 8〜32 GB」「首都圏で 8〜16 GB（推）」 | **OTP 前提なら桁は妥当**：OTP 公式は「フィンランド全土で 10 GB 超、ドイツで 95 GB」。自作の配列型 RAPTOR なら首都圏で数十 MB、全国で数 GB の見込み [GUESS：`core-design.md` 10 章] | [PROVEN（OTP の値）：https://docs.opentripplanner.org/en/latest/System-Requirements/] |
| 26 | 「停留所 20〜30 万」「1 日の便 数十万〜100 万」「1 回の探索 都市内 0.1 秒以下・全国 1 秒」 | [GUESS のまま。実測で置き換える] | — |

### 2.4 飛行機
| # | 文書の記述 | 結果 | 根拠 |
|---|---|---|---|
| 27 | 「Tdep 国内 30〜45 分（推）」 | **妥当な範囲** [ARGUED]。公式の締切：JAL 国内線は 手荷物預け 30 分前（羽田、2026-09-01〜。他空港は目安）、保安検査 20 分前、搭乗口 10 分前。ANA 国内線は 搭乗口 10 分前、手荷物 30 分前（羽田、2026-09〜）。ANA の保安検査 20 分前は 2019 年の報道で確認、現在の公式ページには分数の記載なし | [PROVEN（JAL）：https://www.jal.co.jp/jp/ja/dom/boarding_attention/ 、https://www.jal.co.jp/jp/ja/info/2026/other/260325/ ；（ANA）：https://www.ana.co.jp/ja/jp/guide/boarding-procedures/checkin/domestic/flow_airport/ ；ANA 保安検査 20 分は [ARGUED：https://www.aviationwire.jp/archives/181535（報道）]] |
| 28 | 「Tdep 国際 120 分（推）」 | **根拠なし**。公式の締切は JAL・ANA とも「出発 60 分前までに搭乗手続き」、搭乗口は 30 分前目安・10 分前締切。ANA のカウンターは多くの海外空港で 3 時間前に開く。「2〜3 時間前に到着」と明記した公式文は見つからず | [PROVEN：https://www.jal.co.jp/jp/ja/inter/boarding_attention/ 、https://www.ana.co.jp/ja/jp/guide/boarding-procedures/checkin/international/procedure/ 、https://www.ana.co.jp/ja/jp/guide/boarding-procedures/checkin/international/counter_open/] |
| 29 | 「最小乗継時間（MCT）のデータ源は調査待ち」 | **無料の公的な一覧は見つからず**。IATA・OAG・Cirium の商用製品のみ | [PROVEN（商用の存在）：https://www.iata.org/en/publications/manuals/station-standard-minimum-connecting-time-mct/ ；無料が無いことは [UNKNOWN：見つからなかっただけ]] |
| 30 | 「OpenFlights の路線データ」（`research-japan-data.md` には無いが候補になりうる） | **使えない**：2014 年 6 月で更新停止 | [PROVEN：https://openflights.org/data.php] |

### 2.5 アカウント・法務
| # | 文書の記述 | 結果 | 根拠 |
|---|---|---|---|
| 31 | 「法令：日本の個人情報保護法（詳細は法務確認・不明）」 | 位置情報は蓄積や照合で個人を識別できれば個人情報。要配慮個人情報には含まれない。事業者の規模による除外は無い | [PROVEN：`accounts-privacy.md` 1 章の URL] |
| 32 | （記載なし）アプリ内のアカウント削除 | App Store・Google Play とも **必須** | [PROVEN：`accounts-privacy.md` 3 章] |
| 33 | （記載なし）外部送信規律 | 2023-06-16 施行。該当するかは要確認 | [PROVEN：`accounts-privacy.md` 5 章] |
| 34 | 「認証は Supabase Auth か Firebase Auth」 | Firebase Authentication は **米国のデータセンターのみで処理**。Supabase は東京リージョンを選べる | [PROVEN：https://firebase.google.com/support/privacy 、https://supabase.com/docs/guides/platform/regions] |

## 3. 設計上の指摘（誤り・欠落・過大）

| # | 指摘 | 種別 | 重さ | 対応先 |
|---|---|---|---|---|
| A1 | 飛行機を「別層で 2 段」に組むと、空港候補を 2〜3 港に絞る段階で最適解を落とす（成田の方が早いのに羽田に絞る等）。同じ RAPTOR に「余裕つきの便」として入れる方が正しく、実装も 1 本で済む | 設計 | 高 | `core-design.md` 7 章、`roadmap.md` D1 |
| A2 | データモデルに来歴（データ源・版・ライセンス）が無い。ODPT の出典表示・1 週間更新・契約終了時の削除、OSM の ODbL 判定のすべてに必要 | 欠落 | 高 | `data-pipeline.md` 5 章 |
| A3 | 「運賃不明」「位置が不明」を表す値が無い。0 や推定で埋めると信頼を失う | 欠落 | 高 | `core-design.md` 4.4、`platform-precision.md` 3 章 |
| A4 | 運行日（サービス日）・24 時超え・祝日・特別ダイヤの扱いが無い | 欠落 | 高 | `core-design.md` 6 章 |
| A5 | 直通運転・分割併結・重複した乗り場の方針が無い。首都圏では最頻の罠 | 欠落 | 高 | `core-design.md` 5 章 |
| A6 | 検証計画（差分テスト・ゴールデン・性質テスト）が無い。「主要 20 経路を人手で比較」だけでは取りこぼしを検出できない | 欠落 | 高 | `core-design.md` 9 章 |
| A7 | 段階 2「日本全国」は JR のデータが無い間は成立しない。順番を 首都圏の仕上げ → 飛行機 → アカウント → 全国 に変える | 過大 | 高 | `roadmap.md` |
| A8 | 「データ更新：週 1 回」は ODPT の「通知から 1 週間」の義務を外す危険。確認は毎日 | 誤り | 中 | `data-pipeline.md` 3.2 |
| A9 | 「オフライン：都市圏の時刻表を端末に入れる」は基本ライセンスの再配布禁止に当たる可能性 | 法務 | 中 | `data-pipeline.md` 1.2、`accounts-privacy.md` Q13 |
| A10 | 「乗り場位置の DB は OSM を下地に自前で」は、ODbL の派生データベースになり公開義務を負う可能性。自前の実測は別層に | 法務 | 中 | `platform-precision.md` 9 章 |
| A11 | 「乗り場 ±5 m 目標」は、スマホの GPS（誤差 5〜10 m が普通 [GUESS]）では実測でも保証しにくい。「段階（A〜D）」として表し、段階に応じて見せ方を変える | 過大 | 中 | `platform-precision.md` 3 章 |
| A12 | 「サーバ 1〜2 台 32 GB 級」「月 1〜5 万円」は OTP 前提。自作なら首都圏は数十 MB 級 [GUESS]。費用の前提を書き直す | 古い | 低 | `roadmap.md` 6 章 |
| A13 | 「飛行機の組み合わせ：地上探索 6 回」は 2 段方式の前提。同一エンジンなら不要 | 古い | 低 | `core-design.md` 7 章 |
| A14 | 国際線の余裕 120 分の根拠が無い。公式の締切（手続き 60 分前）に利用者の余裕を足す形にし、設定で変えられるようにする | 推測 | 中 | `core-design.md` 7.2 |
| A15 | アカウントの章に、削除義務（App Store・Google Play）、外部送信規律、Firebase の米国処理、個人情報保護法上の位置づけ、弁護士への質問が無い | 欠落 | 中 | `accounts-privacy.md` |
| A16 | 「ユーザーに決めてほしいこと」の 5 件は `decisions.md` で決まった。新しい決定事項（飛行機の方式・地図部品・認証部品・E2E 暗号化・修正の受付・JR の時期・ODPT が無い間の進め方）に置き換える | 古い | 低 | `roadmap.md` 8 章 |
| A17 | `research-japan-data.md` の「推奨の組み合わせ」1 項（OTP を本番で動かす）は決定と矛盾。OTP は照合用 | 古い | 低 | 本書 4 章 |
| A18 | `research-japan-data.md` 表の「航空：国内線のオープンデータ 不明」を ODPT の全日空・日本航空に差し替える | 誤り | 高 | 本書 4 章 |
| A19 | `research-maps.md` の「推」の無料枠（MapKit JS・Mapbox）は確認済みに格上げできる。Google Maps URLs は「API キー不要」まで | 更新 | 低 | 本書 4 章 |
| A20 | RAPTOR の計算量の表現が不正確（#22） | 誤り | 低 | `core-design.md` 10 章 |
| A21 | エンジンの境界（スナップショット・Router・街路接続・付加情報）が無く、画面とエンジンを直結しない方針が具体化されていない | 欠落 | 中 | `core-design.md` 11 章 |
| A22 | 「ログなし利用：アカウント無しでも検索はすべて可能」は良いが、「同期のオン／オフを本人が選ぶ」まで書くべき | 小 | 低 | `accounts-privacy.md` 1 章 |
| A23 | 「主要 50 駅の出入口・ホームが地図に出る」の完成条件に、精度の段階と出どころの条件が無い | 小 | 低 | `roadmap.md` 2-2 |
| A24 | 「最初は首都圏の地下鉄と私鉄」のうち、**私鉄の大半（小田急・東急・京王・西武・東武・京急・相鉄）と JR 東日本は通常利用できるデータが無い**（チャレンジ限定のみ）。京成・東京モノレールは ODPT に無い。段階 1 の範囲は 東京メトロ・都営・つくばエクスプレス・りんかい線・横浜市営・多摩モノレールに縮む。羽田・成田への鉄道アクセス（京急・モノレール・京成）が欠けるため、段階 3（飛行機）の空港アクセスは都営浅草線・バス・限定データのいずれかに頼る | 前提の崩れ | **高** | `roadmap.md` 1 章・D7・R2 |
| A25 | ODPT の駅施設データ（`odpt:StationFacility`）は廃止されており、出入口は `odpt:exit` の語彙だけで独立データセットが無い。出入口の主な出どころは OSM と自前の実測になる | 欠落 | 中 | `platform-precision.md` 2 章 |

## 4. 具体的な変更の一覧（既存文書への反映）

既存の 3 文書は「レビュー注記」を先頭に 1 つ付けるだけに留め（本書への参照）、本文は改訂しない。改訂版は次の版で書き直す。改訂時に反映する項目：

1. `architecture.md` 結論 1（OTP 土台）→ 決定済み：自作 RAPTOR、OTP は照合用。
2. `architecture.md` 2.2（飛行機の 2 段）→ 同一エンジン方式（A1）。2 段方式は段階 6（海外）でエンジン間の接続として再検討。
3. `architecture.md` 2.4・6 章の数値 → OTP 前提を外し、`core-design.md` 10 章の見積もりに置き換え、段階 1 で実測。
4. `architecture.md` 3 章のデータモデル → Pattern・Service（日付展開）・Transfer（便間）・AirBuffer・Provenance・「不明」値を追加（A2〜A5）。
5. `architecture.md` 4 章 → `accounts-privacy.md` に置き換え（A15・A22）。
6. `architecture.md` 6 章「データ更新 週 1 回」→ ODPT は毎日確認・1 週間以内の反映（A8）。「オフライン」→ ライセンス確認待ち（A9）。
7. `architecture.md` 7 章の段階 → `roadmap.md` に置き換え（A7）。
8. `architecture.md` 8 章の決定事項 → `roadmap.md` 8 章に置き換え（A16）。
9. `research-japan-data.md` 結論 2（基本ライセンス本文 不明）→ 取得済み。要点は `data-pipeline.md` 1.2。
10. `research-japan-data.md` 表「ODPT」行 → 東京メトロ＝基本ライセンス、都営＝CC BY 4.0 を明記（#2）。
11. `research-japan-data.md` 表「航空：国内線のオープンデータ」行 → ODPT の全日空（国内・国際）・日本航空（国内）、基本ライセンス（#3・A18）。
12. `research-japan-data.md` 表「JR 各社」行 → JR 東日本は ODPT に 8 件あるが全部チャレンジ 2026 限定（2027-03-12 失効、競合禁止条項あり）。大手私鉄 7 社も同じ。新しい行として「ODPT で通常利用できる首都圏の鉄道事業者」の一覧を加える（#10）。
13. `research-japan-data.md`「経路探索のオープンソース」表 → MOTIS・R5・Valhalla の MIT、OSRM の BSD-2 を確認済みに（#13）。OTP は LGPL-3.0 以降。
14. `research-japan-data.md`「推奨の組み合わせ」1 → 自作 RAPTOR＋OTP は照合（A17）。
15. `research-japan-data.md`「確認できなかった項目」→ 基本ライセンス本文・限定ライセンス本文・国内線・gtfs-data.jp・JR 東日本の有無を除去（すべて確認済み）。残り：駅すぱあと・NAVITIME の料金 [UNKNOWN]、JR 東日本以外の JR 各社 [UNKNOWN]、日本全国で OTP を動かすメモリ [UNKNOWN]。
15b. `research-japan-data.md` 表「GTFS データリポジトリ」行 → 運営 AIGID、各フィードのライセンスは提供者指定、付帯データ CC BY 4.0（#15b）。「国土数値情報」行 → データごとのライセンス（#15d）。「国交省 GTFS-JP」行 → 第 4.0 版（2026 年 3 月）と、`pathways`・`block_id`・`platform_code` の扱い（#15）。
16. `research-maps.md` 5 章 → MapKit JS（25 万／2.5 万 ／日）・Mapbox（5 万／月）を確認済みに（#16・#17）。
17. `research-maps.md` 4 章「Google Maps URLs は無料（推）」→「API キー不要・2,048 文字まで。料金表に項目なし」（#18）。
18. `research-maps.md` 5 章 OSM 行 → User-Agent 必須、Nominatim の結果キャッシュ必須を追記（#19）。
19. `decisions.md` 2 の補足「CC BY のデータ」→「都営などの CC BY 4.0 と、本文を確認した基本ライセンス（東京メトロ）」（#2）。決定そのものは変えない。
20. `decisions.md` に追記候補：飛行機の方式（D1）、ODPT が無い間の進め方（D2）。
21. 国際線の余裕の既定値 → 「手続き締切 60 分前 ＋ 利用者の余裕（既定 30〜60 分 [GUESS]）」、設定で変更可（A14）。
22. 乗り場の精度目標 → 段階 A〜D と網羅率（A11・A23）。
23. 計算量の表現 → `core-design.md` 10.1（A20）。

## 5. 今回確かめられなかったこと（[UNKNOWN] の一覧）
- ODPT の `odpt:exit`・`odpt:platformNumber`・`previousTrainTimetable` を **実際に埋めている事業者**（API キーが要る。登録後）。
- 祝日 CSV の利用条件（内閣府のページに記載なし）。
- JR 東日本以外の JR 各社（東海・西日本など）のデータの有無。
- 駅すぱあと・NAVITIME の料金。
- ANA の保安検査の締切の現行の公式記載（報道では 20 分前）。
- 無料の MCT の出どころ（無いと思われるが断定しない）。
- Google Routes の日本の鉄道の挙動、Google の各条文（使わない方針のため優先度低）。
- `architecture.md` 2.4・6 章の規模・費用の数値（実測待ち）。
