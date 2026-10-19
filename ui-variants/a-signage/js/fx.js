// 案内標識の見せ場の部品：見出しの和欧 2 段・路線の色・桁が流れる数字・動きを減らす設定。
(function (GT) {
  "use strict";
  var mq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  GT.fx = {
    reduced: function () { return !!(mq && mq.matches); },
    /** 見出し：和文＋小さな欧文（日本語表示のときだけ欧文を添える。読み上げは和文だけ） */
    hd: function (key, iconName) {
      var en = GT.i18n.lang === "ja" ? GT.i18n.tIn("en", key) : "";
      return (iconName ? GT.icon(iconName) : "") + "<span>" + GT.t(key) + "</span>" + (en ? '<span class="en" aria-hidden="true">' + GT.u.esc(en) + "</span>" : "");
    },
    /** 路線の識別色（手段ごと）。色は線と札だけに使う */
    lc: function (mode) { return ' style="--lc:var(--l-' + ({ rail: "rail", subway: "subway", tram: "rail", bus: "bus", air: "air", ferry: "ferry", walk: "walk" }[mode] || "other") + ')"'; },
    /** 数字の文字列を、桁ごとのリールにして書く（最初は静止） */
    digits: function (s) {
      return String(s).split("").map(function (c) { return /\d/.test(c) ? '<span class="dg"><span class="reel"><span>' + c + "</span></span></span>" : "<span>" + GT.u.esc(c) + "</span>"; }).join("");
    },
    /**
     * 発車標のように桁を流して差し替える。桁数が同じなら、各桁が旧→新へ数を順に送る（0→9 の向き）。
     * 桁数が違えば、短いフェードで差し替える。delay は列ごとのずらし（ms）。
     */
    roll: function (el, next, delay) {
      next = String(next);
      var prev = el.getAttribute("data-v");
      el.setAttribute("data-v", next);
      el.setAttribute("aria-label", next);
      if (prev === next) return;
      if (prev == null || prev.length !== next.length || GT.fx.reduced() || !el.animate) {
        el.innerHTML = GT.fx.digits(next);
        if (prev != null) { el.classList.remove("fade-swap"); void el.offsetWidth; el.classList.add("fade-swap"); }
        return;
      }
      var html = "", plan = [];
      for (var i = 0; i < next.length; i++) {
        var a = prev[i], b = next[i];
        if (/\d/.test(a) && /\d/.test(b) && a !== b) {
          var seq = [], d = +a;
          seq.push(d);
          while (d !== +b) { d = (d + 1) % 10; seq.push(d); }
          html += '<span class="dg"><span class="reel">' + seq.map(function (x) { return "<span>" + x + "</span>"; }).join("") + "</span></span>";
          plan.push(seq.length - 1);
        } else {
          html += /\d/.test(b) ? '<span class="dg"><span class="reel"><span>' + b + "</span></span></span>" : "<span>" + GT.u.esc(b) + "</span>";
          plan.push(0);
        }
      }
      el.innerHTML = html;
      var reels = el.querySelectorAll(".reel"), k = 0;
      for (var j = 0; j < next.length; j++) {
        if (!/\d/.test(next[j])) continue;
        var steps = plan[j], r = reels[k++];
        if (!steps) continue;
        // 送る数が多いほど少し長く。行き過ぎて戻る曲線で、パタッと止まる感じを出す。
        var dur = 300 + steps * 26;
        r.animate([{ transform: "translateY(0)" }, { transform: "translateY(" + (-steps * 1.15).toFixed(3) + "em)" }],
          { duration: dur, delay: (delay || 0) + j * 28, easing: "cubic-bezier(.3,1.25,.5,1)", fill: "both" });
      }
    }
  };
})(window.GT = window.GT || {});
