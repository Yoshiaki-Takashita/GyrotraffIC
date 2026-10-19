// 極細のスクロールの棒（つまみだけ）。ふだんは見えず、スクロールした時と指を近づけた時だけ出る。
// 見た目は幅 3px（掴むと 5px）だが、当たり判定は左右に広い透明の帯（28px）と上下 10px の余白で取る。ドラッグでスクロールできる。
// 端末の標準のスクロールの棒は CSS で消す（キーボード・読み上げ・ホイール・指のスクロールは標準のまま動く）。
(function (GT) {
  "use strict";
  var HIT = 28, PADY = 10, MINVIS = 28, HIDE_MS = 900;
  var sb = null, th = null, view = null, hideT = 0, drag = null;

  function geom() {
    var ch = view.clientHeight, sh = view.scrollHeight;
    if (sh <= ch + 1) return null;
    var track = ch - 8;   // 上下 4px ずつあける
    var vis = Math.max(MINVIS, track * ch / sh);
    var y = 4 + (track - vis) * (view.scrollTop / (sh - ch));
    return { ch: ch, sh: sh, track: track, vis: vis, y: y };
  }
  function place() {
    if (!sb) return;
    sb.style.top = view.offsetTop + "px";
    sb.style.height = view.clientHeight + "px";
    var g = geom();
    sb.hidden = !g;
    if (!g) return;
    th.style.height = (g.vis + PADY * 2) + "px";
    th.style.transform = "translate3d(0," + (g.y - PADY) + "px,0)";
  }
  function show() {
    if (!sb || sb.hidden) return;
    sb.classList.add("on");
    clearTimeout(hideT);
    if (!drag) hideT = setTimeout(function () { if (!drag) sb.classList.remove("on"); }, HIDE_MS);
  }

  function attach(scrollEl) {
    view = scrollEl;
    var app = view.parentNode;
    sb = document.createElement("div");
    sb.className = "sb"; sb.setAttribute("aria-hidden", "true");
    sb.style.setProperty("--sb-hit", HIT + "px");
    th = document.createElement("div");
    th.className = "sb-th";
    sb.appendChild(th);
    app.appendChild(sb);
    view.addEventListener("scroll", function () { place(); show(); }, { passive: true });
    window.addEventListener("resize", place);
    if (window.ResizeObserver) { var ro = new ResizeObserver(place); ro.observe(view); }
    if (window.MutationObserver) new MutationObserver(function () { place(); }).observe(view, { childList: true, subtree: true });
    // 指・マウスが右の端に近づいたら出す（見えないまま掴めないことを避ける）
    app.addEventListener("pointermove", function (e) {
      if (e.pointerType !== "mouse") return;
      var r = view.getBoundingClientRect();
      if (e.clientX > r.right - HIT && e.clientY > r.top && e.clientY < r.bottom) show();
    });
    th.addEventListener("pointerdown", function (e) {
      if (e.button > 0) return;
      e.preventDefault(); e.stopPropagation();
      var g = geom(); if (!g) return;
      drag = { id: e.pointerId, y0: e.clientY, s0: view.scrollTop, k: (g.sh - g.ch) / Math.max(1, g.track - g.vis) };
      try { th.setPointerCapture(e.pointerId); } catch (_) {}
      sb.classList.add("on", "drag");
      clearTimeout(hideT);
    });
    th.addEventListener("pointermove", function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      view.scrollTop = drag.s0 + (e.clientY - drag.y0) * drag.k;
    });
    function end(e) {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      drag = null;
      sb.classList.remove("drag");
      show();
    }
    th.addEventListener("pointerup", end);
    th.addEventListener("pointercancel", end);
    th.addEventListener("lostpointercapture", end);
    // 帯そのものは押せない（下の画面の右端の操作を邪魔しない）。押せるのは、出ている間のつまみだけ。
    place();
  }

  GT.scrollbar = {
    attach: attach,
    refresh: function () { if (sb) { place(); } },
    _geom: function () { return view ? geom() : null; },
    HIT: HIT
  };
  function start() { var v = document.getElementById("view"); if (v && !sb) attach(v); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})(window.GT = window.GT || {});
