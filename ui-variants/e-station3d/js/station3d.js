// 駅の立体図の描画（依存ゼロ・Canvas 2D）。黒い面に「枠線だけが白く光る」線画。
// 手法は GNOTO の 3D 音響スタジオ（addons/mstudio-hallview.js）を参考にした：
//   ・面は描かず、線分だけを白で描く（LineSegments＋白一色）
//   ・足し算の合成（AdditiveBlending）＝線が重なる所ほど明るい
//   ・奥行きで薄くする（lineF の uFade：1 − 0.74 × smoothstep(near, far, 奥行き)）
//   ・光のにじみ（UnrealBloomPass 強さ .42・半径 .38）→ ここでは同じ線を太く淡く重ね描きして近づけた
// GNOTO は three.js（WebGL）だが、この試作は外部のライブラリ・CDN を使わない約束なので、投影も自前で書いた（DESIGN.md）。
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
    var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    st.areas.forEach(function (a) { minX = Math.min(minX, a.rect[0]); maxX = Math.max(maxX, a.rect[2]); minY = Math.min(minY, a.rect[1]); maxY = Math.max(maxY, a.rect[3]); });
    var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    var zs = st.levels.map(function (l) { return l.z; });
    var zMid = (Math.max.apply(null, zs) + Math.min.apply(null, zs)) / 2;
    var R = Math.hypot(maxX - minX, maxY - minY) / 2;

    var HOME = { yaw: -62 * DEG, pitch: 40 * DEG, zoom: 1, tx: 0, tz: 0 };
    var cam = { yaw: HOME.yaw, pitch: HOME.pitch, zoom: 1, tx: 0, tz: 0 };
    var SPREAD = [2.6, 5];   // 高さの誇張（階の間が薄く見えないように）。「階の間隔を広げる」で 5 倍
    var spread = SPREAD[0], spreadTo = SPREAD[0];
    var vel = { yaw: 0, pitch: 0 };
    var W = 0, H = 0, dpr = 1;
    var route = null, routeT = 1, routeT0 = 0, pulseT0 = 0, sel = null;
    var raf = 0, alive = true;
    var reduced = function () { return GT.M ? GT.M.reduced() : false; };

    // ── 世界の座標（x 東・y 北・z 上、単位 m）→ 描画の座標（X 右・Y 上・Z 手前）
    function zOf(level, dz) { return (L[level].z - zMid) * spread + (dz || 0); }
    function P(x, y, level, dz) { return [x - cx, zOf(level, dz), y - cy]; }

    // ── 線分を作る（形は spread で変わるので、毎回作る。数百本なので軽い）
    function build() {
      var S = [];   // [a, b, 強さ, 色]
      function seg(a, b, k, col) { S.push([a, b, k, col || WHITE]); }
      function rect(x0, y0, x1, y1, lv, dz, k) {
        var a = P(x0, y0, lv, dz), b = P(x1, y0, lv, dz), c = P(x1, y1, lv, dz), d = P(x0, y1, lv, dz);
        seg(a, b, k); seg(b, c, k); seg(c, d, k); seg(d, a, k);
      }
      function box(x0, y0, x1, y1, lv, h, kFloor, kTop, kPost) {
        rect(x0, y0, x1, y1, lv, 0, kFloor); rect(x0, y0, x1, y1, lv, h, kTop);
        [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].forEach(function (q) { seg(P(q[0], q[1], lv, 0), P(q[0], q[1], lv, h), kPost); });
      }
      st.areas.forEach(function (a) {
        var r = a.rect;
        if (a.kind === "platform") box(r[0], r[1], r[2], r[3], a.level, 1.1, 0.5, 1, 0.55);
        else box(r[0], r[1], r[2], r[3], a.level, 3.2, 0.85, 0.22, 0.3);
      });
      st.tracks.forEach(function (t) {
        var ax = t.from[0] === t.to[0] ? [0.55, 0] : [0, 0.55];
        seg(P(t.from[0] - ax[0], t.from[1] - ax[1], t.level, -0.2), P(t.to[0] - ax[0], t.to[1] - ax[1], t.level, -0.2), 0.32);
        seg(P(t.from[0] + ax[0], t.from[1] + ax[1], t.level, -0.2), P(t.to[0] + ax[0], t.to[1] + ax[1], t.level, -0.2), 0.32);
      });
      // 号車の区切り（ホームの縁に短い縦線）
      st.platforms.forEach(function (p) {
        for (var c = 1; c <= p.cars + 1; c++) {
          var s = p.car1Front + p.dir * p.carLen * (c - 1);
          var e1 = p.axis === "x" ? [s, p.center - 4.6] : [p.center - 5.6, s], e2 = p.axis === "x" ? [s, p.center + 4.6] : [p.center + 5.6, s];
          seg(P(e1[0], e1[1], p.level, 1.1), P(e1[0], e1[1], p.level, 1.9), 0.3);
          seg(P(e2[0], e2[1], p.level, 1.1), P(e2[0], e2[1], p.level, 1.9), 0.3);
        }
      });
      // 上下の移動の設備
      st.edges.forEach(function (e) {
        var a = N[e.a], b = N[e.b];
        if (e.kind !== "stairs" && e.kind !== "escalator" && e.kind !== "elevator") return;
        var top = L[a.level].z > L[b.level].z ? a : b, bot = top === a ? b : a;
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
      if (sel) {
        var p = GT.stationGraph.platformOf(st, sel.platform);
        var cr = GT.stationGraph.carRange(p, sel.car);
        var w = p.axis === "x" ? [cr[0], p.center - 4.2, cr[1], p.center + 4.2] : [p.center - 5.2, cr[0], p.center + 5.2, cr[1]];
        var q = [P(w[0], w[1], p.level, 1.2), P(w[2], w[1], p.level, 1.2), P(w[2], w[3], p.level, 1.2), P(w[0], w[3], p.level, 1.2)];
        for (var i = 0; i < 4; i++) S.push([q[i], q[(i + 1) % 4], 0.8, ACC]);
        var d = GT.stationGraph.doorXY(st, p, sel.car, sel.door);
        S.push([P(d.x, d.y, p.level, 1.2), P(d.x, d.y, p.level, 4.2), 1, AMBER]);
      }
      return S;
    }
    var segs = build();

    // ── 経路の点列（3D）
    function routePoints(r) {
      if (!r || !r.ok || !r.path.length) return null;
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
    function fovF() { return fit.k * H / (2 * Math.tan(20 * DEG)); }
    function camDist() { var asp = W / Math.max(1, H); return (R * 0.98 / Math.tan(20 * DEG)) / Math.min(1, asp * 1.15) / cam.zoom; }
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
      var padX = 20, padTop = 20, padBot = 30;
      var k = Math.min((W - padX * 2) / (x1 - x0), (H - padTop - padBot) / (y1 - y0));
      fit.k = k;
      fit.ox = -((x0 + x1) / 2 - W / 2) * k;
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
    function strokeBuckets(list, D, f, near, far, col, width, mult) {
      var B = {};
      for (var i = 0; i < list.length; i++) {
        var s = list[i]; if (s[3] !== col) continue;
        var a = proj(s[0], D, f), b = proj(s[1], D, f);
        if (!a || !b) continue;
        var fade = 1 - 0.74 * smooth(near, far, (a[2] + b[2]) / 2);
        var k = Math.round(Math.min(1, s[2] * fade * mult) * 12);
        if (k <= 0) continue;
        (B[k] = B[k] || []).push(a[0], a[1], b[0], b[1]);
      }
      ctx.lineWidth = width;
      Object.keys(B).forEach(function (k) {
        var arr = B[k];
        ctx.strokeStyle = "rgba(" + col + "," + (k / 12).toFixed(3) + ")";
        ctx.beginPath();
        for (var j = 0; j < arr.length; j += 4) { ctx.moveTo(arr[j], arr[j + 1]); ctx.lineTo(arr[j + 2], arr[j + 3]); }
        ctx.stroke();
      });
    }

    function draw(now) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#020306";
      ctx.fillRect(0, 0, W, H);
      var D = camDist(), f = fovF(), near = D - R * 0.7, far = D + R * 1.0;
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      // 光のにじみ（太く淡く）→ 芯（細く強く）
      [WHITE, ACC, AMBER].forEach(function (col) {
        strokeBuckets(segs, D, f, near, far, col, 5, 0.09);
        strokeBuckets(segs, D, f, near, far, col, 2.2, 0.22);
        strokeBuckets(segs, D, f, near, far, col, 1, 0.95);
      });
      // 階の名前
      ctx.font = "11px ui-monospace, Menlo, monospace";
      ctx.textBaseline = "middle";
      var labs = [];
      st.levels.forEach(function (l) {
        var a0 = st.areas.find(function (a) { return a.level === l.id; });
        var q = a0 ? proj(P(a0.rect[0], a0.rect[1], l.id, 0), D, f) : null;
        if (!q) return;
        var tw = ctx.measureText(l.name).width;
        labs.push({ t: l.name, x: Math.min(W - tw - 8, Math.max(8, q[0] - tw - 6)), y: q[1] });
      });
      // 重ならないよう縦にずらす
      labs.sort(function (a, b) { return a.y - b.y; });
      for (var li = 1; li < labs.length; li++) if (Math.abs(labs[li].x - labs[li - 1].x) < 90 && labs[li].y - labs[li - 1].y < 15) labs[li].y = labs[li - 1].y + 15;
      ctx.fillStyle = "rgba(" + WHITE + ",.82)";
      ctx.textAlign = "left";
      labs.forEach(function (b) { ctx.fillText(b.t, b.x, b.y); });
      // 経路
      if (route) {
        var pr = route.map(function (p) { return proj(p, D, f); });
        if (pr.every(Boolean)) {
          var len = [0];
          for (var i = 1; i < pr.length; i++) len.push(len[i - 1] + Math.hypot(pr[i][0] - pr[i - 1][0], pr[i][1] - pr[i - 1][1]));
          var total = len[len.length - 1] || 1, upto = total * routeT;
          var path = function () {
            ctx.beginPath(); ctx.moveTo(pr[0][0], pr[0][1]);
            for (var i = 1; i < pr.length; i++) {
              if (len[i] <= upto) ctx.lineTo(pr[i][0], pr[i][1]);
              else { var t = (upto - len[i - 1]) / Math.max(1e-6, len[i] - len[i - 1]); ctx.lineTo(pr[i - 1][0] + (pr[i][0] - pr[i - 1][0]) * t, pr[i - 1][1] + (pr[i][1] - pr[i - 1][1]) * t); break; }
            }
          };
          [[14, 0.07], [7, 0.16], [3.2, 0.55], [1.6, 1]].forEach(function (w) { path(); ctx.lineWidth = w[0]; ctx.strokeStyle = "rgba(" + ACC + "," + w[1] + ")"; ctx.stroke(); });
          // 進む向きの光の粒（引き終えてから 2 往復だけ・動きを減らす設定では出さない）
          var pt = (now - pulseT0) / 1600;
          if (routeT >= 1 && !reduced() && pt >= 0 && pt < 2) {
            var at = total * (pt % 1);
            for (var j = 1; j < pr.length; j++) if (len[j] >= at) {
              var tt = (at - len[j - 1]) / Math.max(1e-6, len[j] - len[j - 1]);
              var gx = pr[j - 1][0] + (pr[j][0] - pr[j - 1][0]) * tt, gy = pr[j - 1][1] + (pr[j][1] - pr[j - 1][1]) * tt;
              var g = ctx.createRadialGradient(gx, gy, 0, gx, gy, 14);
              g.addColorStop(0, "rgba(255,255,255,.95)"); g.addColorStop(0.3, "rgba(" + ACC + ",.55)"); g.addColorStop(1, "rgba(" + ACC + ",0)");
              ctx.fillStyle = g; ctx.beginPath(); ctx.arc(gx, gy, 14, 0, Math.PI * 2); ctx.fill();
              break;
            }
          }
          // 始点（ドア）と終点の印
          var ends = [[pr[0], AMBER], [routeT >= 1 ? pr[pr.length - 1] : null, ACC]];
          ends.forEach(function (e) {
            if (!e[0]) return;
            ctx.strokeStyle = "rgba(" + e[1] + ",.95)"; ctx.lineWidth = 1.6;
            ctx.beginPath(); ctx.arc(e[0][0], e[0][1], 6, 0, Math.PI * 2); ctx.stroke();
            ctx.fillStyle = "rgba(" + e[1] + ",.25)"; ctx.beginPath(); ctx.arc(e[0][0], e[0][1], 11, 0, Math.PI * 2); ctx.fill();
          });
        }
      }
      ctx.globalCompositeOperation = "source-over";
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
    function clampP(p) { return Math.min(80 * DEG, Math.max(8 * DEG, p)); }

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

    var lastR = null;
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
      _project: function (x, y, level, dz) { return proj(P(x, y, level, dz), camDist(), fovF()); }
    };
  }
  GT.station3d = { create: create };
})(window.GT = window.GT || {});
