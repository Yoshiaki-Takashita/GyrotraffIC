// 照合の土台。同じ入力（cases）を GyrotraffIC と OpenTripPlanner（比較の基準）に流し、
// どちらの結果も同じ形（results）にして比べる。OTP 自体はここでは入れない・走らせない。
import type { Journey } from "./journey.js";

export const CASES_FORMAT = "gyrotraffic-cases/1";
export const RESULTS_FORMAT = "gyrotraffic-results/1";

export interface CaseFile {
  format: typeof CASES_FORMAT;
  /** 使った GTFS の説明（パス・版・取得日）。比べる両方で同じものを使う */
  gtfs: string;
  timezone: string;
  cases: Case[];
}

export interface Case {
  id: string;
  from: string;
  to: string;
  /** どちらか一方。ISO 日時（時差付きを推奨） */
  depart?: string;
  arriveBy?: string;
  maxTransfers?: number;
  /** 手で書いた期待値（任意）。合成の試験で使う */
  expected?: { arrival?: string; transfers?: number; routeIds?: string[] }[];
}

export interface ResultFile {
  format: typeof RESULTS_FORMAT;
  engine: string;
  createdAt: string;
  results: CaseResult[];
}

export interface CaseResult {
  id: string;
  error?: string;
  itineraries: Itinerary[];
}

export interface Itinerary {
  /** 現地時刻 "YYYY-MM-DDTHH:MM:SS"（時差なし） */
  departure: string;
  arrival: string;
  transfers: number;
  legs: { mode: string; routeId: string; from: string; to: string; departure: string; arrival: string }[];
}

export function journeyToItinerary(j: Journey): Itinerary {
  return {
    departure: j.departureIso,
    arrival: j.arrivalIso,
    transfers: j.transfers,
    legs: j.legs
      .filter((l) => l.type === "transit")
      .map((l) =>
        l.type === "transit"
          ? { mode: l.mode, routeId: l.routeId, from: l.from.stopId, to: l.to.stopId, departure: l.departureIso, arrival: l.arrivalIso }
          : (null as never),
      ),
  };
}

/**
 * OTP 2 の GraphQL（plan）の応答 → 共通の形（雛形・実物の OTP では未確認＝不明）。
 * 想定する問い合わせ：plan { itineraries { startTime endTime legs { mode startTime endTime
 *   route { gtfsId } from { stop { gtfsId } } to { stop { gtfsId } } } } }
 * 時刻はミリ秒の UNIX 時刻、gtfsId は "フィードID:元のID"。
 */
export function otpPlanToItineraries(plan: unknown, timezone: string): Itinerary[] {
  const p = plan as {
    data?: { plan?: { itineraries?: OtpItin[] } };
    plan?: { itineraries?: OtpItin[] };
  };
  const its = p.data?.plan?.itineraries ?? p.plan?.itineraries ?? [];
  const strip = (id?: string) => (id ? id.replace(/^[^:]*:/, "") : "");
  const iso = (ms: number) => epochToLocalIso(ms, timezone);
  return its.map((it) => {
    const transit = it.legs.filter((l) => l.mode !== "WALK" && l.mode !== "BICYCLE" && l.mode !== "CAR");
    return {
      departure: iso(it.startTime),
      arrival: iso(it.endTime),
      transfers: Math.max(0, transit.length - 1),
      legs: transit.map((l) => ({
        mode: l.mode.toLowerCase(),
        routeId: strip(l.route?.gtfsId),
        from: strip(l.from?.stop?.gtfsId),
        to: strip(l.to?.stop?.gtfsId),
        departure: iso(l.startTime),
        arrival: iso(l.endTime),
      })),
    };
  });
}

interface OtpItin {
  startTime: number;
  endTime: number;
  legs: { mode: string; startTime: number; endTime: number; route?: { gtfsId?: string }; from?: { stop?: { gtfsId?: string } }; to?: { stop?: { gtfsId?: string } } }[];
}

export function epochToLocalIso(ms: number, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const g = (t: string) => parts.find((x) => x.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}:${g("second")}`;
}

function isoSec(s: string): number {
  return Date.parse(s + "Z") / 1000;
}

export interface CompareRow {
  id: string;
  status: "match" | "diff" | "missing";
  /** 最も早い到着の差（秒、a − b） */
  earliestArrivalDiff: number | null;
  /** 最少の乗り換え回数の差（a − b） */
  minTransfersDiff: number | null;
  note: string;
}

/** 2 つの結果を比べる。到着の差が toleranceSec 以内で、最少の乗り換え回数が同じなら一致 */
export function compareResults(a: ResultFile, b: ResultFile, toleranceSec = 300): CompareRow[] {
  const bm = new Map(b.results.map((r) => [r.id, r]));
  const rows: CompareRow[] = [];
  for (const ra of a.results) {
    const rb = bm.get(ra.id);
    if (!rb || ra.itineraries.length === 0 || rb.itineraries.length === 0) {
      const both = (rb?.itineraries.length ?? 0) === 0 && ra.itineraries.length === 0;
      rows.push({ id: ra.id, status: both ? "match" : "missing", earliestArrivalDiff: null, minTransfersDiff: null, note: both ? "どちらも経路なし" : "片方だけ経路なし" });
      continue;
    }
    const ea = Math.min(...ra.itineraries.map((i) => isoSec(i.arrival)));
    const eb = Math.min(...rb.itineraries.map((i) => isoSec(i.arrival)));
    const ta = Math.min(...ra.itineraries.map((i) => i.transfers));
    const tb = Math.min(...rb.itineraries.map((i) => i.transfers));
    const d = ea - eb;
    const ok = Math.abs(d) <= toleranceSec && ta === tb;
    rows.push({ id: ra.id, status: ok ? "match" : "diff", earliestArrivalDiff: d, minTransfersDiff: ta - tb, note: ok ? "" : `到着差 ${d} 秒・乗り換え差 ${ta - tb}` });
  }
  return rows;
}
