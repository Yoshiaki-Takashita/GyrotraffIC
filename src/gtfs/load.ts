// GTFS / GTFS-JP の読み込み。ファイルは 1 行ずつ読み、stop_times は型付き配列に詰めてメモリを抑える。
// GTFS-JP の癖：日本語の名前（UTF-8 のまま扱う）、同じ駅の複数ホーム（location_type=0 の停留所に parent_station）、
// 駅（location_type=1）自体には stop_times が付かないことが多い → 探索側で「駅 ID → 子のホーム」に広げる。
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readCsvRecords } from "./csv.js";
import { parseGtfsTime } from "../time.js";
import { modeFromRouteType, type Mode } from "../modes.js";

export interface GtfsStop {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** 0=停留所・ホーム, 1=駅, 2=出入口, 3=通路の分岐, 4=乗降場所 */
  locationType: number;
  parent: string | null;
  platformCode: string;
}

export interface GtfsRoute {
  id: string;
  agencyId: string;
  shortName: string;
  longName: string;
  routeType: number;
  mode: Mode;
}

export interface GtfsTrip {
  id: string;
  routeId: string;
  serviceId: string;
  headsign: string;
  directionId: string;
}

export interface GtfsCalendar {
  /** [日, 月, 火, 水, 木, 金, 土] */
  days: boolean[];
  start: string;
  end: string;
}

export interface GtfsTransfer {
  from: string;
  to: string;
  /** 0=推奨, 1=接続保証, 2=最小時間あり, 3=不可（4・5 は便どうしの直通。いまは扱わない） */
  type: number;
  minTime: number | null;
}

export interface GtfsFeed {
  timezone: string;
  stops: GtfsStop[];
  stopIndex: Map<string, number>;
  routes: GtfsRoute[];
  routeIndex: Map<string, number>;
  trips: GtfsTrip[];
  tripIndex: Map<string, number>;
  /** 便 t の停車は [tripStart[t], tripStart[t+1]) の範囲。stop_sequence 順。 */
  tripStart: Int32Array;
  stStop: Int32Array;
  stArr: Int32Array;
  stDep: Int32Array;
  /** 0=乗降可, 1=不可（2・3 の「要連絡」は可として扱う） */
  stPickup: Uint8Array;
  stDropOff: Uint8Array;
  calendar: Map<string, GtfsCalendar>;
  /** service_id → (日付 → 1 追加 / 2 削除) */
  calendarDates: Map<string, Map<string, number>>;
  transfers: GtfsTransfer[];
  hasTransfersFile: boolean;
  warnings: string[];
}

