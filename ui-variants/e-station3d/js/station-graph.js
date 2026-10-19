// 駅の中の最短経路（依存ゼロ）。ノード＝ホームの昇降口・階段・改札・通路の点、辺＝歩く秒数。
// コアの src/ は時刻表の RAPTOR で、駅の中のグラフの最短路は持っていないため、ここで小さなダイクストラを書いた（DESIGN.md）。
// 秒数が「不明」（sec:null）の辺は、時間を足さずに「不明の区間の数」を数える。費用は（不明の数, 秒）の辞書順で比べる
// ＝不明を通らずに行けるならそちらを選び、どうしても通るなら不明の数が最も少ない道を選ぶ。
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.GT = root.GT || {}; root.GT.stationGraph = api; }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var STEP_KINDS = { stairs: 1, escalator: 1 };

  function byId(list) { var m = {}; list.forEach(function (x) { m[x.id] = x; }); return m; }
  function platformOf(st, id) { return st.platforms.find(function (p) { return p.id === id; }) || null; }
  function nodeS(p, n) { return p.axis === "x" ? n.x : n.y; }

  /** 号車 car（1 始まり）・ドア door（1 始まり、1 号車の側から数える）の、ホームの軸の上の位置 s（m） */
  function doorS(p, car, door) {
    var front = p.car1Front + p.dir * p.carLen * (car - 1);   // その号車の 1 号車側の端
    return front + p.dir * (door - 0.5) * (p.carLen / p.doors);
  }
  function doorXY(st, p, car, door) {
    var s = doorS(p, car, door);
    return p.axis === "x" ? { x: s, y: p.center, level: p.level } : { x: p.center, y: s, level: p.level };
  }
  function carRange(p, car) {
    var a = p.car1Front + p.dir * p.carLen * (car - 1), b = a + p.dir * p.carLen;
    return [Math.min(a, b), Math.max(a, b)];
  }

  function less(a, b) { return a.u !== b.u ? a.u < b.u : a.t < b.t - 1e-9; }

  /**
   * from: { platform, car, door } または { node }
   * to: ホームの id（その昇降口のどれかに着けばよい）または ノードの id
   * opts.stepFree: 階段とエスカレーターを使わない
   * 戻り値: { ok, sec（分かっている秒の合計）, unknown（不明の区間の数）, path:[ノードの id], steps:[{a,b,kind,sec,dist?}] }
   */
  function route(st, from, to, opts) {
    opts = opts || {};
    var N = byId(st.nodes), v = (st.assumptions && st.assumptions.platformWalkMps) || 1.0;
    var adj = {};
    function add(a, b, e) { (adj[a] = adj[a] || []).push({ to: b, e: e }); }
    st.edges.forEach(function (e) {
      if (opts.stepFree && STEP_KINDS[e.kind]) return;
      add(e.a, e.b, e); if (!e.oneway) add(e.b, e.a, e);
    });
    var src = from.node || "__door";
    if (!from.node) {
      var p = platformOf(st, from.platform), s = doorS(p, from.car, from.door);
      p.access.forEach(function (id) {
        var d = Math.abs(nodeS(p, N[id]) - s);
        add("__door", id, { kind: "platform", sec: d / v, dist: d });
      });
    }
    var tp = platformOf(st, to), goal = {};
    if (tp) tp.access.forEach(function (id) { goal[id] = 1; }); else goal[to] = 1;
    if (from.platform && tp && from.platform === to) return { ok: true, sec: 0, unknown: 0, path: [], steps: [], same: true };

    var best = {}, prev = {}, done = {};
    best[src] = { u: 0, t: 0 };
    var open = [src];
    var hit = null;
    while (open.length) {
      var bi = 0;
      for (var i = 1; i < open.length; i++) if (less(best[open[i]], best[open[bi]])) bi = i;
      var cur = open.splice(bi, 1)[0];
      if (done[cur]) continue;
      done[cur] = 1;
      if (goal[cur]) { hit = cur; break; }
      (adj[cur] || []).forEach(function (x) {
        if (done[x.to]) return;
        var c = best[cur], nc = x.e.sec == null ? { u: c.u + 1, t: c.t } : { u: c.u, t: c.t + x.e.sec };
        if (!best[x.to] || less(nc, best[x.to])) { best[x.to] = nc; prev[x.to] = { from: cur, e: x.e }; open.push(x.to); }
      });
    }
    if (!hit) return { ok: false, sec: null, unknown: 0, path: [], steps: [] };
    var path = [hit], steps = [];
    for (var n = hit; prev[n]; n = prev[n].from) {
      steps.unshift({ a: prev[n].from, b: n, kind: prev[n].e.kind, sec: prev[n].e.sec, dist: prev[n].e.dist });
      path.unshift(prev[n].from);
    }
    return { ok: true, sec: best[hit].t, unknown: best[hit].u, path: path, steps: steps };
  }

  /** そのホームのすべての号車・ドアで調べ、乗換先にいちばん早く着くドアを返す */
  function bestDoor(st, platformId, to, opts) {
    var p = platformOf(st, platformId), top = null;
    for (var c = 1; c <= p.cars; c++) for (var d = 1; d <= p.doors; d++) {
      var r = route(st, { platform: platformId, car: c, door: d }, to, opts);
      if (!r.ok) continue;
      if (!top || less({ u: r.unknown, t: r.sec }, { u: top.r.unknown, t: top.r.sec })) top = { car: c, door: d, r: r };
    }
    return top;
  }

  return { route: route, bestDoor: bestDoor, doorS: doorS, doorXY: doorXY, carRange: carRange, platformOf: platformOf, STEP_KINDS: STEP_KINDS };
});
