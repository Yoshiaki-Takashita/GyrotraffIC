// 経路の詳細（シートの中身）：大きな時刻・所要時間、駅と区間を格子に並べた路線図、乗り場の位置と確からしさ、
// 飛行機の余裕時間、Google マップへのリンク、保存。シートが止まってから、線が始点から伸びて駅が順に点灯する。
(function (GT) {
  "use strict";
  var t = GT.t, ic = GT.icon, esc = GT.u.esc, u = GT.u, fx = GT.fx;
  // コアの既定値（src/modes.ts の DEFAULT_MODE_PROFILES.boardSlack・秒）。API 版ではコアから受け取る予定。
  var BOARD_SLACK = { air: 1800, ferry: 600 };
  var CONF = { confirmed: "confConfirmed", inferred: "confInferred", unknown: "confUnknown" };
  function conf(c) {
    c = CONF[c] ? c : "unknown";
    return '<span class="conf conf-' + c + '" title="' + t("conf." + c + "Long") + '">' + ic(CONF[c]) + '<span class="conf-t" aria-hidden="true">' + t("conf." + c) + '</span><span class="sr-only">' + t("conf." + c + "Long") + "</span></span>";
  }
  function access(stopId) {
    var a = GT.data.stopAccess(stopId);
    if (!a) return '<div class="acc">' + conf("unknown") + '<span class="acc-t">' + t("detail.noAccess") + "</span></div>";
    var rows = [];
    if (a.platform) rows.push(["detail.platform", a.platform]);
    if (a.entrance) rows.push(["detail.entrance", a.entrance]);
    if (a.heading) rows.push(["detail.heading", a.heading]);
    if (a.terminalNote) rows.push(["detail.airTitle", a.terminalNote]);
    return '<div class="acc">' + conf(a.confidence) + '<dl class="acc-t">' +
      (rows.length ? rows.map(function (r) { return "<div><dt>" + t(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd></div>"; }).join("") : "<div><dd>" + t("detail.noAccess") + "</dd></div>") +
      (a.source ? '<div class="src"><dt>' + t("detail.source") + "</dt><dd>" + esc(a.source) + "</dd></div>" : "") + "</dl></div>";
  }
  function station(time, lbl, name, stopId, end) {
    return '<div class="st"><time>' + (time || "") + '</time><span class="node' + (end ? " end" : "") + '"><i></i></span><div class="st-body">' +
      (lbl ? '<span class="st-lbl">' + lbl + "</span>" : "") + '<div class="st-name">' + esc(name) + "</div>" + (stopId ? access(stopId) : "") + "</div></div>";
  }
  /** 区間の並びを「駅・区間・駅…」に直す。乗換の歩きは区間（点線）として入れる。 */
  function diagram(j) {
    var out = [], legs = j.legs, prevTo = null;
    legs.forEach(function (l, i) {
      var first = i === 0, last = i === legs.length - 1;
      if (l.type === "walk") {
        var mins = Math.max(1, Math.round(l.duration / 60));
        out.push('<li class="tl tl-walk"><div class="lg"><span class="lg-dur">' + mins + "′</span>" + '<span class="track walk"' + fx.lc("walk") + '><b></b></span><div class="lg-body lg-walk">' + ic(l.source === "change" ? "clock" : "walk") + " <b>" +
          (l.source === "change" ? t("detail.change", { n: mins }) : t("detail.walk", { n: mins })) + "</b>" +
          (l.source === "geo" ? ' <span class="tag">' + t("conf.inferred") + "：" + t("detail.walkGeo") + "</span>" : "") +
          (l.source !== "change" ? '<span class="lg-sub">' + esc(l.from.name) + " → " + esc(l.to.name) + "</span>" : "") + "</div></div>" +
          (last ? station("", t("detail.alight"), l.to.name, null, true) : "") + "</li>");
        prevTo = l.to;
        return;
      }
      var slack = BOARD_SLACK[l.mode];
      var sameAsPrev = prevTo && prevTo.stopId === l.from.stopId;
      out.push('<li class="tl tl-transit tl-' + l.mode + '">' +
        (sameAsPrev ? "" : station(u.hhmm(l.departureIso), first ? t("detail.board") : t("detail.board"), l.from.name, l.from.stopId, first)) +
        '<div class="lg"><span class="lg-dur">' + Math.round((l.arrival - l.departure) / 60) + "′</span>" +
        '<span class="track"' + fx.lc(l.mode) + '><b></b></span><div class="lg-body">' +
        (slack ? '<div class="callout">' + ic("info") + "<div><b>" + t("detail.airTitle") + "</b><p>" + t(l.mode === "air" ? "detail.airBody" : "detail.ferryBody", { n: slack / 60 }) + "</p></div></div>" : "") +
        '<div class="route"' + fx.lc(l.mode) + '><span class="plate">' + ic(l.mode, "", t("mode." + l.mode)) + "</span><span>" + esc(l.routeName || l.routeId) + "</span></div>" +
        '<span class="lg-sub">' + (l.headsign ? t("detail.bound", { h: esc(l.headsign) }) + " · " : "") + u.dur(l.arrival - l.departure) + (l.intermediateStops ? " · " + t("detail.stops", { n: l.intermediateStops }) : "") + "</span>" +
        "</div></div>" +
        station(u.hhmm(l.arrivalIso), t("detail.alight"), l.to.name, l.to.stopId, last) +
        "</li>");
      prevTo = l.to;
    });
    return out.join("");
  }
  function coord(id) { var p = GT.places().find(function (x) { return x.id === id; }); return p ? p.lat + "," + p.lon : GT.placeName(id); }
  function durHtml(sec) {
    var m = Math.round(sec / 60), ja = GT.i18n.lang === "ja";
    return m >= 60 ? '<span class="num">' + Math.floor(m / 60) + "</span><small>" + (ja ? "時間" : "h") + '</small><span class="num">' + (m % 60) + "</span><small>" + (ja ? "分" : "min") + "</small>"
      : '<span class="num">' + m + "</span><small>" + (ja ? "分" : "min") + "</small>";
  }
  GT.screens = GT.screens || {};
  GT.screens.detail = {
    title: function () { return t("detail.title"); },
    render: function () { return '<div id="dv"></div>'; },
    /** @returns Promise（描き終わったら解決） */
    mount: function (el, p) {
      return GT.data.route({ from: p.from, to: p.to }).then(function (res) {
        var j = res.journeys[Number(p.i) || 0];
        var dv = el.querySelector("#dv");
        if (!j) { dv.innerHTML = '<div class="emptybox">' + ic("info") + "<p>" + t("results.empty") + "</p></div>"; return; }
        var key = u.journeyKey(res.id, j), f = u.fare(j.fare);
        var saved = GT.store.favRoutes.has(key);
        dv.innerHTML = '<div class="sum">' +
          '<div class="sum-time num"><time>' + u.hhmm(j.departureIso) + '</time><span class="arrow" aria-hidden="true">→</span><span class="sr-only">→</span><time>' + u.hhmm(j.arrivalIso) + "</time></div>" +
          '<div class="sum-l2"><span class="sum-dur" aria-label="' + u.dur(j.arrival - j.departure) + '">' + durHtml(j.arrival - j.departure) + "</span>" +
          '<div class="jr-meta"><span class="meta">' + ic("swap") + (j.transfers ? t("results.transfers", { n: j.transfers }) : t("results.noTransfer")) + '</span><span class="meta ' + f.cls + '">' + ic(f.icon) + f.text + "</span></div></div>" +
          (f.partial ? '<p class="fine">' + t("fare.partial") + (j.fare.note ? "（" + esc(j.fare.note) + "）" : "") + "</p>" : "") +
          "</div>" +
          '<div class="legend" aria-label="' + t("detail.legend") + '"><span class="fine">' + t("detail.legend") + "</span>" + conf("confirmed") + conf("inferred") + conf("unknown") + "</div>" +
          '<ol class="timeline">' + diagram(j) + "</ol>" +
          '<div class="dock two">' +
          '<button type="button" class="secondary" id="saveBtn" aria-pressed="' + saved + '">' + ic(saved ? "starFill" : "star") + "<span>" + t(saved ? "detail.saved" : "detail.save") + "</span></button>" +
          '<a class="secondary" target="_blank" rel="noopener noreferrer" href="' + esc(u.gmapsUrl(coord(p.from), coord(p.to))) + '" aria-describedby="gmn">' + ic("external") + "<span>" + t("detail.gmaps") + "</span></a>" +
          '<p class="fine" id="gmn">' + t("detail.gmapsNote") + "</p></div>";
        el.querySelector("#saveBtn").onclick = function () {
          var on = GT.store.favRoutes.toggle({ key: key, from: p.from, to: p.to, i: Number(p.i) || 0, dep: j.departureIso, arr: j.arrivalIso, transfers: j.transfers, modes: j.legs.filter(function (l) { return l.type === "transit"; }).map(function (l) { return l.mode; }) });
          this.setAttribute("aria-pressed", on);
          this.innerHTML = ic(on ? "starFill" : "star") + "<span>" + t(on ? "detail.saved" : "detail.save") + "</span>";
        };
      });
    },
    /** 見せ場：線が始点から終点へ伸び、着いた駅から順に点灯する。各区間 260ms、駅は線が届いた瞬間に。 */
    play: function (el) {
      var nodes = Array.prototype.slice.call(el.querySelectorAll(".node, .track"));
      if (fx.reduced() || !document.body.animate) {
        nodes.forEach(function (n) { n.classList.add(n.classList.contains("node") ? "lit" : "lit-track"); });
        return;
      }
      var at = 0, SEG = 260;
      nodes.forEach(function (n) {
        if (n.classList.contains("track")) {
          var b = n.querySelector("b");
          var a = b.animate([{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }], { duration: SEG, delay: at, easing: "cubic-bezier(.45,0,.55,1)", fill: "both" });
          a.onfinish = function () { n.classList.add("lit-track"); a.cancel(); };
          at += SEG;
        } else {
          setTimeout(function () {
            n.classList.add("lit", "pulse");
            setTimeout(function () { n.classList.remove("pulse"); }, 140);
          }, at);
          at += 40;
        }
      });
    }
  };
})(window.GT = window.GT || {});
