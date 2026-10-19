// 中枢設計（core-design.md）に合わせた部分の試験：来歴（確／推／不明）・運賃の 3 値・画面へのアダプタ。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { loadGtfs } from "../src/gtfs/load.js";
import { Network } from "../src/network.js";
import { Router } from "../src/raptor.js";
import { combineFares, cheapestKnown, fareValueToEstimate, type FareValue } from "../src/fare.js";
import { weakest, unknown, CONFIDENCE_LABEL } from "../src/provenance.js";
import { createCoreProvider } from "../src/ui-adapter/index.js";
import type { WalkLeg } from "../src/journey.js";
import { writeMiniFeed, type MiniFeed } from "./helpers.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// A 線：A1→X、B 線：Y→B1。X と Y は transfers.txt で結ぶ（min あり＝確）。同じ駅 S のホーム P1・P2 は既定値（推）。
const feed: MiniFeed = {
  stops: [
    { id: "A1" }, { id: "X" }, { id: "Y" }, { id: "B1" },
    { id: "S", locationType: 1, name: "駅S" }, { id: "P1", parent: "S" }, { id: "P2", parent: "S" }, { id: "C1" },
  ],
  routes: [{ id: "RA", type: 1 }, { id: "RB", type: 1 }, { id: "RC", type: 3 }, { id: "RD", type: 3 }],
  trips: [
    { id: "a1", route: "RA", service: "W", times: [["A1", "08:00:00"], ["X", "08:10:00"]] },
    { id: "b1", route: "RB", service: "W", times: [["Y", "08:20:00"], ["B1", "08:30:00"]] },
    { id: "c1", route: "RC", service: "W", times: [["A1", "09:00:00"], ["P1", "09:10:00"]] },
    { id: "d1", route: "RD", service: "W", times: [["P2", "09:20:00"], ["C1", "09:30:00"]] },
  ],
  calendar: [{ id: "W", days: "1111111", start: "20260101", end: "20261231" }],
  transfers: [{ from: "X", to: "Y", type: 2, min: 300 }],
};

async function router() {
  const net = new Network(await loadGtfs(writeMiniFeed(feed)));
  return new Router(net);
}

test("徒歩の来歴：transfers.txt の min_transfer_time は確、同じ駅のホーム間の既定値は推", async () => {
  const r = await router();
  const j1 = r.depart({ from: "A1", to: "B1", date: "20261020", time: 7 * 3600 })[0];
  const w1 = j1.legs.find((l) => l.type === "walk") as WalkLeg;
  assert.equal(w1.source, "transfer");
  assert.equal(w1.duration, 300);
  assert.equal(w1.confidence, "confirmed");
  const j2 = r.depart({ from: "A1", to: "C1", date: "20261020", time: 8 * 3600 + 30 * 60 })[0];
  const w2 = j2.legs.find((l) => l.type === "walk") as WalkLeg;
  assert.equal(w2.source, "station");
  assert.equal(w2.confidence, "inferred");
});

test("確信度の合成と不明の値（0 で埋めない）", () => {
  assert.equal(weakest(["confirmed", "inferred"]), "inferred");
  assert.equal(weakest(["confirmed", "unknown", "inferred"]), "unknown");
  assert.equal(weakest(["confirmed"]), "confirmed");
  const u = unknown<number>("データが無い");
  assert.equal(u.value, null);
  assert.equal(u.confidence, "unknown");
  assert.equal(CONFIDENCE_LABEL[u.confidence], "不明");
});

test("運賃の 3 値：Unknown を含めば Unknown、Partial は下限、安い順は Known だけ", () => {
  const k = (n: number): FareValue => ({ kind: "known", amount: n, currency: "JPY", basis: "表" });
  assert.deepEqual(combineFares([k(100), k(200)]), { kind: "known", amount: 300, currency: "JPY", basis: "表＋表" });
  const unk = combineFares([k(100), { kind: "unknown", reason: "B 線の運賃が無い" }]);
  assert.equal(unk.kind, "unknown");
  const part = combineFares([k(100), { kind: "partial", lowerBound: 50, currency: "JPY", unknown: ["特急料金"] }]);
  assert.equal(part.kind, "partial");
  assert.equal(part.kind === "partial" && part.lowerBound, 150);
  assert.equal(combineFares([]).kind, "unknown");
  assert.equal(combineFares([k(1), { kind: "known", amount: 1, currency: "USD", basis: "x" }]).kind, "unknown");
  // 安い 1 本は Known の中で。Unknown（金額なし）は 0 円扱いにならない
  assert.equal(cheapestKnown([unk, k(500), part, k(300)]), 3);
  assert.equal(cheapestKnown([unk, part]), -1);
  assert.equal(fareValueToEstimate(unk), null);
  assert.ok((fareValueToEstimate(part)!.unknownLegs.length ?? 0) > 0, "Partial は画面で「＋」（不明あり）になる");
});

