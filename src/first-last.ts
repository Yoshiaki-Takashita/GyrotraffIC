// 始発・終電の探索（設計 docs/first-last.md）。
//   始発 firstTrain：運行日 D の便だけに絞り、D の「運行日の始まり」から前向き RAPTOR で最も早く着く経路を探す。
//   終電 lastTrain ：運行日 D の便だけに絞り、到着地から逆向き RAPTOR で「最も遅く出発できる経路」を探す。
// 運行日 D の便＝その日の service で動く便（GTFS 時刻が 24 時を超える 25:30 なども D の便）。前日（D−1）の深夜便・翌日（D+1）の便は使わない。
// 時刻表が無い・運行日に便が無い・着けない場合は status:"none" と理由を返す（経路を作らない）。
import { DAY, INF, serviceTimeToLocalIso } from "./time.js";
import type { PatternDay } from "./network.js";
import type { Router } from "./raptor.js";
import type { Mode } from "./modes.js";
import type { Journey, Leg } from "./journey.js";
import { confirmed, inferred, unknown, type Sourced } from "./provenance.js";

/**
 * 運行日の始まり（その日の 0 時からの秒）。既定 03:00。
 * 仮の値（推）：事業者ごとの運行日の境界は GTFS に書かれていないことが多く、確かめていない。問いごとに dayStart で変えられる。
 */
export const DEFAULT_SERVICE_DAY_START = 3 * 3600;

export interface FirstLastQuery {
  from: string | string[];
  to: string | string[];
  /** 運行日 YYYYMMDD */
  date: string;
  maxTransfers?: number;
  modes?: Mode[];
  /** 始発のみ：運行日の始まり（秒）。省略で DEFAULT_SERVICE_DAY_START（仮の値・推） */
  dayStart?: number;
}

export interface FirstLastResult {
  kind: "first" | "last";
  serviceDate: string;
  /** "ok"＝経路あり、"none"＝該当なし（reason に理由） */
  status: "ok" | "none";
  reason?: string;
  /** 乗り換えの少ない順。none なら空 */
  journeys: Journey[];
  provenance: {
    /** 時刻：時刻表の値なので確（データ源そのものの正しさは feed の来歴に従う）。該当なしなら不明 */
    times: Sourced<string>;
    /** 運行日の判定：calendar_dates に明示＝確、calendar の曜日から＝推（祝日の展開が無いと外れうる） */
    serviceDay: Sourced<string>;
    /** 始発の探索の起点（運行日の始まり）。既定値は推。終電では使わないので null */
    dayStart: Sourced<number> | null;
    /** 常に付ける注意 */
    notes: string[];
  };
}

const NOTES = ["この運行日の時刻表で計算", "特別ダイヤ（年末年始・臨時）未反映の場合あり"];

/** 運行日 D の便（dayOffset＝0）だけに絞った時刻表。順番は元のまま（部分集合なので FIFO は崩れない） */
export function serviceDayOnly(days: PatternDay[], L: (p: number) => number): PatternDay[] {
  return days.map((pd, p) => {
    let n = 0;
    for (let j = 0; j < pd.n; j++) if (pd.dayOffset[j] === 0) n++;
    if (n === pd.n) return pd;
    const len = L(p);
    const out: PatternDay = { n, trip: new Int32Array(n), dayOffset: new Int8Array(n), arr: new Int32Array(n * len), dep: new Int32Array(n * len) };
    let k = 0;
    for (let j = 0; j < pd.n; j++) {
      if (pd.dayOffset[j] !== 0) continue;
      out.trip[k] = pd.trip[j];
      out.arr.set(pd.arr.subarray(j * len, (j + 1) * len), k * len);
      out.dep.set(pd.dep.subarray(j * len, (j + 1) * len), k * len);
      k++;
    }
    return out;
  });
}

function prepare(router: Router, q: FirstLastQuery, kind: "first" | "last") {
  const net = router.net;
  const days = serviceDayOnly(net.day(q.date), (p) => net.patterns[p].stops.length);
  let tripsOnDay = 0;
  for (const pd of days) tripsOnDay += pd.n;
  // 運行日の判定の確信度：使う便の service が calendar_dates で明示されていれば確
  const sids = new Set<string>();
  for (const pd of days) for (let j = 0; j < pd.n; j++) sids.add(net.feed.trips[pd.trip[j]].serviceId);
  let explicit = sids.size > 0;
  for (const sid of sids) if (net.feed.calendarDates.get(sid)?.get(q.date) !== 1) explicit = false;
  const serviceDay: Sourced<string> =
    tripsOnDay === 0
      ? unknown("この運行日に動く便が時刻表に無い")
      : explicit
        ? confirmed(q.date, "calendar_dates.txt に明示")
        : inferred(q.date, "calendar.txt の曜日と期間から判定（祝日の展開が無いフィードでは外れうる）");
  const none = (reason: string, dayStart: Sourced<number> | null): FirstLastResult => ({
    kind,
    serviceDate: q.date,
    status: "none",
    reason,
    journeys: [],
    provenance: { times: unknown(reason), serviceDay, dayStart, notes: NOTES },
  });
  return { days, tripsOnDay, serviceDay, none };
}

