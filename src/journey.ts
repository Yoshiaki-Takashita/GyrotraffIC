// 探索結果（経路）の形。照合用 JSON（validation/）もこの形を元にする。
import type { Mode } from "./modes.js";
import type { FareEstimate } from "./fare.js";
import type { Confidence } from "./provenance.js";

export interface StopRef {
  stopId: string;
  name: string;
  /** 親の駅（parent_station）があればその ID */
  stationId?: string;
}

export interface TransitLeg {
  type: "transit";
  mode: Mode;
  routeId: string;
  routeName: string;
  tripId: string;
  headsign: string;
  from: StopRef;
  to: StopRef;
  /** 運行日の 0 時からの秒（24 時超えあり。前日の便は負にならないよう日付で調整して返す） */
  departure: number;
  arrival: number;
  departureIso: string;
  arrivalIso: string;
  /** 途中の停車駅の数（乗車・降車駅を除く） */
  intermediateStops: number;
}

export interface WalkLeg {
  type: "walk";
  from: StopRef;
  to: StopRef;
  /** 秒 */
  duration: number;
  /** "transfer"＝transfers.txt・"station"＝同じ駅のホーム間・"geo"＝直線距離からの推定・"change"＝同じ停留所での乗り換え時間 */
  source: "transfer" | "station" | "geo" | "change";
  /** duration の確信度。transfers.txt の min_transfer_time なら確（confirmed）、距離や既定値からの推定なら推（inferred） */
  confidence?: Confidence;
}

export type Leg = TransitLeg | WalkLeg;

export interface Journey {
  /** 問い合わせの運行日 YYYYMMDD（時刻の基準） */
  serviceDate: string;
  departure: number;
  arrival: number;
  departureIso: string;
  arrivalIso: string;
  transfers: number;
  legs: Leg[];
  fare?: FareEstimate | null;
}
