// RAPTOR（Round-bAsed Public Transit Optimized Router, Delling ほか 2012）。
// ラウンド k で「乗車 k 回（乗り換え k-1 回）までで、各停留所に最も早く着く時刻」を求める。
// 各ラウンドの最良の到着時刻を並べると、到着時刻と乗り換え回数のパレート最適な候補が自然に得られる。
import { DAY, INF, serviceTimeToLocalIso } from "./time.js";
import { FP_GEO, FP_STATION, FP_TRANSFER, Network, type PatternDay } from "./network.js";
import { DEFAULT_MODE_PROFILES, type Mode, type ModeProfile } from "./modes.js";
import type { Journey, Leg, StopRef } from "./journey.js";
import { NoFareCalculator, type FareCalculator } from "./fare.js";
import { confidenceFromCode, type Confidence } from "./provenance.js";

export interface DepartQuery {
  from: string | string[];
  to: string | string[];
  /** 運行日 YYYYMMDD */
  date: string;
  /** その日の 0 時からの秒 */
  time: number;
  /** 乗り換え回数の上限。既定 6 */
  maxTransfers?: number;
  /** 使う手段（省略で全部） */
  modes?: Mode[];
}

export interface ArriveQuery extends Omit<DepartQuery, "time"> {
  /** この時刻までに着きたい（その日の 0 時からの秒） */
  arriveBy: number;
  /** 何秒前までさかのぼって探すか。既定 6 時間 */
  searchWindow?: number;
}

export interface RouterOptions {
  modeProfiles?: Partial<Record<Mode, ModeProfile>>;
  fare?: FareCalculator;
}

const NONE = -1;
const ORIGIN = -2;
const CARRY = -3;

export class Router {
  readonly net: Network;
  /** @internal */
  readonly profiles: Record<Mode, ModeProfile>;
  /** @internal */
  readonly fare: FareCalculator;
  /** 最後の探索で調べたパターンの数など（性能の計測用） */
  lastStats = { rounds: 0, patternsScanned: 0 };

  constructor(net: Network, opts: RouterOptions = {}) {
    this.net = net;
    this.profiles = { ...DEFAULT_MODE_PROFILES, ...(opts.modeProfiles ?? {}) };
    this.fare = opts.fare ?? new NoFareCalculator();
  }

  /** @internal */
  resolve(x: string | string[]): number[] {
    const ids = Array.isArray(x) ? x : [x];
    const set = new Set<number>();
    for (const id of ids) for (const s of this.net.resolveStop(id)) set.add(s);
    return [...set];
  }

  /** 出発時刻を指定した探索。到着時刻と乗り換え回数でパレート最適な経路を、乗り換えの少ない順に返す */
  depart(q: DepartQuery): Journey[] {
    const sources = this.resolve(q.from);
    const targets = this.resolve(q.to);
    return this.run(sources, targets, q.date, q.time, q.maxTransfers ?? 6, q.modes);
  }

  /**
   * 到着時刻を指定した探索（簡易版）。「出発を遅らせても到着は早くならない」性質を使い、
   * 期限に間に合う最も遅い出発時刻を二分探索で求め、その出発での候補のうち期限内のものを返す。
   * 探索は約 log2(窓/60) 回（6 時間なら 9 回程度）。本格的な逆向きの RAPTOR は次の段階。
   */
  arriveBy(q: ArriveQuery): Journey[] {
    const sources = this.resolve(q.from);
    const targets = this.resolve(q.to);
    const K = q.maxTransfers ?? 6;
    const win = q.searchWindow ?? 6 * 3600;
    const out: Journey[] = [];
    let lastDep = -INF;
    // 乗り換え回数の上限 k ごとに「期限に間に合う最も遅い出発」を求め、出発の遅さと乗り換え回数でパレート最適なものを残す
    for (let k = 0; k <= K; k++) {
      const pick = (t: number) => {
        const js = this.run(sources, targets, q.date, t, k, q.modes);
        let bestJ: Journey | null = null;
        for (const j of js) if (j.arrival <= q.arriveBy && (!bestJ || j.transfers < bestJ.transfers)) bestJ = j;
        return bestJ;
      };
      let lo = q.arriveBy - win;
      let hi = q.arriveBy;
      let best = pick(lo);
      if (!best) continue;
      // 出発を実際の乗車まで詰めてから二分探索（分単位）
      lo = Math.max(lo, best.departure);
      best = pick(lo) ?? best;
      while (hi - lo > 60) {
        const mid = lo + Math.max(60, Math.floor((hi - lo) / 120) * 60);
        if (mid >= hi) break;
        const r = pick(mid);
        if (r) {
          lo = Math.max(mid, r.departure);
          best = r;
        } else hi = mid;
      }
      if (best.departure > lastDep) {
        out.push(best);
        lastDep = best.departure;
      }
    }
    return out;
  }

