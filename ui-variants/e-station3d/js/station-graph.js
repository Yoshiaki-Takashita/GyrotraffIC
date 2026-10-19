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

  // 費用は（不明の数 u, 推測の接続の数 g, 秒 t）の辞書順。推測の接続（e.guess）は、使わずに行けるならそちらを選ぶ。
  function less(a, b) { return a.u !== b.u ? a.u < b.u : (a.g || 0) !== (b.g || 0) ? (a.g || 0) < (b.g || 0) : a.t < b.t - 1e-9; }

  // 小さな二分ヒープ（新宿の数千点でも速く回るように。以前は open の線形走査だった）
  function Heap() { this.a = []; }
  Heap.prototype.push = function (k, c) {
    var a = this.a, i = a.length; a.push({ k: k, c: c });
    while (i > 0) { var j = (i - 1) >> 1; if (!less(a[i].c, a[j].c)) break; var t = a[i]; a[i] = a[j]; a[j] = t; i = j; }
  };
  Heap.prototype.pop = function () {
    var a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last; var i = 0;
      for (;;) {
        var l = 2 * i + 1, r = l + 1, m = i;
        if (l < a.length && less(a[l].c, a[m].c)) m = l;
        if (r < a.length && less(a[r].c, a[m].c)) m = r;
        if (m === i) break; var t = a[i]; a[i] = a[m]; a[m] = t; i = m;
      }
    }
    return top;
  };

  function hasDoors(p) { return !!p && p.cars != null && p.doors != null && p.carLen != null && p.car1Front != null && p.dir != null && p.axis != null; }

  /**
   * from: { platform, car, door } または { platform }（号車・ドアが不明なホーム。昇降口のどれからでも 0 秒）または { node }
   * to: ホームの id（その昇降口のどれかに着けばよい）または ノードの id
   * opts.stepFree: 階段とエスカレーターを使わない ／ opts.noGuess: 推測の接続（guess）を使わない
   * 戻り値: { ok, sec（分かっている秒の合計）, unknown（不明の区間の数）, guessed（推測の接続の数）, path:[ノードの id], steps:[{a,b,kind,sec,dist?,guess?}] }
   */
  function route(st, from, to, opts) {
    opts = opts || {};
    var N = byId(st.nodes), v = (st.assumptions && st.assumptions.platformWalkMps) || 1.0;
    var adj = {};
    function add(a, b, e) { (adj[a] = adj[a] || []).push({ to: b, e: e }); }
    st.edges.forEach(function (e) {
      if (!e || !N[e.a] || !N[e.b]) return;            // 端のない辺は捨てる（壊れたデータでも止まらない）
      if (opts.stepFree && STEP_KINDS[e.kind]) return;
      if (opts.noGuess && e.guess) return;
      if (e.oneway === "b>a") add(e.b, e.a, e);
      else { add(e.a, e.b, e); if (!e.oneway) add(e.b, e.a, e); }
    });
    var fp = from.platform ? platformOf(st, from.platform) : null;
    var src = from.node || "__door";
    var none = { ok: false, sec: null, unknown: 0, guessed: 0, path: [], steps: [] };
    if (!from.node) {
      if (!fp) return none;
      var acc = (fp.access || []).filter(function (id) { return N[id]; });
      if (hasDoors(fp) && from.car != null && from.door != null) {
        var s = doorS(fp, from.car, from.door);
        acc.forEach(function (id) { var d = Math.abs(nodeS(fp, N[id]) - s); add("__door", id, { kind: "platform", sec: d / v, dist: d }); });
      } else {
        // 号車・ドアが不明：ホームの上を歩く時間は分からないので、不明として数えずに 0 秒・「ホーム」の区間にする
        src = "__plat";
        acc.forEach(function (id) { add("__plat", id, { kind: "platform", sec: 0, dist: null, unknownDoor: true }); });
      }
    } else if (!N[from.node]) return none;
    var tp = platformOf(st, to), goal = {};
    if (tp) (tp.access || []).forEach(function (id) { goal[id] = 1; }); else goal[to] = 1;
    if (from.platform && tp && from.platform === to) return { ok: true, sec: 0, unknown: 0, guessed: 0, path: [], steps: [], same: true };

    var best = {}, prev = {}, done = {};
    best[src] = { u: 0, g: 0, t: 0 };
    var heap = new Heap(); heap.push(src, best[src]);
    var hit = null;
    while (heap.a.length) {
      var cur = heap.pop().k;
      if (done[cur]) continue;
      done[cur] = 1;
      if (goal[cur]) { hit = cur; break; }
      var list = adj[cur] || [];
      for (var i = 0; i < list.length; i++) {
        var x = list[i];
        if (done[x.to]) continue;
        var c = best[cur], g = c.g + (x.e.guess ? 1 : 0);
        var nc = x.e.sec == null ? { u: c.u + 1, g: g, t: c.t } : { u: c.u, g: g, t: c.t + x.e.sec };
        if (!best[x.to] || less(nc, best[x.to])) { best[x.to] = nc; prev[x.to] = { from: cur, e: x.e }; heap.push(x.to, nc); }
      }
    }
    if (!hit) return none;
    var path = [hit], steps = [];
    for (var n = hit; prev[n]; n = prev[n].from) {
      var e = prev[n].e;
      steps.unshift({ a: prev[n].from, b: n, kind: e.kind, sec: e.sec, dist: e.dist, guess: !!e.guess, unknownDoor: !!e.unknownDoor });
      path.unshift(prev[n].from);
    }
    return { ok: true, sec: best[hit].t, unknown: best[hit].u, guessed: best[hit].g, path: path, steps: steps };
  }

  /** つながりの成分（無向）。戻り値: { of: {ノードの id: 成分の番号}, sizes: [大きい順の点の数] }（辺のない点は数えない） */
  function components(st) {
    var par = {};
    function f(x) { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; }
    var ids = {}; st.nodes.forEach(function (n) { ids[n.id] = 1; });
    st.edges.forEach(function (e) {
      if (!ids[e.a] || !ids[e.b]) return;
      if (par[e.a] === undefined) par[e.a] = e.a; if (par[e.b] === undefined) par[e.b] = e.b;
      var a = f(e.a), b = f(e.b); if (a !== b) par[a] = b;
    });
    var cnt = {};
    Object.keys(par).forEach(function (k) { var r = f(k); cnt[r] = (cnt[r] || 0) + 1; });
    var roots = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; }), num = {};
    roots.forEach(function (r, i) { num[r] = i; });
    var of = {}; Object.keys(par).forEach(function (k) { of[k] = num[f(k)]; });
    return { of: of, sizes: roots.map(function (r) { return cnt[r]; }) };
  }

  /** そのホームのすべての号車・ドアで調べ、乗換先にいちばん早く着くドアを返す */
  function bestDoor(st, platformId, to, opts) {
    var p = platformOf(st, platformId), top = null;
    if (!hasDoors(p)) return null;   // 号車・ドアが不明なホームでは提案しない
    for (var c = 1; c <= p.cars; c++) for (var d = 1; d <= p.doors; d++) {
      var r = route(st, { platform: platformId, car: c, door: d }, to, opts);
      if (!r.ok) continue;
      if (!top || less({ u: r.unknown, t: r.sec }, { u: top.r.unknown, t: top.r.sec })) top = { car: c, door: d, r: r };
    }
    return top;
  }

  return { route: route, bestDoor: bestDoor, components: components, hasDoors: hasDoors, less: less, doorS: doorS, doorXY: doorXY, carRange: carRange, platformOf: platformOf, STEP_KINDS: STEP_KINDS };
});
