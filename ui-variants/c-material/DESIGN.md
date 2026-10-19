# 案 C「Material」 DESIGN.md（c-material）

## 美的な方向
Material Design 3（公式の指針）の作法に忠実な画面。1 つの種の色（青緑 `#00696D`）から導いた tonal な階調で、箱の線ではなく「面の明るさの段」で奥行きを作る。Android の利用者が説明なしで使える：下部のナビゲーションバー（活性の印の丸い帯）・拡張 FAB・セグメントボタン（選択に印）・状態の層（押す・触れるで面が薄く色づく）・大きく丸い形（シートの角 28px）。

禁止（ありきたりへの逆戻り）：Arial/Inter 風の無難な書体の指定、紫のグラデーション＋白地、同じ形のカードの無限の並び、飾りだけの動き、絵文字、角丸の箱の乱用（一覧は 1 枚の面に並べ、区切りは余白と細い線）、iOS 風の部品（すりガラス・iOS のスイッチ・左上の「＜戻る」文字）、Google の商標のロゴの複製（アイコンは自作 SVG）。

## 色（役割ごとの変数。実装はこれだけを使う）
| 役割 | 変数 | ライト | ダーク |
|---|---|---|---|
| 主 | `--primary` / `--on-primary` | #006A6A / #FFFFFF | #4CDADA / #003737 |
| 主の容器 | `--primary-container` / `--on-primary-container` | #9CF1F0 / #002020 | #004F4F / #9CF1F0 |
| 副 | `--secondary` / `--secondary-container` / `--on-secondary-container` | #4A6363 / #CCE8E7 / #051F1F | #B0CCCB / #324B4B / #CCE8E7 |
| 第三 | `--tertiary` / `--tertiary-container` / `--on-tertiary-container` | #4B607C / #D3E4FF / #041C35 | #B3C8E8 / #334863 / #D3E4FF |
| 面 | `--surface` | #F4FBFA | #0E1514 |
| 面の段 | `--sc-lowest` `--sc-low` `--sc` `--sc-high` `--sc-highest` | #FFFFFF #EEF5F4 #E9EFEE #E3E9E9 #DDE4E3 | #090F0F #161D1D #1A2121 #252B2B #303636 |
| 文字 | `--on-surface` / `--on-surface-variant` | #161D1D / #3F4948 | #DDE4E3 / #BEC9C8 |
| 境界 | `--outline` / `--outline-variant` | #6F7979 / #BEC9C8 | #889392 / #3F4948 |
| 誤り | `--error` / `--error-container` / `--on-error-container` | #BA1A1A / #FFDAD6 / #410002 | #FFB4AB / #93000A / #FFDAD6 |
| 遅延・注意（調和させた黄土） | `--warn` / `--warn-container` / `--on-warn-container` | #7A5900 / #FFDEA3 / #261900 | #F4BF4F / #5C4200 / #FFDEA3 |
| 確か | `--ok` | #1E6B3A | #8BD79F |
| 路線（手段ごと） | `--m-rail` `--m-subway` `--m-bus` `--m-air` `--m-ferry` | #006A6A #3D5F90 #8B5000 #5B5D8F #00658E | #4CDADA #A6C8FF #FFB77C #C3C3FF #7FD0FF |

状態の色は文字・形でも示す：確＝塗りの丸＋チェック、推＝半分塗りの三角、不明＝破線の丸＋？。運賃不明は「運賃不明」の文字＋破線の枠。遅延は（データ未対応）注意色＋時計のアイコン＋文字。

状態の層（M3 の state layer）：押す 12%・触れる 8%・焦点 12% の `currentColor` を `::after` で重ねる。

## 書体
`Roboto, "Noto Sans JP", "Noto Sans CJK JP", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", Meiryo, system-ui, sans-serif`（外部フォントなし。Android では Roboto＋Noto Sans CJK が既定で入る）。数字はすべて `font-variant-numeric: tabular-nums`。
| 段階 | 変数 | 大きさ / 行の高さ / 太さ |
|---|---|---|
| Display S | `--t-display` | 36 / 44 / 400 |
| Headline S | `--t-headline` | 24 / 32 / 400 |
| Title L | `--t-title-l` | 22 / 28 / 400 |
| Title M | `--t-title-m` | 16 / 24 / 500 |
| Body L | `--t-body-l` | 16 / 26 / 400（日本語のため M3 の 24 より広く） |
| Body M | `--t-body-m` | 14 / 22 / 400 |
| Label L | `--t-label-l` | 14 / 20 / 500 |
| Label M | `--t-label-m` | 12 / 16 / 500 |
字間：日本語は 0、英数の見出しのみ 0。

## 余白（4 の倍数）
`--s1` 4 / `--s2` 8 / `--s3` 12 / `--s4` 16 / `--s5` 20 / `--s6` 24 / `--s8` 32 / `--s10` 40。横の余白は 16（320 幅で 12）。

## 形（角）
`--shape-xs` 4・`--shape-s` 8・`--shape-m` 12・`--shape-l` 16・`--shape-xl` 28・`--shape-full` 999。シートの上角と FAB の容器は xl/l、チップ 8、入力の面 l。

## 影（M3 の elevation は色の段が主。影は FAB とシートだけ）
`--elev-1`（シート）・`--elev-3`（FAB）。ダークでは影を弱め、面の段で表す。

## 動き
| 変数 | 値 | 用途 |
|---|---|---|
| `--ease-std` | cubic-bezier(.2,0,0,1) | 標準 |
| `--ease-emph-dec` | cubic-bezier(.05,.7,.1,1) | 入る（強調・減速） |
| `--ease-emph-acc` | cubic-bezier(.3,0,.8,.15) | 出る |
| `--d-short` | 150ms | 状態の層・小さな切り替え |
| `--d-med` | 300ms | タブの印・数字の切り替え |
| `--d-long` | 450ms | シート・共有要素 |
見せ場（全体で 3 つ）：①結果→詳細の共有要素の遷移（案の行が詳細のシートに伸びる・View Transitions）②詳細で経路の線が描かれ乗換の点が順に現れる③結果の並び替えで所要時間の数字が流れる。
`prefers-reduced-motion: reduce` では、すべての移動・伸縮をやめて即時表示（共有要素の遷移も使わない）。色の変化だけ 0ms。
