// 経路の詳細：区間ごとのタイムライン・乗り場の位置と確からしさ・飛行機の余裕時間・Google マップへのリンク・保存。
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
  function legHtml(l) {
    if (l.type === "walk") {
      var mins = Math.max(1, Math.round(l.duration / 60));
      return '<li class="tl tl-walk">' + '<span class="tl-ic">' + ic(l.source === "change" ? "clock" : "walk") + "</span>" +
        '<div class="tl-body"><p class="tl-walk-t">' + (l.source === "change" ? t("detail.change", { n: mins }) : t("detail.walk", { n: mins })) +
        (l.source === "geo" ? ' <span class="tag">' + t("conf.inferred") + "：" + t("detail.walkGeo") + "</span>" : "") + "</p>" +
        (l.source !== "change" ? '<p class="fine">' + esc(l.from.name) + " → " + esc(l.to.name) + "</p>" : "") + "</div></li>";
    }
    var slack = BOARD_SLACK[l.mode];
    return '<li class="tl tl-transit tl-' + l.mode + '">' +
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
    render: function () { return '<div class="grab" aria-hidden="true"><i></i></div><div id="dv"></div>'; },
    mount: function (el, p) {
      var dv = el.querySelector("#dv"), grab = el.querySelector(".grab");
      GT.data.route({ from: p.from, to: p.to }).then(function (res) {
        var j = res.journeys[Number(p.i) || 0];
        if (!j) { dv.innerHTML = '<div class="emptybox">' + ic("info") + "<p>" + t("results.empty") + "</p></div>"; return; }
        var key = u.journeyKey(res.id, j), f = u.fare(j.fare);
        var saved = GT.store.favRoutes.has(key);
        dv.innerHTML = '<div class="card sum">' +
          '<div class="jr-top"><span class="jr-dur">' + GT.inst.durHtml(j.arrival - j.departure) + "</span></div>" +
          '<div class="jr-time"><time>' + u.hhmm(j.departureIso) + '</time><span class="arrow" aria-hidden="true">→</span><span class="sr-only">→</span><time>' + u.hhmm(j.arrivalIso) + "</time></div>" +
          '<div class="jr-meta"><span class="meta">' + ic("swap") + (j.transfers ? t("results.transfers", { n: j.transfers }) : t("results.noTransfer")) + '</span><span class="meta ' + f.cls + '">' + ic(f.icon) + f.text + "</span></div>" +
          (f.partial ? '<p class="fine">' + t("fare.partial") + (j.fare.note ? "（" + esc(j.fare.note) + "）" : "") + "</p>" : "") +
          GT.inst.ribbon(j, true) +
          "</div>" +
          '<div class="legend" aria-label="' + t("detail.legend") + '"><span class="fine">' + t("detail.legend") + "</span>" + conf("confirmed") + conf("inferred") + conf("unknown") + "</div>" +
          '<ol class="timeline">' + j.legs.map(legHtml).join("") + "</ol>" +
          '<div class="dock two">' +
          '<button type="button" class="secondary" id="saveBtn" aria-pressed="' + saved + '">' + ic(saved ? "starFill" : "star") + "<span>" + t(saved ? "detail.saved" : "detail.save") + "</span></button>" +
          '<a class="secondary" target="_blank" rel="noopener noreferrer" href="' + esc(u.gmapsUrl(coord(p.from), coord(p.to))) + '" aria-describedby="gmn">' + ic("external") + "<span>" + t("detail.gmaps") + "</span></a>" +
          '</div><p class="fine center" id="gmn">' + t("detail.gmapsNote") + "</p>";
        var M = GT.M, rib = dv.querySelector(".rib-big");
        var sh = GT._shared && M.now() - GT._shared.at < 1200 && GT._shared.i === (Number(p.i) || 0) ? GT._shared : null;
        GT._shared = null;
        if (sh && !M.reduced()) {
          // 共有要素の移り：結果のリボンが、そのまま詳細のリボンへ変形して移る
          M.flipFrom(rib, sh.rect, { spring: { k: 260, zeta: 0.86 }, scaleY: false });
          GT.inst.drawRibbon(dv, { noDraw: true, delay: 160 });
        } else GT.inst.drawRibbon(dv);
        // そのほかは奥行きの順に段差：所要時間 → 時刻 → 区分 → 目盛り → 凡例 → 区間 → 操作
        var layers = [dv.querySelector(".jr-top"), dv.querySelector(".jr-time"), dv.querySelector(".jr-meta"), dv.querySelector(".scale"), dv.querySelector(".legend")]
          .concat(Array.prototype.slice.call(dv.querySelectorAll(".tl"))).concat([dv.querySelector(".dock")]).filter(Boolean);
        GT.vfx.enter(layers, { gap: sh ? 34 : 40, y: 10 });
        var sb = dv.querySelector("#saveBtn");
        sb.setAttribute("aria-describedby", "holdNote");
        sb.insertAdjacentHTML("afterend", '<span class="sr-only" id="holdNote">' + t(saved ? "vfx.holdOff" : "vfx.hold") + "</span>");
        GT.vfx.longPress(sb, {
          onConfirm: function () {
            var on = GT.store.favRoutes.toggle({ key: key, from: p.from, to: p.to, i: Number(p.i) || 0, dep: j.departureIso, arr: j.arrivalIso, transfers: j.transfers, modes: j.legs.filter(function (l) { return l.type === "transit"; }).map(function (l) { return l.mode; }) });
            sb.setAttribute("aria-pressed", on);
            var icon = sb.querySelector(".hold-host .ic");
            icon.innerHTML = GT.icon(on ? "starFill" : "star").replace(/^<svg[^>]*>|<\/svg>$/g, "");
            sb.querySelector(":scope > span:not(.hold-host)").textContent = t(on ? "detail.saved" : "detail.save");
            var hn = document.getElementById("holdNote"); if (hn) hn.textContent = t(on ? "vfx.holdOff" : "vfx.hold");
          },
          onTapHint: function () { GT.toast(t(sb.getAttribute("aria-pressed") === "true" ? "vfx.holdOff" : "vfx.hold")); }
        });
        // 下に払って閉じる（つまみと要約の部分から）
        GT.vfx.sheet(el, [grab, dv.querySelector(".sum")], function () {
          GT._navHint = "dismiss";
          if (history.length > 1 && GT._navCount > 1) history.back(); else location.hash = "#/results?" + u.qs({ from: p.from, to: p.to });
        });
        // 戻るとき：このリボンの場所を覚えておく（結果のリボンへ移る）
        var off = function () { window.removeEventListener("hashchange", off, true); if (rib.isConnected && GT._navHint !== "dismiss") GT._sharedBack = { rect: rib.getBoundingClientRect(), at: M.now(), i: Number(p.i) || 0 }; };
        window.addEventListener("hashchange", off, true);
      });
    }
  };
})(window.GT = window.GT || {});