function ok(kind: "first" | "last", q: FirstLastQuery, js: Journey[], serviceDay: Sourced<string>, dayStart: Sourced<number> | null): FirstLastResult {
  return { kind, serviceDate: q.date, status: "ok", journeys: js, provenance: { times: confirmed("時刻表", "stop_times.txt"), serviceDay, dayStart, notes: NOTES } };
}

/** 始発：運行日 D の便だけで、D の運行日の始まりから最も早く着く経路（到着×乗り換えのパレート集合） */
export function firstTrain(router: Router, q: FirstLastQuery): FirstLastResult {
  const dayStart: Sourced<number> =
    q.dayStart === undefined
      ? inferred(DEFAULT_SERVICE_DAY_START, "既定値 03:00（仮の値。事業者の運行日の境界は未確認）")
      : inferred(q.dayStart, "問い合わせで指定");
  const { days, tripsOnDay, serviceDay, none } = prepare(router, q, "first");
  if (router.net.feed.trips.length === 0) return none("時刻表が無い", dayStart);
  if (tripsOnDay === 0) return none("この運行日に動く便が無い", dayStart);
  const sources = router.resolve(q.from);
  const targets = router.resolve(q.to);
  const js = router.run(sources, targets, q.date, dayStart.value!, q.maxTransfers ?? 6, q.modes, days).filter((j) => j.legs.some((l) => l.type === "transit"));
  if (js.length === 0) return none("この運行日の便では着けない", dayStart);
  return ok("first", q, js, serviceDay, dayStart);
}

const NONE = -1;
const TARGET = -2;
const CARRY = -3;
const NEG = -INF;
/** 目的地の期限の「無限大」（運行日の便だけなので、どの到着より十分遅い） */
const OPEN = 10 * DAY;

/**
 * 終電：運行日 D の便だけで、到着地に着ける最も遅い出発（逆向き RAPTOR）。
 * ラウンド k で「乗車 k 回までで、停留所 s から目的地に着けるために s にいればよい最も遅い時刻」を求める。
 * 答えは（出発の遅さ×乗り換え）のパレート集合を乗り換えの少ない順に返す。
 */
