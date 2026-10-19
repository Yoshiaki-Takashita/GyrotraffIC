#!/usr/bin/env node
// 小さな CLI。
//   gyrotraffic route --gtfs <dir> --from <stop_id> --to <stop_id> --depart <ISO日時> [--arrive-by <ISO日時>] [--max-transfers N] [--json]
//   gyrotraffic run-cases --gtfs <dir> --cases <cases.json> [--out results.json]
//   gyrotraffic compare <a.json> <b.json> [--tolerance 秒]
import { readFileSync, writeFileSync } from "node:fs";
import { loadGtfs } from "./gtfs/load.js";
import { Network } from "./network.js";
import { Router } from "./raptor.js";
import { isoToServiceTime } from "./time.js";
import type { Journey } from "./journey.js";
import { compareResults, journeyToItinerary, RESULTS_FORMAT, type CaseFile, type ResultFile } from "./validation.js";

function parseArgs(argv: string[]): { cmd: string; pos: string[]; opt: Record<string, string | boolean> } {
  const [cmd = "", ...rest] = argv;
  const pos: string[] = [];
  const opt: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = rest[i + 1];
      if (v === undefined || v.startsWith("--")) opt[k] = true;
      else {
        opt[k] = v;
        i++;
      }
    } else pos.push(a);
  }
  return { cmd, pos, opt };
}

const USAGE = `使い方:
  gyrotraffic route --gtfs <dir> --from <stop_id> --to <stop_id> --depart <ISO日時> [--max-transfers N] [--json]
  gyrotraffic route --gtfs <dir> --from <stop_id> --to <stop_id> --arrive-by <ISO日時> [--json]
  gyrotraffic run-cases --gtfs <dir> --cases <cases.json> [--out results.json]
  gyrotraffic compare <a.json> <b.json> [--tolerance 秒]`;

function printJourney(j: Journey, n: number) {
  const mins = Math.round((j.arrival - j.departure) / 60);
  console.log(`\n案 ${n}: ${j.departureIso} 発 → ${j.arrivalIso} 着（${mins} 分・乗り換え ${j.transfers} 回）`);
  for (const l of j.legs) {
    if (l.type === "transit") {
      console.log(`  [${l.mode}] ${l.routeName || l.routeId}${l.headsign ? `（${l.headsign} 行き）` : ""}  ${l.departureIso.slice(11, 16)} ${l.from.name}(${l.from.stopId}) → ${l.arrivalIso.slice(11, 16)} ${l.to.name}(${l.to.stopId})`);
    } else if (l.source === "change") {
      console.log(`  [乗換] ${l.from.name} で ${Math.round(l.duration / 60)} 分`);
    } else {
      console.log(`  [徒歩] ${l.from.name} → ${l.to.name}  ${Math.max(1, Math.round(l.duration / 60))} 分（${l.source}）`);
    }
  }
}

async function build(dir: string) {
  const feed = await loadGtfs(dir);
  const net = new Network(feed);
  return { feed, net, router: new Router(net) };
}

async function main() {
  const { cmd, pos, opt } = parseArgs(process.argv.slice(2));
  if (cmd === "route") {
    const gtfs = opt.gtfs as string;
    const from = opt.from as string;
    const to = opt.to as string;
    if (!gtfs || !from || !to || (!opt.depart && !opt["arrive-by"])) throw new Error(USAGE);
    const { feed, router } = await build(gtfs);
    const maxTransfers = opt["max-transfers"] ? Number(opt["max-transfers"]) : undefined;
    const t0 = Date.now();
    let js: Journey[];
    if (opt["arrive-by"]) {
      const st = isoToServiceTime(opt["arrive-by"] as string, feed.timezone);
      js = router.arriveBy({ from, to, date: st.date, arriveBy: st.time, maxTransfers });
    } else {
      const st = isoToServiceTime(opt.depart as string, feed.timezone);
      js = router.depart({ from, to, date: st.date, time: st.time, maxTransfers });
    }
    const ms = Date.now() - t0;
    if (opt.json) {
      console.log(JSON.stringify({ journeys: js, searchMs: ms }, null, 2));
    } else {
      if (js.length === 0) console.log("経路が見つかりませんでした。");
      js.forEach((j, i) => printJourney(j, i + 1));
      console.log(`\n（探索 ${ms} ms・時刻は ${feed.timezone} の現地時刻）`);
    }
    return;
  }
  if (cmd === "run-cases") {
    const gtfs = opt.gtfs as string;
    const casesPath = opt.cases as string;
    if (!gtfs || !casesPath) throw new Error(USAGE);
    const cf = JSON.parse(readFileSync(casesPath, "utf8")) as CaseFile;
    const { feed, router } = await build(gtfs);
    const tz = cf.timezone || feed.timezone;
    const out: ResultFile = { format: RESULTS_FORMAT, engine: "gyrotraffic", createdAt: new Date().toISOString(), results: [] };
    for (const c of cf.cases) {
      try {
        let js: Journey[];
        if (c.arriveBy) {
          const st = isoToServiceTime(c.arriveBy, tz);
          js = router.arriveBy({ from: c.from, to: c.to, date: st.date, arriveBy: st.time, maxTransfers: c.maxTransfers });
        } else {
          const st = isoToServiceTime(c.depart!, tz);
          js = router.depart({ from: c.from, to: c.to, date: st.date, time: st.time, maxTransfers: c.maxTransfers });
        }
        out.results.push({ id: c.id, itineraries: js.map(journeyToItinerary) });
      } catch (e) {
        out.results.push({ id: c.id, error: String((e as Error).message), itineraries: [] });
      }
    }
    const text = JSON.stringify(out, null, 2);
    if (opt.out) writeFileSync(opt.out as string, text);
    else console.log(text);
    return;
  }
  if (cmd === "compare") {
    if (pos.length < 2) throw new Error(USAGE);
    const a = JSON.parse(readFileSync(pos[0], "utf8")) as ResultFile;
    const b = JSON.parse(readFileSync(pos[1], "utf8")) as ResultFile;
    const rows = compareResults(a, b, opt.tolerance ? Number(opt.tolerance) : 300);
    for (const r of rows) console.log(`${r.status.padEnd(7)} ${r.id}  ${r.note}`);
    const bad = rows.filter((r) => r.status !== "match").length;
    console.log(`\n一致 ${rows.length - bad} / ${rows.length}`);
    process.exitCode = bad ? 1 : 0;
    return;
  }
  console.log(USAGE);
  process.exitCode = cmd ? 1 : 0;
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
