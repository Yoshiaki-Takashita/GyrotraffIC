// (d) 外部の依存・通信が無いこと／CSV・時刻・照合の部品。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { readCsvRows } from "../src/gtfs/csv.js";
import { parseGtfsTime, isoToServiceTime, serviceTimeToLocalIso } from "../src/time.js";
import { compareResults, otpPlanToItineraries, RESULTS_FORMAT, type ResultFile } from "../src/validation.js";
import { writeMiniFeed } from "./helpers.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("実行時の依存が無い（package.json の dependencies が空）", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}), []);
  for (const d of Object.keys(pkg.devDependencies ?? {})) assert.ok(["typescript", "@types/node"].includes(d), `想定外の開発用依存: ${d}`);
});

test("src は通信の部品を使わず、node: の標準以外を読み込まない", () => {
  const files = readdirSync(join(root, "src"), { recursive: true }) as string[];
  for (const f of files.filter((x) => x.endsWith(".ts"))) {
    const text = readFileSync(join(root, "src", f), "utf8");
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket/.test(text), `${f} に通信の呼び出し`);
    for (const m of text.matchAll(/from\s+"([^"]+)"/g)) {
      const mod = m[1];
      assert.ok(mod.startsWith(".") || mod.startsWith("node:"), `${f}: 外部モジュール ${mod}`);
      assert.ok(!["node:http", "node:https", "node:net", "node:dgram", "node:tls", "node:dns", "node:http2"].includes(mod), `${f}: 通信の部品 ${mod}`);
    }
  }
});

test("CSV：引用符・中の改行とカンマ・二重引用符・BOM・CRLF", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gyro-csv-"));
  const p = join(dir, "a.txt");
  writeFileSync(p, '﻿a,b,c\r\n1,"東京, 駅","改\n行"\r\n2,"say ""hi""",\r\n\r\n3,x,y');
  const rows: string[][] = [];
  for await (const r of readCsvRows(p)) rows.push(r);
  assert.deepEqual(rows, [
    ["a", "b", "c"],
    ["1", "東京, 駅", "改\n行"],
    ["2", 'say "hi"', ""],
    ["3", "x", "y"],
  ]);
});

test("時刻：24 時超え・ISO と時差", () => {
  assert.equal(parseGtfsTime("25:10:00"), 25 * 3600 + 600);
  assert.ok(Number.isNaN(parseGtfsTime("")));
  assert.deepEqual(isoToServiceTime("2026-10-19T08:30:00+09:00", "Asia/Tokyo"), { date: "20261019", time: 8.5 * 3600 });
  assert.deepEqual(isoToServiceTime("2026-10-18T23:30:00Z", "Asia/Tokyo"), { date: "20261019", time: 8.5 * 3600 });
  assert.deepEqual(isoToServiceTime("2026-10-19T08:30", "Asia/Tokyo"), { date: "20261019", time: 8.5 * 3600 });
  assert.equal(serviceTimeToLocalIso("20261019", 25 * 3600), "2026-10-20T01:00:00");
});

test("照合：結果の比較と OTP の応答の変換（雛形）", () => {
  const mk = (engine: string, arr: string, tr: number): ResultFile => ({
    format: RESULTS_FORMAT,
    engine,
    createdAt: "",
    results: [{ id: "c1", itineraries: [{ departure: "2026-10-19T08:00:00", arrival: arr, transfers: tr, legs: [] }] }],
  });
  assert.equal(compareResults(mk("a", "2026-10-19T08:30:00", 1), mk("b", "2026-10-19T08:33:00", 1))[0].status, "match");
  assert.equal(compareResults(mk("a", "2026-10-19T08:30:00", 1), mk("b", "2026-10-19T08:40:00", 1))[0].status, "diff");
  const its = otpPlanToItineraries(
    {
      data: {
        plan: {
          itineraries: [
            {
              startTime: Date.parse("2026-10-18T23:00:00Z"),
              endTime: Date.parse("2026-10-18T23:30:00Z"),
              legs: [
                { mode: "WALK", startTime: 0, endTime: 0 },
                { mode: "RAIL", startTime: Date.parse("2026-10-18T23:05:00Z"), endTime: Date.parse("2026-10-18T23:30:00Z"), route: { gtfsId: "1:RA" }, from: { stop: { gtfsId: "1:A1" } }, to: { stop: { gtfsId: "1:A4" } } },
              ],
            },
          ],
        },
      },
    },
    "Asia/Tokyo",
  );
  assert.equal(its[0].arrival, "2026-10-19T08:30:00");
  assert.equal(its[0].transfers, 0);
  assert.equal(its[0].legs[0].routeId, "RA");
});

test("CLI：route と run-cases が動く", () => {
  const dir = writeMiniFeed({
    stops: [{ id: "P", name: "東京" }, { id: "Q", name: "新橋" }],
    routes: [{ id: "L", name: "山手", type: 2 }],
    trips: [{ id: "t", route: "L", service: "S", headsign: "品川", times: [["P", "08:00:00"], ["Q", "08:03:00"]] }],
    calendar: [{ id: "S", days: "1111111", start: "20260101", end: "20271231" }],
    transfers: [],
  });
  const cli = join(root, "dist", "src", "cli.js");
  const out = execFileSync(process.execPath, [cli, "route", "--gtfs", dir, "--from", "P", "--to", "Q", "--depart", "2026-10-19T07:55:00+09:00"], { encoding: "utf8" });
  assert.match(out, /08:00 東京\(P\) → 08:03 新橋\(Q\)/);
  const cases = join(dir, "cases.json");
  writeFileSync(cases, JSON.stringify({ format: "gyrotraffic-cases/1", gtfs: "mini", timezone: "Asia/Tokyo", cases: [{ id: "c1", from: "P", to: "Q", depart: "2026-10-19T07:55:00+09:00" }] }));
  const res = JSON.parse(execFileSync(process.execPath, [cli, "run-cases", "--gtfs", dir, "--cases", cases], { encoding: "utf8" }));
  assert.equal(res.results[0].itineraries[0].arrival, "2026-10-19T08:03:00");
});
