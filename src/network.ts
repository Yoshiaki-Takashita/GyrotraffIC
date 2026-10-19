// 探索用の路線網。GTFS を「経路パターン」（同じ停車駅の並び・同じ乗降条件の便の集まり）と「徒歩のつながり」に組み直す。
// RAPTOR は、1 つのパターンの中で便が追い越さない（どの駅でも順番が同じ）ことを前提にする。
// 追い越しがあるパターンは、追い越さない組に分ける。
import type { GtfsFeed } from "./gtfs/load.js";
import { DAY, weekday } from "./time.js";
import type { Mode } from "./modes.js";
import { CONF_CONFIRMED, CONF_INFERRED } from "./provenance.js";

export interface NetworkOptions {
  /** 歩く速さ m/秒。既定 1.2（推：約 4.3 km/時） */
  walkSpeed: number;
  /** 直線距離に掛ける回り道の係数。既定 1.3（推） */
  detourFactor: number;
  /** 直線距離からの徒歩乗り換えを作る上限の距離 m。既定 400 */
  maxWalkMeters: number;
  /** 同じ駅（parent_station が同じ）の別ホームへの最小の乗り換え時間 秒。既定 120（推） */
  stationTransferSec: number;
  /** 同じ停留所で乗り換えるときの最小時間 秒。既定 0。transfers.txt の from=to があればそちら */
  sameStopChangeSec: number;
  /** 直線距離の徒歩乗り換え："auto"＝transfers.txt が無いときだけ、"always"、"never" */
  geoFootpaths: "auto" | "always" | "never";
}

export const DEFAULT_NETWORK_OPTIONS: NetworkOptions = {
  walkSpeed: 1.2,
  detourFactor: 1.3,
  maxWalkMeters: 400,
  stationTransferSec: 120,
  sameStopChangeSec: 0,
  geoFootpaths: "auto",
};

export interface Pattern {
  routeIdx: number;
  mode: Mode;
  stops: Int32Array;
  /** 1＝その位置で乗れない */
  noPickup: Uint8Array;
  /** 1＝その位置で降りられない */
  noDropOff: Uint8Array;
  /** 便（feed の便番号）。始発駅の出発順 */
  trips: number[];
}

/** ある運行日に動く便を、前日・当日・翌日ぶん並べたもの（パターンごと） */
export interface PatternDay {
  n: number;
  /** 便の番号（feed） */
  trip: Int32Array;
  /** その便の運行日は「問い合わせ日＋dayOffset」 */
  dayOffset: Int8Array;
  /** 行優先 [便 × 位置]。問い合わせ日の 0 時からの秒 */
  arr: Int32Array;
  dep: Int32Array;
}

