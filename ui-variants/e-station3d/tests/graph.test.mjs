// 駅の中の最短経路の単体試験。使い方: node --test ui-variants/e-station3d/tests/graph.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
// リポジトリは "type":"module" なので、ブラウザ用の UMD ファイルを vm で読む
const box = { module: { exports: {} } }; box.self = box;
vm.runInNewContext(readFileSync(join(here, "..", "js", "station-graph.js"), "utf8"), box);
const G = box.module.exports;
const st = JSON.parse(readFileSync(join(here, "..", "data", "sample-station.json"), "utf8"));

test("sample-station.js は sample-station.json と同じ中身", () => {
  const js = readFileSync(join(here, "..", "data", "sample-station.js"), "utf8");
  const m = js.match(/window\.GT_STATION = ([\s\S]*);\s*$/);
  assert.deepEqual(JSON.parse(m[1]), st);
});
test("すべての辺の端が存在するノード", () => {
  const ids = new Set(st.nodes.map((n) => n.id));
  for (const e of st.edges) { assert.ok(ids.has(e.a), e.a); assert.ok(ids.has(e.b), e.b); }
  for (const p of st.platforms) for (const a of p.access) assert.ok(ids.has(a), a);
});
test("ドアの位置：1 号車 1 番ドアは 1 号車の端から半ドア間隔", () => {
  const p = G.platformOf(st, "P12");
  assert.equal(G.doorS(p, 1, 1), 208 - 2.5);
  assert.equal(G.doorS(p, 7, 3), 208 - 120 - 12.5);
});
test("7号車3番ドア → 環線：不明を通らず、手計算と一致", () => {
  const r = G.route(st, { platform: "P12", car: 7, door: 3 }, "P56");
  assert.equal(r.ok, true); assert.equal(r.unknown, 0);
  // ドア s=75.5。階段A(50)まで 25.5 秒 → 30+13+9+25+17+17+25+12+6 → 階段E 26+55 か エスカF 27+50（後者）
  // エスカB(110) 経由：34.5+35+13+17+25+12+6+27+50=219.5／階段A 経由：25.5+30+13+9+25+17+17+25+12+6+77=256.5
  assert.equal(r.sec, 219.5);
  assert.deepEqual([...r.path.slice(0, 3)], ["__door", "P12_es", "C12_es"]);
  assert.equal(r.path[r.path.length - 1], "P56_es");
});
test("おすすめのドアはエスカレーターB の真横（5号車4番ドア）", () => {
  const b = G.bestDoor(st, "P12", "P56");
  assert.equal(b.car, 5); assert.equal(b.door, 4);
  assert.equal(b.r.sec, 0.5 + 185);
});
test("段差なし：エレベーター3 の秒数が不明なので、不明 1 区間として返す", () => {
  const r = G.route(st, { platform: "P12", car: 2, door: 1 }, "P56", { stepFree: true });
  assert.equal(r.ok, true); assert.equal(r.unknown, 1);
  assert.ok(r.steps.every((s) => s.kind !== "stairs" && s.kind !== "escalator"));
  assert.ok(r.path.includes("P56_el"));
});
test("同じホームなら移動なし・出口へも行ける", () => {
  assert.equal(G.route(st, { platform: "P34", car: 1, door: 1 }, "P34").same, true);
  const r = G.route(st, { platform: "P34", car: 4, door: 2 }, "EXN");
  assert.equal(r.ok, true); assert.equal(r.path.at(-1), "EXN");
});
