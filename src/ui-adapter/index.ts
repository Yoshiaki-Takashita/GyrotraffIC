// 画面と中枢をつなぐ薄い層。
// ui-variants/e-station3d/js/data/static-provider.js と同じ約束（戻り値の形）で、中枢（Router）の出力を返す。
//   places()          → Promise<Place[]>
//   route(q)          → Promise<{ id, journeys, searchMs, sample, provenance }>
//   stopAccess(stopId)→ 乗り場の位置（中枢はまだ持たないので常に null＝不明。推測で作らない）
// 画面のコード（ui-variants/）は変えない。ブラウザで使うときは、この provider を GT.providers に登録する形を想定する。
import type { Router } from "../raptor.js";
import type { Journey, Leg } from "../journey.js";
import type { Mode } from "../modes.js";
import { isoToServiceTime } from "../time.js";
import { weakest, type Confidence, type FeedSource } from "../provenance.js";

export interface UiPlace {
  id: string;
  name: string;
  kind: "station" | "bus_stop" | "airport";
  lat: number;
  lon: number;
}

export interface UiRouteQuery {
  from: string;
  to: string;
  /** 省略は "now" */
  mode?: "now" | "depart" | "arrive";
  /** ISO（時差つきでも無しでも可）。mode が depart / arrive のとき使う */
  time?: string;
}

/** 経路 1 本の来歴の要約（区間ごとの値は legs の中にある） */
export interface UiJourneyProvenance {
  /** 時刻：時刻表（データ源）の値なので確。ただしデータ源そのものの正しさは feed の来歴に従う */
  times: Confidence;
  /** 徒歩・乗り換え時間：区間の確信度のうち最も弱いもの。徒歩が無ければ確 */
  walks: Confidence;
  /** 運賃：運賃計算が無いときは不明（0 にしない） */
  fare: Confidence;
}

export type UiJourney = Journey & { provenance: UiJourneyProvenance };

export interface UiRouteResult {
  id: string | null;
  journeys: UiJourney[];
  searchMs: number;
  /** 見本データかどうか。中枢の出力なので false（データ源が合成なら feed.id で分かる） */
  sample: boolean;
  provenance: { engine: "gyrotraffic-raptor"; feed: FeedSource; query: { date: string; time: number; mode: "now" | "depart" | "arrive" } };
  /** 探索しなかった・できなかった理由（停留所が無い等）。あれば journeys は空 */
  error?: string;
}

export interface UiProvider {
  name: string;
  places(): Promise<UiPlace[]>;
  route(q: UiRouteQuery): Promise<UiRouteResult>;
  stopAccess(stopId: string): null;
}

export interface CoreProviderOptions {
  /** 時刻表の出どころ。分からない項目は null のまま渡す */
  feed: FeedSource;
  /** "now" の時刻（試験のため差し替えられる）。既定は実時計 */
  now?: () => Date;
  maxTransfers?: number;
  modes?: Mode[];
}

function legConfidence(l: Leg): Confidence {
  if (l.type === "transit") return "confirmed";
  return l.confidence ?? "unknown";
}

export function journeyProvenance(j: Journey): UiJourneyProvenance {
  const walks = j.legs.filter((l) => l.type === "walk").map(legConfidence);
  return {
    times: "confirmed",
    walks: walks.length ? weakest(walks) : "confirmed",
    fare: j.fare ? "inferred" : "unknown",
  };
}

export function createCoreProvider(router: Router, opts: CoreProviderOptions): UiProvider {
  const feed = router.net.feed;
  const tz = feed.timezone;
  const now = opts.now ?? (() => new Date());

  // 停留所の種類：通るパターンの手段から決める（飛行機→空港、バスだけ→バス停、それ以外→駅）
  const modesAt = (i: number): Set<Mode> => {
    const out = new Set<Mode>();
    const kids = router.net.children.get(feed.stops[i].id) ?? [];
    for (const s of [i, ...kids])
      for (let k = router.net.spStart[s]; k < router.net.spStart[s + 1]; k++) out.add(router.net.patterns[router.net.spPat[k]].mode);
    return out;
  };

  return {
    name: "core-raptor",
    places() {
      const out: UiPlace[] = [];
      feed.stops.forEach((s, i) => {
        // 駅（location_type=1）と、親の無い乗り場だけを場所にする
        if (!(s.locationType === 1 || (s.locationType === 0 && !s.parent))) return;
        const m = modesAt(i);
        const kind: UiPlace["kind"] = m.has("air") ? "airport" : m.size > 0 && [...m].every((x) => x === "bus") ? "bus_stop" : "station";
        out.push({ id: s.id, name: s.name, kind, lat: s.lat, lon: s.lon });
      });
      return Promise.resolve(out);
    },
    route(q) {
      const mode = q.mode ?? "now";
      const t0 = Date.now();
      let st: { date: string; time: number };
      try {
        st = mode === "now" || !q.time ? isoToServiceTime(now().toISOString(), tz) : isoToServiceTime(q.time, tz);
      } catch (e) {
        st = { date: "", time: 0 };
        return Promise.resolve(empty(`日時が読めない：${(e as Error).message}`));
      }
      const base = { engine: "gyrotraffic-raptor" as const, feed: opts.feed, query: { ...st, mode } };
      function empty(error: string): UiRouteResult {
        return { id: null, journeys: [], searchMs: 0, sample: false, provenance: { engine: "gyrotraffic-raptor", feed: opts.feed, query: { ...st, mode } }, error };
      }
      let js: Journey[];
      try {
        js =
          mode === "arrive"
            ? router.arriveBy({ from: q.from, to: q.to, date: st.date, arriveBy: st.time, maxTransfers: opts.maxTransfers, modes: opts.modes })
            : router.depart({ from: q.from, to: q.to, date: st.date, time: st.time, maxTransfers: opts.maxTransfers, modes: opts.modes });
      } catch (e) {
        return Promise.resolve(empty((e as Error).message));
      }
      const journeys: UiJourney[] = js.map((j) => ({ ...j, fare: j.fare ?? null, provenance: journeyProvenance(j) }));
      return Promise.resolve({
        id: `${q.from}>${q.to}@${st.date}T${st.time}`,
        journeys,
        searchMs: Date.now() - t0,
        sample: false,
        provenance: base,
      });
    },
    stopAccess() {
      return null;
    },
  };
}