class IntBuf {
  a: Int32Array;
  n = 0;
  constructor(cap = 1024) {
    this.a = new Int32Array(cap);
  }
  push(v: number) {
    if (this.n === this.a.length) {
      const b = new Int32Array(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = v;
  }
}

async function* records(dir: string, name: string, required: boolean): AsyncGenerator<Record<string, string>> {
  const p = join(dir, name);
  if (!existsSync(p)) {
    if (required) throw new Error(`${name} がありません（${dir}）`);
    return;
  }
  yield* readCsvRecords(p);
}

export async function loadGtfs(dir: string): Promise<GtfsFeed> {
  const warnings: string[] = [];

  let timezone = "Asia/Tokyo";
  for await (const r of records(dir, "agency.txt", false)) {
    if (r.agency_timezone) {
      timezone = r.agency_timezone;
      break;
    }
  }

  const stops: GtfsStop[] = [];
  const stopIndex = new Map<string, number>();
  for await (const r of records(dir, "stops.txt", true)) {
    if (!r.stop_id) continue;
    if (stopIndex.has(r.stop_id)) {
      warnings.push(`stop_id の重複: ${r.stop_id}`);
      continue;
    }
    stopIndex.set(r.stop_id, stops.length);
    stops.push({
      id: r.stop_id,
      name: r.stop_name ?? "",
      lat: Number(r.stop_lat),
      lon: Number(r.stop_lon),
      locationType: r.location_type ? Number(r.location_type) : 0,
      parent: r.parent_station ? r.parent_station : null,
      platformCode: r.platform_code ?? "",
    });
  }

  const routes: GtfsRoute[] = [];
  const routeIndex = new Map<string, number>();
  for await (const r of records(dir, "routes.txt", true)) {
    const rt = Number(r.route_type);
    routeIndex.set(r.route_id, routes.length);
    routes.push({
      id: r.route_id,
      agencyId: r.agency_id ?? "",
      shortName: r.route_short_name ?? "",
      longName: r.route_long_name ?? "",
      routeType: rt,
      mode: modeFromRouteType(rt),
    });
  }

  const trips: GtfsTrip[] = [];
  const tripIndex = new Map<string, number>();
  for await (const r of records(dir, "trips.txt", true)) {
    if (!routeIndex.has(r.route_id)) {
      warnings.push(`trips.txt: 不明な route_id ${r.route_id}（便 ${r.trip_id} を飛ばす）`);
      continue;
    }
    tripIndex.set(r.trip_id, trips.length);
    trips.push({
      id: r.trip_id,
      routeId: r.route_id,
      serviceId: r.service_id,
      headsign: r.trip_headsign ?? "",
      directionId: r.direction_id ?? "",
    });
  }

  // stop_times：いったん平らに貯めて、(便, 順番) で並べ替える
  const bTrip = new IntBuf(1 << 16);
  const bSeq = new IntBuf(1 << 16);
  const bStop = new IntBuf(1 << 16);
  const bArr = new IntBuf(1 << 16);
  const bDep = new IntBuf(1 << 16);
  const bFlags = new IntBuf(1 << 16);
  let skipped = 0;
  for await (const r of records(dir, "stop_times.txt", true)) {
    const t = tripIndex.get(r.trip_id);
    const s = stopIndex.get(r.stop_id);
    if (t === undefined || s === undefined) {
      skipped++;
      continue;
    }
    let a = parseGtfsTime(r.arrival_time);
    let d = parseGtfsTime(r.departure_time);
    if (Number.isNaN(a) && !Number.isNaN(d)) a = d;
    if (Number.isNaN(d) && !Number.isNaN(a)) d = a;
    bTrip.push(t);
    bSeq.push(Number(r.stop_sequence));
    bStop.push(s);
    bArr.push(Number.isNaN(a) ? -1 : a);
    bDep.push(Number.isNaN(d) ? -1 : d);
    const pu = r.pickup_type === "1" ? 1 : 0;
    const dr = r.drop_off_type === "1" ? 1 : 0;
    bFlags.push(pu | (dr << 1));
  }
  if (skipped) warnings.push(`stop_times.txt: 便か停留所が不明な行 ${skipped} 件を飛ばした`);

  const n = bTrip.n;
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  const ta = bTrip.a;
  const sa = bSeq.a;
  order.sort((x, y) => ta[x] - ta[y] || sa[x] - sa[y]);

  const stStop = new Int32Array(n);
  const stArr = new Int32Array(n);
  const stDep = new Int32Array(n);
  const stPickup = new Uint8Array(n);
  const stDropOff = new Uint8Array(n);
  const tripStart = new Int32Array(trips.length + 1);
  for (let k = 0; k < n; k++) {
    const i = order[k];
    stStop[k] = bStop.a[i];
    stArr[k] = bArr.a[i];
    stDep[k] = bDep.a[i];
    stPickup[k] = bFlags.a[i] & 1;
    stDropOff[k] = (bFlags.a[i] >> 1) & 1;
    tripStart[ta[i] + 1]++;
  }
  for (let t = 0; t < trips.length; t++) tripStart[t + 1] += tripStart[t];

  // 時刻の無い停車（時刻点でない停留所）を前後の時刻点から直線で補う
  let interpolated = 0;
  for (let t = 0; t < trips.length; t++) {
    const s0 = tripStart[t];
    const s1 = tripStart[t + 1];
    let prev = -1;
    for (let k = s0; k < s1; k++) {
      if (stArr[k] >= 0) {
        if (prev >= 0 && k - prev > 1) {
          const t0 = stDep[prev];
          const t1 = stArr[k];
          for (let j = prev + 1; j < k; j++) {
            const v = Math.round(t0 + ((t1 - t0) * (j - prev)) / (k - prev));
            stArr[j] = v;
            stDep[j] = v;
            interpolated++;
          }
        }
        prev = k;
      }
    }
    // 先頭・末尾に時刻が無い便は使えない → その停車を落とす代わりに便全体の印を残す
    if (s1 > s0 && (stArr[s0] < 0 || stArr[s1 - 1] < 0)) {
      warnings.push(`便 ${trips[t].id}: 始発か終着に時刻が無い（探索から除外）`);
      for (let k = s0; k < s1; k++) {
        stArr[k] = -1;
        stDep[k] = -1;
      }
    }
  }
  if (interpolated) warnings.push(`時刻の無い停車 ${interpolated} 件を補った（直線補間）`);

  const calendar = new Map<string, GtfsCalendar>();
  for await (const r of records(dir, "calendar.txt", false)) {
    calendar.set(r.service_id, {
      days: [r.sunday, r.monday, r.tuesday, r.wednesday, r.thursday, r.friday, r.saturday].map((v) => v === "1"),
      start: r.start_date,
      end: r.end_date,
    });
  }
  const calendarDates = new Map<string, Map<string, number>>();
  for await (const r of records(dir, "calendar_dates.txt", false)) {
    let m = calendarDates.get(r.service_id);
    if (!m) calendarDates.set(r.service_id, (m = new Map()));
    m.set(r.date, Number(r.exception_type));
  }

  const transfers: GtfsTransfer[] = [];
  const hasTransfersFile = existsSync(join(dir, "transfers.txt"));
  for await (const r of records(dir, "transfers.txt", false)) {
    if (!r.from_stop_id || !r.to_stop_id) continue; // 便・路線どうしの指定（from_trip_id 等だけ）はいまは扱わない
    transfers.push({
      from: r.from_stop_id,
      to: r.to_stop_id,
      type: r.transfer_type ? Number(r.transfer_type) : 0,
      minTime: r.min_transfer_time ? Number(r.min_transfer_time) : null,
    });
  }
  if (existsSync(join(dir, "frequencies.txt"))) {
    warnings.push("frequencies.txt は未対応（無視した）");
  }

  return {
    timezone,
    stops,
    stopIndex,
    routes,
    routeIndex,
    trips,
    tripIndex,
    tripStart,
    stStop,
    stArr,
    stDep,
    stPickup,
    stDropOff,
    calendar,
    calendarDates,
    transfers,
    hasTransfersFile,
    warnings,
  };
}
