// 動きの小道具：桁が流れる数字（見せ場 3）・経路の線（見せ場 2）・共有要素（見せ場 4）・セグメントのつまみ・フレーム速度の記録。
(function (GT) {
  "use strict";
  var mq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  var fx = GT.fx = {
    reduced: function () { return !!(mq && mq.matches); },
    stats: {} // 名前 → {frames, ms, fps, worstMs}（検査が読む。この環境での参考値）
  };

  /** rAF の間隔を測る。stop() で stats[name] に書く */
  fx.meter = function (name) {
    var last = 0, n = 0, worst = 0, t0 = 0;
    return {
      tick: function (now) { if (!t0) t0 = now; else { var d = now - last; if (d > worst) worst = d; } last = now; n++; },
      stop: function () { var ms = last - t0; if (n > 2) fx.stats[name] = { frames: n, ms: Math.round(ms), fps: Math.round((n - 1) / (ms / 1000)), worstMs: Math.round(worst * 10) / 10 }; }
    };
  };

  // ── 桁が流れる数字 ──
  function digitCol(d) {
    var s = "";
    for (var i = 0; i < 10; i++) s += "<span>" + i + "</span>";
    return '<span class="d" aria-hidden="true"><span style="transform:translateY(-' + (d * 1.2) + 'em)">' + s + "</span></span>";
  }
  /** el の中身を text にする。前の値（el.dataset.v）から桁ごとに縦に流す */
  fx.roll = function (el, text) {
    var prev = el.dataset.v || "";
    el.dataset.v = text;
    var same = prev.length === text.length && prev.replace(/\d/g, "0") === text.replace(/\d/g, "0");
    if (!same || fx.reduced()) {
      el.innerHTML = '<span class="sr-only">' + text + "</span>" + text.split("").map(function (c) {
        return /\d/.test(c) ? digitCol(+c) : '<span class="c" aria-hidden="true">' + c + "</span>";
      }).join("");
      return;
    }
    var cols = el.querySelectorAll(".d > span"), k = 0, changed = 0;
    el.querySelector(".sr-only").textContent = text;
    text.split("").forEach(function (c) {
      if (!/\d/.test(c)) return;
      var col = cols[k++];
      if (!col) return;
      var to = "translateY(-" + (+c * 1.2) + "em)";
      if (col.style.transform !== to) { col.style.setProperty("--dl", (changed++ * 22) + "ms"); col.style.transform = to; }
    });
  };
  fx.rollHtml = function (text) { return '<span class="roll" data-v="' + text + '"><span class="sr-only">' + text + "</span>" + text.split("").map(function (c) { return /\d/.test(c) ? digitCol(+c) : '<span class="c" aria-hidden="true">' + c + "</span>"; }).join("") + "</span>"; };

  // ── セグメントのつまみ（選んだ所へばね風の曲線で動く）──
  fx.seg = function (seg) {
    if (!seg) return;
    var items = seg.querySelectorAll(".seg-i");
    var th = seg.querySelector(".seg-thumb");
    if (!th) { th = document.createElement("span"); th.className = "seg-thumb"; th.setAttribute("aria-hidden", "true"); seg.insertBefore(th, seg.firstChild); }
    function place() {
      var idx = 0;
      items.forEach(function (it, i) { if (it.querySelector("input").checked) idx = i; });
      th.style.width = "calc((100% - 4px) / " + items.length + ")";
      th.style.transform = "translateX(" + (idx * 100) + "%)";
    }
    seg.addEventListener("change", place);
    place();
  };

  // ── 経路の線：区間の長さを所要時間に比例させ、左から伸ばす。駅の点は線が届いた瞬間に点灯 ──
  var LINE = { rail: "--line-rail", subway: "--line-subway", bus: "--line-bus", air: "--line-air", ferry: "--line-ferry", tram: "--line-rail", cable: "--line-rail" };
  function easeOut(t) { // cubic-bezier(.2,.8,.2,1) の近似（2 点の 3 次ベジェを数値で解く）
    var lo = 0, hi = 1, x, s;
    for (var i = 0; i < 18; i++) { s = (lo + hi) / 2; x = 3 * (1 - s) * (1 - s) * s * .2 + 3 * (1 - s) * s * s * .2 + s * s * s; if (x < t) lo = s; else hi = s; }
    s = (lo + hi) / 2; return 3 * (1 - s) * (1 - s) * s * .8 + 3 * (1 - s) * s * s * 1 + s * s * s;
  }
  fx.routeMap = function (host, j) {
    var W = Math.max(240, host.clientWidth || 300), H = 64, pad = 10, y = 22;
    var t0 = j.departure, span = Math.max(60, j.arrival - j.departure);
    var X = function (t) { return pad + (W - pad * 2) * ((t - t0) / span); };
    var cs = getComputedStyle(document.documentElement);
    var paths = '<path class="base-line" d="M' + pad + " " + y + "H" + (W - pad) + '"/>', nodes = [], labels = "";
    j.legs.forEach(function (l) {
      var a = X(l.departure != null ? l.departure : t0), b = X(l.arrival != null ? l.arrival : a);
      if (l.type === "walk") { if (b - a > 1) paths += '<path class="walk-line" d="M' + a.toFixed(1) + " " + y + "H" + b.toFixed(1) + '"/>'; return; }
      var c = cs.getPropertyValue(LINE[l.mode] || "--line-walk").trim();
      paths += '<path class="seg-line" stroke="' + c + '" d="M' + a.toFixed(1) + " " + y + "H" + b.toFixed(1) + '"/>';
      nodes.push({ x: a, c: c, t: l.departureIso }); nodes.push({ x: b, c: c, t: l.arrivalIso });
    });
    // 近すぎる点はまとめる（乗換）
    var merged = [];
    nodes.forEach(function (n) { var p = merged[merged.length - 1]; if (p && n.x - p.x < 14) { p.c2 = n.c; return; } merged.push(n); });
    var lastLabelX = -99;
    var nodeSvg = merged.map(function (n, i) {
      var end = i === 0 || i === merged.length - 1;
      var show = end || (n.x - lastLabelX > 46 && (W - pad) - n.x > 46);
      if (show) {
        lastLabelX = n.x;
        var anchor = i === 0 ? "start" : i === merged.length - 1 ? "end" : "middle";
        labels += '<text class="lbl' + (end ? " strong" : "") + '" x="' + (i === 0 ? n.x - 6 : i === merged.length - 1 ? n.x + 6 : n.x).toFixed(1) + '" y="' + (y + 30) + '" text-anchor="' + anchor + '">' + GT.u.hhmm(n.t) + "</text>";
      }
      return '<circle class="node' + (end ? " end" : "") + '" data-x="' + n.x.toFixed(1) + '" cx="' + n.x.toFixed(1) + '" cy="' + y + '" r="' + (end ? 6 : 5) + '" stroke="' + n.c + '" style="opacity:0"/>';
    }).join("");
    var id = "rc" + Math.random().toString(36).slice(2, 7);
    host.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + GT.t("b.routeLine") + '"><defs><clipPath id="' + id + '"><rect id="' + id + 'r" x="0" y="0" height="' + H + '" width="' + (fx.reduced() ? W : 0) + '"/></clipPath></defs>' +
      '<g clip-path="url(#' + id + ')">' + paths + "</g>" + nodeSvg + '<g class="labels" style="opacity:' + (fx.reduced() ? 1 : 0) + ';transition:opacity var(--dur-2) linear">' + labels + "</g></svg>";
    var rect = host.querySelector("#" + id + "r"), circles = host.querySelectorAll(".node"), lab = host.querySelector(".labels");
    if (fx.reduced()) { circles.forEach(function (c) { c.style.opacity = 1; }); return; }
    var DUR = 520, start = 0, m = fx.meter("routeLine");
    function frame(now) {
      if (!start) start = now;
      m.tick(now);
      var p = Math.min(1, (now - start) / DUR), w = W * easeOut(p);
      rect.setAttribute("width", w.toFixed(1));
      circles.forEach(function (c) {
        if (c.dataset.on) return;
        if (+c.dataset.x <= w + 2) { c.dataset.on = 1; c.style.opacity = ""; c.classList.add("lit"); c.animate([{ transform: "scale(.2)", opacity: 0 }, { transform: "scale(1.15)", opacity: 1, offset: .7 }, { transform: "scale(1)", opacity: 1 }], { duration: 320, easing: "ease-out", fill: "both" }); }
      });
      if (p < 1) requestAnimationFrame(frame); else { m.stop(); lab.style.opacity = 1; }
    }
    host._play = function () { requestAnimationFrame(frame); };
  };

  // ── 共有要素：src（画面上の要素）の見た目の複製を、dst の位置まで動かす ──
  fx.flip = function (srcRect, srcHtml, srcFont, dstEl, dstFinalRect) {
    if (fx.reduced() || !srcRect || !dstEl) return;
    var app = document.getElementById("app"), ar = app.getBoundingClientRect();
    var g = document.createElement("div");
    g.className = "ghost jt-ghost";
    g.innerHTML = srcHtml;
    g.style.cssText = "left:" + (srcRect.left - ar.left) + "px;top:" + (srcRect.top - ar.top) + "px;font:" + srcFont + ";display:flex;align-items:baseline;gap:6px";
    app.appendChild(g);
    var sc = dstFinalRect.height / srcRect.height;
    var dx = dstFinalRect.left - srcRect.left, dy = dstFinalRect.top - srcRect.top;
    dstEl.style.visibility = "hidden";
    var a = g.animate([{ transform: "translate(0,0) scale(1)" }, { transform: "translate(" + dx + "px," + dy + "px) scale(" + sc + ")" }], { duration: 380, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" });
    a.onfinish = function () { dstEl.style.visibility = ""; g.remove(); };
  };
})(window.GT = window.GT || {});
