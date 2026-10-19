// 駅の立体図の描画（依存ゼロ・Canvas 2D）。ライトのテーマでは紙のような明るい面に濃いインクの線、
// ダークのテーマでは黒い面に「枠線だけが白く光る」線画（色は css の --map-* から読む。テーマに従う）。
// 手法は GNOTO の 3D 音響スタジオ（addons/mstudio-hallview.js）を参考にした：
//   ・面は描かず、線分だけを白で描く（LineSegments＋白一色）
//   ・足し算の合成（AdditiveBlending）＝線が重なる所ほど明るい
//   ・奥行きで薄くする（lineF の uFade：1 − 0.74 × smoothstep(near, far, 奥行き)）
//   ・光のにじみ（UnrealBloomPass 強さ .42・半径 .38）→ ここでは同じ線を太く淡く重ね描きして近づけた
// GNOTO は three.js（WebGL）だが、この試作は外部のライブラリ・CDN を使わない約束なので、投影も自前で書いた（DESIGN.md）。
//
// 使い方は「決めたルートを見る」が基本（自由に見て回るのではない）：
//   ・ルートを含む階の、ルートから一定距離（CORR）の中だけを細かく描く。遠い所は描かないか極薄の輪郭だけ。
//     階ごとに区画・辺を分けておき、ルートの階だけを組み立てる（遅延）。視錐台の外は省く。1 コマ 1 回の投影。
//   ・床は水平のまま。斜めは階段・エスカレーターの 3D の枠線のモデルだけ（階段＝段と手すり、エスカレーター＝ステップと手すりの斜面、
//     エレベーター＝縦の箱の枠）。各階の床をこのモデルがつなぐ。見本の駅も同じ描き方。
//   ・トイレ・エレベーター・出口・改札は、ルートの近くの分だけ（距離 GLYPH_R 以内・近い順に上限・近いものは 1 つにまとめて件数）、
//     その場所から画面の下の列へ引き出し線を出して記号を並べる（重ならない）。
//   ・カメラはルートに合わせて自動で合わせ、区間ごとに寄って見られる（拡大の上限を大きくした）。
(function (GT) {
  "use strict";
  var DEG = Math.PI / 180;
  // 線の色の名前（build の中で線の種類の印に使う）。実際の色は描く時に THEME から引く
  var WHITE = "ink", ACC = "acc", AMBER = "amber";
  function rgbOf(v, fb) {
    v = (v || "").trim();
    var m = /^#([0-9a-f]{6})$/i.exec(v);
    if (m) { var n = parseInt(m[1], 16); return (n >> 16 & 255) + "," + (n >> 8 & 255) + "," + (n & 255); }
    m = /rgba?\(([^)]+)\)/.exec(v);
    return m ? m[1].split(",").slice(0, 3).map(function (x) { return x.trim(); }).join(",") : fb;
  }
  var VERT = { stairs: 1, escalator: 1 };

  function smooth(a, b, x) { var t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  // 点 (px,py) と線分 (ax,ay)-(bx,by) の距離
  function dseg(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    var x = ax + dx * t - px, y = ay + dy * t - py;
    return Math.sqrt(x * x + y * y);
  }

  function create(canvas, st, opts) {
    opts = opts || {};
    var ctx = canvas.getContext("2d");
    var L = {}; st.levels.forEach(function (l) { L[l.id] = l; });
    var N = {}; st.nodes.forEach(function (n) { N[n.id] = n; });
    var draft = !!(st._view && st._view.draft);
    // ルートの周りの範囲（m）。見本の駅は小さいので全部描く
    var CORR = draft ? 32 : 1e9, GLYPH_R = draft ? 40 : 1e9, GLYPH_MAX = 8, DETAIL_M = 14, MERGE_M = draft ? 12 : 4;
    var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    st.areas.forEach(function (a) { minX = Math.min(minX, a.rect[0]); maxX = Math.max(maxX, a.rect[2]); minY = Math.min(minY, a.rect[1]); maxY = Math.max(maxY, a.rect[3]); });
    if (draft) st.nodes.forEach(function (n) { minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x); minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y); });
    if (minX > maxX) { minX = minY = -50; maxX = maxY = 50; }
    var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    var zs = st.levels.map(function (l) { return l.z; });
    var zMid = zs.length ? (Math.max.apply(null, zs) + Math.min.apply(null, zs)) / 2 : 0;
    var R = Math.hypot(maxX - minX, maxY - minY) / 2;

    // 階ごとに区画・辺を分けておく（ルートの階だけを組み立てるため）
    var areasBy = {}, edgesBy = {};
    st.areas.forEach(function (a) { (areasBy[a.level] = areasBy[a.level] || []).push(a); });
    st.edges.forEach(function (e) {
      var a = N[e.a], b = N[e.b]; if (!a || !b) return;
      (edgesBy[a.level] = edgesBy[a.level] || []).push(e);
      if (b.level !== a.level) (edgesBy[b.level] = edgesBy[b.level] || []).push(e);
    });

    var HOME = draft ? { yaw: -72 * DEG, pitch: 40 * DEG } : { yaw: -28 * DEG, pitch: 38 * DEG };
    var cam = { yaw: HOME.yaw, pitch: HOME.pitch, zoom: 1, tx: 0, ty: 0, tz: 0 };
    var ZMIN = 0.3, ZMAX = 220;   // 拡大の上限（以前は 6 倍）。画面上 1 m が数十 px まで寄れる
    var SPREAD = draft ? [3.2, 7] : [2.6, 5];   // 高さの誇張（階の間が薄く見えないように）。「階の間隔を広げる」で 5 倍
    var spread = SPREAD[0], spreadTo = SPREAD[0];
    var vel = { yaw: 0, pitch: 0 };
    var W = 0, H = 0, dpr = 1;
    var route = null, routeMeta = [], routeT = 1, routeT0 = 0, pulseT0 = 0, sel = null;
    var secs = [], curSec = -1, scope = null, fitted = null, anim = null;
    var raf = 0, alive = true;
    var hidden = {}, focus = null, glyphs = [], near = [], nearCount = 0, perf = { n: 0, sum: 0, last: 0, max: 0, drawn: 0, culled: 0 };
    var reduced = function () { return GT.M ? GT.M.reduced() : false; };
    // テーマの色：dark＝黒い面に光る白い線（足し算の合成・にじみ）／light＝紙の面に濃い線（普通の重ね塗り・にじみなし）
    var TH = null;
    function readTheme() {
      var cs = getComputedStyle(canvas), dark = document.documentElement.dataset.theme === "dark";
      TH = { dark: dark,
        bg: (cs.getPropertyValue("--map-bg") || "").trim() || (dark ? "#020306" : "#f7f6f2"),
        ink: rgbOf(cs.getPropertyValue("--map-ink"), dark ? "235,242,245" : "20,23,26"),
        acc: rgbOf(cs.getPropertyValue("--map-accent"), dark ? "95,214,195" : "0,105,94"),
        amber: rgbOf(cs.getPropertyValue("--map-amber"), dark ? "240,178,78" : "138,83,0") };
      TH.paper = rgbOf(TH.bg, dark ? "2,3,6" : "247,246,242");
    }
    function C(name) { return TH[name] || name; }
    readTheme();
    var mo = window.MutationObserver ? new MutationObserver(function () { readTheme(); kick(); }) : null;
    if (mo) mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    // ── 世界の座標（x 東・y 北・z 上、単位 m）→ 描画の座標（X 右・Y 上・Z 手前）
    function zOf(level, dz) { return (L[level].z - zMid) * spread + (dz || 0); }
    function P(x, y, level, dz) { return [x - cx, zOf(level, dz), y - cy]; }
    function slabOf(lv) {
      var b = null, m = draft ? 8 : 4;
      (areasBy[lv] || []).forEach(function (a) {
        var r = a.rect;
        b = b ? [Math.min(b[0], r[0] - m), Math.min(b[1], r[1] - m), Math.max(b[2], r[2] + m), Math.max(b[3], r[3] + m)] : [r[0] - m, r[1] - m, r[2] + m, r[3] + m];
      });
      if (!b && draft) st.nodes.forEach(function (n) {   // 区画のない階（例：B5F・B4F）は点の広がりで床の板を作る
        if (n.level !== lv) return;
        b = b ? [Math.min(b[0], n.x - m), Math.min(b[1], n.y - m), Math.max(b[2], n.x + m), Math.max(b[3], n.y + m)] : [n.x - m, n.y - m, n.x + m, n.y + m];
      });
      return b;
    }
    var slabs = {}; st.levels.forEach(function (l) { slabs[l.id] = slabOf(l.id); });

    // ── 上下の移動の設備のモデルの両端（世界の座標）。見本と新宿で同じ形のモデルを描く
    // 戻り値: { top:{x,y,lv,dz}, bot:{...}, topNode, botNode }
    function vEnds(e) {
      var a = N[e.a], b = N[e.b];
      if (!a || !b || a.level === b.level) return null;
      var top = L[a.level].z > L[b.level].z ? a : b, bot = top === a ? b : a;
      if (!draft) {
        var dzTop = top.level === "L1" || /^P/.test(top.id) ? 1.1 : 0;
        return { top: { x: top.x - 6, y: top.y, lv: top.level, dz: dzTop }, bot: { x: bot.x + 6, y: bot.y, lv: bot.level, dz: 0 }, topNode: top, botNode: bot };
      }
      // 新宿：2 点の中ほどに、実際の高さの差に見合う長さ（高さ × 1.6、最低 4 m）の斜面を置く。点とモデルの端は床の上の短い線でつなぐ
      var dx = bot.x - top.x, dy = bot.y - top.y, d = Math.hypot(dx, dy), rise = Math.abs(L[top.level].z - L[bot.level].z);
      var ux = d > 0.5 ? dx / d : 1, uy = d > 0.5 ? dy / d : 0, run = Math.max(d, rise * 1.6, 4);
      var mx = (top.x + bot.x) / 2, my = (top.y + bot.y) / 2;
      return { top: { x: mx - ux * run / 2, y: my - uy * run / 2, lv: top.level, dz: 0 }, bot: { x: mx + ux * run / 2, y: my + uy * run / 2, lv: bot.level, dz: 0 }, topNode: top, botNode: bot };
    }

    // ── 線分を作る。sc（ルートの階と範囲）があればその中だけ。形は spread で変わるので、変わるたびに作り直す
    function build(sc) {
      var S = [];   // [a, b, 強さ, 色, 種類の印, 階, 階2, 施設の種類]  種類の印：floor（床・水平）/ post（鉛直）/ stairs・escalator（斜め）/ elev / mark …
      var tag = "floor", cur = { lv: null, lv2: null, kind: null };
      var raw = false;   // 範囲の判定をしない線（床の板）
      function inLv(lv) { return !sc || !lv || sc.levels[lv]; }
      function seg(a, b, k, col) {
        if (sc && !raw) {
          if (!(inLv(cur.lv) || (cur.lv2 && sc.levels[cur.lv2]))) return;
          if (!sc.near((a[0] + b[0]) / 2 + cx, (a[2] + b[2]) / 2 + cy, cur.lv, cur.lv2)) {
            // 範囲の外：ルートの階のホームの縁だけを極薄で残す（それ以外は描かない）
            if (tag === "floor" && cur.kind === "platform" && sc.levels[cur.lv]) S.push([a, b, k * 0.14, col || WHITE, tag, cur.lv, cur.lv2, cur.kind]);
            return;
          }
        }
        S.push([a, b, k, col || WHITE, tag, cur.lv, cur.lv2, cur.kind]);
      }
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
      // 階ごとの床の板（その階の区画をすべて囲む水平の矩形）。ルートのない階は薄く
      raw = true;
      st.levels.forEach(function (l) {
        cur = { lv: l.id, lv2: null, kind: null };
        var b = slabs[l.id]; if (b) rect(b[0], b[1], b[2], b[3], l.id, 0, !sc || sc.levels[l.id] ? 0.22 : 0.08);
      });
      raw = false;
      // ── 階段・エスカレーター・エレベーターの 3D の枠線のモデル
      function model(e) {
        var ve = vEnds(e); if (!ve) return;
        var kind = e.kind, col = e.guess ? AMBER : WHITE;
        cur = { lv: ve.botNode.level, lv2: ve.topNode.level, kind: kind === "elevator" ? "elevator" : VERT[kind] ? kind : "net" };
        if (kind === "elevator") {
          // 縦の箱の枠：下の階の点の真上に、上の階の床より少し上まで
          var b = ve.botNode, t = ve.topNode, hw = 1.1, h = zOf(t.level, 2.6) - zOf(b.level, 0);
          var up = function (p, dz) { return [p[0], p[1] + dz, p[2]]; };
          var q = [[b.x - hw, b.y - hw], [b.x + hw, b.y - hw], [b.x + hw, b.y + hw], [b.x - hw, b.y + hw]].map(function (c) { return P(c[0], c[1], b.level, 0); });
          var t0 = tag; tag = "elev";
          for (var i = 0; i < 4; i++) { seg(q[i], q[(i + 1) % 4], 0.8, col); seg(up(q[i], h), up(q[(i + 1) % 4], h), 0.8, col); }
          tag = "post";
          for (i = 0; i < 4; i++) seg(q[i], up(q[i], h), 0.75, col);
          [b.level, t.level].forEach(function (lv) {   // 各階の乗り口（扉の縦の線 2 本）
            var y0 = zOf(lv, 0), y1 = zOf(lv, 2.1);
            [b.x - 0.45, b.x + 0.45].forEach(function (x) { seg([x - cx, y0, b.y - hw - cy], [x - cx, y1, b.y - hw - cy], 0.55, col); });
          });
          tag = t0;
          return;
        }
        var A = P(ve.top.x, ve.top.y, ve.top.lv, ve.top.dz), B = P(ve.bot.x, ve.bot.y, ve.bot.lv, ve.bot.dz);
        var ux = B[0] - A[0], uz = B[2] - A[2], ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
        var hw2 = 1.2, sx = -uz * hw2, sz = ux * hw2;
        var off = function (p, s, upv) { return [p[0] + sx * s, p[1] + (upv || 0), p[2] + sz * s]; };
        var lerp = function (p, r, f) { return [p[0] + (r[0] - p[0]) * f, p[1] + (r[1] - p[1]) * f, p[2] + (r[2] - p[2]) * f]; };
        if (!VERT[kind]) {   // 坂・段差・種類不明の上下の移動：細い斜めの 2 本だけ
          tag = "stairs"; seg(off(A, -0.5), off(B, -0.5), 0.35, col); seg(off(A, 0.5), off(B, 0.5), 0.35, col);
          return;
        }
        tag = kind;
        var RAIL = 1.0;
        // ルートから離れたモデルは簡単な形（斜面の両側と上下の縁）だけにする＝近いものだけ詳しく
        // （新宿でルートがない時＝駅全体を描く時も簡単な形。見本の駅はいつも詳しく）
        var fine = !draft || !!sc && distRoute((ve.top.x + ve.bot.x) / 2, (ve.top.y + ve.bot.y) / 2, null) <= DETAIL_M;
        if (!fine) {
          [-1, 1].forEach(function (s) { seg(off(A, s), off(B, s), 0.6, col); });
          seg(off(A, -1), off(A, 1), 0.45, col); seg(off(B, -1), off(B, 1), 0.45, col);
        } else if (kind === "stairs") {
          // 段のある斜面（両側の段の横顔・段の縁）と手すり
          var n = 8;
          [-1, 1].forEach(function (s) {
            var prev = off(A, s);
            for (var i2 = 1; i2 <= n; i2++) {
              var p = off(lerp(A, B, i2 / n), s), mid = [p[0], prev[1], p[2]];
              seg(prev, mid, 0.8, col); seg(mid, p, 0.8, col); prev = p;
            }
            seg(off(A, s, RAIL), off(B, s, RAIL), 0.5, col);
            seg(off(A, s), off(A, s, RAIL), 0.4, col); seg(off(B, s), off(B, s, RAIL), 0.4, col);
          });
          for (var j = 0; j <= n; j++) { var c = lerp(A, B, j / n), c2 = j ? [c[0], lerp(A, B, (j - 1) / n)[1], c[2]] : c; seg(off(c2, -1), off(c2, 1), 0.45, col); }
        } else {
          // エスカレーター：上下の平らな乗り口→斜面、両側の手すりの帯、ステップの線
          var lg = Math.min(1.6, ul * 0.2);
          var A2 = [A[0] + ux * lg, A[1], A[2] + uz * lg], B2 = [B[0] - ux * lg, B[1], B[2] - uz * lg];
          [-1, 1].forEach(function (s) {
            seg(off(A, s), off(A2, s), 0.8, col); seg(off(A2, s), off(B2, s), 0.85, col); seg(off(B2, s), off(B, s), 0.8, col);
            seg(off(A, s, RAIL), off(A2, s, RAIL), 0.5, col); seg(off(A2, s, RAIL), off(B2, s, RAIL), 0.55, col); seg(off(B2, s, RAIL), off(B, s, RAIL), 0.5, col);
            seg(off(A, s), off(A, s, RAIL), 0.4, col); seg(off(B, s), off(B, s, RAIL), 0.4, col);
          });
          var m = 10;
          for (var k2 = 0; k2 <= m; k2++) { var q2 = lerp(A2, B2, k2 / m); seg(off(q2, -0.85), off(q2, 0.85), 0.28, col); }
          seg(off(A, -1), off(A, 1), 0.5, col); seg(off(B, -1), off(B, 1), 0.5, col);
        }
        // 新宿：点とモデルの端を、それぞれの階の床の上でつなぐ
        if (draft) {
          tag = "floor";
          cur = { lv: ve.topNode.level, lv2: null, kind: "net" };
          seg(P(ve.topNode.x, ve.topNode.y, ve.topNode.level, 0), P(ve.top.x, ve.top.y, ve.top.lv, 0), 0.3, col);
          cur = { lv: ve.botNode.level, lv2: null, kind: "net" };
          seg(P(ve.botNode.x, ve.botNode.y, ve.botNode.level, 0), P(ve.bot.x, ve.bot.y, ve.bot.lv, 0), 0.3, col);
        }
      }
      if (draft) {
        var lvs = st.levels.filter(function (l) { return inLv(l.id); }).map(function (l) { return l.id; });
        lvs.forEach(function (lv) {
          (areasBy[lv] || []).forEach(function (a) {
            var plat = a.kind === "platform";
            cur = { lv: a.level, lv2: null, kind: plat ? "platform" : null }; tag = "floor";
            var poly = a.poly || [[a.rect[0], a.rect[1]], [a.rect[2], a.rect[1]], [a.rect[2], a.rect[3]], [a.rect[0], a.rect[3]]];
            var k = plat ? 0.95 : 0.42;
            for (var i = 0; i < poly.length; i++) { var q0 = poly[i], q1 = poly[(i + 1) % poly.length]; seg(P(q0[0], q0[1], a.level, 0), P(q1[0], q1[1], a.level, 0), k); }
          });
        });
        var seen = {};
        lvs.forEach(function (lv) {
          (edgesBy[lv] || []).forEach(function (e) {
            var a = N[e.a], b = N[e.b];
            if (a.level === b.level) {
              cur = { lv: a.level, lv2: null, kind: e.guess ? "guess" : "net" }; tag = "floor";
              seg(P(a.x, a.y, a.level, 0), P(b.x, b.y, b.level, 0), e.guess ? 0.5 : 0.2, e.guess ? AMBER : WHITE);
              return;
            }
            var key = e.a + ">" + e.b; if (seen[key]) return; seen[key] = 1;
            model(e);
          });
        });
        cur = { lv: null, lv2: null, kind: null };
        return S;
      }
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
      st.platforms.forEach(function (p) {   // 号車の区切り（ホームの縁に短い縦線）
        if (!GT.stationGraph.hasDoors(p)) return;
        for (var c = 1; c <= p.cars + 1; c++) {
          var s = p.car1Front + p.dir * p.carLen * (c - 1);
          var e1 = p.axis === "x" ? [s, p.center - 4.6] : [p.center - 5.6, s], e2 = p.axis === "x" ? [s, p.center + 4.6] : [p.center + 5.6, s];
          seg(P(e1[0], e1[1], p.level, 1.1), P(e1[0], e1[1], p.level, 1.9), 0.3);
          seg(P(e2[0], e2[1], p.level, 1.1), P(e2[0], e2[1], p.level, 1.9), 0.3);
        }
      });
      st.edges.forEach(function (e) { if (VERT[e.kind] || e.kind === "elevator") model(e); });
      cur = { lv: null, lv2: null, kind: null };
      tag = "mark";
      st.nodes.forEach(function (n) {   // 改札（通路を横切る低い柱の列）と出口（門の枠）
        if (n.kind === "gate") {
          var across = n.id === "GT" ? [0, 1] : [1, 0];
          for (var i = -2; i <= 2; i++) { var x = n.x + across[0] * i * 1.4, y = n.y + across[1] * i * 1.4; seg(P(x, y, n.level, 0), P(x, y, n.level, 1.1), 0.9); }
          seg(P(n.x - across[0] * 2.8, n.y - across[1] * 2.8, n.level, 1.1), P(n.x + across[0] * 2.8, n.y + across[1] * 2.8, n.level, 1.1), 0.5);
        } else if (n.kind === "exit") {
          var a = P(n.x - 2, n.y, n.level, 0), b = P(n.x - 2, n.y, n.level, 2.8), c = P(n.x + 2, n.y, n.level, 2.8), d = P(n.x + 2, n.y, n.level, 0);
          seg(a, b, 0.9); seg(b, c, 0.9); seg(c, d, 0.9);
        }
      });
      if (sel) {   // 選んだ号車（枠）とドア（縦の線）
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

    // 施設の記号（画面の下の列に並べる枠線の記号）。階段・エスカレーターは記号にせず 3D のモデルで描く
    var GLYPH_KINDS = { toilet: 1, elevator: 1, exit: 1, gate: 1 };
    st.nodes.forEach(function (n) { if (GLYPH_KINDS[n.kind]) glyphs.push({ x: n.x, y: n.y, level: n.level, kind: n.kind, ground: !!n.ground, id: n.id }); });
    var SHAPE = {
      toilet: (function () { var a = []; for (var i = 0; i < 8; i++) { var t0 = i / 8 * Math.PI * 2, t1 = (i + 1) / 8 * Math.PI * 2; a.push([Math.cos(t0), Math.sin(t0), Math.cos(t1), Math.sin(t1)]); } a.push([0, -0.45, 0, 0.45]); return a; })(),
      elevator: [[-0.7, -1, 0.7, -1], [0.7, -1, 0.7, 1], [0.7, 1, -0.7, 1], [-0.7, 1, -0.7, -1], [0, -0.6, -0.3, -0.25], [0, -0.6, 0.3, -0.25], [0, 0.6, -0.3, 0.25], [0, 0.6, 0.3, 0.25]],
      gate: [[-1, 1, -1, -0.5], [0, 1, 0, -0.5], [1, 1, 1, -0.5], [-1, -0.5, 1, -0.5]],
      exit: [[-0.7, 1, -0.7, -0.5], [-0.7, -0.5, 0.7, -0.5], [0.7, -0.5, 0.7, 1]],
      exitGround: [[-0.7, 1, -0.7, -0.4], [0.7, -0.4, 0.7, 1], [-1, -0.4, 0, -1.1], [0, -1.1, 1, -0.4]]
    };

    // ── ルート：点列（3D）、区間、範囲
    var routeXY = [], ptSec = [];   // routeXY：[{ax,ay,bx,by,lv}] 同じ階の線分（範囲の判定用）／ptSec：点ごとの区間の番号
    function nodePt(id) {
      if (id === "__door" && sel) {
        var p = GT.stationGraph.platformOf(st, sel.platform), d = GT.stationGraph.doorXY(st, p, sel.car, sel.door);
        return { x: d.x, y: d.y, lv: p.level, dz: 1.4 };
      }
      var n = N[id]; if (!n) return null;
      return { x: n.x, y: n.y, lv: n.level, dz: draft ? 0.6 : /^P\d/.test(id) ? 1.4 : 0.4 };
    }
    function buildRoute(r) {
      routeMeta = []; routeXY = []; secs = []; ptSec = [];
      if (!r || !r.ok || !r.steps || !r.steps.length) {
        if (r && r.ok && r.path && r.path.length === 1 && N[r.path[0]]) {
          var w0 = nodePt(r.path[0]); routeXY.push({ ax: w0.x, ay: w0.y, bx: w0.x, by: w0.y, lv: w0.lv });
          return [P(w0.x, w0.y, w0.lv, w0.dz), P(w0.x, w0.y, w0.lv, w0.dz)];
        }
        return null;
      }
      secs = GT.stationGraph.sections(r);
      var secOf = []; secs.forEach(function (s, k) { for (var i = s.i0; i <= s.i1; i++) secOf[i] = k; });
      var pts = [], wpts = [];
      function push(w, g, sec) { if (pts.length) routeMeta.push({ g: g, sec: sec }); pts.push(P(w.x, w.y, w.lv, w.dz)); wpts.push(w); ptSec.push(sec); }
      r.steps.forEach(function (s, i) {
        var a = nodePt(s.a), b = nodePt(s.b), sec = secOf[i];
        if (!b) return;
        if (!pts.length) { if (a) push(a, false, sec); else { push(b, false, sec); return; } }
        var na = N[s.a], nb = N[s.b];
        var cross = na && nb && na.level !== nb.level;
        var ve = cross && VERT[s.kind] ? vEnds({ a: s.a, b: s.b, kind: s.kind }) : null;
        if (ve) {   // 階段・エスカレーターはモデルの端から端へ
          var aTop = ve.topNode.id === s.a, lift = draft ? 0.6 : 0.4;
          var e1 = aTop ? ve.top : ve.bot, e2 = aTop ? ve.bot : ve.top;
          push({ x: e1.x, y: e1.y, lv: e1.lv, dz: e1.dz + lift }, s.guess, sec);
          push({ x: e2.x, y: e2.y, lv: e2.lv, dz: e2.dz + lift }, s.guess, sec);
        } else if (cross && s.kind === "elevator") {   // エレベーターは箱の中を鉛直に
          var bn = L[na.level].z < L[nb.level].z ? na : nb;
          push({ x: bn.x, y: bn.y, lv: na.level, dz: a.dz }, s.guess, sec);
          push({ x: bn.x, y: bn.y, lv: nb.level, dz: b.dz }, s.guess, sec);
        }
        push(b, s.guess, sec);
      });
      for (var i = 1; i < wpts.length; i++) {
        var p0 = wpts[i - 1], p1 = wpts[i];
        if (p0.lv === p1.lv) routeXY.push({ ax: p0.x, ay: p0.y, bx: p1.x, by: p1.y, lv: p0.lv });
        else { routeXY.push({ ax: p0.x, ay: p0.y, bx: p0.x, by: p0.y, lv: p0.lv }); routeXY.push({ ax: p1.x, ay: p1.y, bx: p1.x, by: p1.y, lv: p1.lv }); }
      }
      return pts.length >= 2 ? pts : pts.length ? [pts[0], pts[0]] : null;
    }
    function distRoute(x, y, lv) {
      var best = 1e9;
      for (var i = 0; i < routeXY.length; i++) {
        var s = routeXY[i]; if (lv && s.lv !== lv) continue;
        var d = dseg(x, y, s.ax, s.ay, s.bx, s.by); if (d < best) best = d;
      }
      return best;
    }
    function makeScope() {
      if (!draft || !routeXY.length) return null;   // 見本の駅は小さいので全部描く。ルートがない時は全体
      var lv = {}; routeXY.forEach(function (s) { lv[s.lv] = 1; });
      // 範囲の判定を速くするため、ルートの線分を囲む箱で先にふるい落とす
      var bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
      routeXY.forEach(function (s) { bx0 = Math.min(bx0, s.ax, s.bx); bx1 = Math.max(bx1, s.ax, s.bx); by0 = Math.min(by0, s.ay, s.by); by1 = Math.max(by1, s.ay, s.by); });
      return {
        levels: lv,
        near: function (x, y, l1, l2) {
          if (x < bx0 - CORR || x > bx1 + CORR || y < by0 - CORR || y > by1 + CORR) return false;
          var d = distRoute(x, y, l1 && lv[l1] ? l1 : null);
          if (l2 && lv[l2]) d = Math.min(d, distRoute(x, y, l2));
          return d <= CORR;
        }
      };
    }
    // ルートの近くの施設：同じ階で距離 GLYPH_R 以内・近い順・近いものはまとめて件数・上限 GLYPH_MAX（行き先のトイレは必ず入れる）
    function makeNear(r) {
      near = []; nearCount = 0;
      if (!routeXY.length) return;
      var lvs = {}; routeXY.forEach(function (s) { lvs[s.lv] = 1; });
      var cand = [];
      glyphs.forEach(function (g) {
        if (!lvs[g.level]) return;
        var d = distRoute(g.x, g.y, g.level);
        if (d <= GLYPH_R) cand.push({ g: g, d: d, goal: r && r.goal === g.id ? 1 : 0 });
      });
      nearCount = cand.length;
      cand.sort(function (a, b) { return (b.goal - a.goal) || (a.d - b.d); });
      cand.forEach(function (c) {
        var g = c.g;
        for (var i = 0; i < near.length; i++) {
          var m = near[i];
          if (m.kind === g.kind && m.level === g.level && Math.hypot(m.x - g.x, m.y - g.y) <= MERGE_M) { m.n++; return; }
        }
        if (near.length < GLYPH_MAX) near.push({ x: g.x, y: g.y, level: g.level, kind: g.kind, ground: g.ground, id: g.id, n: 1, d: c.d, goal: !!c.goal });
      });
    }

    var segs = [];
    function rebuild() { scope = makeScope(); segs = build(scope); }

    // ── 投影（ほぼ正投影：画角 4° で遠くから見る。拡大はレンズの倍率で行うので、寄ってもパースは強くならない）
    var fit = { k: 1, ox: 0, oy: 0 };
    var FOV = 4 * DEG;
    function fovF() { return fit.k * cam.zoom * H / (2 * Math.tan(FOV / 2)); }
    function camDist() { var asp = W / Math.max(1, H); return (R * 0.98 / Math.tan(FOV / 2)) / Math.min(1, asp * 1.15); }
    function proj(p, D, f) {
      var x = p[0] - cam.tx, y = p[1] - cam.ty, z = p[2] - cam.tz;
      var cy_ = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
      var x1 = x * cy_ - z * sy, z1 = x * sy + z * cy_;
      var y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
      var d = D + z2;
      if (d < 1) return null;
      return [W / 2 + fit.ox + x1 * f / d, H / 2 + fit.oy - y2 * f / d, d];
    }
    var PAD = { l: 104, r: 58, t: 18, b: 64 };   // 左は階の名前の列、右は道具のボタン、下は施設の記号の列
    // 全体が画面に収まるよう、倍率と中心のずれを決める（ルートがない時）
    function fitView() {
      fit = { k: 1, ox: 0, oy: 0 }; cam.tx = cam.ty = cam.tz = 0; cam.zoom = 1; anim = null;
      var D = camDist(), f = fovF(), x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      segs.forEach(function (s) { [s[0], s[1]].forEach(function (p) { var q = proj(p, D, f); if (!q) return; x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }); });
      if (x1 <= x0) return;
      var padL = 112, padX = 20, padTop = 20, padBot = 30;
      var k = Math.min((W - padL - padX) / (x1 - x0), (H - padTop - padBot) / (y1 - y0));
      fit.k = k;
      fit.ox = -((x0 + x1) / 2 - (W + padL - padX) / 2) * k;
      fit.oy = -((y0 + y1) / 2 - (H + padTop - padBot) / 2) * k;
    }
    // 点の集まりにカメラを合わせる（中心へ寄せ、画面に収まるいちばん大きな倍率）。minHalf：短い区間でも寄りすぎない余白（m）
    function camFor(points, minHalf) {
      var x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
      points.forEach(function (p) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); });
      var c = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], h = minHalf || 6;
      var bx = [];
      [x0 - h, x1 + h].forEach(function (x) { [y0, y1].forEach(function (y) { [z0 - h, z1 + h].forEach(function (z) { bx.push([x, y, z]); }); }); });
      var keep = { tx: cam.tx, ty: cam.ty, tz: cam.tz, zoom: cam.zoom, f: fit };
      cam.tx = c[0]; cam.ty = c[1]; cam.tz = c[2]; cam.zoom = 1; fit = { k: 1, ox: 0, oy: 0 };
      var D = camDist(), f = fovF(), sx0 = 1e9, sx1 = -1e9, sy0 = 1e9, sy1 = -1e9;
      bx.forEach(function (p) { var q = proj(p, D, f); if (!q) return; sx0 = Math.min(sx0, q[0]); sx1 = Math.max(sx1, q[0]); sy0 = Math.min(sy0, q[1]); sy1 = Math.max(sy1, q[1]); });
      var aw = Math.max(40, W - PAD.l - PAD.r), ah = Math.max(40, H - PAD.t - PAD.b);
      var z = Math.max(ZMIN, Math.min(ZMAX, Math.min(aw / Math.max(1, sx1 - sx0), ah / Math.max(1, sy1 - sy0))));
      var out = { tx: c[0], ty: c[1], tz: c[2], zoom: z,
        ox: -((sx0 + sx1) / 2 - W / 2) * z + (PAD.l - PAD.r) / 2, oy: -((sy0 + sy1) / 2 - H / 2) * z + (PAD.t - PAD.b) / 2 };
      cam.tx = keep.tx; cam.ty = keep.ty; cam.tz = keep.tz; cam.zoom = keep.zoom; fit = keep.f;
      return out;
    }
    function goCam(to, instant) {
      // 倍率は fit.k に畳み込んでから動かす（全体表示からの移り変わりも滑らかに）
      cam.zoom *= fit.k; fit = { k: 1, ox: fit.ox, oy: fit.oy };
      if (instant || reduced() || opts.instant) { anim = null; cam.tx = to.tx; cam.ty = to.ty; cam.tz = to.tz; cam.zoom = to.zoom; fit.ox = to.ox; fit.oy = to.oy; kick(); return; }
      anim = { t0: performance.now(), dur: 480, a: { tx: cam.tx, ty: cam.ty, tz: cam.tz, zoom: cam.zoom, ox: fit.ox, oy: fit.oy }, b: to };
      kick();
    }
    function sectionPoints(i) {
      if (!route) return [];
      if (i < 0) return route;
      var out = [];
      routeMeta.forEach(function (m, j) { if (m.sec === i) { out.push(route[j]); out.push(route[j + 1]); } });
      ptSec.forEach(function (s, j) { if (s === i && route[j]) out.push(route[j]); });   // 線のない区間（ホームの上の始まりなど）は点だけ
      return out.length ? out : route;
    }
    function fitRoute(instant) {
      if (!route) return false;
      fitted = camFor(sectionPoints(curSec), curSec < 0 ? 10 : 7);
      goCam(fitted, instant);
      return true;
    }
    function resize() {
      var r = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(1, r.width); H = Math.max(1, r.height);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      if (route) fitRoute(true); else fitView();
      kick();
    }

    // ── 描画。1 コマに 1 回だけ全部の端点を投影し、にじみ・芯の描き分けはその結果を使い回す。視錐台の外の線は省く
    var pr = new Float32Array(0), wv = new Float32Array(0);
    function levelMul(s) {
      if (!focus) return 1;
      return s[5] === focus || s[6] === focus || s[5] == null ? 1 : 0.13;
    }
    function projectAll(D, f, near_, far) {
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
          var p = s[e], x = p[0] - cam.tx, y = p[1] - cam.ty, z = p[2] - cam.tz;
          var x1 = x * cy_ - z * sy, z1 = x * sy + z * cy_;
          var y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp, d = D + z2;
          if (d < 1) { ok = false; break; }
          pr[i * 4 + e * 2] = hw + x1 * f / d; pr[i * 4 + e * 2 + 1] = hh - y2 * f / d; dsum += d;
        }
        if (!ok) { wv[i] = 0; continue; }
        var ax = pr[i * 4], ay = pr[i * 4 + 1], bx = pr[i * 4 + 2], by = pr[i * 4 + 3];
        if ((ax < -m && bx < -m) || (ax > W + m && bx > W + m) || (ay < -m && by < -m) || (ay > H + m && by > H + m)) { wv[i] = 0; culled++; continue; }
        wv[i] = w * (1 - 0.74 * smooth(near_, far, dsum / 2));
        drawn++;
      }
      perf.drawn = drawn; perf.culled = culled;
    }
    function strokeBuckets(col, width, mult) {
      var B = {};
      for (var i = 0; i < segs.length; i++) {
        if (wv[i] <= 0 || segs[i][3] !== col) continue;
        var k = Math.round(Math.min(1, wv[i] * mult) * 12);
        if (k <= 0) continue;
        (B[k] = B[k] || []).push(i);
      }
      ctx.lineWidth = width;
      Object.keys(B).forEach(function (k) {
        var arr = B[k];
        ctx.strokeStyle = "rgba(" + C(col) + "," + (k / 12).toFixed(3) + ")";
        ctx.beginPath();
        for (var j = 0; j < arr.length; j++) { var o = arr[j] * 4; ctx.moveTo(pr[o], pr[o + 1]); ctx.lineTo(pr[o + 2], pr[o + 3]); }
        ctx.stroke();
      });
    }
    // 施設の記号：ルートの近くの分だけ。その場所から画面の下の列へ引き出し線を出して並べる（x の順・間隔をあけて重ならない）
    var lastIcons = [];
    function drawGlyphs(D, f) {
      lastIcons = [];
      var list = [];
      near.forEach(function (g) {
        if (hidden[g.kind]) return;
        var q = proj(P(g.x, g.y, g.level, 0), D, f);
        if (!q || q[0] < 0 || q[0] > W || q[1] < 0 || q[1] > H - PAD.b + 10) return;
        list.push({ g: g, ax: q[0], ay: q[1], x: q[0] });
      });
      if (!list.length) return;
      list.sort(function (a, b) { return a.ax - b.ax; });
      var r = 7, gap = 32, y = H - 24, lo = 20, hi = W - 20;
      if (gap * (list.length - 1) > hi - lo) gap = (hi - lo) / Math.max(1, list.length - 1);
      for (var it = 0; it < 4; it++) {
        for (var i = 1; i < list.length; i++) if (list[i].x < list[i - 1].x + gap) list[i].x = list[i - 1].x + gap;
        if (list[list.length - 1].x > hi) list[list.length - 1].x = hi;
        for (i = list.length - 2; i >= 0; i--) if (list[i].x > list[i + 1].x - gap) list[i].x = list[i + 1].x - gap;
        if (list[0].x < lo) list[0].x = lo;
      }
      list.forEach(function (o) {
        var g = o.g, bx = o.x, col = g.goal ? ACC : WHITE;
        ctx.lineWidth = 1;
        col = C(col);
        ctx.strokeStyle = "rgba(" + col + (TH.dark ? ",.45)" : ",.6)");   // 引き出し線（場所の小さな丸 → 記号の枠の上）
        ctx.beginPath(); ctx.moveTo(o.ax, o.ay); ctx.lineTo(bx, y - 13); ctx.stroke();
        ctx.beginPath(); ctx.arc(o.ax, o.ay, 2.2, 0, Math.PI * 2); ctx.stroke();
        if (!TH.dark) { ctx.fillStyle = TH.bg; ctx.fillRect(bx - 12, y - 12, 24, 24); }
        ctx.strokeStyle = "rgba(" + col + (TH.dark ? ",.6)" : ",.75)");
        ctx.beginPath(); ctx.rect(bx - 12, y - 12, 24, 24); ctx.stroke();
        var sh = SHAPE[g.kind === "exit" && g.ground ? "exitGround" : g.kind];
        (TH.dark ? [[2.6, 0.16], [1.1, 0.95]] : [[1.5, 1]]).forEach(function (pass) {
          ctx.lineWidth = pass[0]; ctx.strokeStyle = "rgba(" + col + "," + pass[1] + ")";
          ctx.beginPath();
          for (var t = 0; t < sh.length; t++) { var l = sh[t]; ctx.moveTo(bx + l[0] * r, y + l[1] * r); ctx.lineTo(bx + l[2] * r, y + l[3] * r); }
          ctx.stroke();
        });
        if (g.n > 1) {   // まとめた件数
          ctx.fillStyle = "rgba(" + TH.ink + ",.9)"; ctx.font = "10px ui-monospace, Menlo, monospace"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
          ctx.fillText(String(g.n), bx + 14, y - 10);
        }
        lastIcons.push({ kind: g.kind, n: g.n, box: [bx - 12, y - 12, bx + 12, y + 12], anchor: [o.ax, o.ay] });
      });
    }

    function draw(now) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = TH.bg;
      ctx.fillRect(0, 0, W, H);
      var D = camDist(), f = fovF(), near_ = D - R * 0.7, far = D + R * 1.0;
      ctx.globalCompositeOperation = TH.dark ? "lighter" : "source-over";   // 明るい面では足し算にしない（白に飛ぶため）
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      var t0 = performance.now();
      projectAll(D, f, near_, far);
      var heavy = perf.drawn > 6000;
      [WHITE, ACC, AMBER].forEach(function (col) {
        if (TH.dark) {   // にじみ（同じ線を太く淡く重ねる）
          if (!heavy) strokeBuckets(col, 5, 0.09);
          strokeBuckets(col, 2.2, heavy ? 0.16 : 0.22);
          strokeBuckets(col, 1, 0.95);
        } else strokeBuckets(col, 1.1, 1.15);   // 紙の面：にじみなし。濃淡（不透明度）だけで強弱を出す
      });
      // 階の名前：床の板の、画面でいちばん左の角から外側へ引き出し線を出し、左の列に階の高い順で並べる（重ならないよう 16px 以上離す）
      ctx.font = "11px ui-monospace, Menlo, monospace";
      ctx.textBaseline = "middle";
      var labs = [];
      st.levels.forEach(function (l) {
        var sb = slabs[l.id]; if (!sb) return;
        if (scope && !scope.levels[l.id]) return;   // ルートの階だけ
        var best = null;
        [[sb[0], sb[1]], [sb[2], sb[1]], [sb[2], sb[3]], [sb[0], sb[3]]].forEach(function (c) {
          var q = proj(P(c[0], c[1], l.id, 0), D, f); if (q && (!best || q[0] < best[0])) best = q;
        });
        if (best) labs.push({ id: l.id, t: l.name, z: L[l.id].z, ax: best[0], ay: best[1], y: best[1], w: ctx.measureText(l.name).width });
      });
      labs.sort(function (a, b) { return b.z - a.z; });
      for (var it = 0; it < 4; it++) {
        for (var li = 1; li < labs.length; li++) if (labs[li].y < labs[li - 1].y + 16) labs[li].y = labs[li - 1].y + 16;
        if (labs.length && labs[labs.length - 1].y > H - 10) labs[labs.length - 1].y = H - 10;
        for (li = labs.length - 2; li >= 0; li--) if (labs[li].y > labs[li + 1].y - 16) labs[li].y = labs[li + 1].y - 16;
        if (labs.length && labs[0].y < 10) labs[0].y = 10;
      }
      labs.forEach(function (b) {
        var tx = 8, ex = tx + b.w + 4;
        var ax = Math.max(-4000, Math.min(W + 4000, b.ax)), ay = Math.max(-4000, Math.min(H + 4000, b.ay));
        ctx.strokeStyle = "rgba(" + TH.ink + (TH.dark ? ",.35)" : ",.45)"); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(ex, b.y); ctx.lineTo(Math.max(ex + 6, ax - 3), b.y); ctx.lineTo(ax, ay); ctx.stroke();
        // 文字のコントラスト（AA 4.5:1 目安）：薄表示でも dark .55／light .62 を下回らない
        ctx.fillStyle = "rgba(" + TH.ink + "," + (focus && b.id !== focus ? (TH.dark ? ".55" : ".62") : (TH.dark ? ".85" : ".9")) + ")"; ctx.textAlign = "left";
        ctx.save(); ctx.globalAlpha = 0.85; ctx.fillStyle = TH.bg; ctx.fillRect(tx - 3, b.y - 8, b.w + 6, 16); ctx.restore();   // 線が文字に重ならないよう面の色の下地
        ctx.fillText(b.t, tx, b.y);
        b.box = [tx, b.y - 7, ex, b.y + 7];
      });
      lastLabels = labs;
      // 経路（いまの区間を強く、ほかは控えめに）
      if (route) {
        var rp = route.map(function (p) { return proj(p, D, f); });
        if (rp.every(Boolean)) {
          var len = [0];
          for (var i = 1; i < rp.length; i++) len.push(len[i - 1] + Math.hypot(rp[i][0] - rp[i - 1][0], rp[i][1] - rp[i - 1][1]));
          var total = len[len.length - 1] || 1, upto = total * routeT;
          var path = function (only) {
            ctx.beginPath();
            var started = false;
            for (var i = 1; i < rp.length; i++) {
              if (only != null && routeMeta[i - 1] && routeMeta[i - 1].sec !== only) { started = false; continue; }
              if (len[i - 1] > upto) break;
              if (!started) { ctx.moveTo(rp[i - 1][0], rp[i - 1][1]); started = true; }
              if (len[i] <= upto) ctx.lineTo(rp[i][0], rp[i][1]);
              else { var t = (upto - len[i - 1]) / Math.max(1e-6, len[i] - len[i - 1]); ctx.lineTo(rp[i - 1][0] + (rp[i][0] - rp[i - 1][0]) * t, rp[i - 1][1] + (rp[i][1] - rp[i - 1][1]) * t); break; }
            }
          };
          var dimAll = curSec >= 0 ? 0.4 : 1, A = TH.acc, PP = TH.paper;
          if (TH.dark) {   // 光る線（4 重のにじみ）
            [[14, 0.07], [7, 0.16], [3.2, 0.55], [1.6, 1]].forEach(function (w) { path(null); ctx.lineWidth = w[0]; ctx.strokeStyle = "rgba(" + A + "," + (w[1] * dimAll).toFixed(3) + ")"; ctx.stroke(); });
            if (curSec >= 0) {
              [[18, 0.12], [8, 0.3], [3.6, 0.8], [1.8, 1]].forEach(function (w) { path(curSec); ctx.lineWidth = w[0]; ctx.strokeStyle = "rgba(" + A + "," + w[1] + ")"; ctx.stroke(); });
              path(curSec); ctx.lineWidth = 1; ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.stroke();
            }
          } else {   // 紙の面：紙の色の縁取り＋アクセント色のくっきりした太線（にじみなし）
            path(null); ctx.lineWidth = 6; ctx.strokeStyle = "rgba(" + PP + "," + (0.9 * dimAll).toFixed(3) + ")"; ctx.stroke();
            path(null); ctx.lineWidth = 3.4; ctx.strokeStyle = "rgba(" + A + "," + (curSec >= 0 ? 0.35 : 1) + ")"; ctx.stroke();
            if (curSec >= 0) {
              path(curSec); ctx.lineWidth = 7.5; ctx.strokeStyle = "rgb(" + PP + ")"; ctx.stroke();
              path(curSec); ctx.lineWidth = 4.4; ctx.strokeStyle = "rgb(" + A + ")"; ctx.stroke();
            }
          }
          // 推測の接続を通る区間は、琥珀色の点線を重ねる（「推」の印）
          if (routeT >= 1 && routeMeta.some(function (m) { return m.g; })) {
            ctx.setLineDash([4, 4]); ctx.lineWidth = TH.dark ? 2.4 : 2.6; ctx.strokeStyle = "rgba(" + TH.amber + ",.95)";
            ctx.beginPath();
            for (var gi = 0; gi < routeMeta.length; gi++) if (routeMeta[gi].g) { ctx.moveTo(rp[gi][0], rp[gi][1]); ctx.lineTo(rp[gi + 1][0], rp[gi + 1][1]); }
            ctx.stroke(); ctx.setLineDash([]);
          }
          var pt = (now - pulseT0) / 1600;
          if (routeT >= 1 && !reduced() && pt >= 0 && pt < 2) {
            var at = total * (pt % 1);
            for (var j = 1; j < rp.length; j++) if (len[j] >= at) {
              var tt = (at - len[j - 1]) / Math.max(1e-6, len[j] - len[j - 1]);
              var gx = rp[j - 1][0] + (rp[j][0] - rp[j - 1][0]) * tt, gy = rp[j - 1][1] + (rp[j][1] - rp[j - 1][1]) * tt;
              if (TH.dark) {
                var g = ctx.createRadialGradient(gx, gy, 0, gx, gy, 14);
                g.addColorStop(0, "rgba(255,255,255,.95)"); g.addColorStop(0.3, "rgba(" + A + ",.55)"); g.addColorStop(1, "rgba(" + A + ",0)");
                ctx.fillStyle = g; ctx.beginPath(); ctx.arc(gx, gy, 14, 0, Math.PI * 2); ctx.fill();
              } else {   // 紙の面：にじみの代わりに、紙の縁のついた濃い点
                ctx.fillStyle = "rgb(" + PP + ")"; ctx.beginPath(); ctx.arc(gx, gy, 6, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = "rgb(" + A + ")"; ctx.beginPath(); ctx.arc(gx, gy, 4, 0, Math.PI * 2); ctx.fill();
              }
              break;
            }
          }
          var ends = [[rp[0], TH.amber], [routeT >= 1 ? rp[rp.length - 1] : null, A]];
          ends.forEach(function (e) {
            if (!e[0]) return;
            if (!TH.dark) { ctx.fillStyle = "rgb(" + PP + ")"; ctx.beginPath(); ctx.arc(e[0][0], e[0][1], 8, 0, Math.PI * 2); ctx.fill(); }
            ctx.strokeStyle = "rgba(" + e[1] + ",.95)"; ctx.lineWidth = TH.dark ? 1.6 : 2.2;
            ctx.beginPath(); ctx.arc(e[0][0], e[0][1], 6, 0, Math.PI * 2); ctx.stroke();
            ctx.fillStyle = "rgba(" + e[1] + (TH.dark ? ",.25)" : ",.18)"); ctx.beginPath(); ctx.arc(e[0][0], e[0][1], TH.dark ? 11 : 3, 0, Math.PI * 2); ctx.fill();
          });
        }
      }
      drawGlyphs(D, f);
      ctx.globalCompositeOperation = "source-over";
      var dtm = performance.now() - t0;
      perf.last = dtm; perf.n++; perf.sum += dtm; perf.max = Math.max(perf.max, dtm);
    }

    // ── 繰り返し（必要な間だけ回す）
    function animating(now) {
      return !!anim || routeT < 1 || Math.abs(vel.yaw) > 1e-4 || Math.abs(vel.pitch) > 1e-4 || Math.abs(spread - spreadTo) > 1e-3 || (!reduced() && route && now - pulseT0 < 3200);
    }
    var last = 0;
    function frame(now) {
      raf = 0;
      if (!alive || !canvas.isConnected) return;
      var dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016; last = now;
      if (routeT < 1) { routeT = Math.min(1, (now - routeT0) / 900); if (routeT >= 1) pulseT0 = now; }
      if (anim) {
        var u = Math.min(1, (now - anim.t0) / anim.dur), e = 1 - Math.pow(1 - u, 3), a = anim.a, b = anim.b;
        cam.tx = a.tx + (b.tx - a.tx) * e; cam.ty = a.ty + (b.ty - a.ty) * e; cam.tz = a.tz + (b.tz - a.tz) * e;
        cam.zoom = Math.exp(Math.log(a.zoom) + (Math.log(b.zoom) - Math.log(a.zoom)) * e);
        fit.ox = a.ox + (b.ox - a.ox) * e; fit.oy = a.oy + (b.oy - a.oy) * e;
        if (u >= 1) anim = null;
      }
      if (!drag.active && (vel.yaw || vel.pitch)) {
        cam.yaw += vel.yaw * dt * 60; cam.pitch = clampP(cam.pitch + vel.pitch * dt * 60);
        var dec = Math.exp(-dt * 5.5); vel.yaw *= dec; vel.pitch *= dec;
        if (Math.abs(vel.yaw) < 1e-4) vel.yaw = 0; if (Math.abs(vel.pitch) < 1e-4) vel.pitch = 0;
      }
      if (Math.abs(spread - spreadTo) > 1e-3) {
        spread += (spreadTo - spread) * (1 - Math.exp(-dt * 9));
        if (Math.abs(spread - spreadTo) <= 1e-3) spread = spreadTo;
        route = buildRoute(lastR); rebuild();
      }
      draw(now);
      if (animating(now)) kick(); else last = 0;
    }
    function kick() { if (!raf && alive) raf = requestAnimationFrame(frame); }
    function clampP(p) { return Math.min(90 * DEG, Math.max(12 * DEG, p)); }   // ピッチは 12°〜真上 90°。ヨーは鉛直の軸まわりだけなので床は常に水平

    // ── 操作：1 本指＝注視点まわりの回転、シフト+ドラッグ＝平行移動、2 本指＝拡大（つまむ中心へ）と平行移動、ホイール＝カーソルの下へ拡大、矢印キー＝回転、＋−＝拡大、[ ]＝区間を戻る・進む
    var pts = {}, drag = { active: false };
    function count() { return Object.keys(pts).length; }
    function pinchInfo() {
      var k = Object.keys(pts), a = pts[k[0]], b = pts[k[1]];
      return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    }
    // ── 注視点（cam.tx/ty/tz）。回転はいつもこの点まわり。画面の上では「見える範囲の中心」PIV() に置く
    // 画面の中心＝キャンバス全体の見た目の中心（階の名前の列やボタンが重なっていても、目に見える真ん中）
    function PIV() { return [W / 2, H / 2]; }
    // 画面の点 (sx, sy) の下にある、高さ h の水平面の上の点（proj の逆）。面と交わらなければ null
    function unproject(sx, sy, h) {
      var D = camDist(), f = fovF(), u = (sx - W / 2 - fit.ox) / f, v = -(sy - H / 2 - fit.oy) / f;
      var cy_ = Math.cos(cam.yaw), sy_ = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
      var den = v * cp + sp; if (den < 1e-4) return null;
      var t = (h - cam.ty + D * sp) / den; if (t < 1) return null;
      var x1 = u * t, y2 = v * t, z2 = t - D, z1 = -y2 * sp + z2 * cp;
      return [x1 * cy_ + z1 * sy_ + cam.tx, h, -x1 * sy_ + z1 * cy_ + cam.tz];
    }
    // 画面の点 (sx, sy) を通る視線の上で、奥行き d（proj の 3 番目の値）の点
    function unprojectDepth(sx, sy, d) {
      var D = camDist(), f = fovF(), u = (sx - W / 2 - fit.ox) / f, v = -(sy - H / 2 - fit.oy) / f;
      var cy_ = Math.cos(cam.yaw), sy_ = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
      var x1 = u * d, y2 = v * d, z2 = d - D;
      var y = y2 * cp + z2 * sp, z1 = -y2 * sp + z2 * cp;
      return [x1 * cy_ + z1 * sy_ + cam.tx, y + cam.ty, -x1 * sy_ + z1 * cy_ + cam.tz];
    }
    // 回転の中心を採る：画面の中心の視線の上で、描いている物（線・階段/エスカレーターのモデル・ルートの線）のうち
    // 中心から PICK_PX 以内に見える最も手前の物の奥行き。なければ床の板（見ている階を優先・次に手前の板）。それもなければ注視点の高さの水平面
    var PICK_PX = 10;
    function pickPivot() {
      var c = PIV(), D = camDist(), f = fovF(), best = null;
      function tryLine(a, b) {
        var qa = proj(a, D, f), qb = proj(b, D, f); if (!qa || !qb) return;
        var dx = qb[0] - qa[0], dy = qb[1] - qa[1], l = dx * dx + dy * dy, t = l ? ((c[0] - qa[0]) * dx + (c[1] - qa[1]) * dy) / l : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        if (Math.hypot(qa[0] + dx * t - c[0], qa[1] + dy * t - c[1]) > PICK_PX) return;
        var d = qa[2] + (qb[2] - qa[2]) * t;
        if (!best || d < best.d) best = { d: d, src: "line" };
      }
      for (var i = 0; i < segs.length; i++) {
        var s = segs[i];
        if (s[7] && hidden[s[7]]) continue;
        if (s[4] === "floor" && s[7] == null && s[6] == null && s[2] <= 0.22) continue;   // 床の板の枠は下の「板」で扱う
        if (focus && levelMul(s) < 1) continue;   // 薄く出している階は選ばない
        tryLine(s[0], s[1]);
      }
      if (route) for (i = 1; i < route.length; i++) tryLine(route[i - 1], route[i]);
      if (!best) {   // 床の板：視線と各階の水平面の交点が、その階の板の中にあるか
        st.levels.forEach(function (l) {
          var b = slabs[l.id]; if (!b) return;
          if (scope && !scope.levels[l.id]) return;
          if (focus && l.id !== focus) return;
          var q = unproject(c[0], c[1], zOf(l.id, 0)); if (!q) return;
          var wx = q[0] + cx, wy = q[2] + cy;
          if (wx < b[0] || wx > b[2] || wy < b[1] || wy > b[3]) return;
          var pq = proj(q, D, f); if (pq && (!best || pq[2] < best.d)) best = { d: pq[2], src: "slab" };
        });
      }
      if (best) return { p: unprojectDepth(c[0], c[1], best.d), src: best.src };
      var h = unproject(c[0], c[1], cam.ty);
      return h ? { p: h, src: "plane" } : null;
    }
    var lastPick = null;
    // 回し始め：中心の下の点を注視点にする（見た目は変えない）。回転中はこの点のまま
    function beginRotate() {
      anim = null;
      var r = pickPivot(); lastPick = r ? { src: r.src, p: r.p.slice() } : null; if (!r) return;
      cam.tx = r.p[0]; cam.ty = r.p[1]; cam.tz = r.p[2]; fit.ox = 0; fit.oy = 0;
    }
    function clampT() { var lim = R * 1.2; cam.tx = Math.max(-lim, Math.min(lim, cam.tx)); cam.tz = Math.max(-lim, Math.min(lim, cam.tz)); }
    // 見た目を変えずに、画面の中心 PIV() に見えている点を注視点にし直す（区間送り・自動フィットのずれ fit.ox/oy を畳む）
    function rebase() {
      anim = null;
      var c = PIV(), q = unproject(c[0], c[1], cam.ty); if (!q) return;
      cam.tx = q[0]; cam.tz = q[2]; fit.ox = c[0] - W / 2; fit.oy = c[1] - H / 2;
    }
    function floorH() { return focus && L[focus] ? zOf(focus, 0) : cam.ty; }   // 拡大の基準の床：見ている階、なければ注視点の高さ
    // (sx, sy) の下の点を動かさずに拡大。位置がなければ画面の中心で
    function zoomBy(m, sx, sy) {
      rebase();
      if (sx == null) { var c = PIV(); sx = c[0]; sy = c[1]; }
      var h = floorH(), a = unproject(sx, sy, h);
      cam.zoom = Math.min(ZMAX / fit.k, Math.max(ZMIN / fit.k, cam.zoom * m));
      var b = a && unproject(sx, sy, h);
      if (a && b) { cam.tx += a[0] - b[0]; cam.tz += a[2] - b[2]; clampT(); }
      kick();
    }
    // 平行移動：(dx, dy) px だけ、指の下の床ごと注視点を動かす
    function pan(dx, dy) {
      rebase();
      var c = PIV(), a = unproject(c[0], c[1], cam.ty), b = unproject(c[0] + dx, c[1] + dy, cam.ty);
      if (a && b) { cam.tx -= b[0] - a[0]; cam.tz -= b[2] - a[2]; clampT(); }
      kick();
    }
    function rotate(dyaw, dpitch) { if (anim) beginRotate(); cam.yaw += dyaw; cam.pitch = clampP(cam.pitch + dpitch); }
    function local(e) { var r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    canvas.addEventListener("pointerdown", function (e) {
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      drag = { active: true, pinch: count() === 2 ? pinchInfo() : null, t: performance.now(), shift: !!e.shiftKey };
      vel.yaw = vel.pitch = 0;
      if (count() === 1 && !drag.shift) beginRotate(); else rebase();   // 1 本指の回し始めごとに中心を採り直す（ズーム・パンの後も必ず）
    });
    canvas.addEventListener("pointermove", function (e) {
      var q = pts[e.pointerId]; if (!q) return;
      var dx = e.clientX - q.x, dy = e.clientY - q.y;
      q.x = e.clientX; q.y = e.clientY;
      if (count() >= 2 && drag.pinch) {
        var pi = pinchInfo();
        var r = canvas.getBoundingClientRect();
        zoomBy(pi.d / Math.max(1, drag.pinch.d), drag.pinch.mx - r.left, drag.pinch.my - r.top);   // つまむ中心の下の点を動かさない
        pan(pi.mx - drag.pinch.mx, pi.my - drag.pinch.my);
        drag.pinch = pi;
      } else if (count() === 1 && (drag.shift || e.shiftKey)) {
        pan(dx, dy); vel.yaw = vel.pitch = 0;
      } else if (count() === 1) {
        var ky = -dx * 0.0065, kp = dy * 0.005;
        rotate(ky, kp);
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
    canvas.addEventListener("wheel", function (e) { e.preventDefault(); var q = local(e); zoomBy(Math.exp(-e.deltaY * 0.0015), q[0], q[1]); }, { passive: false });
    canvas.addEventListener("keydown", function (e) {
      var k = e.key, used = true;
      if (k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowUp" || k === "ArrowDown") beginRotate();
      if (k === "ArrowLeft") rotate(0.12, 0); else if (k === "ArrowRight") rotate(-0.12, 0);
      else if (k === "ArrowUp") rotate(0, 0.08); else if (k === "ArrowDown") rotate(0, -0.08);
      else if (k === "+" || k === "=") zoomBy(1.15); else if (k === "-" || k === "_") zoomBy(1 / 1.15);
      else if (k === "]") api.stepSection(1); else if (k === "[") api.stepSection(-1);
      else used = false;
      if (used) { e.preventDefault(); kick(); }
    });
    var lastR = null, lastLabels = [];
    var ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
    rebuild();
    if (ro) ro.observe(canvas); else window.addEventListener("resize", resize);
    resize();

    var api = {
      setSelection: function (s) { sel = s; route = buildRoute(lastR); rebuild(); kick(); },
      /** ルートを出す。カメラはルート全体に自動で合わせる（o.fit=false で合わせない） */
      setRoute: function (r, o) {
        lastR = r; curSec = -1;
        route = buildRoute(r); makeNear(r); rebuild();
        if (reduced() || opts.instant) { routeT = 1; pulseT0 = -1e9; } else { routeT = 0; routeT0 = performance.now(); }
        if (!o || o.fit !== false) { if (route) fitRoute(false); else fitView(); }
        kick();
      },
      /** 区間：-1＝ルート全体。i 番の区間に寄って強調する */
      setSection: function (i) { if (!route) return -1; curSec = i < -1 ? -1 : i >= secs.length ? secs.length - 1 : i; fitRoute(false); kick(); return curSec; },
      stepSection: function (d) { if (!route || !secs.length) return -1; var i = curSec + d; if (i < -1) i = secs.length - 1; if (i >= secs.length) i = -1; return api.setSection(i); },
      section: function () { return curSec; },
      sectionCount: function () { return secs.length; },
      fitRoute: function () { curSec = -1; return fitRoute(false); },
      /** 視点を戻す：ルートがあればルート全体へ、なければ駅全体へ（向きも初めの角度に） */
      reset: function () { cam.yaw = HOME.yaw; cam.pitch = HOME.pitch; vel.yaw = vel.pitch = 0; anim = null; if (route) { curSec = -1; fitRoute(true); } else fitView(); kick(); },
      setSpread: function (on) { spreadTo = on ? SPREAD[1] : SPREAD[0]; if (reduced()) { spread = spreadTo; route = buildRoute(lastR); rebuild(); } kick(); },
      resume: function () { alive = true; last = 0; resize(); },
      destroy: function () { alive = false; if (raf) cancelAnimationFrame(raf); raf = 0; if (ro) ro.disconnect(); if (mo) mo.disconnect(); },
      _theme: function () { return Object.assign({}, TH); },
      /** ルートの近くの施設：shown＝描く記号の数（まとめた後）、items＝範囲の中の施設の数、all＝駅の全部の数 */
      nearInfo: function () { return { shown: near.length, items: nearCount, all: glyphs.length, list: near.map(function (g) { return { kind: g.kind, n: g.n, id: g.id, d: +g.d.toFixed(1), level: g.level, goal: g.goal }; }) }; },
      _state: function () { return { cam: Object.assign({}, cam), k: fit.k, spread: spread, routeT: routeT, segs: segs.length, running: !!raf, section: curSec, scoped: !!scope, fitted: fitted ? Object.assign({}, fitted) : null }; },
      _segs: function () { return segs.map(function (s) { return { a: s[0], b: s[1], tag: s[4], kind: s[7] }; }); },
      _segsAll: function () { return build(null).map(function (s) { return { a: s[0], b: s[1], tag: s[4], kind: s[7] }; }); },
      _levelHeights: function () { var o = {}; st.levels.forEach(function (l) { o[l.id] = zOf(l.id, 0); }); return o; },
      _labels: function () { return lastLabels.map(function (b) { return { t: b.t, box: b.box }; }); },
      _icons: function () { return lastIcons.slice(); },
      _setCam: function (yaw, pitch) { cam.yaw = yaw; cam.pitch = clampP(pitch); vel.yaw = vel.pitch = 0; anim = null; if (route) fitRoute(true); else fitView(); kick(); },
      _project: function (x, y, level, dz) { return proj(P(x, y, level, dz), camDist(), fovF()); },
      _pxPerM: function () { return fovF() / camDist(); },
      _pivot: function () { return { t: [cam.tx, cam.ty, cam.tz], screen: proj([cam.tx, cam.ty, cam.tz], camDist(), fovF()), center: PIV() }; },
      _unproject: function (sx, sy, h) { return unproject(sx, sy, h == null ? floorH() : h); },
      _projW: function (p) { return proj(p, camDist(), fovF()); },
      _rotate: function (dy, dp) { beginRotate(); rotate(dy, dp); kick(); },
      _pick: function () { var r = pickPivot(); return r ? { p: r.p, src: r.src, screen: proj(r.p, camDist(), fovF()) } : null; },
      _lastPick: function () { return lastPick; },
      _zoomAt: function (m, sx, sy) { zoomBy(m, sx, sy); },
      _pan: function (dx, dy) { pan(dx, dy); },
      _zoomLimits: function () { return { min: ZMIN, max: ZMAX }; },
      setHidden: function (kind, hide) { hidden[kind] = !!hide; kick(); },
      hidden: function () { return Object.assign({}, hidden); },
      setFocus: function (lv) { focus = lv && L[lv] ? lv : null; kick(); },
      focus: function () { return focus; },
      /** その点を画面の中心に寄せて拡大 */
      zoomTo: function (x, y, zoom) { anim = null; fit = { k: 1, ox: 0, oy: 0 }; cam.tx = x - cx; cam.tz = y - cy; cam.ty = 0; cam.zoom = Math.min(ZMAX, Math.max(ZMIN, zoom || 2.5)); kick(); },
      _perf: function () { return { frames: perf.n, avgMs: perf.n ? perf.sum / perf.n : 0, maxMs: perf.max, lastMs: perf.last, segs: segs.length, glyphs: glyphs.length, near: near.length, drawn: perf.drawn, culled: perf.culled }; },
      _perfReset: function () { perf.n = 0; perf.sum = 0; perf.max = 0; },
      _drawOnce: function () { draw(performance.now()); return perf.last; },
      _glyphs: function () { return glyphs.slice(); }
    };
    return api;
  }
  GT.station3d = { create: create };
})(window.GT = window.GT || {});