  /**
   * 前向き RAPTOR の本体。daysOverride を渡すと、その時刻表（例：運行日の便だけに絞ったもの）で探す（始発の探索 first-last.ts が使う）。
   * @internal
   */
  run(sources: number[], targets: number[], date: string, t0: number, maxTransfers: number, modes?: Mode[], daysOverride?: PatternDay[]): Journey[] {
    const net = this.net;
    const S = net.feed.stops.length;
    const days = daysOverride ?? net.day(date);
    const pats = net.patterns;
    const K = maxTransfers + 1;
    const allowed = modes ? new Set(modes) : null;
    const isTarget = new Uint8Array(S);
    for (const t of targets) isTarget[t] = 1;

    // ラウンドごとの配列
    const arrTrip: Int32Array[] = []; // 乗車で着いた時刻
    const arrWalk: Int32Array[] = []; // 乗車か、乗車後の徒歩で着いた時刻（目的地の判定用）
    const arrBoard: Int32Array[] = []; // 次のラウンドで乗れる時刻（乗り換え時間・徒歩を足したもの）
    const lblPat: Int32Array[] = [];
    const lblInst: Int32Array[] = [];
    const lblBoardPos: Int32Array[] = [];
    const lblAlightPos: Int32Array[] = [];
    const walkFrom: Int32Array[] = [];
    const boardFrom: Int32Array[] = [];
    const best = new Int32Array(S).fill(INF);
    let bestTarget = INF;
    const results: { k: number; stop: number; arr: number }[] = [];

    // ラウンド 0：出発地と、そこから歩ける所
    arrTrip.push(new Int32Array(S).fill(INF));
    arrWalk.push(new Int32Array(S).fill(INF));
    arrBoard.push(new Int32Array(S).fill(INF));
    walkFrom.push(new Int32Array(S).fill(NONE));
    boardFrom.push(new Int32Array(S).fill(NONE));
    for (const a of [lblPat, lblInst, lblBoardPos, lblAlightPos]) a.push(new Int32Array(0));
    let marked: number[] = [];
    const isMarked = new Uint8Array(S);
    const mark = (s: number) => {
      if (!isMarked[s]) {
        isMarked[s] = 1;
        marked.push(s);
      }
    };
    for (const s of sources) {
      arrBoard[0][s] = t0;
      arrWalk[0][s] = t0;
      boardFrom[0][s] = ORIGIN;
      walkFrom[0][s] = ORIGIN;
      best[s] = Math.min(best[s], t0);
      mark(s);
    }
    for (const s of sources) {
      for (let e = net.fpStart[s]; e < net.fpStart[s + 1]; e++) {
        const b = net.fpTo[e];
        const a = t0 + net.fpDur[e];
        if (a < arrBoard[0][b]) {
          arrBoard[0][b] = a;
          boardFrom[0][b] = s;
          arrWalk[0][b] = a;
          walkFrom[0][b] = s;
          best[b] = Math.min(best[b], a);
          mark(b);
        }
      }
    }
    // 歩くだけで着く場合（出発地と目的地が同じ・近い）
    {
      let bt = INF;
      let bs = -1;
      for (const t of targets) if (arrWalk[0][t] < bt) ((bt = arrWalk[0][t]), (bs = t));
      if (bs >= 0) {
        bestTarget = bt;
        results.push({ k: 0, stop: bs, arr: bt });
      }
    }

    const queue = new Int32Array(pats.length).fill(-1);
    const queued: number[] = [];
    let scanned = 0;
    let rounds = 0;
    for (let k = 1; k <= K && marked.length > 0; k++) {
      rounds = k;
      const prevBoard = arrBoard[k - 1];
      const curTrip = new Int32Array(S).fill(INF);
      const curWalk = new Int32Array(S).fill(INF);
      const curBoard = prevBoard.slice();
      const curWalkFrom = new Int32Array(S).fill(NONE);
      const curBoardFrom = new Int32Array(S).fill(CARRY);
      const lp = new Int32Array(S).fill(NONE);
      const li = new Int32Array(S);
      const lb = new Int32Array(S);
      const la = new Int32Array(S);

      // 印の付いた停留所を通るパターンを、最も手前の位置で集める
      for (const s of marked) {
        isMarked[s] = 0;
        for (let e = net.spStart[s]; e < net.spStart[s + 1]; e++) {
          const p = net.spPat[e];
          const pos = net.spPos[e];
          if (queue[p] < 0) {
            queued.push(p);
            queue[p] = pos;
          } else if (pos < queue[p]) queue[p] = pos;
        }
      }
      marked = [];
      const improved: number[] = [];

      for (const p of queued) {
        const pos0 = queue[p];
        queue[p] = -1;
        const pat = pats[p];
        if (allowed && !allowed.has(pat.mode)) continue;
        const pd: PatternDay = days[p];
        if (pd.n === 0) continue;
        scanned++;
        const L = pat.stops.length;
        const slack = this.profiles[pat.mode].boardSlack;
        let t = -1;
        let boardPos = -1;
        for (let i = pos0; i < L; i++) {
          const s = pat.stops[i];
          if (t >= 0 && !pat.noDropOff[i]) {
            const a = pd.arr[t * L + i];
            if (a < curTrip[s] && a < best[s] && a < bestTarget) {
              curTrip[s] = a;
              best[s] = a;
              lp[s] = p;
              li[s] = t;
              lb[s] = boardPos;
              la[s] = i;
              improved.push(s);
            }
          }
          // もっと早い便に乗れるか
          const pb = prevBoard[s];
          if (pb < INF && !pat.noPickup[i] && (t < 0 || pb + slack <= pd.dep[t * L + i])) {
            const need = pb + slack;
            const upper = t < 0 ? pd.n : t + 1; // t（いまの便）以前だけを見る
            let lo = 0;
            let hi = upper;
            while (lo < hi) {
              const m = (lo + hi) >> 1;
              if (pd.dep[m * L + i] >= need) hi = m;
              else lo = m + 1;
            }
            if (lo < upper && (t < 0 || lo < t)) {
              t = lo;
              boardPos = i;
            }
          }
        }
      }
      queued.length = 0;

      // 乗り換え（同じ停留所の乗り換え時間・徒歩）
      for (const s of improved) {
        if (curTrip[s] >= INF) continue;
        if (curTrip[s] < curWalk[s]) {
          curWalk[s] = curTrip[s];
          curWalkFrom[s] = s;
        }
        const ab = curTrip[s] + net.selfChange[s];
        if (ab < curBoard[s]) {
          curBoard[s] = ab;
          curBoardFrom[s] = s;
          mark(s);
        }
      }
      for (const s of improved) {
        const base = curTrip[s];
        if (base >= INF) continue;
        for (let e = net.fpStart[s]; e < net.fpStart[s + 1]; e++) {
          const b = net.fpTo[e];
          const a = base + net.fpDur[e];
          if (a < curWalk[b] && a < bestTarget) {
            curWalk[b] = a;
            curWalkFrom[b] = s;
          }
          if (a < curBoard[b]) {
            curBoard[b] = a;
            curBoardFrom[b] = s;
            if (a < best[b]) best[b] = a;
            mark(b);
          }
        }
      }

      arrTrip.push(curTrip);
      arrWalk.push(curWalk);
      arrBoard.push(curBoard);
      walkFrom.push(curWalkFrom);
      boardFrom.push(curBoardFrom);
      lblPat.push(lp);
      lblInst.push(li);
      lblBoardPos.push(lb);
      lblAlightPos.push(la);

      let bt = INF;
      let bs = -1;
      for (const t of targets) if (curWalk[t] < bt) ((bt = curWalk[t]), (bs = t));
      if (bs >= 0 && bt < bestTarget) {
        bestTarget = bt;
        results.push({ k, stop: bs, arr: bt });
      }
    }
    this.lastStats = { rounds, patternsScanned: scanned };

    const journeys: Journey[] = [];
    for (const r of results) {
      const legs = this.reconstruct(r.k, r.stop, date, days, { arrTrip, walkFrom, boardFrom, lblPat, lblInst, lblBoardPos, lblAlightPos });
      const transit = legs.filter((l) => l.type === "transit").length;
      const dep = legs.length && legs[0].type === "transit" ? legs[0].departure : t0;
      const j: Journey = {
        serviceDate: date,
        departure: dep,
        arrival: r.arr,
        departureIso: serviceTimeToLocalIso(date, dep),
        arrivalIso: serviceTimeToLocalIso(date, r.arr),
        transfers: Math.max(0, transit - 1),
        legs,
      };
      // 先頭が徒歩なら、乗車に間に合う最も遅い出発に寄せる
      if (legs.length >= 2 && legs[0].type === "walk" && legs[1].type === "transit") {
        j.departure = legs[1].departure - legs[0].duration;
        j.departureIso = serviceTimeToLocalIso(date, j.departure);
      }
      j.fare = this.fare.estimate(j);
      journeys.push(j);
    }
    return journeys;
  }

