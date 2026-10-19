// 新宿駅の下書きモデル（data/shinjuku/shinjuku-station.json）を、駅の立体図で読める形にする変換（依存ゼロ・UMD）。
// 元のデータは別担当の成果なので書き換えない。ここでは写しを作って、次のことだけをする：
//   1. 壊れた所を捨てる（座標や階のない点、端のない辺）。捨てた数は dropped に残す。
//   2. null や空（号車・ドア・線路・ホームの名前）はそのまま「不明」として持つ（作り話で埋めない）。
//   3. 推測の接続（guess）を足す。どれも conf「推」・src「viewer-guess」・guess:true で、「確」にはしない。
//      a) かたまり同士の橋：小さなかたまり（3 点以上）の点と、いちばん大きなかたまりの同じ階の点が BRIDGE_M 以内なら、歩く辺で結ぶ。
//      b) ホームの上の階段・エスカレーター・エレベーター：東京都データには多角形はあるが歩行ネットワークに載っていない
//         （JR の 1〜16 番線・小田急のホームがこれ）。ホームの多角形の中にある施設の点を、そのホームの昇降口（access）に入れ、
//         別の階にある「同じ種類で、ネットワークに載っている点」のうち水平に VERT_M 以内のいちばん近いものと結ぶ。
//         どの階のどの点に本当に通じているかは資料にない。だから推測。経路に使ったときは画面に「推測の接続」と出す。
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.GT = root.GT || {}; root.GT.shinjukuView = api; }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var BRIDGE_M = 5, VERT_M = 12;
  var VERT_KINDS = { stairs: 1, escalator: 1, elevator: 1 };
  var FACILITY = ["toilet", "stairs", "escalator", "elevator", "exit", "gate", "platform"];

  function inside(x, y, poly) {
    var c = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var x1 = poly[i][0], y1 = poly[i][1], x2 = poly[j][0], y2 = poly[j][1];
      if ((y1 > y) !== (y2 > y) && x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-12) + x1) c = !c;
    }
    return c;
  }
  function fin(v) { return typeof v === "number" && isFinite(v); }

  // 無向のつながりの成分（station-graph.js の components と同じ考え。変換をこのファイルだけで完結させるため写した）
  function comps(nodes, edges) {
    var par = {};
    function f(x) { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; }
    edges.forEach(function (e) {
      if (par[e.a] === undefined) par[e.a] = e.a; if (par[e.b] === undefined) par[e.b] = e.b;
      var a = f(e.a), b = f(e.b); if (a !== b) par[a] = b;
    });
    var cnt = {}; Object.keys(par).forEach(function (k) { var r = f(k); cnt[r] = (cnt[r] || 0) + 1; });
    var roots = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; }), num = {};
    roots.forEach(function (r, i) { num[r] = i; });
    var of = {}; Object.keys(par).forEach(function (k) { of[k] = num[f(k)]; });
    return { of: of, sizes: roots.map(function (r) { return cnt[r]; }) };
  }

  function convert(raw, opts) {
    opts = opts || {};
    var useGuess = opts.guess !== false;
    raw = raw || {};
    var levels = (raw.levels || []).filter(function (l) { return l && l.id && fin(l.z); });
    var LV = {}; levels.forEach(function (l) { LV[l.id] = l; });
    var dropped = { nodes: 0, edges: 0, areas: 0 };
    var nodes = [], N = {};
    (raw.nodes || []).forEach(function (n) {
      if (!n || !n.id || !fin(n.x) || !fin(n.y) || !LV[n.level] || N[n.id]) { dropped.nodes++; return; }
      var c = Object.assign({}, n); nodes.push(c); N[c.id] = c;
    });
    var edges = [];
    (raw.edges || []).forEach(function (e) {
      if (!e || !N[e.a] || !N[e.b]) { dropped.edges++; return; }
      edges.push(Object.assign({}, e));
    });
    var areas = (raw.areas || []).filter(function (a) {
      var ok = a && LV[a.level] && Array.isArray(a.rect) && a.rect.length === 4 && a.rect.every(fin);
      if (!ok) dropped.areas++;
      return ok;
    }).map(function (a) { return Object.assign({}, a, { poly: Array.isArray(a.poly) && a.poly.length >= 3 ? a.poly : null }); });
    var A = {}; areas.forEach(function (a) { A[a.id] = a; });
    var platforms = (raw.platforms || []).filter(function (p) { return p && p.id && LV[p.level]; }).map(function (p) {
      var c = Object.assign({}, p);
      c.access = (p.access || []).filter(function (id) { return N[id]; });
      c.nameKnown = !!p.name;
      c.label = p.name ? String(p.name).replace(/\s+/g, " ") : null;   // 表示用（null は画面で「名前不明」）
      return c;
    });

    var before = comps(nodes, edges);
    var guesses = { bridge: 0, platformAccess: 0, vertical: 0 };
    if (useGuess) {
      // a) かたまり同士の橋
      var deg = {}; edges.forEach(function (e) { deg[e.a] = 1; deg[e.b] = 1; });
      var mainNodes = nodes.filter(function (n) { return before.of[n.id] === 0; });
      for (var ci = 1; ci < before.sizes.length; ci++) {
        if (before.sizes[ci] < 3) continue;
        var bestB = null;
        nodes.forEach(function (n) {
          if (before.of[n.id] !== ci) return;
          mainNodes.forEach(function (m) {
            if (m.level !== n.level) return;
            var d = Math.hypot(m.x - n.x, m.y - n.y);
            if (d <= BRIDGE_M && (!bestB || d < bestB.d)) bestB = { a: n.id, b: m.id, d: d };
          });
        });
        if (bestB) {
          edges.push({ a: bestB.a, b: bestB.b, m: +bestB.d.toFixed(2), sec: +(bestB.d / 1.2).toFixed(1), kind: "walk", src: "viewer-guess", conf: "推", guess: true,
            note: "ビューアの推測：別のかたまりの、同じ階で " + BRIDGE_M + " m 以内のいちばん近い点どうしを結んだ。実際の通路は未確認" });
          guesses.bridge++;
        }
      }
      // b) ホームの上の施設 → 昇降口と、別の階の同じ種類の点
      var after1 = comps(nodes, edges);
      var netByKind = {};
      nodes.forEach(function (n) { if (after1.of[n.id] === 0 && VERT_KINDS[n.kind]) (netByKind[n.kind] = netByKind[n.kind] || []).push(n); });
      platforms.forEach(function (p) {
        var ar = A[p.area]; if (!ar || !ar.poly) return;
        nodes.forEach(function (n) {
          if (n.level !== p.level || !VERT_KINDS[n.kind] || deg[n.id] || !inside(n.x, n.y, ar.poly)) return;
          if (p.access.indexOf(n.id) < 0) { p.access.push(n.id); guesses.platformAccess++; p.accessGuess = true; }
          var best = null;
          (netByKind[n.kind] || []).forEach(function (m) {
            if (m.level === n.level) return;
            var d = Math.hypot(m.x - n.x, m.y - n.y);
            if (d <= VERT_M && (!best || d < best.d)) best = { m: m, d: d };
          });
          if (!best) return;
          var dz = Math.abs(LV[best.m.level].z - LV[n.level].z), len = Math.hypot(best.d, dz);
          edges.push({ a: n.id, b: best.m.id, m: +len.toFixed(2), sec: +(len / 1.2).toFixed(1), kind: n.kind, src: "viewer-guess", conf: "推", guess: true,
            note: "ビューアの推測：ホームの上の" + n.kind + "を、別の階の同じ種類の点（水平 " + best.d.toFixed(1) + " m）と結んだ。行き先の階は資料になく未確認" });
          guesses.vertical++;
        });
      });
    }
    var after = comps(nodes, edges);
    function reach(c) {
      var r = { platforms: 0, platformsTotal: platforms.length, groundExits: 0, groundExitsTotal: 0, gates: 0, gatesTotal: 0 };
      platforms.forEach(function (p) { if (p.access.some(function (id) { return c.of[id] === 0; })) r.platforms++; });
      nodes.forEach(function (n) {
        if (n.kind === "exit" && n.ground) { r.groundExitsTotal++; if (c.of[n.id] === 0) r.groundExits++; }
        if (n.kind === "gate") { r.gatesTotal++; if (c.of[n.id] === 0) r.gates++; }
      });
      return r;
    }
    var counts = {};
    FACILITY.forEach(function (k) { counts[k] = 0; });
    nodes.forEach(function (n) { if (counts[n.kind] !== undefined && n.kind !== "platform") counts[n.kind]++; });
    counts.platform = platforms.length;

    var gateIds = nodes.filter(function (n) { return n.kind === "gate" && after.of[n.id] !== undefined; }).map(function (n) { return n.id; });
    return {
      format: raw.format, id: raw.id || "SHINJUKU_DRAFT", name: raw.name || "新宿駅（下書き）", _draft: raw._draft,
      units: raw.units, origin: raw.origin,
      assumptions: Object.assign({ platformWalkMps: 1.0 }, raw.assumptions || {}),
      sources: raw.sources, confidenceScale: raw.confidenceScale,
      levels: levels, areas: areas, tracks: Array.isArray(raw.tracks) ? raw.tracks : [], platforms: platforms, nodes: nodes, edges: edges,
      targets: (raw.targets || []).filter(function (id) { return N[id] || platforms.some(function (p) { return p.id === id; }); }).concat(gateIds),
      unknown: raw.unknown || [],
      _view: {
        draft: true, dropped: dropped, counts: counts, guesses: guesses,
        components: { before: before.sizes, after: after.sizes },
        reach: { strict: reach(before), withGuess: reach(after) },
        thresholds: { bridgeM: BRIDGE_M, verticalM: VERT_M }
      }
    };
  }
  return { convert: convert, inside: inside, FACILITY: FACILITY, BRIDGE_M: BRIDGE_M, VERT_M: VERT_M };
});
