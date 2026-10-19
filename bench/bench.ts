// (c) 性能の計測：乱数の大きな合成網（既定 駅 3,000・便 50,000）。
//   node dist/bench/bench.js [駅の数] [便の数] [問い合わせの数]
// 目標は決めず、参考値として記録する。
import { loadGtfs } from "../src/gtfs/load.js";
import { Network } from "../src/network.js";
import { Router } from "../src/raptor.js";
import { writeRandomFeed, rng } from "../test/helpers.js";
import { statSync } from "node:fs";
import { join } from "node:path";

const S = Number(process.argv[2] ?? 3000);
const TR = Number(process.argv[3] ?? 50000);
const Q = Number(process.argv[4] ?? 200);
const DATE = "20261019";

const ms = (t: bigint) => Number(t) / 1e6;
const now = () => process.hrtime.bigint();

let t = now();
const { dir, stopIds } = await writeRandomFeed({ stops: S, trips: TR, seed: 42 });
const genMs = ms(now() - t);
const stSize = statSync(join(dir, "stop_times.txt")).size;

t = now();
const feed = await loadGtfs(dir);
const loadMs = ms(now() - t);
t = now();
const net = new Network(feed);
const netMs = ms(now() - t);
t = now();
net.day(DATE);
const dayMs = ms(now() - t);
const router = new Router(net);

const R = rng(9);
const times: number[] = [];
let found = 0;
let transfersSum = 0;
for (let i = 0; i < Q; i++) {
  const a = stopIds[Math.floor(R() * S)];
  const b = stopIds[Math.floor(R() * S)];
  const dep = 6 * 3600 + Math.floor(R() * 14 * 3600);
  const t0 = now();
  const js = router.depart({ from: a, to: b, date: DATE, time: dep, maxTransfers: 6 });
  times.push(ms(now() - t0));
  if (js.length) {
    found++;
    transfersSum += js[js.length - 1].transfers;
  }
}
times.sort((x, y) => x - y);
const pct = (p: number) => times[Math.min(times.length - 1, Math.floor((p / 100) * times.length))];
const mem = process.memoryUsage();
const result = {
  node: process.version,
  stops: feed.stops.length,
  trips: feed.trips.length,
  stopTimes: feed.stStop.length,
  stopTimesFileMB: +(stSize / 1e6).toFixed(1),
  patterns: net.patterns.length,
  footpaths: net.fpTo.length,
  generateMs: Math.round(genMs),
  loadMs: Math.round(loadMs),
  buildNetworkMs: Math.round(netMs),
  buildDayMs: Math.round(dayMs),
  queries: Q,
  found,
  avgTransfersOfFastest: found ? +(transfersSum / found).toFixed(2) : null,
  queryMs: { p50: +pct(50).toFixed(2), p90: +pct(90).toFixed(2), p99: +pct(99).toFixed(2), max: +times[times.length - 1].toFixed(2), mean: +(times.reduce((x, y) => x + y, 0) / times.length).toFixed(2) },
  heapUsedMB: Math.round(mem.heapUsed / 1e6),
  rssMB: Math.round(mem.rss / 1e6),
};
console.log(JSON.stringify(result, null, 2));
