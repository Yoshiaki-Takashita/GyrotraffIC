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
  /** 揺れている姿勢計を、今の傾きから水平へ滑らかに定める */
  I.settleGyro = function (svg) {
    if (!svg) return;
    var parts = svg.querySelectorAll(".g-card, .g-roll");
    if (I.reduced()) { svg.classList.remove("spin"); return; }
    parts.forEach(function (g) { g.style.transform = getComputedStyle(g).transform; });
    svg.classList.remove("spin");
    void svg.getBoundingClientRect();
    svg.classList.add("settle");
    requestAnimationFrame(function () { parts.forEach(function (g) { g.style.transform = "none"; }); });
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
  I.rollOdo = function (root) {
    var cols = root.querySelectorAll(".odo-s");
    if (I.reduced()) { cols.forEach(function (c) { c.style.setProperty("--d", c.dataset.d); }); return; }
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        cols.forEach(function (c) { c.classList.add("roll"); c.style.setProperty("--d", c.dataset.d); });
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
  /** 線を左から伸ばし、乗り換えの節を順に点灯する */
  I.drawRibbon = function (root) {
    var rib = root.querySelector(".rib-big");
    if (!rib) return;
    var nodes = rib.querySelectorAll(".rib-s, .rib-end");
    if (I.reduced()) { nodes.forEach(function (n) { n.classList.add("lit"); }); return; }
    rib.classList.add("draw");
    nodes.forEach(function (n) { setTimeout(function () { n.classList.add("lit"); }, Number(n.dataset.at) || 0); });
  };

  /* ---------- 起動の演出（1 回だけ・1 秒以内） ---------- */
  I.splash = function () {
    var seen = false;
    try { seen = sessionStorage.getItem("gyrotraffic.splash") === "1"; sessionStorage.setItem("gyrotraffic.splash", "1"); } catch (e) {}
    if (seen || I.reduced()) return;
    var el = document.createElement("div");
    el.className = "splash";
    el.setAttribute("aria-hidden", "true");
    var ticks = [-30, -20, -10, 0, 10, 20, 30].map(function (a) {
      var r = a * Math.PI / 180, l = a % 30 === 0 ? 7 : 4;
      return '<line class="s-tick" x1="' + (100 + Math.sin(r) * 50).toFixed(2) + '" y1="' + (60 - Math.cos(r) * 50).toFixed(2) + '" x2="' + (100 + Math.sin(r) * (50 - l)).toFixed(2) + '" y2="' + (60 - Math.cos(r) * (50 - l)).toFixed(2) + '"/>';
    }).join("");
    el.innerHTML = '<div class="splash-in"><svg viewBox="0 0 200 120"><circle class="s-ring" cx="100" cy="60" r="50"/>' + ticks +
      '<g class="s-hzg"><line class="s-hz" x1="30" y1="60" x2="170" y2="60"/></g></svg><span class="splash-w">GyrotraffIC</span></div>';
    document.getElementById("app").appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 960);
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
