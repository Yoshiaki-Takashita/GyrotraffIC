// 始発・終電（first-last.ts）の試験：終電後の乗り継ぎ不可、日付またぎ（25:30 など）、運行日の違い、便なし。
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGtfs } from "../src/gtfs/load.js";
import { Network } from "../src/network.js";
import { Router } from "../src/raptor.js";
import { firstTrain, lastTrain } from "../src/first-last.js";
import { createCoreProvider } from "../src/ui-adapter/index.js";
import type { TransitLeg } from "../src/journey.js";
import { writeMiniFeed, type MiniFeed } from "./helpers.js";

const H = (h: number, m = 0) => h * 3600 + m * 60;

// W＝平日、S＝土曜（＋calendar_dates で 2026-11-01 日曜に追加）。日曜 2026-10-25 は便なし。
const feed: MiniFeed = {
  stops: [{ id: "A" }, { id: "B" }, { id: "C" }],
  routes: [{ id: "R1", type: 1 }, { id: "R2", type: 1 }],
  trips: [
    { id: "w0200", route: "R1", service: "W", times: [["A", "02:00:00"], ["B", "02:20:00"]] },
    { id: "w0500", route: "R1", service: "W", times: [["A", "05:00:00"], ["B", "05:20:00"]] },
    { id: "w2300", route: "R1", service: "W", times: [["A", "23:00:00"], ["B", "23:20:00"]] },
    { id: "w2530", route: "R1", service: "W", times: [["A", "25:30:00"], ["B", "25:50:00"]] },
    { id: "x0600", route: "R2", service: "W", times: [["B", "06:00:00"], ["C", "06:20:00"]] },
    { id: "x2440", route: "R2", service: "W", times: [["B", "24:40:00"], ["C", "25:00:00"]] },
    { id: "s0700", route: "R1", service: "S", times: [["A", "07:00:00"], ["B", "07:20:00"]] },
  ],
  calendar: [
    { id: "W", days: "1111100", start: "20260101", end: "20261231" },
    { id: "S", days: "0000010", start: "20260101", end: "20261231" },
  ],
  calendarDates: [{ id: "S", date: "20261101", type: 1 }],
};

async function router(f: MiniFeed = feed) {
  return new Router(new Network(await loadGtfs(writeMiniFeed(f))));
}
const trips = (j: { legs: { type: string }[] }) => j.legs.filter((l) => l.type === "transit").map((l) => (l as TransitLeg).tripId);

test("始発：前日の深夜便（25:30＝翌 1:30）と運行日の始まり（03:00）より前の便を使わない", async () => {
  const r = await router();
  // 比較：ふつうの前向き探索を 0 時から走らせると、前日の 25:30 の便が答えになる
  const naive = r.depart({ from: "A", to: "B", date: "20261021", time: 0 })[0];
  assert.deepEqual(trips(naive), ["w2530"]);
  const res = firstTrain(r, { from: "A", to: "B", date: "20261021" });
  assert.equal(res.status, "ok");
  assert.deepEqual(trips(res.journeys[0]), ["w0500"]);
  assert.equal(res.journeys[0].departureIso, "2026-10-21T05:00:00");
  assert.equal(res.provenance.dayStart?.value, H(3));
  assert.equal(res.provenance.dayStart?.confidence, "inferred");
  assert.equal(res.provenance.serviceDay.confidence, "inferred");
  // 運行日の始まりを変えると 02:00 の便も D の便として使える
  const early = firstTrain(r, { from: "A", to: "B", date: "20261021", dayStart: H(1) });
  assert.deepEqual(trips(early.journeys[0]), ["w0200"]);
});

test("終電：24 時を超える便（25:30）も運行日の便として最も遅い出発に入る。日付は翌日の ISO で返す", async () => {
  const r = await router();
  const res = lastTrain(r, { from: "A", to: "B", date: "20261020" });
  assert.equal(res.status, "ok");
  const j = res.journeys[0];
  assert.deepEqual(trips(j), ["w2530"]);
  assert.equal(j.departure, H(25, 30));
  assert.equal(j.departureIso, "2026-10-21T01:30:00");
  assert.equal(j.arrivalIso, "2026-10-21T01:50:00");
  assert.equal(res.provenance.times.confidence, "confirmed");
});