export const FP_TRANSFER = 0;
export const FP_STATION = 1;
export const FP_GEO = 2;

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371008.8;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export class Network {
  readonly feed: GtfsFeed;
  readonly options: NetworkOptions;
  readonly patterns: Pattern[] = [];
  /** 停留所 s を通るパターン：[patStart[s], patStart[s+1]) の範囲の (spPat, spPos) */
  readonly spStart: Int32Array;
  readonly spPat: Int32Array;
  readonly spPos: Int32Array;
  /** 徒歩のつながり（s から出る）：[fpStart[s], fpStart[s+1]) */
  readonly fpStart: Int32Array;
  readonly fpTo: Int32Array;
  readonly fpDur: Int32Array;
  readonly fpSrc: Uint8Array;
  /** 徒歩の秒の確信度（provenance.ts の CONF_*）。transfers.txt の min_transfer_time だけが確、ほかは推 */
  readonly fpConf: Uint8Array;
  /** 同じ停留所での乗り換え時間 */
  readonly selfChange: Int32Array;
  /** 同じ停留所での乗り換え時間の確信度（transfers.txt の type 2 の from=to なら確、既定値なら推） */
  readonly selfChangeConf: Uint8Array;
  /** 駅 ID → 子の停留所（ホーム） */
  readonly children = new Map<string, number[]>();
  private dayCache = new Map<string, PatternDay[]>();
  readonly warnings: string[] = [];

  constructor(feed: GtfsFeed, options: Partial<NetworkOptions> = {}) {
    this.feed = feed;
    this.options = { ...DEFAULT_NETWORK_OPTIONS, ...options };
    const S = feed.stops.length;

    for (let i = 0; i < S; i++) {
      const p = feed.stops[i].parent;
      if (p) {
        let c = this.children.get(p);
        if (!c) this.children.set(p, (c = []));
        c.push(i);
      }
    }

    this.buildPatterns();

    // 停留所 → パターン
    const cnt = new Int32Array(S + 1);
    for (const p of this.patterns) for (let i = 0; i < p.stops.length; i++) cnt[p.stops[i] + 1]++;
    for (let s = 0; s < S; s++) cnt[s + 1] += cnt[s];
    this.spStart = cnt.slice();
    this.spPat = new Int32Array(cnt[S]);
    this.spPos = new Int32Array(cnt[S]);
    const fill = cnt.slice();
    this.patterns.forEach((p, pi) => {
      for (let i = 0; i < p.stops.length; i++) {
        const k = fill[p.stops[i]]++;
        this.spPat[k] = pi;
        this.spPos[k] = i;
      }
    });

    // 徒歩
    this.selfChange = new Int32Array(S).fill(this.options.sameStopChangeSec);
    this.selfChangeConf = new Uint8Array(S).fill(CONF_INFERRED);
    const fp = this.buildFootpaths();
    const fcnt = new Int32Array(S + 1);
    for (const [a] of fp) fcnt[a + 1]++;
    for (let s = 0; s < S; s++) fcnt[s + 1] += fcnt[s];
    this.fpStart = fcnt.slice();
    this.fpTo = new Int32Array(fp.length);
    this.fpDur = new Int32Array(fp.length);
    this.fpSrc = new Uint8Array(fp.length);
    this.fpConf = new Uint8Array(fp.length);
    const ff = fcnt.slice();
    for (const [a, b, d, src, conf] of fp) {
      const k = ff[a]++;
      this.fpConf[k] = conf;
      this.fpTo[k] = b;
      this.fpDur[k] = d;
      this.fpSrc[k] = src;
    }
  }

  private buildPatterns() {
    const f = this.feed;
    const groups = new Map<string, number[]>();
    for (let t = 0; t < f.trips.length; t++) {
      const s0 = f.tripStart[t];
      const s1 = f.tripStart[t + 1];
      if (s1 - s0 < 2 || f.stArr[s0] < 0) continue;
      let key = f.trips[t].routeId + "|";
      for (let k = s0; k < s1; k++) key += f.stStop[k] + (f.stPickup[k] ? "p" : "") + (f.stDropOff[k] ? "d" : "") + ",";
      let g = groups.get(key);
      if (!g) groups.set(key, (g = []));
      g.push(t);
    }
    let splits = 0;
    for (const trips of groups.values()) {
      trips.sort((a, b) => f.stDep[f.tripStart[a]] - f.stDep[f.tripStart[b]]);
      const subs: number[][] = [];
      for (const t of trips) {
        let placed = false;
        for (const sub of subs) {
          const last = sub[sub.length - 1];
          if (!overtakes(f, last, t)) {
            sub.push(t);
            placed = true;
            break;
          }
        }
        if (!placed) subs.push([t]);
      }
      splits += subs.length - 1;
      for (const sub of subs) {
        const t0 = sub[0];
        const s0 = f.tripStart[t0];
        const s1 = f.tripStart[t0 + 1];
        const route = f.routes[f.routeIndex.get(f.trips[t0].routeId)!];
        this.patterns.push({
          routeIdx: f.routeIndex.get(f.trips[t0].routeId)!,
          mode: route.mode,
          stops: f.stStop.slice(s0, s1),
          noPickup: f.stPickup.slice(s0, s1),
          noDropOff: f.stDropOff.slice(s0, s1),
          trips: sub,
        });
      }
    }
    if (splits) this.warnings.push(`追い越しのため、パターンを ${splits} 個に分けた`);
  }

  private walkSec(a: number, b: number): number {
    const sa = this.feed.stops[a];
    const sb = this.feed.stops[b];
    const d = haversine(sa.lat, sa.lon, sb.lat, sb.lon);
    return Math.round((d * this.options.detourFactor) / this.options.walkSpeed);
  }

  private buildFootpaths(): [number, number, number, number, number][] {
    const f = this.feed;
    const o = this.options;
    const S = f.stops.length;
    const map = new Map<number, [number, number, number]>(); // a*S+b → [秒, 種類, 確信度]
    const key = (a: number, b: number) => a * S + b;

    // 同じ駅のホームどうし
    for (const kids of this.children.values()) {
      for (const a of kids)
        for (const b of kids) {
          if (a === b) continue;
          map.set(key(a, b), [Math.max(o.stationTransferSec, this.walkSec(a, b)), FP_STATION, CONF_INFERRED]);
        }
    }

    // 直線距離（格子で近いものだけ比べる）
    const useGeo = o.geoFootpaths === "always" || (o.geoFootpaths === "auto" && !f.hasTransfersFile);
    if (useGeo && o.maxWalkMeters > 0) {
      const cellLat = o.maxWalkMeters / 111000;
      const grid = new Map<string, number[]>();
      const cellOf = (i: number) => {
        const s = f.stops[i];
        const cellLon = cellLat / Math.max(0.1, Math.cos((s.lat * Math.PI) / 180));
        return [Math.floor(s.lat / cellLat), Math.floor(s.lon / cellLon)];
      };
      const usable: number[] = [];
      for (let i = 0; i < S; i++) {
        const s = f.stops[i];
        if (s.locationType !== 0 && s.locationType !== 4) continue;
        if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
        usable.push(i);
        const [cy, cx] = cellOf(i);
        const k = cy + ":" + cx;
        let g = grid.get(k);
        if (!g) grid.set(k, (g = []));
        g.push(i);
      }
      for (const a of usable) {
        const [cy, cx] = cellOf(a);
        const sa = f.stops[a];
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const g = grid.get(cy + dy + ":" + (cx + dx));
            if (!g) continue;
            for (const b of g) {
              if (a === b || map.has(key(a, b))) continue;
              const sb = f.stops[b];
              const d = haversine(sa.lat, sa.lon, sb.lat, sb.lon);
              if (d <= o.maxWalkMeters) map.set(key(a, b), [Math.round((d * o.detourFactor) / o.walkSpeed), FP_GEO, CONF_INFERRED]);
            }
          }
      }
    }

    // transfers.txt（いちばん優先）。駅 ID が書かれていれば子のホームに広げる
    const expand = (id: string): number[] => {
      const i = f.stopIndex.get(id);
      if (i === undefined) return [];
      const kids = this.children.get(id);
      return kids && f.stops[i].locationType === 1 ? kids : [i];
    };
    for (const tr of f.transfers) {
      const A = expand(tr.from);
      const B = expand(tr.to);
      for (const a of A)
        for (const b of B) {
          if (tr.type === 3) {
            if (a !== b) map.delete(key(a, b));
            continue;
          }
          if (tr.type >= 4) continue;
          if (a === b) {
            const given = tr.type === 2 && tr.minTime !== null;
            this.selfChange[a] = given ? tr.minTime! : o.sameStopChangeSec;
            this.selfChangeConf[a] = given ? CONF_CONFIRMED : CONF_INFERRED;
          } else {
            const given = tr.type === 2 && tr.minTime !== null;
            const d = given ? tr.minTime! : this.walkSec(a, b);
            map.set(key(a, b), [d, FP_TRANSFER, given ? CONF_CONFIRMED : CONF_INFERRED]);
          }
        }
    }

    const out: [number, number, number, number, number][] = [];
    for (const [k, [d, src, conf]] of map) out.push([Math.floor(k / S), k % S, d, src, conf]);
    return out;
  }

  /** 便の運行日の判定（calendar と calendar_dates） */
  serviceRuns(serviceId: string, date: string): boolean {
    const ex = this.feed.calendarDates.get(serviceId)?.get(date);
    if (ex === 1) return true;
    if (ex === 2) return false;
    const c = this.feed.calendar.get(serviceId);
    if (!c) return false;
    if (date < c.start || date > c.end) return false;
    return c.days[weekday(date)];
  }

  /** 問い合わせ日の時刻表（前日・当日・翌日の便を、問い合わせ日の時刻に直して並べる）。日付ごとに覚えておく */
  day(date: string): PatternDay[] {
    const hit = this.dayCache.get(date);
    if (hit) return hit;
    const f = this.feed;
    const runs = new Map<string, boolean>();
    const runsOn = (sid: string, off: number) => {
      const k = sid + "@" + off;
      let v = runs.get(k);
      if (v === undefined) {
        v = this.serviceRuns(sid, shift(date, off));
        runs.set(k, v);
      }
      return v;
    };
    const out: PatternDay[] = [];
    let fifoBroken = 0;
    for (const p of this.patterns) {
      const L = p.stops.length;
      const inst: [number, number, number][] = []; // [始発の時刻, 便, 日]
      for (const off of [-1, 0, 1]) {
        for (const t of p.trips) {
          const s0 = f.tripStart[t];
          if (off === -1 && f.stArr[s0 + L - 1] < DAY) continue; // 前日の便で日をまたがないものは不要
          if (!runsOn(f.trips[t].serviceId, off)) continue;
          inst.push([f.stDep[s0] + off * DAY, t, off]);
        }
      }
      inst.sort((x, y) => x[0] - y[0]);
      const n = inst.length;
      const pd: PatternDay = {
        n,
        trip: new Int32Array(n),
        dayOffset: new Int8Array(n),
        arr: new Int32Array(n * L),
        dep: new Int32Array(n * L),
      };
      for (let j = 0; j < n; j++) {
        const [, t, off] = inst[j];
        pd.trip[j] = t;
        pd.dayOffset[j] = off;
        const s0 = f.tripStart[t];
        for (let i = 0; i < L; i++) {
          pd.arr[j * L + i] = f.stArr[s0 + i] + off * DAY;
          pd.dep[j * L + i] = f.stDep[s0 + i] + off * DAY;
          if (j > 0 && pd.dep[j * L + i] < pd.dep[(j - 1) * L + i]) fifoBroken++;
        }
      }
      out.push(pd);
    }
    if (fifoBroken) this.warnings.push(`${date}: 日をまたぐ便の並びで追い越し ${fifoBroken} 件（24 時間を超える便の可能性。結果が最適でないことがある）`);
    this.dayCache.set(date, out);
    return out;
  }

  /** 停留所 ID（駅 ID なら子のホームも）→ 停留所番号の一覧 */
  resolveStop(id: string): number[] {
    const i = this.feed.stopIndex.get(id);
    if (i === undefined) throw new Error(`停留所が見つかりません: ${id}`);
    const kids = this.children.get(id);
    const out = new Set<number>([i]);
    if (kids) for (const k of kids) out.add(k);
    return [...out];
  }
}

function shift(date: string, off: number): string {
  if (off === 0) return date;
  const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8) + off));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** b が a を追い越す（ある駅で b の時刻が a より早い）か */
function overtakes(f: GtfsFeed, a: number, b: number): boolean {
  const sa = f.tripStart[a];
  const sb = f.tripStart[b];
  const L = f.tripStart[a + 1] - sa;
  for (let i = 0; i < L; i++) {
    if (f.stArr[sb + i] < f.stArr[sa + i] || f.stDep[sb + i] < f.stDep[sa + i]) return true;
  }
  return false;
}
