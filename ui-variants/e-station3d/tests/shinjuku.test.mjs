// 新宿の下書きの変換（data/shinjuku-view.js）と経路の単体試験。使い方: node --test ui-variants/e-station3d/tests/shinjuku.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const load = (f) => { const b = { module: { exports: {} } }; b.self = b; vm.runInNewContext(readFileSync(f, "utf8"), b); return b.module.exports; };
const V = load(join(here, "..", "data", "shinjuku-view.js"));
const G = load(join(here, "..", "js", "station-graph.js"));
const rawPath = resolve(here, "..", "..", "..", "data", "shinjuku", "shinjuku-station.json");
const raw = JSON.parse(readFileSync(rawPath, "utf8"));
const st = V.convert(raw);

test("shinjuku-station.js は元の JSON と同じ中身", () => {
  const js = readFileSync(join(here, "..", "data", "shinjuku-station.js"), "utf8");
  const m = js.match(/window\.GT_SHINJUKU_RAW = ([\s\S]*);\s*$/);
  assert.deepEqual(JSON.parse(m[1]), raw);
});
test("読み込み：階・点・辺・ホームを 1 つも捨てない／元のデータを書き換えない", () => {
  const before = JSON.stringify(raw);
  const s = V.convert(raw);
  assert.equal(JSON.stringify(raw), before);
  assert.deepEqual({ ...s._view.dropped }, { nodes: 0, edges: 0, areas: 0 });
  assert.equal(s.levels.length, raw.levels.length);
  assert.equal(s.nodes.length, raw.nodes.length);
  assert.equal(s.platforms.length, raw.platforms.length);
  assert.equal(s.edges.length, raw.edges.length + s._view.guesses.bridge + s._view.guesses.vertical);
});
test("施設の数が元データと一致（トイレ・階段・エスカレーター・エレベーター・改札・出口・ホーム）", () => {
  const want = {}; for (const n of raw.nodes) want[n.kind] = (want[n.kind] || 0) + 1;
  for (const k of ["toilet", "stairs", "escalator", "elevator", "gate", "exit"]) assert.equal(st._view.counts[k], want[k], k);
  assert.equal(st._view.counts.platform, raw.platforms.length);
  assert.equal(want.toilet, 51); assert.equal(want.stairs, 413); assert.equal(want.escalator, 284); assert.equal(want.elevator, 103);
  assert.equal(want.gate, 48); assert.equal(want.exit, 150); assert.equal(raw.platforms.length, 41); assert.equal(raw.levels.length, 11);
});
test("床は水平：階ごとに高さは 1 つ、点はどれも自分の階の高さを持つ", () => {
  const z = new Map(st.levels.map((l) => [l.id, l.z]));
  assert.equal(new Set(st.levels.map((l) => l.z)).size, st.levels.length);
  for (const n of st.nodes) assert.ok(z.has(n.level), n.id);
  for (const a of st.areas) assert.ok(z.has(a.level), a.id);
});
test("null と空に強い：号車・ドア・線路・名前が null／壊れた点と辺を混ぜても止まらない", () => {
  const broken = {
    levels: [{ id: "1F", name: "1F", z: 0 }, { id: "XX", name: "XX", z: null }],
    nodes: [{ id: "a", level: "1F", x: 0, y: 0, kind: "gate" }, { id: "b", level: "1F", x: 10, y: 0, kind: "exit", ground: true },
      { id: "c", level: "1F", x: null, y: 0, kind: "toilet" }, { id: "d", level: "ZZ", x: 0, y: 0, kind: "stairs" }, null, { id: "a", level: "1F", x: 1, y: 1 }],
    edges: [{ a: "a", b: "b", sec: 8, kind: "walk" }, { a: "a", b: "c", sec: 1 }, null],
    areas: [{ id: "A1", level: "1F", kind: "platform", rect: [0, 0, 5, 5] }, { id: "A2", level: "1F", rect: null }],
    platforms: [{ id: "P1", name: null, level: "1F", area: "A1", cars: null, doors: null, access: null }],
    tracks: null, targets: ["P1", "b", "nope"]
  };
  const s = V.convert(broken);
  assert.deepEqual({ ...s._view.dropped }, { nodes: 4, edges: 2, areas: 1 });
  assert.equal(s.levels.length, 1);
  assert.deepEqual([...s.tracks], []);
  assert.equal(s.platforms[0].label, null);
  assert.deepEqual([...s.platforms[0].access], []);
  assert.deepEqual([...s.targets], ["P1", "b", "a"]);
  assert.equal(G.bestDoor(s, "P1", "b"), null);                 // 号車・ドアが不明なホームでは提案しない
  assert.equal(G.route(s, { platform: "P1" }, "b").ok, false);  // 昇降口がない → 経路不明
  assert.equal(G.route(s, { node: "a" }, "b").sec, 8);
  assert.equal(G.route(s, { node: "zzz" }, "b").ok, false);
  assert.doesNotThrow(() => V.convert({}));
  assert.doesNotThrow(() => V.convert(null));
});
test("推測の接続はどれも「推」で、「確」は 1 件もない", () => {
  const g = st.edges.filter((e) => e.guess);
  assert.equal(g.length, st._view.guesses.bridge + st._view.guesses.vertical);
  for (const e of g) { assert.equal(e.conf, "推"); assert.equal(e.src, "viewer-guess"); assert.ok(e.note); }
  assert.equal(st.nodes.filter((n) => n.conf === "確").length, 0);
  assert.equal(st.edges.filter((e) => e.conf === "確").length, 0);
  assert.equal(V.convert(raw, { guess: false }).edges.filter((e) => e.guess).length, 0);
});
test("つながりのかたまり：元は 6、推測の接続で 4。行けるホームは 10 → 16", () => {
  assert.deepEqual([...st._view.components.before], [2472, 89, 61, 4, 4, 2]);
  assert.equal(G.components(raw).sizes.length, 6);
  assert.equal(st._view.components.after.length, 4);
  assert.equal(st._view.reach.strict.platforms, 10);
  assert.equal(st._view.reach.withGuess.platforms, 16);
});
test("経路：JR 14 番線 → 改札 → 地上の出口 21（推測の接続 1 区間）", () => {
  const p = st.platforms.find((x) => /^14\s/.test(x.label || ""));
  const ex = st.nodes.find((n) => n.kind === "exit" && n.name === "出口 21");
  const r = G.route(st, { platform: p.id }, ex.id);
  assert.equal(r.ok, true);
  assert.ok(r.guessed >= 1);
  const kinds = r.path.map((id) => (st.nodes.find((n) => n.id === id) || {}).kind);
  assert.ok(kinds.includes("gate"));
  assert.equal(kinds.at(-1), "exit");
  assert.equal(G.route(st, { platform: p.id }, ex.id, { noGuess: true }).ok, false);   // 推測なしでは行けない
});
test("経路不明：つながらない 2 点は ok:false", () => {
  const C = G.components(st);
  const iso = st.platforms.find((x) => !x.access.some((id) => C.of[id] === 0));
  const ex = st.nodes.find((n) => n.kind === "exit" && n.ground && C.of[n.id] === 0);
  const r = G.route(st, { platform: iso.id }, ex.id);
  assert.equal(r.ok, false); assert.equal(r.sec, null);
});
test("3 種のルート：JR 14 番線 → 出口 21。段差を避けると階段・エスカレーターが減る（0 にできない時はその数を返す）", () => {
  const p = st.platforms.find((x) => /^14\s/.test(x.label || ""));
  const ex = st.nodes.find((n) => n.kind === "exit" && n.name === "出口 21");
  const fast = G.route(st, { platform: p.id }, ex.id);
  const avoid = G.route(st, { platform: p.id }, ex.id, { avoidSteps: true });
  assert.equal(avoid.ok, true);
  assert.ok(avoid.stepEdges <= fast.stepEdges);
  assert.equal(avoid.stepEdges, avoid.steps.filter((s) => s.kind === "stairs" || s.kind === "escalator").length);
  const wc = G.route(st, { platform: p.id }, { kind: "toilet" });
  assert.equal(wc.ok, true);
  assert.equal(st.nodes.find((n) => n.id === wc.goal).kind, "toilet");
});
