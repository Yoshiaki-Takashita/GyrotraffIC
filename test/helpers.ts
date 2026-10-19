// 試験用：GTFS のファイルを一時フォルダに書き出す（読み込み部品も一緒に試すため、メモリ上でなくファイルにする）。
import { mkdtempSync, writeFileSync, createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface MiniStop {
  id: string;
  name?: string;
  lat?: number;
  lon?: number;
  locationType?: number;
  parent?: string;
}
export interface MiniTrip {
  id: string;
  route: string;
  service: string;
  headsign?: string;
  /** [stop_id, "HH:MM:SS"（到着＝出発）] か [stop_id, 到着, 出発] */
  times: ([string, string] | [string, string, string])[];
  noPickup?: string[];
  noDropOff?: string[];
}
export interface MiniFeed {
  stops: MiniStop[];
  routes: { id: string; name?: string; type: number }[];
  trips: MiniTrip[];
  calendar: { id: string; days: string; start: string; end: string }[]; // days = "1111100"（月〜日）
  calendarDates?: { id: string; date: string; type: 1 | 2 }[];
  transfers?: { from: string; to: string; type: number; min?: number }[];
}

function csv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(",")).join("\n") + "\n";
}

export function writeMiniFeed(feed: MiniFeed): string {
  const dir = mkdtempSync(join(tmpdir(), "gyro-"));
  writeFileSync(join(dir, "agency.txt"), csv([["agency_id", "agency_name", "agency_url", "agency_timezone"], ["A", "試験交通", "https://example.invalid", "Asia/Tokyo"]]));
  writeFileSync(
    join(dir, "stops.txt"),
    "﻿" +
      csv([
        ["stop_id", "stop_name", "stop_lat", "stop_lon", "location_type", "parent_station"],
        ...feed.stops.map((s, i) => [s.id, s.name ?? s.id, s.lat ?? 35 + i * 0.01, s.lon ?? 139 + i * 0.01, s.locationType ?? 0, s.parent ?? ""]),
      ]).replace(/\n/g, "\r\n"),
  );
  writeFileSync(join(dir, "routes.txt"), csv([["route_id", "agency_id", "route_short_name", "route_long_name", "route_type"], ...feed.routes.map((r) => [r.id, "A", r.name ?? r.id, "", r.type])]));
  writeFileSync(join(dir, "trips.txt"), csv([["route_id", "service_id", "trip_id", "trip_headsign"], ...feed.trips.map((t) => [t.route, t.service, t.id, t.headsign ?? ""])]));
  const st: (string | number)[][] = [["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence", "pickup_type", "drop_off_type"]];
  for (const t of feed.trips) {
    t.times.forEach((x, i) => {
      const [s, a, d] = x.length === 3 ? x : [x[0], x[1], x[1]];
      st.push([t.id, a, d, s, (i + 1) * 10, t.noPickup?.includes(s) ? 1 : 0, t.noDropOff?.includes(s) ? 1 : 0]);
    });
  }
  writeFileSync(join(dir, "stop_times.txt"), csv(st));
  writeFileSync(
    join(dir, "calendar.txt"),
    csv([
      ["service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "start_date", "end_date"],
      ...feed.calendar.map((c) => [c.id, ...c.days.split(""), c.start, c.end]),
    ]),
  );
  if (feed.calendarDates) writeFileSync(join(dir, "calendar_dates.txt"), csv([["service_id", "date", "exception_type"], ...feed.calendarDates.map((c) => [c.id, c.date, c.type])]));
  if (feed.transfers)
    writeFileSync(join(dir, "transfers.txt"), csv([["from_stop_id", "to_stop_id", "transfer_type", "min_transfer_time"], ...feed.transfers.map((t) => [t.from, t.to, t.type, t.min ?? ""])]));
  return dir;
}

/** 決まった種から出す乱数（mulberry32） */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hms(t: number) {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * 乱数の大きな合成網を書き出す。駅を約 30 km 四方に散らし、近くの駅をつないだ路線を作り、
 * 便を 5〜25 時台に間隔をあけて走らせる（往復）。transfers.txt は作らない（直線距離の徒歩を使う）。
 */
export async function writeRandomFeed(opts: { stops: number; trips: number; seed: number; routeLen?: [number, number] }): Promise<{ dir: string; stopIds: string[] }> {
  const R = rng(opts.seed);
  const dir = mkdtempSync(join(tmpdir(), "gyro-rand-"));
  const S = opts.stops;
  const lat: number[] = [];
  const lon: number[] = [];
  const stopIds: string[] = [];
  for (let i = 0; i < S; i++) {
    lat.push(35.5 + R() * 0.27);
    lon.push(139.5 + R() * 0.33);
    stopIds.push("S" + i);
  }
  writeFileSync(join(dir, "agency.txt"), csv([["agency_id", "agency_name", "agency_url", "agency_timezone"], ["A", "乱数交通", "https://example.invalid", "Asia/Tokyo"]]));
  writeFileSync(join(dir, "stops.txt"), csv([["stop_id", "stop_name", "stop_lat", "stop_lon"], ...stopIds.map((id, i) => [id, "駅" + i, lat[i].toFixed(6), lon[i].toFixed(6)])]));
  writeFileSync(join(dir, "calendar.txt"), csv([["service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "start_date", "end_date"], ["ALL", 1, 1, 1, 1, 1, 1, 1, "20260101", "20271231"]]));

  // 格子で近い駅を探す
  const G = 40;
  const cell = (i: number) => Math.min(G - 1, Math.floor(((lat[i] - 35.5) / 0.27) * G)) * G + Math.min(G - 1, Math.floor(((lon[i] - 139.5) / 0.33) * G));
  const grid: number[][] = Array.from({ length: G * G }, () => []);
  for (let i = 0; i < S; i++) grid[cell(i)].push(i);
  const near = (i: number): number => {
    const c = cell(i);
    const cy = Math.floor(c / G);
    const cx = c % G;
    const cand: number[] = [];
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const y = cy + dy;
        const x = cx + dx;
        if (y < 0 || x < 0 || y >= G || x >= G) continue;
        cand.push(...grid[y * G + x]);
      }
    return cand.length ? cand[Math.floor(R() * cand.length)] : Math.floor(R() * S);
  };

  const [lmin, lmax] = opts.routeLen ?? [10, 30];
  const routes: number[][] = [];
  const tripsPerRoute: number[] = [];
  // 平均の長さから必要な路線の数を決める（1 路線あたり往復で約 2×headway 本）
  const avgTripsPerRoute = 60;
  const nRoutes = Math.max(1, Math.round(opts.trips / avgTripsPerRoute));
  for (let r = 0; r < nRoutes; r++) {
    const len = lmin + Math.floor(R() * (lmax - lmin + 1));
    const seq = [Math.floor(R() * S)];
    const used = new Set(seq);
    while (seq.length < len) {
      let nx = near(seq[seq.length - 1]);
      let tries = 0;
      while (used.has(nx) && tries++ < 10) nx = near(seq[seq.length - 1]);
      if (used.has(nx)) break;
      used.add(nx);
      seq.push(nx);
    }
    if (seq.length < 2) continue;
    routes.push(seq);
  }
  let remaining = opts.trips;
  for (let r = 0; r < routes.length; r++) {
    const n = r === routes.length - 1 ? remaining : Math.min(remaining, Math.round(opts.trips / routes.length));
    tripsPerRoute.push(n);
    remaining -= n;
  }
  writeFileSync(join(dir, "routes.txt"), csv([["route_id", "agency_id", "route_short_name", "route_long_name", "route_type"], ...routes.map((_, r) => ["R" + r, "A", "線" + r, "", r % 5 === 0 ? 3 : 2])]));

  const tw = createWriteStream(join(dir, "trips.txt"));
  const sw = createWriteStream(join(dir, "stop_times.txt"));
  tw.write("route_id,service_id,trip_id\n");
  sw.write("trip_id,arrival_time,departure_time,stop_id,stop_sequence\n");
  let tid = 0;
  const writes: Promise<void>[] = [];
  for (let r = 0; r < routes.length; r++) {
    const seq = routes[r];
    const n = tripsPerRoute[r];
    // 駅間の所要：距離から（鉄道 約 40 km/時・最低 60 秒）
    const hop: number[] = [];
    for (let i = 1; i < seq.length; i++) {
      const dy = (lat[seq[i]] - lat[seq[i - 1]]) * 111000;
      const dx = (lon[seq[i]] - lon[seq[i - 1]]) * 91000;
      hop.push(Math.max(60, Math.round(Math.hypot(dx, dy) / 11)));
    }
    const span = 20 * 3600; // 5:00〜25:00
    const perDir = Math.ceil(n / 2);
    const headway = Math.max(60, Math.floor(span / perDir));
    for (let k = 0; k < n; k++) {
      const dir0 = k % 2 === 0;
      const order = dir0 ? seq : [...seq].reverse();
      const hops = dir0 ? hop : [...hop].reverse();
      let t = 5 * 3600 + Math.floor(k / 2) * headway + Math.floor(R() * 60);
      const id = "T" + tid++;
      let chunk = `R${r},ALL,${id}\n`;
      tw.write(chunk);
      chunk = "";
      for (let i = 0; i < order.length; i++) {
        if (i > 0) t += hops[i - 1];
        const dwell = i > 0 && i < order.length - 1 ? 30 : 0;
        chunk += `${id},${hms(t)},${hms(t + dwell)},S${order[i]},${i + 1}\n`;
        t += dwell;
      }
      if (!sw.write(chunk)) await new Promise<void>((res) => sw.once("drain", () => res()));
    }
  }
  writes.push(new Promise<void>((res) => tw.end(() => res())));
  writes.push(new Promise<void>((res) => sw.end(() => res())));
  await Promise.all(writes);
  return { dir, stopIds };
}