  /** @internal */
  stopRef(s: number): StopRef {
    const st = this.net.feed.stops[s];
    const r: StopRef = { stopId: st.id, name: st.name };
    if (st.parent) r.stationId = st.parent;
    return r;
  }

  /** @internal */
  fpInfo(a: number, b: number): { dur: number; src: WalkSource; confidence: Confidence } {
    const net = this.net;
    for (let e = net.fpStart[a]; e < net.fpStart[a + 1]; e++) {
      if (net.fpTo[e] === b) {
        const s = net.fpSrc[e];
        return { dur: net.fpDur[e], confidence: confidenceFromCode(net.fpConf[e]), src: s === FP_TRANSFER ? "transfer" : s === FP_STATION ? "station" : s === FP_GEO ? "geo" : "geo" };
      }
    }
    throw new Error(`内部エラー：徒歩のつながりが見つからない ${a}→${b}`);
  }

  private reconstruct(
    k: number,
    target: number,
    date: string,
    days: PatternDay[],
    L: {
      arrTrip: Int32Array[];
      walkFrom: Int32Array[];
      boardFrom: Int32Array[];
      lblPat: Int32Array[];
      lblInst: Int32Array[];
      lblBoardPos: Int32Array[];
      lblAlightPos: Int32Array[];
    },
  ): Leg[] {
    const legs: Leg[] = [];
    const net = this.net;
    const f = net.feed;
    // 目的地：乗車で着いたか、乗車のあと歩いたか
    let s = target;
    const wf = L.walkFrom[k][s];
    if (k === 0) {
      if (wf !== ORIGIN && wf >= 0) {
        const fi = this.fpInfo(wf, s);
        legs.push({ type: "walk", from: this.stopRef(wf), to: this.stopRef(s), duration: fi.dur, source: fi.src, confidence: fi.confidence });
      }
      return legs;
    }
    if (wf !== s) {
      const fi = this.fpInfo(wf, s);
      legs.push({ type: "walk", from: this.stopRef(wf), to: this.stopRef(s), duration: fi.dur, source: fi.src, confidence: fi.confidence });
      s = wf;
    }
    let round = k;
    // s には round で乗車して着いた
    for (;;) {
      const p = L.lblPat[round][s];
      if (p < 0) throw new Error(`内部エラー：経路の復元に失敗（round ${round}, stop ${f.stops[s].id}）`);
      const t = L.lblInst[round][s];
      const bp = L.lblBoardPos[round][s];
      const ap = L.lblAlightPos[round][s];
      const pat = net.patterns[p];
      const pd = days[p];
      const Ls = pat.stops.length;
      const trip = f.trips[pd.trip[t]];
      const route = f.routes[pat.routeIdx];
      const dep = pd.dep[t * Ls + bp];
      const arr = pd.arr[t * Ls + ap];
      legs.push({
        type: "transit",
        mode: pat.mode,
        routeId: route.id,
        routeName: route.shortName || route.longName,
        tripId: trip.id,
        headsign: trip.headsign,
        from: this.stopRef(pat.stops[bp]),
        to: this.stopRef(pat.stops[ap]),
        departure: dep,
        arrival: arr,
        departureIso: serviceTimeToLocalIso(date, dep),
        arrivalIso: serviceTimeToLocalIso(date, arr),
        intermediateStops: ap - bp - 1,
      });
      // 乗車した停留所に、どうやって round-1 で乗れる状態になったか
      let b = pat.stops[bp];
      let r = round - 1;
      while (r > 0 && L.boardFrom[r][b] === CARRY) r--;
      const from = L.boardFrom[r][b];
      if (r === 0) {
        if (from !== ORIGIN) {
          const fi = this.fpInfo(from, b);
          legs.push({ type: "walk", from: this.stopRef(from), to: this.stopRef(b), duration: fi.dur, source: fi.src, confidence: fi.confidence });
        }
        break;
      }
      if (from === b) {
        const ch = net.selfChange[b];
        if (ch > 0) legs.push({ type: "walk", from: this.stopRef(b), to: this.stopRef(b), duration: ch, source: "change", confidence: confidenceFromCode(net.selfChangeConf[b]) });
      } else {
        const fi = this.fpInfo(from, b);
        legs.push({ type: "walk", from: this.stopRef(from), to: this.stopRef(b), duration: fi.dur, source: fi.src, confidence: fi.confidence });
        b = from;
      }
      s = b;
      round = r;
    }
    legs.reverse();
    return legs;
  }
}

type WalkSource = "transfer" | "station" | "geo";

export { DAY };
