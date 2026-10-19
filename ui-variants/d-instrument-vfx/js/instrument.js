// 案 D「計器」の部品：姿勢計（検索中に静かに揺れ、結果で水平に定まる）・機械式カウンター・経路のリボン・起動の演出。
// 動きは CSS の transform / opacity だけ（合成で済む）。動きを減らす設定では、すべて静止した最終状態で出す。
(function (GT) {
  "use strict";
  var mq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  var I = GT.inst = {};
  I.reduced = function () { return !!(mq && mq.matches); };

  /* ---------- 姿勢計 ---------- */
  I.gyro = function () {
    var ticks = [-60, -30, -20, -10, 10, 20, 30, 60].map(function (a) {
      var r = a * Math.PI / 180, l = Math.abs(a) % 30 === 0 ? 5 : 3;
      var x1 = 36 + Math.sin(r) * 33, y1 = 36 - Math.cos(r) * 33, x2 = 36 + Math.sin(r) * (33 - l), y2 = 36 - Math.cos(r) * (33 - l);
      return '<line class="g-tick" x1="' + x1.toFixed(2) + '" y1="' + y1.toFixed(2) + '" x2="' + x2.toFixed(2) + '" y2="' + y2.toFixed(2) + '"/>';
    }).join("");
    return '<svg class="gyro spin" viewBox="0 0 72 72" aria-hidden="true" focusable="false">' +
      '<defs><clipPath id="gclip"><circle cx="36" cy="36" r="27"/></clipPath></defs>' +
      '<circle class="g-bezel" cx="36" cy="36" r="35"/>' + ticks +
      '<path class="g-ptr" d="M36 3.5l2.6 4.5h-5.2z"/>' +
      '<g clip-path="url(#gclip)"><g class="g-roll"><g class="g-card">' +
      '<rect class="g-sky" x="-10" y="-10" width="92" height="46"/><rect class="g-gnd" x="-10" y="36" width="92" height="46"/>' +
      '<line class="g-hz" x1="-10" y1="36" x2="82" y2="36"/>' +
      '<line class="g-pitch" x1="29" y1="28" x2="43" y2="28"/><line class="g-pitch" x1="31" y1="20" x2="41" y2="20"/>' +
      '<line class="g-pitch" x1="29" y1="44" x2="43" y2="44"/><line class="g-pitch" x1="31" y1="52" x2="41" y2="52"/>' +
      "</g></g></g>" +
      '<circle class="g-bezel" cx="36" cy="36" r="27"/>' +
      '<path class="g-wing" d="M20 37h9l3 3 4-4 4 4 3-3h9"/>' +
      "</svg>";
  };
  /** 揺れている姿勢計を、今の傾きと速度から水平へ定める（弱減衰のばね＝針が定まる前の小さな揺れ） */
  I.settleGyro = function (svg) {
    if (!svg) return;
    var card = svg.querySelector(".g-card"), roll = svg.querySelector(".g-roll");
    if (I.reduced()) { svg.classList.remove("spin"); return; }
    var ang = 0, ty = 0;
    try {
      var m1 = new DOMMatrix(getComputedStyle(roll).transform), m2 = new DOMMatrix(getComputedStyle(card).transform);
      ang = Math.atan2(m1.b, m1.a) * 180 / Math.PI; ty = m2.f;
    } catch (e) {}
    svg.classList.remove("spin");
    var M = GT.M;
    // CSS の往復の向きから、今の角速度を推定して引き継ぐ（いきなり止まらない）
    var vr = -ang * 2.2, vy = -ty * 2.2;
    M.spring({ from: ang, to: 0, velocity: vr, spring: { k: 150, zeta: 0.42 }, restDelta: 0.02, onUpdate: function (x) { roll.style.transform = "rotate(" + x.toFixed(2) + "deg)"; } });
    // 針が震えながら収束：定まる直前に微細な回転の震え
    M.after(420, function () { M.tremor(svg, { amp: 1.1, freq: 12, decay: 0.12, dir: "r", dur: 520 }); });
    M.spring({ from: ty, to: 0, velocity: vy, spring: { k: 170, zeta: 0.55 }, restDelta: 0.02, onUpdate: function (x) { card.style.transform = "translateY(" + x.toFixed(2) + "px)"; } });
  };

  /* ---------- 機械式カウンター ---------- */
  /** parts: [[文字列, 単位?], ...]。数字は桁ごとの帯、単位は小さな文字 */
  I.odo = function (parts, label) {
    var k = 0, html = "";
    parts.forEach(function (p) {
      String(p[0]).split("").forEach(function (ch) {
        if (/\d/.test(ch)) {
          var col = "";
          for (var i = 0; i <= 9; i++) col += "<span>" + i + "</span>";
          html += '<span class="odo-d"><span class="odo-s" data-d="' + ch + '" style="--k:' + (k++) + '">' + col + "</span></span>";
        } else html += "<span>" + ch + "</span>";
      });
      if (p[1]) html += '<span class="odo-u">' + p[1] + "</span>";
    });
    return '<span aria-hidden="true" style="display:contents">' + html + '</span><span class="sr-only">' + label + "</span>";
  };
  /** 桁ごとの帯を、慣性のあるばねで回す。桁は 60ms ずつずらし、上の桁ほど重く（ゆっくり定まる） */
  I.rollOdo = function (root, instant) {
    var cols = root.querySelectorAll(".odo-s");
    if (I.reduced() || instant) { cols.forEach(function (c) { c.style.setProperty("--d", c.dataset.d); }); return; }
    var n = cols.length;
    cols.forEach(function (c, i) {
      var d = Number(c.dataset.d), from = c.__pos != null ? c.__pos : 0;
      c.style.setProperty("--d", 0);
      var mass = 1 + (n - 1 - i) * 0.08;
      GT.M.after(i * 60, function () {
        GT.M.spring({ from: from, to: d, velocity: (d - from) * 1.5, spring: { k: 170, zeta: 0.74, mass: mass }, restDelta: 0.002,
          onUpdate: function (x) { c.__pos = x; c.style.transform = "translate3d(0," + (-x).toFixed(4) + "em,0)"; },
          onRest: function () { c.style.transform = ""; c.style.setProperty("--d", d); if (i === n - 1) { GT.M.haptic("tick"); var ro = c.closest(".readout-v"); if (ro) GT.M.tremor(ro, { amp: 0.8, freq: 16, decay: 0.06, dir: "y", dur: 260 }); } } });
      });
    });
  };
  /** 所要時間（秒）→ カウンター用の部品 */
  I.durParts = function (sec) {
    var m = Math.round(sec / 60);
    if (m < 60) return [[m, GT.t("inst.min")]];
    return [[Math.floor(m / 60), GT.t("inst.h")], [("0" + (m % 60)).slice(-2), GT.t("inst.min")]];
  };
  /** 一覧用の静的な所要時間（数字は等幅、単位は小さく） */
  I.durHtml = function (sec) {
    return I.durParts(sec).map(function (p) { return p[0] + '<span class="u">' + p[1] + "</span>"; }).join("");
  };

  /* ---------- 経路のリボン ---------- */
  I.ribbon = function (j, big) {
    var legs = j.legs, html = "", acc = 0, DRAW = 760;
    var ds = legs.map(function (l) { return Math.max(1, l.type === "walk" ? (l.duration || 60) : l.arrival - l.departure); });
    var total = ds.reduce(function (a, b) { return a + b; }, 0);
    legs.forEach(function (l, i) {
      var d = ds[i];
      var cls = l.type === "walk" ? "rib-walk" : (l.mode === "air" ? "rib-air" : "rib-transit");
      var at = Math.round(acc / total * DRAW), seg = Math.max(60, Math.round(d / total * DRAW));
      acc += d;
      var ic = big && l.type === "transit" ? '<span class="rib-ic">' + GT.icon(l.mode) + "</span>" : "";
      html += '<span class="rib-s ' + cls + '" data-at="' + at + '" style="flex-grow:' + Math.max(1, d) + ";--at:" + at + "ms;--seg:" + seg + 'ms"><i class="rib-n"></i>' + ic + "</span>";
    });
    html += '<span class="rib-end" data-at="' + DRAW + '"><i class="rib-n"></i></span>';
    var label = GT.t("inst.ribbon", { n: legs.filter(function (l) { return l.type === "transit"; }).length });
    var out = '<div class="rib' + (big ? " rib-big" : "") + '" role="img" aria-label="' + label + '">' + html + "</div>";
    if (big) {
      var tick = Math.min(100, 600 / total * 100);
      out += '<div class="scale" style="--tick:' + tick.toFixed(3) + '%" aria-hidden="true"><span class="a">' + GT.u.hhmm(j.departureIso) + '</span><span class="b">' + GT.u.hhmm(j.arrivalIso) + "</span></div>";
    }
    return out;
  };
  /** 線を左から伸ばし、乗り換えの節を順に点灯する。描き終えたら光の脈が 1 回だけ走り、到着の節で小さな粒 */
  I.drawRibbon = function (root, opts) {
    opts = opts || {};
    var rib = root.querySelector(".rib-big");
    if (!rib) return;
    var nodes = rib.querySelectorAll(".rib-s, .rib-end");
    if (I.reduced()) { nodes.forEach(function (n) { n.classList.add("lit"); }); return; }
    if (!opts.noDraw) rib.classList.add("draw");
    var k = opts.noDraw ? 0.5 : 1, endAt = 0;
    nodes.forEach(function (n) {
      var at = (Number(n.dataset.at) || 0) * k + (opts.delay || 0);
      endAt = Math.max(endAt, at);
      GT.M.after(at, function () { I.lamp(n.querySelector(".rib-n")); n.classList.add("lit"); });
    });
    GT.M.after(endAt + 60, function () { if (rib.isConnected) I.pulse(rib); });
  };
  /** 節の点灯：一瞬だけ膨らみ、ばねで定まる */
  I.lamp = function (el) {
    if (!el || I.reduced()) return;
    var mv = GT.M.el(el);
    mv.set({ s: 1.6 });
    mv.to({ s: 1 }, { k: 420, zeta: 0.5 });
  };
  /** 光の脈：細い光がリボンを 1 回だけ走る（transform と opacity だけ） */
  I.pulse = function (rib) {
    var M = GT.M;
    if (I.reduced() || M.q.get() === 0) return;
    var w = rib.clientWidth, p = document.createElement("i");
    p.className = "rib-pulse"; p.setAttribute("aria-hidden", "true");
    rib.appendChild(p);
    p.style.willChange = "transform, opacity";
    M.tween({ dur: 720, ease: "inOutSine", onUpdate: function (e, raw) {
      p.style.transform = "translate3d(" + (e * (w - 48)).toFixed(1) + "px,0,0)";
      p.style.opacity = Math.min(1, raw * 6, (1 - raw) * 5).toFixed(3);
    }, onDone: function () {
      p.remove();
      var end = rib.querySelector(".rib-end .rib-n");
      if (end) { I.sparks(end); I.lamp(end); }
    } });
  };
  /** 到着の小さな光の粒：数は品質の段で 10・5・0。直径 72px の Canvas の中だけ。0.5 秒で消える */
  I.sparks = function (anchor) {
    var M = GT.M, n = M.q.particles();
    if (!n || I.reduced()) return;
    var S = 40, dpr = Math.min(2, window.devicePixelRatio || 1);
    var cv = document.createElement("canvas");
    cv.className = "sparks"; cv.width = S * dpr; cv.height = S * dpr; cv.setAttribute("aria-hidden", "true");
    anchor.parentNode.appendChild(cv);
    var ctx = cv.getContext("2d"); ctx.scale(dpr, dpr);
    var col = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#5fd6c3";
    var ps = [];
    for (var i = 0; i < n; i++) {
      var a = -Math.PI / 2 + (i / n - 0.5) * Math.PI * 1.7 + (Math.random() - 0.5) * 0.3, sp = 22 + Math.random() * 16;
      ps.push({ x: S / 2, y: S / 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 0.8 + Math.random() * 0.9 });
    }
    var life = 0, LIFE = 0.52;
    M.add({ tick: function (dt) {
      life += dt;
      var k = 1 - life / LIFE;
      ctx.clearRect(0, 0, S, S);
      ctx.fillStyle = col;
      ps.forEach(function (p) {
        p.vx *= Math.pow(0.04, dt); p.vy = p.vy * Math.pow(0.04, dt) + 30 * dt;   // 強い空気抵抗＋わずかな重力
        p.x += p.vx * dt; p.y += p.vy * dt;
        ctx.globalAlpha = Math.max(0, k * k);
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.6 + k * 0.6), 0, 6.283); ctx.fill();
      });
      return life < LIFE;
    }, done: function () { cv.remove(); } });
  };

  /* ---------- 起動の演出（1 回だけ・1 秒以内） ----------
     0〜560ms：傾いた水平線が、弱減衰のばねで水平に定まる（針の揺れ）。目盛りが内側から順に点灯。
     560〜880ms：水平線が上部の境界線へ移り（共有要素）、画面の中身が段差をつけて入る。
     View Transitions API があれば使い、なければ同じ動きを自前の FLIP で。 */
  I.splash = function () {
    var seen = false;
    try { seen = sessionStorage.getItem("gyrotraffic.splash") === "1"; sessionStorage.setItem("gyrotraffic.splash", "1"); } catch (e) {}
    if (seen || I.reduced()) return;
    var M = GT.M;
    var el = document.createElement("div");
    el.className = "splash";
    el.setAttribute("aria-hidden", "true");
    var ticks = [-30, -20, -10, 0, 10, 20, 30].map(function (a) {
      var r = a * Math.PI / 180, l = a % 30 === 0 ? 7 : 4;
      return '<line class="s-tick" style="--i:' + Math.abs(a / 10) + '" x1="' + (100 + Math.sin(r) * 50).toFixed(2) + '" y1="' + (60 - Math.cos(r) * 50).toFixed(2) + '" x2="' + (100 + Math.sin(r) * (50 - l)).toFixed(2) + '" y2="' + (60 - Math.cos(r) * (50 - l)).toFixed(2) + '"/>';
    }).join("");
    el.innerHTML = '<div class="splash-in"><div class="s-dial"><svg viewBox="0 0 200 120"><circle class="s-ring" cx="100" cy="60" r="50"/>' + ticks +
      '</svg><i class="s-hz"></i></div><span class="splash-w">GyrotraffIC</span></div>';
    document.getElementById("app").appendChild(el);
    var hz = el.querySelector(".s-hz"), word = el.querySelector(".splash-w"), ring = el.querySelector(".s-ring");
    var tks = el.querySelectorAll(".s-tick");
    var mh = M.el(hz), mw = M.el(word), mr = M.el(ring);
    mh.set({ r: -24, sx: 0.15 });
    mh.to({ r: 0 }, { k: 160, zeta: 0.5 });
    mh.to({ sx: 1 }, { k: 220, zeta: 0.9 });
    mr.set({ o: 0 }); mr.to({ o: 1 }, { k: 200, zeta: 1 });
    mw.set({ o: 0, y: 6 }); M.after(140, function () { mw.to({ o: 1, y: 0 }, "gentle"); });
    tks.forEach(function (tk) { tk.style.opacity = 0; M.after(60 + Number(tk.style.getPropertyValue("--i")) * 70, function () { M.el(tk).set({ o: 0 }); M.el(tk).to({ o: 1 }, { k: 400, zeta: 1 }); }); });
    // 画面の中身は、水平線の受け渡しに合わせて段差をつけて入る
    var view = document.getElementById("view");
    var items = Array.prototype.slice.call(view.children[0] && view.children[0].id === "sf" ? [view.querySelector(".od"), view.querySelector(".when"), view.querySelector(".note")].concat(Array.prototype.slice.call(view.querySelectorAll(".sec, .dock"))) : view.children).filter(Boolean);
    items.forEach(function (it) { M.el(it).set({ o: 0, y: 14 }); });
    M.after(440, function () {
      var line = document.querySelector(".top-line");
      var first = hz.getBoundingClientRect();
      function after() {
        M.stagger(items, 32, function (it, i, instant) { var m = M.el(it); if (instant) m.set({ o: 1, y: 0 }); else m.to({ o: 1, y: 0 }, "page").then(function () { m.clear(); }); });
      }
      if (document.startViewTransition && !M.noVT && line) {
        // View Transitions：同じばねを CSS の linear() に写して使う
        document.documentElement.style.setProperty("--vt-ease", M.springEasing("page", 380));
        hz.style.viewTransitionName = "gt-hz";
        var vt = document.startViewTransition(function () {
          hz.style.viewTransitionName = ""; line.style.viewTransitionName = "gt-hz"; line.classList.add("hand");
          if (el.parentNode) el.parentNode.removeChild(el);
        });
        vt.ready.then(after, after);
        vt.finished.then(function () { line.style.viewTransitionName = ""; fadeLine(line); }, function () { fadeLine(line); });
      } else {
        // 自前の FLIP：上部の線を、水平線の位置と幅から今の場所へ
        var mo = M.el(el);
        mo.to({ o: 0 }, { k: 520, zeta: 1 }).then(function () { if (el.parentNode) el.parentNode.removeChild(el); });
        mh.to({ o: 0 }, { k: 600, zeta: 1 });
        if (line) { line.classList.add("hand"); M.flipFrom(line, first, { spring: "page" }).then(function () { fadeLine(line); }); }
        after();
      }
    });
    function fadeLine(line) { M.after(40, function () { M.el(line).to({ o: 0 }, { k: 260, zeta: 1 }).then(function () { line.classList.remove("hand"); M.el(line).clear(); }); }); }
    // 万一の保険：1.2 秒で必ず消す
    M.after(1200, function () { if (el.parentNode) el.parentNode.removeChild(el); items.forEach(function (it) { if (it.style.opacity === "0") M.el(it).clear(); }); });
  };

  /* ---------- 時計（分の境目で 1 回だけ更新） ---------- */
  I.clock = function () {
    var el = document.getElementById("clock");
    if (!el) return;
    var d = new Date();
    el.textContent = ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
    clearTimeout(I._ct);
    I._ct = setTimeout(I.clock, 60000 - d.getSeconds() * 1000 - d.getMilliseconds() + 20);
  };
})(window.GT = window.GT || {});
