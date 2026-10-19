// 来歴（出どころ）と確信度。中枢設計 core-design.md の P3（不明は値として持つ）・P4（出どころを付ける）に合わせる。
// 確信度は 3 段：確（confirmed）＝データ源に書いてある値、推（inferred）＝推定・既定値、不明（unknown）＝分からない。
// 不明を 0 などで埋めない。不明な値は value を null にして、理由を basis に書く。

export type Confidence = "confirmed" | "inferred" | "unknown";

/** 画面の表示用の短い印 */
export const CONFIDENCE_LABEL: Record<Confidence, "確" | "推" | "不明"> = {
  confirmed: "確",
  inferred: "推",
  unknown: "不明",
};

/** 型付き配列に詰めるときの番号 */
export const CONF_CONFIRMED = 0;
export const CONF_INFERRED = 1;
export const CONF_UNKNOWN = 2;

export function confidenceFromCode(c: number): Confidence {
  return c === CONF_CONFIRMED ? "confirmed" : c === CONF_INFERRED ? "inferred" : "unknown";
}

/** 出どころつきの値。value が null なら不明（confidence は必ず "unknown"） */
export interface Sourced<T> {
  value: T | null;
  confidence: Confidence;
  /** 根拠（例 "transfers.txt min_transfer_time"、"既定値 120 秒"、理由） */
  basis: string;
}

export function confirmed<T>(value: T, basis: string): Sourced<T> {
  return { value, confidence: "confirmed", basis };
}
export function inferred<T>(value: T, basis: string): Sourced<T> {
  return { value, confidence: "inferred", basis };
}
export function unknown<T = never>(reason: string): Sourced<T> {
  return { value: null, confidence: "unknown", basis: reason };
}

/** 複数の値をまとめた確信度：1 つでも不明なら不明、推を含めば推、すべて確なら確 */
export function weakest(cs: Confidence[]): Confidence {
  if (cs.includes("unknown")) return "unknown";
  if (cs.includes("inferred")) return "inferred";
  return "confirmed";
}

/** 時刻表の出どころ（データ源・版・ライセンス）。分からない項目は null（埋めない） */
export interface FeedSource {
  /** データ源 ID（例 "gtfsjp.shiokaze"・"synthetic"） */
  id: string;
  /** 版（feed_version やスナップショット ID）。不明なら null */
  version: string | null;
  /** ライセンス（例 "CC BY 4.0"）。不明なら null */
  license: string | null;
  /** 出典の表示の文言。不明なら null */
  attribution: string | null;
}
