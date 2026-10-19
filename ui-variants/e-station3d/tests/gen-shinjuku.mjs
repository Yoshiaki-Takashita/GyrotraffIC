// data/shinjuku/shinjuku-station.json（別担当の成果・読むだけ）から ui-variants/e-station3d/data/shinjuku-station.js を作る
// （file:// で開けるよう JS にする。中身は元の JSON そのまま。変換は data/shinjuku-view.js が画面で行う）。
// 使い方: node ui-variants/e-station3d/tests/gen-shinjuku.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "..", "..", "..", "data", "shinjuku", "shinjuku-station.json");
const j = JSON.parse(readFileSync(src, "utf8"));
writeFileSync(join(here, "..", "data", "shinjuku-station.js"), "// 自動生成（tests/gen-shinjuku.mjs）。手で直さず data/shinjuku/shinjuku-station.json から作り直す。\nwindow.GT_SHINJUKU_RAW = " + JSON.stringify(j) + ";\n");