test("アダプタ：static-provider.js と同じ名前の関数を持ち、経路と来歴を返す", async () => {
  // 画面側の provider を読み取り専用で読み、関数の名前をくらべる（ui-variants は変更しない）
  const src = readFileSync(join(root, "ui-variants/e-station3d/js/data/static-provider.js"), "utf8");
  const ctx: { window: Record<string, unknown> } = { window: {} };
  vm.runInNewContext(src, ctx);
  const staticP = (ctx.window.GT as { providers: Record<string, Record<string, unknown>> }).providers.static;
  const p = createCoreProvider(await router(), { feed: { id: "test-mini", version: null, license: null, attribution: null } });
  for (const k of Object.keys(staticP)) assert.equal(typeof (p as unknown as Record<string, unknown>)[k], typeof staticP[k], `関数 ${k}`);

  const res = await p.route({ from: "A1", to: "B1", mode: "depart", time: "2026-10-20T07:00:00+09:00" });
  assert.equal(res.sample, false);
  assert.equal(res.journeys.length, 1);
  const j = res.journeys[0];
  assert.equal(j.fare, null, "運賃計算が無いので null（画面は「運賃不明」）。0 にしない");
  assert.deepEqual(j.provenance, { times: "confirmed", walks: "confirmed", fare: "unknown" });
  assert.equal(res.provenance.feed.license, null, "ライセンス不明は null のまま");
  assert.equal(p.stopAccess("A1"), null, "乗り場の位置は中枢に無い＝不明");

  const res2 = await p.route({ from: "A1", to: "C1", mode: "depart", time: "2026-10-20T08:30:00" });
  assert.equal(res2.journeys[0].provenance.walks, "inferred");

  const bad = await p.route({ from: "NOPE", to: "B1", mode: "depart", time: "2026-10-20T07:00:00" });
  assert.equal(bad.journeys.length, 0);
  assert.ok(bad.error);
});

test("アダプタ：「今」は差し替えた時計、「到着」は期限内、場所は駅と親の無い乗り場", async () => {
  const p = createCoreProvider(await router(), {
    feed: { id: "test-mini", version: "v1", license: null, attribution: null },
    now: () => new Date("2026-10-19T22:00:00Z"), // 日本時間 10-20 07:00
  });
  const now = await p.route({ from: "A1", to: "B1" });
  assert.equal(now.provenance.query.date, "20261020");
  assert.equal(now.journeys[0].arrivalIso, "2026-10-20T08:30:00");
  const arr = await p.route({ from: "A1", to: "B1", mode: "arrive", time: "2026-10-20T08:45:00" });
  assert.ok(arr.journeys.length > 0 && arr.journeys.every((j) => j.arrival <= 8 * 3600 + 45 * 60));
  const places = await p.places();
  const ids = places.map((x) => x.id).sort();
  assert.ok(ids.includes("S") && !ids.includes("P1"));
  assert.equal(places.find((x) => x.id === "C1")!.kind, "bus_stop");
});

test("アダプタの経路は画面の見本（samples.js）の経路と同じ項目を持つ", async () => {
  const ctx: { window: Record<string, unknown> } = { window: {} };
  vm.runInNewContext(readFileSync(join(root, "ui-variants/e-station3d/sample/samples.js"), "utf8"), ctx);
  const S = ctx.window.GT_SAMPLES as { routes: { journeys: Record<string, unknown>[] }[] };
  const sampleJ = S.routes[0].journeys[0];
  const p = createCoreProvider(await router(), { feed: { id: "t", version: null, license: null, attribution: null } });
  const j = (await p.route({ from: "A1", to: "B1", mode: "depart", time: "2026-10-20T07:00:00" })).journeys[0] as unknown as Record<string, unknown>;
  for (const k of Object.keys(sampleJ)) assert.ok(k in j, `経路の項目 ${k}`);
  const sTransit = (sampleJ.legs as Record<string, unknown>[]).find((l) => l.type === "transit")!;
  const jTransit = (j.legs as Record<string, unknown>[]).find((l) => l.type === "transit")!;
  for (const k of Object.keys(sTransit)) assert.ok(k in jTransit, `乗車区間の項目 ${k}`);
});