test("終電：終電の後の乗り継ぎはできない（25:30 の便は 24:40 の最終に間に合わないので 23:00 発が答え）", async () => {
  const r = await router();
  const res = lastTrain(r, { from: "A", to: "C", date: "20261020" });
  assert.equal(res.status, "ok");
  const j = res.journeys[0];
  assert.deepEqual(trips(j), ["w2300", "x2440"]);
  assert.equal(j.departure, H(23));
  assert.equal(j.arrival, H(25));
  assert.equal(j.transfers, 1);
  // 1 分でも遅く出ると、同じ運行日の便では着けない（始発の探索で確かめる）
  assert.equal(firstTrain(r, { from: "A", to: "C", date: "20261020", dayStart: j.departure }).status, "ok");
  const late = firstTrain(r, { from: "A", to: "C", date: "20261020", dayStart: j.departure + 60 });
  assert.equal(late.status, "none");
  assert.equal(late.journeys.length, 0);
  // C から A へは便が無い：作り話の経路を返さない
  const back = lastTrain(r, { from: "C", to: "A", date: "20261020" });
  assert.equal(back.status, "none");
  assert.equal(back.journeys.length, 0);
  assert.equal(back.provenance.times.confidence, "unknown");
});

test("運行日の違い：土曜は土曜の便だけ、平日の深夜便（金曜の 25:30）は土曜の始発に入らない", async () => {
  const r = await router();
  const sat = firstTrain(r, { from: "A", to: "B", date: "20261024" });
  assert.deepEqual(trips(sat.journeys[0]), ["s0700"]);
  const satLast = lastTrain(r, { from: "A", to: "B", date: "20261024" });
  assert.deepEqual(trips(satLast.journeys[0]), ["s0700"]);
  // 土曜に B→C の便は無い
  assert.equal(lastTrain(r, { from: "A", to: "C", date: "20261024" }).status, "none");
  // calendar_dates で明示された運行日は確
  const added = firstTrain(r, { from: "A", to: "B", date: "20261101" });
  assert.equal(added.status, "ok");
  assert.equal(added.provenance.serviceDay.confidence, "confirmed");
});

test("便なし：運行日に便が無い・時刻表が空なら『該当なし』", async () => {
  const r = await router();
  for (const fn of [firstTrain, lastTrain]) {
    const res = fn(r, { from: "A", to: "B", date: "20261025" });
    assert.equal(res.status, "none");
    assert.match(res.reason!, /便が無い/);
    assert.equal(res.journeys.length, 0);
    assert.equal(res.provenance.serviceDay.confidence, "unknown");
  }
  const empty = await router({ ...feed, trips: [] });
  for (const fn of [firstTrain, lastTrain]) assert.equal(fn(empty, { from: "A", to: "B", date: "20261020" }).status, "none");
});

test("画面へのアダプタ：mode first / last で始発・終電、該当なしは error と空の journeys", async () => {
  const r = await router();
  const p = createCoreProvider(r, { feed: { id: "synthetic", version: null, license: null, attribution: null } });
  const f = await p.route({ from: "A", to: "B", mode: "first", time: "2026-10-21" });
  assert.equal(f.journeys[0].departureIso, "2026-10-21T05:00:00");
  assert.equal(f.firstLast?.dayStart?.confidence, "inferred");
  const l = await p.route({ from: "A", to: "C", mode: "last", time: "2026-10-20T10:00:00+09:00" });
  assert.equal(l.journeys[0].departure, H(23));
  const n = await p.route({ from: "A", to: "B", mode: "last", time: "2026-10-25" });
  assert.equal(n.journeys.length, 0);
  assert.match(n.error!, /該当なし/);
});

test("性質：乱数の網で、終電の出発で前向きに出れば着き、1 分遅れると同じ運行日の便では着けない（乗り換え上限なし相当）", async () => {
  const { writeRandomFeed, rng } = await import("./helpers.js");
  const { dir, stopIds } = await writeRandomFeed({ stops: 60, trips: 2400, seed: 11, routeLen: [4, 10] });
  const r = new Router(new Network(await loadGtfs(dir)));
  const rand = rng(5);
  let checked = 0;
  for (let n = 0; n < 2000 && checked < 25; n++) {
    const a = stopIds[Math.floor(rand() * stopIds.length)];
    const b = stopIds[Math.floor(rand() * stopIds.length)];
    if (a === b) continue;
    const res = lastTrain(r, { from: a, to: b, date: "20261019", maxTransfers: 8 });
    if (res.status !== "ok") continue;
    const j = res.journeys[res.journeys.length - 1]; // 最も遅い出発
    const first = j.legs[0];
    // 先頭の乗車の余裕（boardSlack）は 0 の手段だけを試す網なので、出発時刻＝そこにいればよい時刻
    if (first.type === "transit" && first.mode === "air") continue;
    assert.equal(firstTrain(r, { from: a, to: b, date: "20261019", dayStart: j.departure, maxTransfers: 8 }).status, "ok", `${a}→${b}`);
    assert.equal(firstTrain(r, { from: a, to: b, date: "20261019", dayStart: j.departure + 60, maxTransfers: 8 }).status, "none", `${a}→${b} +60`);
    checked++;
  }
  assert.ok(checked >= 25, `確かめた問いが少ない: ${checked}`);
});
