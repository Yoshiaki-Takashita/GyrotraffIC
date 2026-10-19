// (b) 性質の試験。乱数の中くらいの網で、多くの問い合わせについて性質が成り立つかを見る。
// あわせて、別の方式（接続走査＝CSA の素朴な実装）で求めた最早到着と一致するかも確かめる。
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGtfs } from "../src/gtfs/load.js";
import { Network } from "../src/network.js";
import { Router } from "../src/raptor.js";
import { INF } from "../src/time.js";
import type { TransitLeg } from "../src/journey.js";
import { rng, writeRandomFeed } from "./helpers.js";

const DATE = "20261019";

const setup = (async () => {
  const { dir, stopIds } = await writeRandomFeed({ stops: 300, trips: 3000, seed: 7, routeLen: [5, 15] });
  const net = new Network(await loadGtfs(dir));
  return { net, router: new Router(net), stopIds };
})();

/** 素朴な接続走査（乗り換え回数の制限なし）。RAPTOR と同じ規則：最初と乗車後に 1 回だけ歩ける */
function csaEarliest(net: Network, from: number, to: number, t0: number): number {
  const days = net.day(DATE);
  const conns: [number, number, number, number, number, number][] = []; // dep, arr, a, b, 便の通し番号, 位置
  let tripId = 0;
  const pickupOk: boolean[] = [];
  const dropOk: boolean[] = [];
  net.patterns.forEach((p, pi) => {
    const pd = days[pi];
    const L = p.stops.length;
    for (let j = 0; j < pd.n; j++) {
      for (let i = 0; i + 1 < L; i++) {
        conns.push([pd.dep[j * L + i], pd.arr[j * L + i + 1], p.stops[i], p.stops[i + 1], tripId, pickupOk.length]);
        pickupOk.push(!p.noPickup[i]);
        dropOk.push(!p.noDropOff[i + 1]);
      }
      tripId++;
    }
  });
  conns.sort((x, y) => x[0] - y[0]);
  const S = net.feed.stops.length;
  const board = new Float64Array(S).fill(Infinity);
  let target = Infinity;
  board[from] = t0;
  if (from === to) return t0;
  for (let e = net.fpStart[from]; e < net.fpStart[from + 1]; e++) {
    board[net.fpTo[e]] = Math.min(board[net.fpTo[e]], t0 + net.fpDur[e]);
    if (net.fpTo[e] === to) target = Math.min(target, t0 + net.fpDur[e]);
  }
  const onTrip = new Uint8Array(tripId);
  for (const [d, a, s, b, t, ci] of conns) {
    if (d >= target) break;
    if (!onTrip[t] && pickupOk[ci] && board[s] <= d) onTrip[t] = 1;
    if (!onTrip[t] || !dropOk[ci]) continue;
    if (b === to) target = Math.min(target, a);
    const ab = a + net.selfChange[b];
    if (ab < board[b]) board[b] = ab;
    for (let e = net.fpStart[b]; e < net.fpStart[b + 1]; e++) {
      const w = a + net.fpDur[e];
      if (w < board[net.fpTo[e]]) board[net.fpTo[e]] = w;
      if (net.fpTo[e] === to) target = Math.min(target, w);
    }
  }
  return target;
}

function queries(n: number, S: number, seed: number) {
  const R = rng(seed);
  const out: { from: number; to: number; t: number }[] = [];
  while (out.length < n) {
    const from = Math.floor(R() * S);
    const to = Math.floor(R() * S);
    if (from !== to) out.push({ from, to, t: 5 * 3600 + Math.floor(R() * 16 * 3600) });
  }
  return out;
}

