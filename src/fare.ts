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
