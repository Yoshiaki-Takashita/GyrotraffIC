// 移動手段の抽象化。「便の時刻表」で表せるもの（鉄道・地下鉄・バス・フェリー・飛行機）は同じ探索に載せる。
// 手段ごとの違い（乗る前の余裕＝搭乗手続きなど）は ModeProfile で与える。

export type Mode = "rail" | "subway" | "tram" | "bus" | "ferry" | "air" | "cable" | "other";

export const ALL_MODES: Mode[] = ["rail", "subway", "tram", "bus", "ferry", "air", "cable", "other"];

/** GTFS の route_type（基本＋拡張）→ 手段 */
export function modeFromRouteType(rt: number): Mode {
  if (rt === 0) return "tram";
  if (rt === 1) return "subway";
  if (rt === 2) return "rail";
  if (rt === 3 || rt === 11) return "bus";
  if (rt === 4) return "ferry";
  if (rt === 5 || rt === 6 || rt === 7 || rt === 12) return "cable";
  if (rt >= 100 && rt < 200) return "rail";
  if (rt >= 200 && rt < 300) return "bus";
  if (rt >= 400 && rt < 500) return "subway";
  if (rt >= 700 && rt < 800) return "bus";
  if (rt >= 900 && rt < 1000) return "tram";
  if (rt >= 1000 && rt < 1100) return "ferry";
  if (rt >= 1100 && rt < 1200) return "air";
  if (rt >= 1200 && rt < 1300) return "ferry";
  if (rt >= 1300 && rt < 1500) return "cable";
  return "other";
}

export interface ModeProfile {
  /** 乗る前に必要な余裕（秒）。到着してから、この秒数以上あとに出る便にだけ乗れる。飛行機の搭乗手続きなど。 */
  boardSlack: number;
}

/** 既定値。飛行機・フェリーの値は推（実際は空港・航路ごとに違う。後で駅・空港ごとの値に置き換える）。 */
export const DEFAULT_MODE_PROFILES: Record<Mode, ModeProfile> = {
  rail: { boardSlack: 0 },
  subway: { boardSlack: 0 },
  tram: { boardSlack: 0 },
  bus: { boardSlack: 0 },
  ferry: { boardSlack: 600 }, // 推：乗船手続き 10 分
  air: { boardSlack: 1800 }, // 推：国内線 30 分
  cable: { boardSlack: 0 },
  other: { boardSlack: 0 },
};