test("最早到着が接続走査（CSA）と一致する（乗り換え上限を大きくしたとき）", async () => {
  const { net, router, stopIds } = await setup;
  let found = 0;
  for (const q of queries(150, stopIds.length, 1)) {
    const js = router.depart({ from: stopIds[q.from], to: stopIds[q.to], date: DATE, time: q.t, maxTransfers: 30 });
    const r = js.length ? Math.min(...js.map((j) => j.arrival)) : INF;
    const c = csaEarliest(net, q.from, q.to, q.t);
    assert.equal(r === INF ? Infinity : r, c, `${stopIds[q.from]}→${stopIds[q.to]} @${q.t}`);
    if (js.length) found++;
  }
  assert.ok(found > 50, `経路が見つかった数が少なすぎる: ${found}`);
});

test("出発を遅らせても、到着は早くならない", async () => {
  const { router, stopIds } = await setup;
  for (const q of queries(80, stopIds.length, 2)) {
    const a = router.depart({ from: stopIds[q.from], to: stopIds[q.to], date: DATE, time: q.t });
    const b = router.depart({ from: stopIds[q.from], to: stopIds[q.to], date: DATE, time: q.t + 900 });
    const ea = a.length ? Math.min(...a.map((j) => j.arrival)) : INF;
    const eb = b.length ? Math.min(...b.map((j) => j.arrival)) : INF;
    assert.ok(eb >= ea, `${q.from}→${q.to}: ${ea} → ${eb}`);
  }
});

test("乗り換え回数の上限が効き、上限を上げても最早到着は遅くならない", async () => {
  const { router, stopIds } = await setup;
  for (const q of queries(60, stopIds.length, 3)) {
    let prev = INF;
    for (const k of [0, 1, 2, 4]) {
      const js = router.depart({ from: stopIds[q.from], to: stopIds[q.to], date: DATE, time: q.t, maxTransfers: k });
      for (const j of js) assert.ok(j.transfers <= k);
      const e = js.length ? Math.min(...js.map((j) => j.arrival)) : INF;
      assert.ok(e <= prev);
      prev = e;
    }
  }
});

test("パレート：乗り換えが増えるほど到着は真に早い／経路の時刻と駅がつながっている", async () => {
  const { router, stopIds, net } = await setup;
  for (const q of queries(80, stopIds.length, 4)) {
    const js = router.depart({ from: stopIds[q.from], to: stopIds[q.to], date: DATE, time: q.t });
    for (let i = 1; i < js.length; i++) {
      assert.ok(js[i].transfers > js[i - 1].transfers);
      assert.ok(js[i].arrival < js[i - 1].arrival);
    }
    for (const j of js) {
      let t = q.t;
      let at = stopIds[q.from];
      for (const l of j.legs) {
        assert.equal(l.from.stopId, at, "区間がつながっていない");
        if (l.type === "transit") {
          assert.ok(l.departure >= t, "前の区間より前に出発している");
          assert.ok(l.arrival >= l.departure);
          t = l.arrival;
        } else {
          t += l.duration;
        }
        at = l.to.stopId;
      }
      assert.equal(at, stopIds[q.to]);
      assert.equal(t, j.arrival);
      assert.equal(j.transfers, Math.max(0, j.legs.filter((l): l is TransitLeg => l.type === "transit").length - 1));
    }
  }
  assert.ok(net.patterns.length > 0);
});

test("到着時刻の指定：結果は期限内で、期限の 1 分後の出発では間に合わない", async () => {
  const { router, stopIds } = await setup;
  let checked = 0;
  for (const q of queries(40, stopIds.length, 5)) {
    const deadline = q.t + 2 * 3600;
    const js = router.arriveBy({ from: stopIds[q.from], to: stopIds[q.to], date: DATE, arriveBy: deadline, maxTransfers: 3 });
    if (!js.length) continue;
    checked++;
    for (const j of js) assert.ok(j.arrival <= deadline);
    const latest = Math.max(...js.map((j) => j.departure));
    const later = router.depart({ from: stopIds[q.from], to: stopIds[q.to], date: DATE, time: latest + 61, maxTransfers: 3 });
    assert.ok(later.every((j) => j.arrival > deadline), `${q.from}→${q.to}: より遅い出発でも間に合う`);
  }
  assert.ok(checked > 5);
});