export function lastTrain(router: Router, q: FirstLastQuery): FirstLastResult {
  const { days, tripsOnDay, serviceDay, none } = prepare(router, q, "last");
  if (router.net.feed.trips.length === 0) return none("時刻表が無い", null);
  if (tripsOnDay === 0) return none("この運行日に動く便が無い", null);
  const net = router.net;
  const S = net.feed.stops.length;
  const pats = net.patterns;
  const sources = router.resolve(q.from);
  const targets = router.resolve(q.to);
  const K = (q.maxTransfers ?? 6) + 1;
  const allowed = q.modes ? new Set(q.modes) : null;

  // 逆向きの徒歩の索引（b に入ってくる a→b）
  const inCnt = new Int32Array(S + 1);
  for (let a = 0; a < S; a++) for (let e = net.fpStart[a]; e < net.fpStart[a + 1]; e++) inCnt[net.fpTo[e] + 1]++;
  for (let s = 0; s < S; s++) inCnt[s + 1] += inCnt[s];
  const fpIn = new Int32Array(inCnt[S]); // 入ってくる辺の番号（fpTo などの添字）
  const fpInFrom = new Int32Array(inCnt[S]);
  {
    const fill = inCnt.slice();
    for (let a = 0; a < S; a++)
      for (let e = net.fpStart[a]; e < net.fpStart[a + 1]; e++) {
        const k = fill[net.fpTo[e]]++;
        fpIn[k] = e;
        fpInFrom[k] = a;
      }
  }

  // dl[k][s]：乗車 k 回までで、s で降りた（着いた）とき、この時刻までなら目的地に間に合う
  // ready[k][s]：乗車ちょうど k 回目で s から乗るとき、s にいればよい最も遅い時刻（乗る前の余裕を引いた値）
  const dl: Int32Array[] = [];
  const dlFrom: Int32Array[] = [];
  const ready: Int32Array[] = [];
  const lblPat: Int32Array[] = [];
  const lblInst: Int32Array[] = [];
  const lblBoard: Int32Array[] = [];
  const lblAlight: Int32Array[] = [];
  const best = new Int32Array(S).fill(NEG);

  const dl0 = new Int32Array(S).fill(NEG);
  const dlf0 = new Int32Array(S).fill(NONE);
  let marked: number[] = [];
  const isMarked = new Uint8Array(S);
  const mark = (s: number) => {
    if (!isMarked[s]) {
      isMarked[s] = 1;
      marked.push(s);
    }
  };
  for (const t of targets) {
    dl0[t] = OPEN;
    dlf0[t] = TARGET;
    mark(t);
  }
  for (const t of targets)
    for (let k = inCnt[t]; k < inCnt[t + 1]; k++) {
      const a = fpInFrom[k];
      const v = OPEN - net.fpDur[fpIn[k]];
      if (v > dl0[a]) {
        dl0[a] = v;
        dlf0[a] = t;
        mark(a);
      }
    }
  dl.push(dl0);
  dlFrom.push(dlf0);
  ready.push(new Int32Array(S).fill(NEG));
  for (const a of [lblPat, lblInst, lblBoard, lblAlight]) a.push(new Int32Array(0));

  const results: { k: number; stop: number; first: number; dep: number }[] = [];
  let bestDep = NEG;
  const queue = new Int32Array(pats.length).fill(-1);
  const queued: number[] = [];

  for (let k = 1; k <= K && marked.length > 0; k++) {
    const prevDl = dl[k - 1];
    const curReady = new Int32Array(S).fill(NEG);
    const curDl = prevDl.slice();
    const curDlFrom = new Int32Array(S).fill(CARRY);
    const lp = new Int32Array(S).fill(NONE);
    const li = new Int32Array(S);
    const lb = new Int32Array(S);
    const la = new Int32Array(S);
    // 印の付いた停留所を通るパターンを、最も奥（後ろ）の位置で集める
    for (const s of marked) {
      isMarked[s] = 0;
      for (let e = net.spStart[s]; e < net.spStart[s + 1]; e++) {
        const p = net.spPat[e];
        const pos = net.spPos[e];
        if (queue[p] < 0) {
          queued.push(p);
          queue[p] = pos;
        } else if (pos > queue[p]) queue[p] = pos;
      }
    }
    marked = [];
    const improved: number[] = [];
    for (const p of queued) {
      const pos0 = queue[p];
      queue[p] = -1;
      const pat = pats[p];
      if (allowed && !allowed.has(pat.mode)) continue;
      const pd = days[p];
      if (pd.n === 0) continue;
      const L = pat.stops.length;
      const slack = router.profiles[pat.mode].boardSlack;
      let t = -1;
      let alightPos = -1;
      for (let i = pos0; i >= 0; i--) {
        const s = pat.stops[i];
        // いまの便に s から乗る
        if (t >= 0 && !pat.noPickup[i]) {
          const r = pd.dep[t * L + i] - slack;
          if (r > curReady[s] && r > best[s]) {
            curReady[s] = r;
            best[s] = r;
            lp[s] = p;
            li[s] = t;
            lb[s] = i;
            la[s] = alightPos;
            improved.push(s);
          }
        }
        // s で降りて間に合う、もっと遅い便があるか
        const d = prevDl[s];
        if (d > NEG && !pat.noDropOff[i]) {
          // arr[j,i] <= d となる最大の j（t より後ろだけ）
          let lo = t < 0 ? 0 : t;
          let hi = pd.n;
          while (lo < hi) {
            const m = (lo + hi) >> 1;
            if (pd.arr[m * L + i] <= d) lo = m + 1;
            else hi = m;
          }
          const j = lo - 1;
          if (j >= 0 && j > t) {
            t = j;
            alightPos = i;
          }
        }
      }
    }
    queued.length = 0;
    // 乗り換え：s で乗るには、s に降りる便が selfChange 前、a→s の徒歩なら a に dur 前
    for (const s of improved) {
      const r = curReady[s];
      const v = r - net.selfChange[s];
      if (v > curDl[s]) {
        curDl[s] = v;
        curDlFrom[s] = s;
        mark(s);
      }
      for (let x = inCnt[s]; x < inCnt[s + 1]; x++) {
        const a = fpInFrom[x];
        const w = r - net.fpDur[fpIn[x]];
        if (w > curDl[a]) {
          curDl[a] = w;
          curDlFrom[a] = s;
          mark(a);
        }
      }
    }
    dl.push(curDl);
    dlFrom.push(curDlFrom);
    ready.push(curReady);
    lblPat.push(lp);
    lblInst.push(li);
    lblBoard.push(lb);
    lblAlight.push(la);

    // 出発地：そこから乗る、または出発地から歩いて乗る
    let bd = NEG;
    let bs = -1;
    let bfirst = -1;
    for (const s of sources) {
      if (curReady[s] > NEG) {
        const dep = depOf(k, s);
        if (dep > bd) ((bd = dep), (bs = s), (bfirst = s));
      }
      for (let e = net.fpStart[s]; e < net.fpStart[s + 1]; e++) {
        const b = net.fpTo[e];
        if (curReady[b] <= NEG) continue;
        const dep = depOf(k, b) - net.fpDur[e];
        if (dep > bd) ((bd = dep), (bs = s), (bfirst = b));
      }
    }
    if (bs >= 0 && bd > bestDep) {
      bestDep = bd;
      results.push({ k, stop: bs, first: bfirst, dep: bd });
    }
  }

  // 乗車の実際の出発時刻（ready は余裕を引いてあるので便の時刻に戻す）
  function depOf(k: number, s: number): number {
    const p = lblPat[k][s];
    const L = pats[p].stops.length;
    return days[p].dep[lblInst[k][s] * L + lblBoard[k][s]];
  }

  if (results.length === 0) return none("この運行日の便では着けない（終電の後の乗り継ぎができない等）", null);
  const f = net.feed;
  const journeys: Journey[] = results.map((r) => {
    const legs: Leg[] = [];
    if (r.first !== r.stop) {
      const fi = router.fpInfo(r.stop, r.first);
      legs.push({ type: "walk", from: router.stopRef(r.stop), to: router.stopRef(r.first), duration: fi.dur, source: fi.src, confidence: fi.confidence });
    }
    let s = r.first;
    let round = r.k;
    for (;;) {
      const p = lblPat[round][s];
      if (p < 0) throw new Error(`内部エラー：終電の経路の復元に失敗（round ${round}, stop ${f.stops[s].id}）`);
      const pat = pats[p];
      const L = pat.stops.length;
      const t = lblInst[round][s];
      const bp = lblBoard[round][s];
      const ap = lblAlight[round][s];
      const pd = days[p];
      const trip = f.trips[pd.trip[t]];
      const route = f.routes[pat.routeIdx];
      const dep = pd.dep[t * L + bp];
      const arr = pd.arr[t * L + ap];
      legs.push({
        type: "transit",
        mode: pat.mode,
        routeId: route.id,
        routeName: route.shortName || route.longName,
        tripId: trip.id,
        headsign: trip.headsign,
        from: router.stopRef(pat.stops[bp]),
        to: router.stopRef(pat.stops[ap]),
        departure: dep,
        arrival: arr,
        departureIso: serviceTimeToLocalIso(q.date, dep),
        arrivalIso: serviceTimeToLocalIso(q.date, arr),
        intermediateStops: ap - bp - 1,
      });
      let a = pat.stops[ap];
      let rr = round - 1;
      while (rr > 0 && dlFrom[rr][a] === CARRY) rr--;
      const from = dlFrom[rr][a];
      if (rr === 0) {
        if (from !== TARGET) {
          const fi = router.fpInfo(a, from);
          legs.push({ type: "walk", from: router.stopRef(a), to: router.stopRef(from), duration: fi.dur, source: fi.src, confidence: fi.confidence });
        }
        break;
      }
      if (from === a) {
        const ch = net.selfChange[a];
        if (ch > 0) legs.push({ type: "walk", from: router.stopRef(a), to: router.stopRef(a), duration: ch, source: "change", confidence: net.selfChangeConf[a] === 0 ? "confirmed" : "inferred" });
      } else {
        const fi = router.fpInfo(a, from);
        legs.push({ type: "walk", from: router.stopRef(a), to: router.stopRef(from), duration: fi.dur, source: fi.src, confidence: fi.confidence });
        a = from;
      }
      s = a;
      round = rr;
    }
    const transit = legs.filter((l) => l.type === "transit");
    let arrival = transit[transit.length - 1].arrival;
    const last = legs[legs.length - 1];
    if (last.type === "walk" && last.source !== "change") arrival += last.duration;
    const j: Journey = {
      serviceDate: q.date,
      departure: r.dep,
      arrival,
      departureIso: serviceTimeToLocalIso(q.date, r.dep),
      arrivalIso: serviceTimeToLocalIso(q.date, arrival),
      transfers: Math.max(0, transit.length - 1),
      legs,
    };
    j.fare = router.fare.estimate(j);
    return j;
  });
  return ok("last", q, journeys, serviceDay, null);
}
