// 駅の立体図の描画（依存ゼロ・Canvas 2D）。黒い面に「枠線だけが白く光る」線画。
// 手法は GNOTO の 3D 音響スタジオ（addons/mstudio-hallview.js）を参考にした：
//   ・面は描かず、線分だけを白で描く（LineSegments＋白一色）
//   ・足し算の合成（AdditiveBlending）＝線が重なる所ほど明るい
//   ・奥行きで薄くする（lineF の uFade：1 − 0.74 × smoothstep(near, far, 奥行き)）
//   ・光のにじみ（UnrealBloomPass 強さ .42・半径 .38）→ ここでは同じ線を太く淡く重ね描きして近づけた
// GNOTO は three.js（WebGL）だが、この試作は外部のライブラリ・CDN を使わない約束なので、投影も自前で書いた（DESIGN.md）。
// 新宿の下書き（st._view.draft）では、区画は多角形の床の輪郭、施設は種類ごとの枠線の記号（画面上で一定の大きさ）で描き、
// 種類ごとの表示のオン／オフ・階ごとの強調（他の階は薄く）・視錐台の外の省略・1 コマ 1 回の投影で数千点を回す。
(function (GT) {
  "use strict";
  var DEG = Math.PI / 180;
  var WHITE = "235,242,245", ACC = "95,214,195", AMBER = "240,178,78";

  function smooth(a, b, x) { var t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

  function create(canvas, st, opts) {
    opts = opts || {};
    var ctx = canvas.getContext("2d");
    var L = {}; st.levels.forEach(function (l) { L[l.id] = l; });
    var N = {}; st.nodes.forEach(function (n) { N[n.id] = n; });
    // 駅の大きさ（全体が収まる距離を決める）
    var draft = !!(st._view && st._view.draft);
    var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    st.areas.forEach(function (a) { minX = Math.min(minX, a.rect[0]); maxX = Math.max(maxX, a.rect[2]); minY = Math.min(minY, a.rect[1]); maxY = Math.max(maxY, a.rect[3]); });
    if (draft) st.nodes.forEach(function (n) { minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x); minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y); });
    if (minX > maxX) { minX = minY = -50; maxX = maxY = 50; }
    var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    var zs = st.levels.map(function (l) { return l.z; });
    var zMid = zs.length ? (Math.max.apply(null, zs) + Math.min.apply(null, zs)) / 2 : 0;
    var R = Math.hypot(maxX - minX, maxY - minY) / 2;

    // 新宿は南北に長い（約 800 m）ので、長い向きが画面の横に来る角度から見る
    var HOME = draft ? { yaw: -72 * DEG, pitch: 40 * DEG, zoom: 1, tx: 0, tz: 0 } : { yaw: -28 * DEG, pitch: 38 * DEG, zoom: 1, tx: 0, tz: 0 };
    var cam = { yaw: HOME.yaw, pitch: HOME.pitch, zoom: 1, tx: 0, tz: 0 };
    var SPREAD = draft ? [3.2, 7] : [2.6, 5];   // 高さの誇張（階の間が薄く見えないように）。「階の間隔を広げる」で 5 倍
    var spread = SPREAD[0], spreadTo = SPREAD[0];
    var vel = { yaw: 0, pitch: 0 };
    var W = 0, H = 0, dpr = 1;
    var route = null, routeT = 1, routeT0 = 0, pulseT0 = 0, sel = null;
    var raf = 0, alive = true;
    // 表示の状態：種類ごとのオン／オフ（hidden[種類]=true で隠す）と、強調する階（null＝全部）
    var hidden = {}, focus = null, glyphs = [], perf = { n: 0, sum: 0, last: 0, max: 0, drawn: 0, culled: 0 };
    var reduced = function () { return GT.M ? GT.M.reduced() : false; };

    // ── 世界の座標（x 東・y 北・z 上、単位 m）→ 描画の座標（X 右・Y 上・Z 手前）
    function zOf(level, dz) { return (L[level].z - zMid) * spread + (dz || 0); }
    function P(x, y, level, dz) { return [x - cx, zOf(level, dz), y - cy]; }
    function slabOf(lv) {
      var b = null, m = draft ? 8 : 4;
      st.areas.forEach(function (a) {
        if (a.level !== lv) return;
        var r = a.rect;
        b = b ? [Math.min(b[0], r[0] - m), Math.min(b[1], r[1] - m), Math.max(b[2], r[2] + m), Math.max(b[3], r[3] + m)] : [r[0] - m, r[1] - m, r[2] + m, r[3] + m];
      });
      if (!b && draft) st.nodes.forEach(function (n) {   // 区画のない階（例：B5F・B4F）は点の広がりで床の板を作る
        if (n.level !== lv) return;
        b = b ? [Math.min(b[0], n.x - m), Math.min(b[1], n.y - m), Math.max(b[2], n.x + m), Math.max(b[3], n.y + m)] : [n.x - m, n.y - m, n.x + m, n.y + m];
      });
      return b;
    }

    // ── 線分を作る（形は spread で変わるので、毎回作る。数百本なので軽い）
    function build() {
      var S = [];   // [a, b, 強さ, 色, 種類]  種類：floor（床・水平）/ post（鉛直）/ stairs・escalator（斜め）/ mark
      var tag = "floor", cur = { lv: null, lv2: null, kind: null };   // 線ごとに、どの階・どの種類の物かを持つ（強調・表示切り替え用）
      function seg(a, b, k, col) { S.push([a, b, k, col || WHITE, tag, cur.lv, cur.lv2, cur.kind]); }
      function rect(x0, y0, x1, y1, lv, dz, k) {
        var a = P(x0, y0, lv, dz), b = P(x1, y0, lv, dz), c = P(x1, y1, lv, dz), d = P(x0, y1, lv, dz);
        seg(a, b, k); seg(b, c, k); seg(c, d, k); seg(d, a, k);
      }
      function box(x0, y0, x1, y1, lv, h, kFloor, kTop, kPost) {
        var t0 = tag;
        rect(x0, y0, x1, y1, lv, 0, kFloor); tag = "top"; rect(x0, y0, x1, y1, lv, h, kTop);
        tag = "post";
        [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].forEach(function (q) { seg(P(q[0], q[1], lv, 0), P(q[0], q[1], lv, h), kPost); });
        tag = t0;
      }
      // 階ごとの床の板（その階の区画をすべて囲む水平の矩形。高さは階ごとに一定）
      st.levels.forEach(function (l) {
        cur = { lv: l.id, lv2: null, kind: null };
        var b = slabOf(l.id); if (b) rect(b[0], b[1], b[2], b[3], l.id, 0, 0.22);
      });
      if (draft) { buildDraft(S, seg, function (t) { tag = t; }, function (c) { cur = c; }); return S; }
      st.areas.forEach(function (a) {
        cur = { lv: a.level, lv2: null, kind: a.kind === "platform" ? "platform" : null };
        var r = a.rect;
        if (a.kind === "platform") box(r[0], r[1], r[2], r[3], a.level, 1.1, 0.5, 1, 0.55);
        else box(r[0], r[1], r[2], r[3], a.level, 3.2, 0.85, 0.22, 0.3);
      });
      cur = { lv: null, lv2: null, kind: null };
      tag = "track";
      st.tracks.forEach(function (t) {
        var ax = t.from[0] === t.to[0] ? [0.55, 0] : [0, 0.55];
        seg(P(t.from[0] - ax[0], t.from[1] - ax[1], t.level, -0.2), P(t.to[0] - ax[0], t.to[1] - ax[1], t.level, -0.2), 0.32);
        seg(P(t.from[0] + ax[0], t.from[1] + ax[1], t.level, -0.2), P(t.to[0] + ax[0], t.to[1] + ax[1], t.level, -0.2), 0.32);
      });
      tag = "post";
      // 号車の区切り（ホームの縁に短い縦線）
      st.platforms.forEach(function (p) {
        if (!GT.stationGraph.hasDoors(p)) return;   // 号車が不明なホームには区切りを描かない
        for (var c = 1; c <= p.cars + 1; c++) {
          var s = p.car1Front + p.dir * p.carLen * (c - 1);
          var e1 = p.axis === "x" ? [s, p.center - 4.6] : [p.center - 5.6, s], e2 = p.axis === "x" ? [s, p.center + 4.6] : [p.center + 5.6, s];
          seg(P(e1[0], e1[1], p.level, 1.1), P(e1[0], e1[1], p.level, 1.9), 0.3);
          seg(P(e2[0], e2[1], p.level, 1.1), P(e2[0], e2[1], p.level, 1.9), 0.3);
        }
      });
      // 上下の移動の設備（エレベーターは鉛直、階段・エスカレーターだけが斜め）
      st.edges.forEach(function (e) {
        var a = N[e.a], b = N[e.b];
        if (e.kind !== "stairs" && e.kind !== "escalator" && e.kind !== "elevator") return;
        var top = L[a.level].z > L[b.level].z ? a : b, bot = top === a ? b : a;
        tag = e.kind === "elevator" ? "post" : e.kind;
        var dzTop = top.level === "L1" || /^P/.test(top.id) ? 1.1 : 0;
        if (e.kind === "elevator") {
          var h0 = 0, h1 = zOf(top.level, dzTop + 2.8) - zOf(bot.level, 0);
          box(bot.x - 1.3, bot.y - 1.3, bot.x + 1.3, bot.y + 1.3, bot.level, h1 - h0, 0.8, 0.8, 0.8);
          return;
        }
        var A = function (dy) { return P(top.x - 6, top.y + dy, top.level, dzTop); }, B = function (dy) { return P(bot.x + 6, bot.y + dy, bot.level, 0); };
        [-1.1, 1.1].forEach(function (dy) {
          var a3 = A(dy), b3 = B(dy);
          if (e.kind === "stairs") {
            var n = 9, prev = a3;
            for (var i = 1; i <= n; i++) {
              var f = i / n, x = a3[0] + (b3[0] - a3[0]) * f, y = a3[1] + (b3[1] - a3[1]) * f, z = a3[2] + (b3[2] - a3[2]) * f;
              var mid = [x, prev[1], z]; seg(prev, mid, 0.85); seg(mid, [x, y, z], 0.85); prev = [x, y, z];
            }
          } else {
            seg(a3, b3, 0.9);
            seg([a3[0], a3[1] + 1, a3[2]], [b3[0], b3[1] + 1, b3[2]], 0.45);   // 手すり
          }
        });
        var a1 = A(-1.1), a2 = A(1.1), b1 = B(-1.1), b2 = B(1.1);
        seg(a1, a2, 0.7); seg(b1, b2, 0.7);
      });
      tag = "mark";
      // 改札（通路を横切る低い柱の列）と出口（門の枠）
      st.nodes.forEach(function (n) {
        if (n.kind === "gate") {
          var across = n.id === "GT" ? [0, 1] : [1, 0];
          for (var i = -2; i <= 2; i++) {
            var x = n.x + across[0] * i * 1.4, y = n.y + across[1] * i * 1.4;
            seg(P(x, y, n.level, 0), P(x, y, n.level, 1.1), 0.9);
          }
          seg(P(n.x - across[0] * 2.8, n.y - across[1] * 2.8, n.level, 1.1), P(n.x + across[0] * 2.8, n.y + across[1] * 2.8, n.level, 1.1), 0.5);
        } else if (n.kind === "exit") {
          var a = P(n.x - 2, n.y, n.level, 0), b = P(n.x - 2, n.y, n.level, 2.8), c = P(n.x + 2, n.y, n.level, 2.8), d = P(n.x + 2, n.y, n.level, 0);
          seg(a, b, 0.9); seg(b, c, 0.9); seg(c, d, 0.9);
        }
      });
      // 選んだ号車（枠）とドア（縦の線）、乗換先
      tag = "mark";
      if (sel) {
        var p = GT.stationGraph.platformOf(st, sel.platform);
        var cr = GT.stationGraph.carRange(p, sel.car);
        var w = p.axis === "x" ? [cr[0], p.center - 4.2, cr[1], p.center + 4.2] : [p.center - 5.2, cr[0], p.center + 5.2, cr[1]];
        var q = [P(w[0], w[1], p.level, 1.2), P(w[2], w[1], p.level, 1.2), P(w[2], w[3], p.level, 1.2), P(w[0], w[3], p.level, 1.2)];
        for (var i = 0; i < 4; i++) S.push([q[i], q[(i + 1) % 4], 0.8, ACC, "mark"]);
        var d = GT.stationGraph.doorXY(st, p, sel.car, sel.door);
        S.push([P(d.x, d.y, p.level, 1.2), P(d.x, d.y, p.level, 4.2), 1, AMBER, "post"]);
      }
      return S;
    }
    // ── 新宿の下書き：床は水平の多角形、斜めは別の階を結ぶ階段・エスカレーターの辺だけ、エレベーターは鉛直の柱
    function buildDraft(S, seg, setTag, setCur) {
      st.areas.forEach(function (a) {
        var plat = a.kind === "platform";
        setCur({ lv: a.level, lv2: null, kind: plat ? "platform" : null });
        setTag("floor");
        var poly = a.poly || [[a.rect[0], a.rect[1]], [a.rect[2], a.rect[1]], [a.rect[2], a.rect[3]], [a.rect[0], a.rect[3]]];
        var k = plat ? 0.95 : 0.42;
        for (var i = 0; i < poly.length; i++) {
          var q0 = poly[i], q1 = poly[(i + 1) % poly.length];
          seg(P(q0[0], q0[1], a.level, 0), P(q1[0], q1[1], a.level, 0), k);
        }
      });
      // 歩行ネットワーク（同じ階の辺）：薄い線。強調した階でだけ見える強さにしてある
      st.edges.forEach(function (e) {
        var a = N[e.a], b = N[e.b]; if (!a || !b) return;
        if (a.level === b.level) {
          setCur({ lv: a.level, lv2: null, kind: e.guess ? "guess" : "net" }); setTag("floor");
          seg(P(a.x, a.y, a.level, 0), P(b.x, b.y, b.level, 0), e.guess ? 0.5 : 0.2, e.guess ? AMBER : WHITE);
          return;
        }
        // 別の階を結ぶ辺。エレベーターは鉛直の柱（下の点の真上へ）、階段・エスカレーターは斜め、ほかの種類（坂・段差・不明）は細い斜め
        var top = L[a.level].z > L[b.level].z ? a : b, bot = top === a ? b : a;
        var kind = e.kind === "elevator" || e.kind === "stairs" || e.kind === "escalator" ? e.kind : "net";
        setCur({ lv: bot.level, lv2: top.level, kind: kind });
        if (e.kind === "elevator") {
          setTag("post");
          seg(P(bot.x, bot.y, bot.level, 0), P(bot.x, bot.y, top.level, 0), 0.75, e.guess ? AMBER : WHITE);
          return;
        }
        setTag(e.kind === "stairs" || e.kind === "escalator" ? e.kind : "stairs");
        seg(P(top.x, top.y, top.level, 0), P(bot.x, bot.y, bot.level, 0), e.kind === "escalator" || e.kind === "stairs" ? 0.8 : 0.35, e.guess ? AMBER : WHITE);
      });
      setCur({ lv: null, lv2: null, kind: null });
    }
    // 施設の記号（画面上で一定の大きさに描く枠線の記号。3D の点に固定）
    var GLYPH_KINDS = { toilet: 1, stairs: 1, escalator: 1, elevator: 1, exit: 1, gate: 1 };
    if (draft) st.nodes.forEach(function (n) { if (GLYPH_KINDS[n.kind]) glyphs.push({ x: n.x, y: n.y, level: n.level, kind: n.kind, ground: !!n.ground, id: n.id }); });
    // 記号の形（単位は記号の半径 1。y は下向き＝画面の向き）。色はどれも白い光で、線の形だけで種類を分ける
    var SHAPE = {
      toilet: (function () { var a = []; for (var i = 0; i < 8; i++) { var t0 = i / 8 * Math.PI * 2, t1 = (i + 1) / 8 * Math.PI * 2; a.push([Math.cos(t0), Math.sin(t0), Math.cos(t1), Math.sin(t1)]); } a.push([0, -0.45, 0, 0.45]); return a; })(),   // 円＋縦の棒
      stairs: [[-1, 1, -1, 0.33], [-1, 0.33, -0.33, 0.33], [-0.33, 0.33, -0.33, -0.33], [-0.33, -0.33, 0.33, -0.33], [0.33, -0.33, 0.33, -1], [0.33, -1, 1, -1]],   // 段の横顔
      escalator: [[-1, 0.7, -0.45, 0.7], [-0.45, 0.7, 0.45, -0.7], [0.45, -0.7, 1, -0.7], [-1, 1, 1, 1]],   // 下の平ら→斜め→上の平ら（床の線つき）
      elevator: [[-0.7, -1, 0.7, -1], [0.7, -1, 0.7, 1], [0.7, 1, -0.7, 1], [-0.7, 1, -0.7, -1], [0, -0.6, -0.3, -0.25], [0, -0.6, 0.3, -0.25], [0, 0.6, -0.3, 0.25], [0, 0.6, 0.3, 0.25]],   // 箱＋上下の矢
      gate: [[-1, 1, -1, -0.5], [0, 1, 0, -0.5], [1, 1, 1, -0.5], [-1, -0.5, 1, -0.5]],   // 柱 3 本＋上の横棒
      exit: [[-0.7, 1, -0.7, -0.5], [-0.7, -0.5, 0.7, -0.5], [0.7, -0.5, 0.7, 1]],   // 門の枠
      exitGround: [[-0.7, 1, -0.7, -0.4], [0.7, -0.4, 0.7, 1], [-1, -0.4, 0, -1.1], [0, -1.1, 1, -0.4]]   // 門の枠＋屋根（地上の出口）
    };
    var segs = build();

    // ── 経路の点列（3D）
    var routeGuess = [];
    function routePoints(r) {
      routeGuess = [];
      if (!r || !r.ok || !r.path.length) return null;
      if (draft) {
        // 下書き：点の位置をそのまま結ぶ（上下の移動は別の階の点どうしの斜め・鉛直になる）。推測の接続の区間を覚えておく
        var out = [], gs = {};
        r.steps.forEach(function (s) { if (s.guess) gs[s.a + ">" + s.b] = 1; });
        var ids = r.path.filter(function (id) { return N[id]; });
        ids.forEach(function (id, i) {
          var n = N[id]; out.push(P(n.x, n.y, n.level, 0.6));
          if (i) routeGuess.push(!!(gs[ids[i - 1] + ">" + id] || gs[id + ">" + ids[i - 1]]));
        });
        return out.length >= 2 ? out : (out.length ? [out[0], out[0]] : null);
      }
      var pts = [];
      var edgeKind = {};
      r.steps.forEach(function (s) { edgeKind[s.a + ">" + s.b] = s.kind; });
      r.path.forEach(function (id, i) {
        if (id === "__door") {
          var p = GT.stationGraph.platformOf(st, sel.platform), d = GT.stationGraph.doorXY(st, p, sel.car, sel.door);
          pts.push(P(d.x, d.y, p.level, 1.4));
          return;
        }
        var n = N[id], prevId = r.path[i - 1], nextId = r.path[i + 1];
        var k = (prevId && edgeKind[prevId + ">" + id]) || (nextId && edgeKind[id + ">" + nextId]);
        var onPlat = /^P\d/.test(id);
        var dz = onPlat ? 1.4 : 0.4;
        var x = n.x;
        if (n.kind === "stairs" || n.kind === "escalator") {
          var isTop = st.edges.some(function (e) { return (e.a === id || e.b === id) && (e.kind === "stairs" || e.kind === "escalator") && L[N[e.a === id ? e.b : e.a].level].z < L[n.level].z; });
          x = isTop ? n.x - 6 : n.x + 6;
          // 歩いて来る側は設備の点そのもの、上下の移動はずらした端から端へ
          if (k !== "stairs" && k !== "escalator") { pts.push(P(n.x, n.y, n.level, dz)); }
          pts.push(P(x, n.y, n.level, dz));
          return;
        }
        pts.push(P(x, n.y, n.level, dz));
      });
      return pts;
    }

    // ── 投影
    var fit = { k: 1, ox: 0, oy: 0 };
    // 不具合の元：以前は画角 40° でカメラが駅の大きさ R の約 2.7 倍の距離にあり、パースが強すぎた。
    // 細長いホーム（205m×10m）の水平な矩形が手前ほど大きく広がって、どの床も「坂」に見えていた。
    // いまは画角を狭くして遠くから見る（正投影に近い。奥行きの差による大きさの差は約 ±8%）。
    var FOV = 4 * DEG;
    function fovF() { return fit.k * H / (2 * Math.tan(FOV / 2)); }
    function camDist() { var asp = W / Math.max(1, H); return (R * 0.98 / Math.tan(FOV / 2)) / Math.min(1, asp * 1.15) / cam.zoom; }
    function proj(p, D, f) {
      var x = p[0] - cam.tx, y = p[1], z = p[2] - cam.tz;
      var cy_ = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
      var x1 = x * cy_ - z * sy, z1 = x * sy + z * cy_;
      var y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
      var d = D + z2;
      if (d < 1) return null;
      return [W / 2 + fit.ox + x1 * f / d, H / 2 + fit.oy - y2 * f / d, d];
    }

    // 全体が画面に収まるよう、倍率と中心のずれを決める（起動・大きさの変化・視点を戻す時だけ。回している間は変えない）
    function fitView() {
      fit = { k: 1, ox: 0, oy: 0 };
      var D = camDist(), f = fovF(), x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      segs.forEach(function (s) { [s[0], s[1]].forEach(function (p) { var q = proj(p, D, f); if (!q) return; x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }); });
      if (x1 <= x0) return;
      var padL = 112, padX = 20, padTop = 20, padBot = 30;   // 左は階の名前の列のぶん空ける
      var k = Math.min((W - padL - padX) / (x1 - x0), (H - padTop - padBot) / (y1 - y0));
      fit.k = k;
      fit.ox = -((x0 + x1) / 2 - (W + padL - padX) / 2) * k;
      fit.oy = -((y0 + y1) / 2 - (H + padTop - padBot) / 2) * k;
    }
    function resize() {
      var r = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(1, r.width); H = Math.max(1, r.height);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      fitView(); kick();
    }

    // ── 描画
    // 1 コマに 1 回だけ全部の端点を投影して pr に入れ、にじみ・芯の 3 回の描き分けはその結果を使い回す。
    // 両端が同じ側で画面の外にある線は省く（視錐台の外）。強さ 0 の線（隠した種類・薄くした階の薄い線）も省く。
    var pr = new Float32Array(0), wv = new Float32Array(0);
    function levelMul(s) {
      if (!focus) return 1;
      return s[5] === focus || s[6] === focus || s[5] == null ? 1 : 0.13;
    }
    function projectAll(D, f, near, far) {
      var n = segs.length;
      if (pr.length < n * 4) { pr = new Float32Array(n * 4); wv = new Float32Array(n); }
      var cy_ = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
      var hw = W / 2 + fit.ox, hh = H / 2 + fit.oy, drawn = 0, culled = 0, m = 24;
      for (var i = 0; i < n; i++) {
        var s = segs[i];
        if (s[7] && hidden[s[7]]) { wv[i] = 0; continue; }
        var w = s[2] * levelMul(s);
        var dsum = 0, ok = true;
        for (var e = 0; e < 2; e++) {
          var p = s[e], x = p[0] - cam.tx, y = p[1], z = p[2] - cam.tz;
          var x1 = x * cy_ - z * sy, z1 = x * sy + z * cy_;
          var y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp, d = D + z2;
          if (d < 1) { ok = false; break; }
          pr[i * 4 + e * 2] = hw + x1 * f / d; pr[i * 4 + e * 2 + 1] = hh - y2 * f / d; dsum += d;
        }
        if (!ok) { wv[i] = 0; continue; }
        var ax = pr[i * 4], ay = pr[i * 4 + 1], bx = pr[i * 4 + 2], by = pr[i * 4 + 3];
        if ((ax < -m && bx < -m) || (ax > W + m && bx > W + m) || (ay < -m && by < -m) || (ay > H + m && by > H + m)) { wv[i] = 0; culled++; continue; }
        wv[i] = w * (1 - 0.74 * smooth(near, far, dsum / 2));
        drawn++;
      }
      perf.drawn = drawn; perf.culled = culled;
    }
    function strokeBuckets(list, D, f, near, far, col, width, mult) {
      var B = {};
      for (var i = 0; i < list.length; i++) {
        var s = list[i]; if (s[3] !== col || wv[i] <= 0) continue;
        var k = Math.round(Math.min(1, wv[i] * mult) * 12);
        if (k <= 0) continue;
        (B[k] = B[k] || []).push(i);
      }
      ctx.lineWidth = width;
      Object.keys(B).forEach(function (k) {
        var arr = B[k];
        ctx.strokeStyle = "rgba(" + col + "," + (k / 12).toFixed(3) + ")";
        ctx.beginPath();
        for (var j = 0; j < arr.length; j++) { var o = arr[j] * 4; ctx.moveTo(pr[o], pr[o + 1]); ctx.lineTo(pr[o + 2], pr[o + 3]); }
        ctx.stroke();
      });
    }
    // 施設の記号：種類ごと・強さごとに 1 本のパスにまとめて描く
    function drawGlyphs(D, f) {
      if (!glyphs.length) return;
      var pxPerM = f / D, r = Math.max(2.2, Math.min(7, 3.2 * pxPerM));
      var far = Math.min(1, Math.max(0.35, (r - 2.2) / 3));   // 引いて見ている時（記号が小さい時）は暗くして、白い塊にならないようにする
      var B = {};
      for (var i = 0; i < glyphs.length; i++) {
        var g = glyphs[i]; if (hidden[g.kind]) continue;
        var dim = focus && g.level !== focus;
        var q = proj(P(g.x, g.y, g.level, 0), D, f);
        if (!q || q[0] < -10 || q[0] > W + 10 || q[1] < -10 || q[1] > H + 10) continue;
        var key = (dim ? "d" : "b") + (g.kind === "exit" && g.ground ? "exitGround" : g.kind);
        (B[key] = B[key] || []).push(q[0], q[1]);
      }
      Object.keys(B).forEach(function (key) {
        var dim = key[0] === "d", sh = SHAPE[key.slice(1)], arr = B[key], rr = dim ? r * 0.7 : r;
        [[3, dim ? 0.05 : 0.16], [1.1, dim ? 0.22 : 0.95]].forEach(function (pass) {
          ctx.lineWidth = pass[0]; ctx.strokeStyle = "rgba(" + WHITE + "," + (pass[1] * far).toFixed(3) + ")";
          ctx.beginPath();
          for (var j = 0; j < arr.length; j += 2) for (var t = 0; t < sh.length; t++) {
            var l = sh[t]; ctx.moveTo(arr[j] + l[0] * rr, arr[j + 1] + l[1] * rr - rr * 1.3); ctx.lineTo(arr[j] + l[2] * rr, arr[j + 1] + l[3] * rr - rr * 1.3);
          }
          ctx.stroke();
        });
      });
    }

    function draw(now) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#020306";
      ctx.fillRect(0, 0, W, H);
      var D = camDist(), f = fovF(), near = D - R * 0.7, far = D + R * 1.0;   // 奥行きの薄れ（D に対する相対値なので、遠くから見ても同じ効き）
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      // 光のにじみ（太く淡く）→ 芯（細く強く）。線が多い時（新宿）は、いちばん太いにじみを省いて描く量を減らす
      var t0 = performance.now();
      projectAll(D, f, near, far);
      var heavy = perf.drawn > 6000;
      [WHITE, ACC, AMBER].forEach(function (col) {
        if (!heavy) strokeBuckets(segs, D, f, near, far, col, 5, 0.09);
        strokeBuckets(segs, D, f, near, far, col, 2.2, heavy ? 0.16 : 0.22);
        strokeBuckets(segs, D, f, near, far, col, 1, 0.95);
      });
      drawGlyphs(D, f);
      // 階の名前：床の板の、画面でいちばん左の角から外側へ引き出し線を出し、左の列に階の高い順で並べる（重ならないよう 16px 以上離す）
      ctx.font = "11px ui-monospace, Menlo, monospace";
      ctx.textBaseline = "middle";
      var labs = [];
      st.levels.forEach(function (l) {
        var sb = slabOf(l.id); if (!sb) return;
        var best = null;
        [[sb[0], sb[1]], [sb[2], sb[1]], [sb[2], sb[3]], [sb[0], sb[3]]].forEach(function (c) {
          var q = proj(P(c[0], c[1], l.id, 0), D, f); if (q && (!best || q[0] < best[0])) best = q;
        });
        if (best) labs.push({ id: l.id, t: l.name, z: L[l.id].z, ax: best[0], ay: best[1], y: best[1], w: ctx.measureText(l.name).width });
      });
      labs.sort(function (a, b) { return b.z - a.z; });
      for (var it = 0; it < 4; it++) {
        for (var li = 1; li < labs.length; li++) if (labs[li].y < labs[li - 1].y + 16) labs[li].y = labs[li - 1].y + 16;
        // 画面の外へはみ出す名前は、端に押し込んでから詰め直す（拡大した時に下端で重ならないように）
        if (labs.length && labs[labs.length - 1].y > H - 10) labs[labs.length - 1].y = H - 10;
        for (li = labs.length - 2; li >= 0; li--) if (labs[li].y > labs[li + 1].y - 16) labs[li].y = labs[li + 1].y - 16;
        if (labs.length && labs[0].y < 10) labs[0].y = 10;
      }
      labs.forEach(function (b) {
        var tx = 8, ex = tx + b.w + 4;
        ctx.strokeStyle = "rgba(" + WHITE + ",.35)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(ex, b.y); ctx.lineTo(Math.max(ex + 6, b.ax - 3), b.y); ctx.lineTo(b.ax, b.ay); ctx.stroke();
        ctx.fillStyle = "rgba(" + WHITE + "," + (focus && b.id !== focus ? ".35" : ".85") + ")"; ctx.textAlign = "left";
        ctx.fillText(b.t, tx, b.y);
        b.box = [tx, b.y - 7, ex, b.y + 7];
      });
      lastLabels = labs;
      // 経路
      if (route) {
        var rp = route.map(function (p) { return proj(p, D, f); });   // ここの rp は経路の点の投影（線の投影 pr とは別）
        if (rp.every(Boolean)) {
          var len = [0];
          for (var i = 1; i < rp.length; i++) len.push(len[i - 1] + Math.hypot(rp[i][0] - rp[i - 1][0], rp[i][1] - rp[i - 1][1]));
          var total = len[len.length - 1] || 1, upto = total * routeT;
          var path = function () {
            ctx.beginPath(); ctx.moveTo(rp[0][0], rp[0][1]);
            for (var i = 1; i < rp.length; i++) {
              if (len[i] <= upto) ctx.lineTo(rp[i][0], rp[i][1]);
              else { var t = (upto - len[i - 1]) / Math.max(1e-6, len[i] - len[i - 1]); ctx.lineTo(rp[i - 1][0] + (rp[i][0] - rp[i - 1][0]) * t, rp[i - 1][1] + (rp[i][1] - rp[i - 1][1]) * t); break; }
            }
          };
          [[14, 0.07], [7, 0.16], [3.2, 0.55], [1.6, 1]].forEach(function (w) { path(); ctx.lineWidth = w[0]; ctx.strokeStyle = "rgba(" + ACC + "," + w[1] + ")"; ctx.stroke(); });
          // 推測の接続を通る区間は、琥珀色の点線を重ねる（「推」の印）
          if (routeGuess.length && routeT >= 1) {
            ctx.setLineDash([4, 4]); ctx.lineWidth = 2.4; ctx.strokeStyle = "rgba(" + AMBER + ",.95)";
            ctx.beginPath();
            for (var gi = 0; gi < routeGuess.length; gi++) if (routeGuess[gi]) { ctx.moveTo(rp[gi][0], rp[gi][1]); ctx.lineTo(rp[gi + 1][0], rp[gi + 1][1]); }
            ctx.stroke(); ctx.setLineDash([]);
          }
          // 進む向きの光の粒（引き終えてから 2 往復だけ・動きを減らす設定では出さない）
          var pt = (now - pulseT0) / 1600;
          if (routeT >= 1 && !reduced() && pt >= 0 && pt < 2) {
            var at = total * (pt % 1);
            for (var j = 1; j < rp.length; j++) if (len[j] >= at) {
              var tt = (at - len[j - 1]) / Math.max(1e-6, len[j] - len[j - 1]);
              var gx = rp[j - 1][0] + (rp[j][0] - rp[j - 1][0]) * tt, gy = rp[j - 1][1] + (rp[j][1] - rp[j - 1][1]) * tt;
              var g = ctx.createRadialGradient(gx, gy, 0, gx, gy, 14);
              g.addColorStop(0, "rgba(255,255,255,.95)"); g.addColorStop(0.3, "rgba(" + ACC + ",.55)"); g.addColorStop(1, "rgba(" + ACC + ",0)");
              ctx.fillStyle = g; ctx.beginPath(); ctx.arc(gx, gy, 14, 0, Math.PI * 2); ctx.fill();
              break;
            }
          }
          // 始点（ドア）と終点の印
          var ends = [[rp[0], AMBER], [routeT >= 1 ? rp[rp.length - 1] : null, ACC]];
          ends.forEach(function (e) {
            if (!e[0]) return;
            ctx.strokeStyle = "rgba(" + e[1] + ",.95)"; ctx.lineWidth = 1.6;
            ctx.beginPath(); ctx.arc(e[0][0], e[0][1], 6, 0, Math.PI * 2); ctx.stroke();
            ctx.fillStyle = "rgba(" + e[1] + ",.25)"; ctx.beginPath(); ctx.arc(e[0][0], e[0][1], 11, 0, Math.PI * 2); ctx.fill();
          });
        }
      }
      ctx.globalCompositeOperation = "source-over";
      var dtm = performance.now() - t0;
      perf.last = dtm; perf.n++; perf.sum += dtm; perf.max = Math.max(perf.max, dtm);
    }

    // ── 繰り返し（必要な間だけ回す）
    function animating(now) {
      return routeT < 1 || Math.abs(vel.yaw) > 1e-4 || Math.abs(vel.pitch) > 1e-4 || Math.abs(spread - spreadTo) > 1e-3 || (!reduced() && route && now - pulseT0 < 3200);
    }
    var last = 0;
    function frame(now) {
      raf = 0;
      if (!alive || !canvas.isConnected) return;
      var dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016; last = now;
      if (routeT < 1) { routeT = Math.min(1, (now - routeT0) / 900); routeT = routeT >= 1 ? 1 : routeT; if (routeT >= 1) pulseT0 = now; }
      if (!drag.active && (vel.yaw || vel.pitch)) {
        cam.yaw += vel.yaw * dt * 60; cam.pitch = clampP(cam.pitch + vel.pitch * dt * 60);
        var dec = Math.exp(-dt * 5.5); vel.yaw *= dec; vel.pitch *= dec;
        if (Math.abs(vel.yaw) < 1e-4) vel.yaw = 0; if (Math.abs(vel.pitch) < 1e-4) vel.pitch = 0;
      }
      if (Math.abs(spread - spreadTo) > 1e-3) {
        spread += (spreadTo - spread) * (1 - Math.exp(-dt * 9));
        if (Math.abs(spread - spreadTo) <= 1e-3) spread = spreadTo;
        segs = build(); route = routePoints(lastR);
      }
      draw(now);
      if (animating(now)) kick(); else last = 0;
    }
    function kick() { if (!raf && alive) raf = requestAnimationFrame(frame); }
    function clampP(p) { return Math.min(90 * DEG, Math.max(12 * DEG, p)); }   // ピッチは 12°〜真上 90°。ヨーは鉛直の軸まわりだけなので床は常に水平

    // ── 操作：1 本指＝回転、2 本指＝拡大（つまむ）と平行移動、ホイール＝拡大、矢印キー＝回転、＋−＝拡大
    var pts = {}, drag = { active: false };
    function count() { return Object.keys(pts).length; }
    function pinchInfo() {
      var k = Object.keys(pts), a = pts[k[0]], b = pts[k[1]];
      return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    }
    function zoomBy(m) { cam.zoom = Math.min(6, Math.max(0.6, cam.zoom * m)); kick(); }
    function pan(dx, dy) {
      var D = camDist(), f = fovF(), s = D / f;
      var cy_ = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
      cam.tx -= (dx * cy_ + dy * sy / Math.max(0.3, Math.sin(cam.pitch))) * s;
      cam.tz -= (-dx * sy + dy * cy_ / Math.max(0.3, Math.sin(cam.pitch))) * s;
      var lim = R; cam.tx = Math.max(-lim, Math.min(lim, cam.tx)); cam.tz = Math.max(-lim, Math.min(lim, cam.tz));
    }
    canvas.addEventListener("pointerdown", function (e) {
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      drag = { active: true, pinch: count() === 2 ? pinchInfo() : null, t: performance.now() };
      vel.yaw = vel.pitch = 0;
    });
    canvas.addEventListener("pointermove", function (e) {
      var q = pts[e.pointerId]; if (!q) return;
      var dx = e.clientX - q.x, dy = e.clientY - q.y;
      q.x = e.clientX; q.y = e.clientY;
      if (count() >= 2 && drag.pinch) {
        var pi = pinchInfo();
        zoomBy(pi.d / Math.max(1, drag.pinch.d));
        pan(pi.mx - drag.pinch.mx, pi.my - drag.pinch.my);
        drag.pinch = pi;
      } else if (count() === 1) {
        var ky = -dx * 0.0065, kp = dy * 0.005;
        cam.yaw += ky; cam.pitch = clampP(cam.pitch + kp);
        var now = performance.now(), dtm = Math.max(8, now - drag.t); drag.t = now;
        vel.yaw = ky * 16 / dtm; vel.pitch = kp * 16 / dtm;
      }
      kick();
    });
    function up(e) {
      delete pts[e.pointerId];
      if (count() === 1) drag.pinch = null;
      if (count() === 0) { drag.active = false; if (reduced()) vel.yaw = vel.pitch = 0; kick(); }
      else if (count() === 2) drag.pinch = pinchInfo();
    }
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", function (e) { e.preventDefault(); zoomBy(Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    canvas.addEventListener("keydown", function (e) {
      var k = e.key, used = true;
      if (k === "ArrowLeft") cam.yaw += 0.12; else if (k === "ArrowRight") cam.yaw -= 0.12;
      else if (k === "ArrowUp") cam.pitch = clampP(cam.pitch + 0.08); else if (k === "ArrowDown") cam.pitch = clampP(cam.pitch - 0.08);
      else if (k === "+" || k === "=") zoomBy(1.15); else if (k === "-" || k === "_") zoomBy(1 / 1.15);
      else used = false;
      if (used) { e.preventDefault(); kick(); }
    });
    var ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(canvas); else window.addEventListener("resize", resize);
    resize();

    var lastR = null, lastLabels = [];
    return {
      setSelection: function (s) { sel = s; segs = build(); kick(); },
      setRoute: function (r) {
        lastR = r; route = routePoints(r);
        var now = performance.now();
        if (reduced() || opts.instant) { routeT = 1; pulseT0 = -1e9; } else { routeT = 0; routeT0 = now; }
        kick();
      },
      reset: function () { cam.yaw = HOME.yaw; cam.pitch = HOME.pitch; cam.zoom = 1; cam.tx = 0; cam.tz = 0; vel.yaw = vel.pitch = 0; fitView(); kick(); },
      setSpread: function (on) { spreadTo = on ? SPREAD[1] : SPREAD[0]; if (reduced()) { spread = spreadTo; segs = build(); route = routePoints(lastR); } kick(); },
      resume: function () { alive = true; last = 0; resize(); },
      destroy: function () { alive = false; if (raf) cancelAnimationFrame(raf); raf = 0; if (ro) ro.disconnect(); },
      _state: function () { return { cam: Object.assign({}, cam), spread: spread, routeT: routeT, segs: segs.length, running: !!raf }; },
      _segs: function () { return segs.map(function (s) { return { a: s[0], b: s[1], tag: s[4] }; }); },
      _levelHeights: function () { var o = {}; st.levels.forEach(function (l) { o[l.id] = zOf(l.id, 0); }); return o; },
      _labels: function () { return lastLabels.map(function (b) { return { t: b.t, box: b.box }; }); },
      _setCam: function (yaw, pitch) { cam.yaw = yaw; cam.pitch = clampP(pitch); vel.yaw = vel.pitch = 0; fitView(); kick(); },
      _project: function (x, y, level, dz) { return proj(P(x, y, level, dz), camDist(), fovF()); },
      /** 種類ごとの表示：hide=true で隠す（toilet / stairs / escalator / elevator / exit / gate / platform） */
      setHidden: function (kind, hide) { hidden[kind] = !!hide; kick(); },
      hidden: function () { return Object.assign({}, hidden); },
      /** 1 階だけ強調（他の階は薄く）。null で全部 */
      setFocus: function (lv) { focus = lv && L[lv] ? lv : null; kick(); },
      focus: function () { return focus; },
      /** その点を画面の中心に寄せて拡大 */
      zoomTo: function (x, y, zoom) { cam.tx = x - cx; cam.tz = y - cy; cam.zoom = Math.min(6, Math.max(0.6, zoom || 2.5)); kick(); },
      _perf: function () { return { frames: perf.n, avgMs: perf.n ? perf.sum / perf.n : 0, maxMs: perf.max, lastMs: perf.last, segs: segs.length, glyphs: glyphs.length, drawn: perf.drawn, culled: perf.culled }; },
      _perfReset: function () { perf.n = 0; perf.sum = 0; perf.max = 0; },
      _drawOnce: function () { draw(performance.now()); return perf.last; },
      _glyphs: function () { return glyphs.slice(); }
    };
  }
  GT.station3d = { create: create };
})(window.GT = window.GT || {});
