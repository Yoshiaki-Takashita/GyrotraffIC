// 見せ場③：数字の切り替え（桁が流れる）。読み上げは aria-label の全文、見た目の桁は aria-hidden。
(function (GT) {
  "use strict";
  var reduce = function () { return window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches; };
  function col(d, k) {
    var s = ""; for (var i = 0; i < 10; i++) s += "<span>" + i + "</span>";
    return '<span class="rd" style="--k:' + k + '"><span data-d="' + d + '">' + s + "</span></span>";
  }
  /** 文字列 text を el に描く。from があれば、その数字から流す */
  GT.roll = function (el, text, from) {
    el.setAttribute("aria-label", text);
    var k = 0, html = "";
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      html += /\d/.test(c) ? col(c, k++) : '<span aria-hidden="true">' + GT.u.esc(c) + "</span>";
    }
    el.innerHTML = '<span class="roll" aria-hidden="true">' + html + "</span>";
    var cols = el.querySelectorAll(".rd > span");
    var fromDigits = (from || "").replace(/\D/g, "");
    var off = fromDigits.length - cols.length;
    cols.forEach(function (c, i) {
      var start = from != null && !reduce() ? (fromDigits[i + off] || "0") : c.dataset.d;
      c.style.transition = "none";
      c.style.transform = "translateY(" + (-start * 32) + "px)";
    });
    if (from == null || reduce()) return;
    el.offsetHeight; // 描画を確定してから動かす
    cols.forEach(function (c) { c.style.transition = ""; c.style.transform = "translateY(" + (-c.dataset.d * 32) + "px)"; });
  };
})(window.GT = window.GT || {});
