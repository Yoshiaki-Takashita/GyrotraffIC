// data/sample-station.json から data/sample-station.js を作る（file:// で開けるよう JS にする）。
// 使い方: node ui-variants/e-station3d/tests/gen-station.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const d = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const j = JSON.parse(readFileSync(join(d, "sample-station.json"), "utf8"));
writeFileSync(join(d, "sample-station.js"), "// 自動生成（tests/gen-station.mjs）。手で直さず sample-station.json を直して作り直す。\nwindow.GT_STATION = " + JSON.stringify(j) + ";\n");
