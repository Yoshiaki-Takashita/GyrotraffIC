// 書式と小道具。
(function (GT) {
  "use strict";
  var t = function (k, v) { return GT.t(k, v); };
  GT.u = {
    esc: function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); },
    hhmm: function (iso) { return iso ? iso.slice(11, 16) : "--:--"; },
    dur: function (sec) {
      var m = Math.round(sec / 60);
      return m >= 60 ? t("results.hm", { h: Math.floor(m / 60), m: m % 60 }) : t("results.min", { n: m });
    },
    /** 駅名から「（架空）」の印とホーム名を分けて返す */
    stopName: function (name) { return String(name || ""); },
    fare: function (f) {
      if (!f) return { text: t("fare.unknown"), cls: "fare-unknown", icon: "info" };
      var amt = (f.currency === "JPY" ? "¥" : f.currency + " ") + f.amount.toLocaleString("ja-JP");
      var partial = f.unknownLegs && f.unknownLegs.length > 0;
      return { text: (f.kind === "estimate" ? t("fare.estimate") + " " : "") + amt + (partial ? "＋" : ""), cls: f.kind === "estimate" ? "fare-est" : "fare-exact", icon: "yen", partial: partial };
    },
    modeOfLeg: function (l) { return l.type === "walk" ? "walk" : l.mode; },
    journeyKey: function (rid, j) { return rid + "@" + j.departureIso + ">" + j.arrivalIso + "#" + j.transfers; },
    qs: function (o) { return Object.keys(o).filter(function (k) { return o[k] != null && o[k] !== ""; }).map(function (k) { return k + "=" + encodeURIComponent(o[k]); }).join("&"); },
    parseQs: function (s) { var o = {}; (s || "").split("&").forEach(function (p) { if (!p) return; var i = p.indexOf("="); o[decodeURIComponent(p.slice(0, i))] = decodeURIComponent(p.slice(i + 1)); }); return o; },
    gmapsUrl: function (o, d) {
      // 公式の URL 形式（Maps URLs）。リンクアウトのみ。
      return "https://www.google.com/maps/dir/?api=1&origin=" + encodeURIComponent(o) + "&destination=" + encodeURIComponent(d) + "&travelmode=transit";
    }
  };
})(window.GT = window.GT || {});
