// 経路の詳細：上に要約（大きな所要時間）、下から出るシートに区間のタイムライン。
// 線が描かれ乗換の点が順に現れる（見せ場②）。乗り場の位置と確からしさ・飛行機の余裕時間・Google マップへのリンク・保存。
(function (GT) {
  "use strict";
  var t = GT.t, ic = GT.icon, esc = GT.u.esc, u = GT.u;
  // コアの既定値（src/modes.ts の DEFAULT_MODE_PROFILES.boardSlack・秒）。API 版ではコアから受け取る予定。
  var BOARD_SLACK = { air: 1800, ferry: 600 };
  var CONF = { confirmed: "confConfirmed", inferred: "confInferred", unknown: "confUnknown" };
  function conf(c) {
    c = CONF[c] ? c : "unknown";
    return '<span class="conf conf-' + c + '" title="' + t("conf." + c + "Long") + '">' + ic(CONF[c]) + '<span class="conf-t">' + t("conf." + c) + '</span><span class="sr-only">' + t("conf." + c + "Long") + "</span></span>";
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
  function legHtml(l, i) {
    var st = ' style="--i:' + i + '"';
    if (l.type === "walk") {
      var mins = Math.max(1, Math.round(l.duration / 60));
      return '<li class="tl tl-walk"' + st + '><span class="tl-ic">' + ic(l.source === "change" ? "clock" : "walk") + "</span>" +
        '<div class="tl-body"><p class="tl-walk-t">' + (l.source === "change" ? t("detail.change", { n: mins }) : t("detail.walk", { n: mins })) +
        (l.source === "geo" ? ' <span class="tag">' + ic("confInferred") + t("conf.inferred") + "：" + t("detail.walkGeo") + "</span>" : "") + "</p>" +
        (l.source !== "change" ? '<p class="fine">' + esc(l.from.name) + " → " + esc(l.to.name) + "</p>" : "") + "</div></li>";
    }
    var slack = BOARD_SLACK[l.mode];
    return '<li class="tl tl-transit tl-' + l.mode + '"' + st + ">" +
      '<span class="tl-ic">' + ic(l.mode, "", t("mode." + l.mode)) + "</span>" +
      '<div class="tl-body">' +
      (slack ? '<div class="callout">' + ic("info") + "<div><b>" + t("detail.airTitle") + "</b><p>" + t(l.mode === "air" ? "detail.airBody" : "detail.ferryBody", { n: slack / 60 }) + "</p></div></div>" : "") +
      '<div class="stop"><time>' + u.hhmm(l.departureIso) + '</time><div><span class="lbl">' + t("detail.board") + "</span><b>" + esc(l.from.name) + "</b></div></div>" +
      access(l.from.stopId) +
      '<div class="line"><span class="route">' + esc(l.routeName || l.routeId) + "</span>" + (l.headsign ? '<span class="fine">' + t("detail.bound", { h: esc(l.headsign) }) + "</span>" : "") +
      '<span class="fine">' + u.dur(l.arrival - l.departure) + (l.intermediateStops ? " · " + t("detail.stops", { n: l.intermediateStops }) : "") + "</span></div>" +
      '<div class="stop"><time>' + u.hhmm(l.arrivalIso) + '</time><div><span class="lbl">' + t("detail.alight") + "</span><b>" + esc(l.to.name) + "</b></div></div>" +
      access(l.to.stopId) +
      "</div></li>";
  }
  function coord(id) { var p = GT.places().find(function (x) { return x.id === id; }); return p ? p.lat + "," + p.lon : GT.placeName(id); }
  GT.screens.detail = {
    title: function () { return t("detail.title"); },
    render: function () { return '<div id="dv"></div>'; },
    mount: function (el, p) {
      return GT.data.route({ from: p.from, to: p.to }).then(function (res) {
        var j = res.journeys[Number(p.i) || 0];
        var dv = el.querySelector("#dv");
        if (!j) { dv.innerHTML = '<div class="emptybox">' + ic("info") + "<p>" + t("results.empty") + "</p></div>"; return; }
        var key = u.journeyKey(res.id, j), f = u.fare(j.fare);
        var saved = GT.store.favRoutes.has(key);
        var legs = j.legs;
        dv.innerHTML = '<div class="d-head">' +
          '<span class="d-dur" style="view-transition-name:jr-dur">' + u.dur(j.arrival - j.departure) + "</span>" +
          '<div class="d-time"><time>' + u.hhmm(j.departureIso) + "</time>" + GT.arrow + "<time>" + u.hhmm(j.arrivalIso) + "</time></div>" +
          '<div class="d-meta"><span class="meta">' + ic("swap") + (j.transfers ? t("results.transfers", { n: j.transfers }) : t("results.noTransfer")) + '</span><span class="meta ' + f.cls + '">' + ic(f.icon) + f.text + "</span></div>" +
          (f.partial ? '<p class="fine">' + t("fare.partial") + (j.fare.note ? "（" + esc(j.fare.note) + "）" : "") + "</p>" : "") +
          '<div class="actions">' +
          '<button type="button" class="tonal sl" id="saveBtn" aria-pressed="' + saved + '">' + ic(saved ? "starFill" : "star") + "<span>" + t(saved ? "detail.saved" : "detail.save") + "</span></button>" +
          '<a class="secondary sl" target="_blank" rel="noopener noreferrer" href="' + esc(u.gmapsUrl(coord(p.from), coord(p.to))) + '" aria-describedby="gmn">' + ic("external") + "<span>" + t("detail.gmaps") + "</span></a>" +
          '</div><p class="fine" id="gmn">' + t("detail.gmapsNote") + "</p>" +
          "</div>" +
          '<section class="sheet" style="view-transition-name:jr-hero" aria-label="' + t("detail.title") + '"><div class="handle" aria-hidden="true"></div>' +
          '<div class="legend" aria-label="' + t("detail.legend") + '"><span class="fine">' + t("detail.legend") + "</span>" + conf("confirmed") + conf("inferred") + conf("unknown") + "</div>" +
          '<ol class="timeline' + (GT.reduced() ? "" : " draw") + '">' + legs.map(legHtml).join("") +
          '<li class="tl tl-end" style="--i:' + legs.length + '"><span class="tl-ic">' + ic("flag", "", t("home.to")) + '</span><div class="tl-body"><p class="tl-walk-t">' + esc(GT.placeName(p.to)) + "</p></div></li>" +
          "</ol></section>";
        el.querySelector("#saveBtn").onclick = function () {
          var on = GT.store.favRoutes.toggle({ key: key, from: p.from, to: p.to, i: Number(p.i) || 0, dep: j.departureIso, arr: j.arrivalIso, transfers: j.transfers, modes: legs.filter(function (l) { return l.type === "transit"; }).map(function (l) { return l.mode; }) });
          this.setAttribute("aria-pressed", on);
          this.innerHTML = ic(on ? "starFill" : "star") + "<span>" + t(on ? "detail.saved" : "detail.save") + "</span>";
        };
      });
    }
  };
})(window.GT = window.GT || {});
