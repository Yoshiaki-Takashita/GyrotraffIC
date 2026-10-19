// (a) 手で答えの分かる小さな路線網。
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGtfs } from "../src/gtfs/load.js";
import { Network } from "../src/network.js";
import { Router } from "../src/raptor.js";
import { parseGtfsTime as T, DAY } from "../src/time.js";
import type { TransitLeg } from "../src/journey.js";
import { writeMiniFeed, type MiniFeed } from "./helpers.js";

// 2026-10-19 は月曜。
const MON = "20261019";
const TUE = "20261020";
const WED = "20261021"; // 臨時ダイヤの日（平日ダイヤを止め、特別ダイヤを足す）
const SAT = "20261024";

function line(id: string, route: string, service: string, stops: string[], start: string, step = 5): MiniFeed["trips"][number] {
  const t0 = T(start);
  return { id, route, service, headsign: stops[stops.length - 1], times: stops.map((s, i) => [s, fmt(t0 + i * step * 60)] as [string, string]) };
}
function fmt(t: number) {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

const A = ["A1", "A2", "XA", "A3", "A4"];
const B = ["B1", "XB", "B2", "Y", "B3"];
const feed: MiniFeed = {
  stops: [
    { id: "A1", name: "青山一丁目" },
    { id: "A2", name: "赤坂" },
    { id: "X", name: "交差駅", locationType: 1 },
    { id: "XA", name: "交差駅 A線ホーム", parent: "X" },
    { id: "XB", name: "交差駅 B線ホーム", parent: "X" },
    { id: "A3", name: "芝" },
    { id: "A4", name: "品川口" },
    { id: "B1", name: "北" },
    { id: "B2", name: "芝東" },
    { id: "Y", name: "谷" },
    { id: "B3", name: "南" },
    { id: "D1", name: "夜1" },
    { id: "DM", name: "夜中" },
    { id: "D2", name: "夜2" },
  ],
  routes: [
    { id: "RA", name: "A線", type: 2 },
    { id: "RB", name: "B線", type: 1 },
    { id: "RF", name: "直通バス", type: 3 },
    { id: "RD", name: "深夜線", type: 2 },
  ],
  trips: [
    line("A0700", "RA", "WD", A, "07:00:00"),
    line("A0730", "RA", "WD", A, "07:30:00"),
    line("A0800", "RA", "WD", A, "08:00:00"),
    line("A2330", "RA", "WD", A, "23:30:00"),
    line("AH0900", "RA", "HOL", A, "09:00:00"),
    line("AW1000", "RA", "WE", A, "10:00:00"),
    ...["07:10", "07:25", "07:40", "07:55", "08:10"].map((t) => line("B" + t.replace(":", ""), "RB", "WD", B, t + ":00")),
    { id: "F0700", route: "RF", service: "WD", headsign: "南", times: [["A1", "07:00:00"], ["B3", "08:30:00"]] },
    { id: "D2350", route: "RD", service: "WD", times: [["D1", "23:50:00"], ["DM", "24:10:00"], ["D2", "24:20:00"]] },
  ],
  calendar: [
    { id: "WD", days: "1111100", start: "20260101", end: "20271231" },
    { id: "WE", days: "0000011", start: "20260101", end: "20271231" },
    { id: "HOL", days: "0000000", start: "20260101", end: "20271231" },
  ],
  calendarDates: [
    { id: "WD", date: WED, type: 2 },
    { id: "HOL", date: WED, type: 1 },
  ],
  transfers: [
    { from: "A3", to: "B2", type: 2, min: 120 }, // 近くの駅への徒歩
    { from: "XA", to: "XB", type: 2, min: 360 }, // 同じ駅の別ホーム（構内が長い）
    { from: "XB", to: "XA", type: 2, min: 360 },
  ],
};

const dirP = (async () => {
  const dir = writeMiniFeed(feed);
  const f = await loadGtfs(dir);
  return new Router(new Network(f));
})();

const transit = (j: { legs: { type: string }[] }) => j.legs.filter((l): l is TransitLeg => l.type === "transit");

test("日本語の名前・駅（parent_station）・BOM/CRLF を読める", async () => {
  const r = await dirP;
  const f = r.net.feed;
  assert.equal(f.stops[f.stopIndex.get("A1")!].name, "青山一丁目");
  assert.deepEqual(r.net.children.get("X")!.map((i) => f.stops[i].id).sort(), ["XA", "XB"]);
  assert.equal(f.timezone, "Asia/Tokyo");
});

test("最速は徒歩乗り換え（A3→B2）・乗り換えなしの直通バスもパレート案として出る", async () => {
  const r = await dirP;
  const js = r.depart({ from: "A1", to: "B3", date: MON, time: T("06:55:00") });
  assert.equal(js.length, 2);
  // 乗り換えの少ない順
  assert.equal(js[0].transfers, 0);
  assert.equal(js[0].arrival, T("08:30:00"));
  assert.equal(transit(js[0])[0].routeId, "RF");
  assert.equal(js[1].transfers, 1);
  assert.equal(js[1].arrival, T("07:30:00"));
  const legs = js[1].legs;
  assert.deepEqual(
    legs.map((l) => (l.type === "transit" ? `${l.routeId}:${l.from.stopId}-${l.to.stopId}` : `walk:${l.from.stopId}-${l.to.stopId}`)),
    ["RA:A1-A3", "walk:A3-B2", "RB:B2-B3"],
  );
  const t1 = transit(js[1]);
  assert.equal(t1[0].departure, T("07:00:00"));
  assert.equal(t1[1].departure, T("07:20:00"));
  assert.equal(t1[0].routeName, "A線");
  assert.equal(t1[1].from.name, "芝東");
});

test("乗り換え回数の上限 0 なら直通バスだけ", async () => {
  const r = await dirP;
  const js = r.depart({ from: "A1", to: "B3", date: MON, time: T("06:55:00"), maxTransfers: 0 });
  assert.equal(js.length, 1);
  assert.equal(transit(js[0])[0].routeId, "RF");
});

test("同じ駅の別ホーム：駅 ID で指定でき、構内の乗り換え時間（360 秒）が効く", async () => {
  const r = await dirP;
  // X 駅（XA/XB どちらでも）から B3 へ 07:14：XB を 07:15 に出る便に乗れる
  const js = r.depart({ from: "X", to: "B3", date: MON, time: T("07:14:00") });
  assert.equal(js[0].arrival, T("07:30:00"));
  assert.equal(js[0].transfers, 0);
  // A 線から B 線へ X で乗り換えると 360 秒かかる：A1 07:30 → XA 07:40 → XB 07:46 以降 → 08:00 発 → B3 08:15
  // A3 経由の徒歩：A3 07:45 → B2 07:47 → 07:50（B1 07:40 の便）→ B3 08:00。徒歩のほうが早い。
  const js2 = r.depart({ from: "A1", to: "B3", date: MON, time: T("07:30:00"), maxTransfers: 1 });
  const fast = js2[js2.length - 1];
  assert.equal(fast.arrival, T("08:00:00"));
});

test("終電：23:20 なら 23:30 発に乗れる。23:40 なら翌朝の始発", async () => {
  const r = await dirP;
  const a = r.depart({ from: "A1", to: "A4", date: MON, time: T("23:20:00") });
  assert.equal(a[0].arrival, T("23:50:00"));
  const b = r.depart({ from: "A1", to: "A4", date: MON, time: T("23:40:00") });
  assert.equal(b[0].arrival, DAY + T("07:20:00"));
  assert.match(b[0].arrivalIso, /^2026-10-20T07:20:00$/);
});

test("日またぎ：前日 23:50 発の便に、翌日 0:00 の問い合わせで途中駅から乗れる", async () => {
  const r = await dirP;
  const js = r.depart({ from: "DM", to: "D2", date: TUE, time: T("00:00:00") });
  assert.equal(js.length, 1);
  assert.equal(js[0].arrival, T("00:20:00"));
  assert.equal(transit(js[0])[0].tripId, "D2350");
  assert.equal(js[0].arrivalIso, "2026-10-20T00:20:00");
  // 当日の便としては 24:10 → 24:20
  const js2 = r.depart({ from: "D1", to: "D2", date: MON, time: T("23:00:00") });
  assert.equal(js2[0].arrival, T("24:20:00"));
  assert.equal(js2[0].arrivalIso, "2026-10-20T00:20:00");
});

test("運行日の例外：水曜は平日ダイヤが止まり、特別ダイヤ（9:00）だけ。土曜は休日ダイヤ", async () => {
  const r = await dirP;
  const w = r.depart({ from: "A1", to: "A4", date: WED, time: T("07:00:00") });
  assert.equal(w[0].arrival, T("09:20:00"));
  assert.equal(transit(w[0])[0].tripId, "AH0900");
  const s = r.depart({ from: "A1", to: "A4", date: SAT, time: T("07:00:00") });
  assert.equal(transit(s[0])[0].tripId, "AW1000");
});

test("到着時刻の指定：08:00 までに B3 に着く最も遅い出発", async () => {
  const r = await dirP;
  const js = r.arriveBy({ from: "A1", to: "B3", date: MON, arriveBy: T("08:00:00") });
  assert.ok(js.length >= 1);
  for (const j of js) assert.ok(j.arrival <= T("08:00:00"));
  const latest = js[js.length - 1];
  assert.equal(transit(latest)[0].departure, T("07:30:00"));
  // 乗り換えなしでは直通バス（8:30 着）しかないので、乗り換え 0 回の案は出ない
  assert.ok(js.every((j) => j.transfers >= 1));
});

test("乗れない・降りられない停車（pickup_type / drop_off_type = 1）を守る", async () => {
  const dir = writeMiniFeed({
    stops: [{ id: "P" }, { id: "Q" }, { id: "R" }],
    routes: [{ id: "L", type: 3 }],
    trips: [{ id: "t1", route: "L", service: "S", times: [["P", "08:00:00"], ["Q", "08:10:00"], ["R", "08:20:00"]], noDropOff: ["Q"], noPickup: ["R"] }],
    calendar: [{ id: "S", days: "1111111", start: "20260101", end: "20271231" }],
    transfers: [],
  });
  const r = new Router(new Network(await loadGtfs(dir)));
  assert.equal(r.depart({ from: "P", to: "Q", date: MON, time: T("07:00:00") }).length, 0);
  assert.equal(r.depart({ from: "P", to: "R", date: MON, time: T("07:00:00") })[0].arrival, T("08:20:00"));
});

test("transfers.txt が無ければ、直線距離＋歩く速さで徒歩乗り換えを作る", async () => {
  // P2 と Q1 は約 111 m 離れている → 111×1.3/1.2 ≒ 120 秒
  const dir = writeMiniFeed({
    stops: [
      { id: "P1", lat: 35.0, lon: 139.0 },
      { id: "P2", lat: 35.01, lon: 139.0 },
      { id: "Q1", lat: 35.011, lon: 139.0 },
      { id: "Q2", lat: 35.02, lon: 139.0 },
    ],
    routes: [
      { id: "P", type: 2 },
      { id: "Q", type: 2 },
    ],
    trips: [
      { id: "p", route: "P", service: "S", times: [["P1", "08:00:00"], ["P2", "08:10:00"]] },
      { id: "q1", route: "Q", service: "S", times: [["Q1", "08:11:00"], ["Q2", "08:20:00"]] },
      { id: "q2", route: "Q", service: "S", times: [["Q1", "08:13:00"], ["Q2", "08:22:00"]] },
    ],
    calendar: [{ id: "S", days: "1111111", start: "20260101", end: "20271231" }],
  });
  const r = new Router(new Network(await loadGtfs(dir)));
  const js = r.depart({ from: "P1", to: "Q2", date: MON, time: T("07:00:00") });
  assert.equal(js[0].arrival, T("08:22:00"));
  const walk = js[0].legs.find((l) => l.type === "walk");
  assert.ok(walk && walk.type === "walk" && walk.source === "geo" && walk.duration > 100 && walk.duration < 140);
});

test("時刻の無い停車（時刻点でない）を補間し、追い越す便はパターンを分ける", async () => {
  const dir = writeMiniFeed({
    stops: [{ id: "S1" }, { id: "S2" }, { id: "S3" }],
    routes: [{ id: "L", type: 2 }],
    trips: [
      { id: "local", route: "L", service: "S", times: [["S1", "08:00:00"], ["S2", ""], ["S3", "08:40:00"]] },
      { id: "express", route: "L", service: "S", times: [["S1", "08:05:00"], ["S2", "08:10:00"], ["S3", "08:15:00"]] },
    ],
    calendar: [{ id: "S", days: "1111111", start: "20260101", end: "20271231" }],
    transfers: [],
  });
  const net = new Network(await loadGtfs(dir));
  assert.equal(net.patterns.length, 2);
  const r = new Router(net);
  const js = r.depart({ from: "S1", to: "S3", date: MON, time: T("07:59:00") });
  assert.equal(js[0].arrival, T("08:15:00"));
  const js2 = r.depart({ from: "S1", to: "S2", date: MON, time: T("07:00:00") });
  assert.equal(js2[0].arrival, T("08:10:00"));
  const f = net.feed;
  const k = f.tripStart[f.tripIndex.get("local")!] + 1;
  assert.equal(f.stArr[k], T("08:20:00"));
});

test("飛行機も同じ仕組み：搭乗手続きの余裕（30 分）が効く", async () => {
  const dir = writeMiniFeed({
    stops: [{ id: "HOME" }, { id: "HND" }, { id: "ITM" }],
    routes: [
      { id: "BUS", type: 3 },
      { id: "AIR", type: 1100 },
    ],
    trips: [
      { id: "b", route: "BUS", service: "S", times: [["HOME", "07:00:00"], ["HND", "07:40:00"]] },
      { id: "f1", route: "AIR", service: "S", times: [["HND", "08:00:00"], ["ITM", "09:05:00"]] },
      { id: "f2", route: "AIR", service: "S", times: [["HND", "08:30:00"], ["ITM", "09:35:00"]] },
    ],
    calendar: [{ id: "S", days: "1111111", start: "20260101", end: "20271231" }],
    transfers: [],
  });
  const r = new Router(new Network(await loadGtfs(dir)));
  const js = r.depart({ from: "HOME", to: "ITM", date: MON, time: T("06:50:00") });
  assert.equal(js[0].arrival, T("09:35:00"));
  assert.equal(transit(js[0])[1].mode, "air");
  // 手段の除外：飛行機を使わなければ経路なし
  assert.equal(r.depart({ from: "HOME", to: "ITM", date: MON, time: T("06:50:00"), modes: ["bus"] }).length, 0);
});
