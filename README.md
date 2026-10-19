# GyrotraffIC

鉄道・バス・フェリー・飛行機をまとめて、出発地から目的地までの基本の経路を決めるアプリ。日本から作る。非公開。

## 状態（2026-10-19）
- 経路探索の中核（自作・RAPTOR 方式）の最初の版ができた。GTFS を読み、出発時刻／到着時刻の指定で、
  「到着時刻 × 乗り換え回数」の候補を複数出す。運賃は未対応（差し込み口だけ）。
- 確かめたこと：手で答えの分かる合成の路線網、乱数の網での性質試験（別方式の素朴な探索と最早到着が一致）、
  乱数の大きな網（駅 3,000・便 50,000）での計測、日本の公開 GTFS 1 件（北海道のバス 1 路線・CC BY 4.0）。
- まだ：首都圏の鉄道の実データでの確認（ODPT の登録待ち）、OpenTripPlanner との照合の実施、運賃、画面。

## 使い方
Node 20 以上。実行時の依存は無し（開発時のみ TypeScript〈Apache-2.0〉と @types/node〈MIT〉）。

```sh
npm install          # 開発用（typescript・@types/node）
npm test             # ビルドして試験（node:test）
npm run bench        # 性能の計測（駅 3,000・便 50,000 の合成網）
node dist/src/cli.js route --gtfs <GTFSのフォルダ> --from <stop_id> --to <stop_id> --depart 2026-10-20T08:00:00+09:00
node dist/src/cli.js route --gtfs <dir> --from <id> --to <id> --arrive-by 2026-10-20T09:00:00+09:00 --json
node dist/src/cli.js run-cases --gtfs <dir> --cases validation/cases-shiokazeline.json --out ours.json
node dist/src/cli.js compare ours.json otp.json --tolerance 300
```
- `npm link` すると `gyrotraffic route ...` の形でも呼べる（package.json の bin）。
- `--from` / `--to` に駅（location_type=1）の ID を渡すと、その駅の全ホームを出発・到着の候補にする。
- GTFS は zip を展開したフォルダを渡す（zip の直接読み込みは未対応）。

## 限界（詳しくは `docs/router-design.md`）
- 運賃なし。frequencies.txt（間隔指定の便）・便どうしの直通（transfers の type 4・5）・pathways.txt は未対応。
- 到着時刻の指定は簡易版（出発時刻の探索の二分探索）。
- 徒歩は停留所間だけ（住所・地図上の地点からの徒歩は未対応）。transfers.txt が無いデータでは直線距離から推定（推）。
- 性能の値は乱数の合成網での参考値。実際の首都圏のデータでの値は不明。

## 文書
- `docs/router-design.md`：経路探索の設計（10 行の要約・アルゴリズム・計算量・日本の癖・限界・次の段階）
- `docs/decisions.md`：所有者の決定
- `docs/architecture.md`：中枢システムの設計（段階計画・未決定事項つき）
- `docs/research-japan-data.md`：日本の交通データの入手先とライセンス
- `docs/research-maps.md`：地図の連携の機能・料金・規約
- `validation/`：照合（OpenTripPlanner との比較）用の入力の例
- 【2026-10-19 追加・中枢システムの設計一式】
  - `docs/review-architecture.md`：`architecture.md` と 2 つの調査文書の批判的レビューと検証結果
  - `docs/core-design.md`：経路探索の中核の設計（RAPTOR・飛行機の結合・運賃不明の扱い・直通・検証計画）
  - `docs/data-pipeline.md`：データの取り込み・版・更新・ライセンスの守り・来歴
  - `docs/platform-precision.md`：出入口・ホーム・バス停の向きと位置の確信度
  - `docs/accounts-privacy.md`：アカウント・端末内履歴・削除と書き出し・脅威モデル・弁護士への質問
  - `docs/roadmap.md`：段階計画・最小の一歩・危険・所有者の決定事項

## 構成
- `src/gtfs/`：CSV のストリーム読み込み・GTFS の読み込み
- `src/network.ts`：経路パターン・徒歩のつながり・運行日
- `src/raptor.ts`：RAPTOR の探索と経路の復元
- `src/modes.ts`・`src/fare.ts`：移動手段の抽象化・運賃の差し込み口
- `src/validation.ts`：照合用の共通 JSON と比較
- `src/cli.ts`：CLI
- `test/`・`bench/`：試験・計測
