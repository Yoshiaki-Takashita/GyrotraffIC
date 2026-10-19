// データ層（静的サンプル版）。ui/sample/samples.js の window.GT_SAMPLES を返す。
// 後で API 版（例：GET /route?from=&to=&depart=）に差し替える。約束（戻り値の形）は docs/ui-design.md の「データの約束」。
(function (GT) {
  "use strict";
  var S = window.GT_SAMPLES || { routes: [], places: { places: [] }, stopAccess: { stops: {} } };
  GT.providers = GT.providers || {};
  GT.providers["static"] = {
    name: "static-sample",
    /** @returns Promise<Place[]> */
    places: function () { return Promise.resolve(S.places ? S.places.places : []); },
    /**
     * @param q {from, to, mode:"now"|"depart"|"arrive", time?: ISO}
     * @returns Promise<{journeys: Journey[], searchMs:number, sample:boolean}>
     * Journey はコアの src/journey.ts の形そのまま。
     */
    route: function (q) {
      var hit = S.routes.find(function (r) { return r.query.from === q.from && r.query.to === q.to; });
      return Promise.resolve(hit ? { id: hit.id, journeys: hit.journeys, searchMs: hit.searchMs, sample: true } : { id: null, journeys: [], searchMs: 0, sample: true });
    },
    /** 乗り場の位置（コア未対応の拡張・推の形）。stopId → {platform, entrance, heading, confidence, source} */
    stopAccess: function (stopId) { return (S.stopAccess && S.stopAccess.stops[stopId]) || null; }
  };
})(window.GT = window.GT || {});
