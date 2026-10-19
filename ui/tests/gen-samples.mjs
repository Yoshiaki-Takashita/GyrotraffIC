// ui/sample/*.json → ui/sample/samples.js（file:// で開いても読めるように、JSON を window.GT_SAMPLES に入れる）
// 使い方: node ui/tests/gen-samples.mjs
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "sample");
const out = { routes: [], places: null, stopAccess: null };
for (const f of readdirSync(dir).sort()) {
  if (!f.endsWith(".json")) continue;
  const j = JSON.parse(readFileSync(join(dir, f), "utf8"));
  if (j.format === "gyrotraffic-route-v0") out.routes.push(j);
  else if (j.format === "gyrotraffic-places-v0") out.places = j;
  else if (j.format === "gyrotraffic-stop-access-v0") out.stopAccess = j;
}
writeFileSync(join(dir, "samples.js"), "// 自動生成（ui/tests/gen-samples.mjs）。手で直さない。\nwindow.GT_SAMPLES = " + JSON.stringify(out) + ";\n");
console.log("routes:", out.routes.length);
