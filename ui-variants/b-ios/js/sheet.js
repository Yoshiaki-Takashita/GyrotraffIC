// 下から出る詳細のシート（見せ場 1）。止まる高さは 2 つ（中間・大）。つかんで動かし、離した速さを先読みして止まる位置を選ぶ。
// ばね：硬さ 420・減衰 38・質量 1（減衰比 約 0.93。ゆれは 1 回未満）。動きを減らす設定ではばねを使わず即座に置く。
(function (GT) {
  "use strict";
  var K = 420, C = 38, PROJ = 0.2;
  var layer, sheet, scrim, top, body;
  var y = 0, v = 0, target = 0, raf = 0, H = 0, detent = "closed", onDismiss = null, meter = null;

  function snaps() {
    H = layer.clientHeight;
    var st = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--safe-t")) || 0;
    return { large: Math.max(st, 0) + 12, medium: Math.round(H * 0.40), closed: H + 20 };
  }
  function paint() {
    sheet.style.transform = "translate3d(0," + y.toFixed(2) + "px,0)";
    var s = snaps(), o;
    if (y >= s.medium) o = 0.6 * Math.max(0, (s.closed - y) / (s.closed - s.medium));
    else o = 0.6 + 0.4 * Math.min(1, (s.medium - y) / (s.medium - s.large));
    scrim.style.opacity = o.toFixed(3);
    var lg = y < s.medium - 8;
    body.style.overflowY = lg ? "auto" : "hidden";
  }
  function step(now) {
    if (meter) meter.tick(now);
    var last = step.last || now; step.last = now;
    var dt = Math.min(0.032, (now - last) / 1000) || 1 / 60;
    // 半陰的オイラー法を 4 分割で（硬いばねでも安定）
    for (var i = 0; i < 4; i++) { var h = dt / 4; var a = -K * (y - target) - C * v; v += a * h; y += v * h; }
    paint();
    if (Math.abs(y - target) < 0.4 && Math.abs(v) < 8) {
      y = target; v = 0; paint(); raf = 0; step.last = 0;
      if (meter) { meter.stop(); meter = null; }
      if (detent === "closed") finishClose();
      return;
    }
    raf = requestAnimationFrame(step);
  }
  function animateTo(name, velocity) {
    var s = snaps();
    detent = name; target = s[name];
    if (velocity != null) v = velocity;
    if (GT.fx.reduced()) { y = target; v = 0; paint(); if (name === "closed") finishClose(); return; }
    if (!meter) meter = GT.fx.meter("sheet");
    if (!raf) { step.last = 0; raf = requestAnimationFrame(step); }
  }
  function finishClose() {
    layer.classList.remove("open");
    layer.setAttribute("aria-hidden", "true");
    document.getElementById("view").removeAttribute("aria-hidden");
    if (onDismiss) { var f = onDismiss; onDismiss = null; f(); }
  }

  // ── つかむ ──
  var drag = null;
  function down(e) {
    if (e.button > 0) return;
    if (e.target.closest("button, a, input, select")) return;
    var inBody = body.contains(e.target);
    if (inBody && (detent === "large" || body.scrollTop > 0)) return; // 大きい高さでは本文のスクロールを優先
    drag = { id: e.pointerId, y0: e.clientY, sy: y, moved: false, samples: [[e.timeStamp, e.clientY]] };
    if (raf) { cancelAnimationFrame(raf); raf = 0; if (meter) { meter.stop(); meter = null; } }
    v = 0;
  }
  function move(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dy = e.clientY - drag.y0;
    if (!drag.moved && Math.abs(dy) < 4) return;
    if (!drag.moved) { drag.moved = true; try { sheet.setPointerCapture(e.pointerId); } catch (x) {} }
    var s = snaps(), ny = drag.sy + dy;
    if (ny < s.large) ny = s.large - Math.pow(s.large - ny, 0.7); // 上端の先は手応え（ゴムのような抵抗）
    y = ny; paint();
    drag.samples.push([e.timeStamp, e.clientY]);
    if (drag.samples.length > 6) drag.samples.shift();
    e.preventDefault();
  }
  function up(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var d = drag; drag = null;
    if (!d.moved) return;
    var a = d.samples[0], b = d.samples[d.samples.length - 1];
    var vel = b[0] > a[0] ? (b[1] - a[1]) / ((b[0] - a[0]) / 1000) : 0;
    var s = snaps(), proj = y + vel * PROJ;
    var best = "medium", bd = Infinity;
    ["large", "medium", "closed"].forEach(function (k) { var dd = Math.abs(s[k] - proj); if (dd < bd) { bd = dd; best = k; } });
    if (best === "closed") GT.sheet.dismiss(vel); else animateTo(best, vel);
  }

  GT.sheet = {
    init: function () {
      layer = document.getElementById("sheetLayer"); sheet = document.getElementById("sheet");
      scrim = document.getElementById("scrim"); top = document.getElementById("sheetTop"); body = document.getElementById("sheetBody");
      sheet.addEventListener("pointerdown", down);
      window.addEventListener("pointermove", move, { passive: false });
      window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
      scrim.addEventListener("click", function () { GT.sheet.dismiss(); });
      document.getElementById("sheetClose").addEventListener("click", function () { GT.sheet.dismiss(); });
      document.addEventListener("keydown", function (e) { if (e.key === "Escape" && GT.sheet.isOpen()) GT.sheet.dismiss(); });
      window.addEventListener("resize", function () { if (detent !== "closed") { y = snaps()[detent]; paint(); } });
      y = snaps().closed; paint();
    },
    isOpen: function () { return detent !== "closed"; },
    detent: function () { return detent; },
    /** 中身を入れて開く。dismissCb は閉じ終わったとき（下に払った・×・背景）に呼ぶ */
    open: function (dismissCb) {
      onDismiss = dismissCb || null;
      var wasOpen = detent !== "closed";
      layer.classList.add("open");
      layer.setAttribute("aria-hidden", "false");
      document.getElementById("view").setAttribute("aria-hidden", "true");
      body.scrollTop = 0;
      if (!wasOpen) { y = snaps().closed; v = 0; paint(); }
      animateTo("medium", wasOpen ? null : -1400);
      setTimeout(function () { sheet.focus({ preventScroll: true }); }, 30);
    },
    expand: function () { animateTo("large"); },
    dismiss: function (vel) { if (detent === "closed") return; animateTo("closed", vel != null ? Math.max(vel, 600) : 0); },
    /** 閉じる（コールバックを呼ばない。別の画面に移るとき）*/
    closeSilently: function () { onDismiss = null; if (detent !== "closed") animateTo("closed", 0); },
    finalTop: function () { return snaps().medium; },
    y: function () { return y; }
  };
})(window.GT = window.GT || {});
