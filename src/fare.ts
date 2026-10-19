// 運賃の差し込み口。いまは計算しない（決定 #3：運賃は後）。
// 後で GTFS-Fares・事業者の表・外部 API などを、この形で差し込む。
import type { Journey } from "./journey.js";

export interface FareEstimate {
  /** 金額（最小単位。円なら円） */
  amount: number;
  currency: string;
  /** "estimate"＝目安、"exact"＝確定。日本の鉄道は当面 "estimate" だけの見込み（推） */
  kind: "estimate" | "exact";
  /** 運賃が分からない区間があれば、その区間の番号 */
  unknownLegs: number[];
  note?: string;
}

export interface FareCalculator {
  /** 分からなければ null。経路の探索には影響しない（探索のあとで付ける）。 */
  estimate(journey: Journey): FareEstimate | null;
}

export class NoFareCalculator implements FareCalculator {
  estimate(): FareEstimate | null {
    return null;
  }
}

// ── 運賃の 3 値（core-design.md 4.4）。不明を 0 で埋めない。 ──────────────────────
// Leg ごとに Known（金額・通貨・根拠）／Partial（下限・不明な要素）／Unknown（理由）。

export type FareValue =
  | { kind: "known"; amount: number; currency: string; basis: string }
  | { kind: "partial"; lowerBound: number; currency: string; unknown: string[] }
  | { kind: "unknown"; reason: string };

/**
 * 区間の運賃を合成する。すべて Known なら Known（合計）、1 つでも Unknown なら Unknown、
 * Partial を含めば Partial（下限の合計）。通貨が混ざれば Unknown（換算しない）。区間が無ければ Unknown。
 */
export function combineFares(legs: FareValue[]): FareValue {
  if (legs.length === 0) return { kind: "unknown", reason: "運賃の対象の区間が無い" };
  const unk = legs.filter((l): l is Extract<FareValue, { kind: "unknown" }> => l.kind === "unknown");
  if (unk.length) return { kind: "unknown", reason: unk.map((u) => u.reason).join("／") };
  const cur = new Set(legs.map((l) => (l as { currency: string }).currency));
  if (cur.size > 1) return { kind: "unknown", reason: "通貨が混ざっている（換算しない）" };
  const currency = [...cur][0];
  let sum = 0;
  const missing: string[] = [];
  for (const l of legs) {
    if (l.kind === "known") sum += l.amount;
    else if (l.kind === "partial") {
      sum += l.lowerBound;
      missing.push(...l.unknown);
    }
  }
  if (missing.length) return { kind: "partial", lowerBound: sum, currency, unknown: missing };
  return { kind: "known", amount: sum, currency, basis: legs.map((l) => (l as { basis: string }).basis).join("＋") };
}

/** 「安い」案：Known の中だけで最小の添字。Partial・Unknown は順位に入れない。無ければ -1 */
export function cheapestKnown(fares: FareValue[]): number {
  let best = -1;
  for (let i = 0; i < fares.length; i++) {
    const f = fares[i];
    if (f.kind !== "known") continue;
    const b = fares[best];
    if (best < 0 || (b.kind === "known" && f.amount < b.amount)) best = i;
  }
  return best;
}

/** 画面の古い形（FareEstimate）に直す。Unknown は null（「運賃不明」と表示される。0 にしない） */
export function fareValueToEstimate(f: FareValue, unknownLegs: number[] = []): FareEstimate | null {
  if (f.kind === "unknown") return null;
  if (f.kind === "known") return { amount: f.amount, currency: f.currency, kind: "estimate", unknownLegs, note: f.basis };
  return { amount: f.lowerBound, currency: f.currency, kind: "estimate", unknownLegs: unknownLegs.length ? unknownLegs : [-1], note: "下限。不明：" + f.unknown.join("・") };
}
