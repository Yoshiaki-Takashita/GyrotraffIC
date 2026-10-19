// 経路の詳細（結果の上に出るシートの中身）：経路の線（見せ場 2）・区間ごとのタイムライン・乗り場と確からしさ・空港の余裕時間・保存・Google マップへのリンク。
(function (GT) {
  "use strict";
  var t = GT.t, ic = GT.icon, esc = GT.u.esc, u = GT.u;
  // コアの既定値（src/modes.ts の DEFAULT_MODE_PROFILES.boardSlack・秒）。API 版ではコアから受け取る予定。
  var BOARD_SLACK = { air: 1800, ferry: 600 };
  var CONF = { confirmed: "confConfirmed", inferred: "confInferred", unknown: "confUnknown" };
  function conf(c) {
    c = CONF[c] ? c : "unknown";
    return '<span class="conf conf-' + c + '" title="' + t("conf." + c + "Long") + '">' + ic(CONF[c]) + '<span aria-hidden="true">' + t("conf." + c) + '</span><span class="sr-only">' + t("conf." + c + "Long") + "</span></span>";
  }
  function access(stopId) {
    var a = GT.data.stopAccess(stopId);
    if (!a) return '<div class="acc">' + conf("unknown") + "<span>" + t("detail.noAccess") + "</span></div>";
    var rows = [];
    if (a.platform) rows.push(["detail.platform", a.platform]);
    if (a.entrance) rows.push(["detail.entrance", a.entrance]);
    if (a.heading) rows.push(["detail.heading", a.heading]);
    if (a.terminalNote) rows.push(["detail.airTitle", a.terminalNote]);
    return '<div class="acc">' + conf(a.confidence) + "<dl>" +
      (rows.length ? rows.map(function (r) { return "<div><dt>" + t(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd></div>"; }).join("") : "<div><dd>" + t("detail.noAccess") + "</dd></div>") +
      (a.source ? "<div><dt>" + t("detail.source") + "</dt><dd>" + esc(a.source) + "</dd></div>" : "") + "</dl></div>";
  }
  function legHtml(l) {
    if (l.type === "walk") {
      var mins = Math.max(1, Math.round(l.duration / 60));
      return '<li class="walkrow">' + ic(l.source === "change" ? "clock" : "walk") + "<span>" + (l.source === "change" ? t("detail.change", { n: mins }) : t("detail.walk", { n: mins })) + "</span>" +
        (l.source === "geo" ? '<span class="tag">' + ic("confInferred") + t("conf.inferred") + "：" + t("detail.walkGeo") + "</span>" : "") + "</li>";
    }
    var slack = BOARD_SLACK[l.mode];
    return '<li class="leg ' + l.mode + '">' +
      '<span class="lic ico ' + l.mode + '">' + ic(l.mode, "", t("mode." + l.mode)) + "</span>" +
      (slack ? '<div class="callout">' + ic("info") + "<div><b>" + t("detail.airTitle") + "</b>" + t(l.mode === "air" ? "detail.airBody" : "detail.ferryBody", { n: slack / 60 }) + "</div></div>" : "") +
      '<div class="st"><b>' + esc(l.from.name) + "</b><time>" + u.hhmm(l.departureIso) + '</time><span class="lbl">' + t("detail.board") + "</span></div>" +
      access(l.from.stopId) +
      '<div class="lmid"><span class="rn">' + esc(l.routeName || l.routeId) + "</span>" +
      '<span class="cap">' + (l.headsign ? t("detail.bound", { h: esc(l.headsign) }) + " · " : "") + u.dur(l.arrival - l.departure) + (l.intermediateStops ? " · " + t("detail.stops", { n: l.intermediateStops }) : "") + "</span></div>" +
      '<div class="st"><b>' + esc(l.to.name) + "</b><time>" + u.hhmm(l.arrivalIso) + '</time><span class="lbl">' + t("detail.alight") + "</span></div>" +
      access(l.to.stopId) + '<span class="dot-end" aria-hidden="true"></span>' +
      "</li>";
  }
  function coord(id) { var p = GT.places().find(function (x) { return x.id === id; }); return p ? p.lat + "," + p.lon : GT.placeName(id); }

  GT.screens.detail = {
    fill: function (p) {
      var head = document.getElementById("sheetHead"), body = document.getElementById("sheetBody");
      document.getElementById("shTitle").textContent = t("detail.title");
      GT.data.route({ from: p.from, to: p.to }).then(function (res) {
        var j = res.journeys[Number(p.i) || 0];
        if (!j) { head.innerHTML = ""; body.innerHTML = '<div class="emptybox">' + ic("info") + "<b>" + t("results.empty") + "</b></div>"; return; }
        var key = u.journeyKey(res.id, j), f = u.fare(j.fare);
        var saved = GT.store.favRoutes.has(key);
        head.innerHTML = '<div class="sh-time" id="shTime"><time>' + u.hhmm(j.departureIso) + '</time><span class="dash" aria-hidden="true">–</span><span class="sr-only">→</span><time>' + u.hhmm(j.arrivalIso) + "</time></div>" +
          '<div class="sh-meta"><span><b>' + u.dur(j.arrival - j.departure) + "</b></span><span>" + ic("swap") + (j.transfers ? t("results.transfers", { n: j.transfers }) : t("results.noTransfer")) + "</span>" +
          '<span class="fare ' + (j.fare ? "" : "unknown") + '">' + ic(j.fare ? "yen" : "confUnknown") + esc(f.text) + "</span></div>" +
          (f.partial ? '<p class="sh-note">' + t("fare.partial") + (j.fare.note ? "（" + esc(j.fare.note) + "）" : "") + "</p>" : "") +
          '<div class="rmap" id="rmap"></div>';
        body.innerHTML =
          '<h3 class="sr-only">' + t("b.legsSec") + '</h3><ol class="tl">' + j.legs.map(legHtml).join("") + "</ol>" +
          '<div class="legend" role="group" aria-label="' + t("detail.legend") + '"><span>' + t("detail.legend") + "</span>" + conf("confirmed") + conf("inferred") + conf("unknown") + "</div>" +
          '<div class="sheet-actions btnrow">' +
          '<button type="button" class="btn tinted" id="saveBtn" aria-pressed="' + saved + '">' + ic(saved ? "starFill" : "star") + "<span>" + t(saved ? "detail.saved" : "detail.save") + "</span></button>" +
          '<a class="btn gray" target="_blank" rel="noopener noreferrer" href="' + esc(u.gmapsUrl(coord(p.from), coord(p.to))) + '" aria-describedby="gmn">' + ic("external") + "<span>" + t("detail.gmaps") + "</span></a>" +
          '</div><p class="fine center mt2" id="gmn">' + t("detail.gmapsNote") + "</p>";
        body.querySelector("#saveBtn").onclick = function () {
          var on = GT.store.favRoutes.toggle({ key: key, from: p.from, to: p.to, i: Number(p.i) || 0, dep: j.departureIso, arr: j.arrivalIso, transfers: j.transfers, modes: j.legs.filter(function (l) { return l.type === "transit"; }).map(function (l) { return l.mode; }) });
          this.setAttribute("aria-pressed", on);
          this.innerHTML = ic(on ? "starFill" : "star") + "<span>" + t(on ? "detail.saved" : "detail.save") + "</span>";
          GT.toast(t(on ? "detail.saved" : "detail.save"));
        };
        var map = head.querySelector("#rmap");
        GT.fx.routeMap(map, j);
        // シートが動き出してから線を描く（シートが中間の高さに近づく頃に伸び終わる）
        if (map._play) setTimeout(map._play, 140);
        // 共有要素：押した行の時刻 → シートの見出し
        var fl = GT._flip; GT._flip = null;
        if (fl) {
          var tEl = head.querySelector("#shTime");
          var sheetY = GT.sheet.y(), finalY = GT.sheet.finalTop();
          var first = tEl.querySelector("time").getBoundingClientRect();
          var dst = { left: first.left, top: first.top - sheetY + finalY, height: first.height };
          var srcFirst = { left: fl.rect.left, top: fl.rect.top, height: fl.rect.height };
          GT.fx.flip(srcFirst, fl.html, fl.font, tEl, dst);
        }
      });
    }
  };
})(window.GT = window.GT || {});
