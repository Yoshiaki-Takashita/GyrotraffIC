// 結果一覧：主のタブ（最速・乗換最少・安値）。先頭の案は主の容器の色。並び替えで所要時間の数字が流れる（見せ場③）。
(function (GT) {
  "use strict";
  var t = GT.t, ic = GT.icon, esc = GT.u.esc, u = GT.u;
  var tab = "fastest";
  var TIC = { fastest: "clock", fewest: "swap", cheapest: "yen" };
  function sortFor(js, k) {
    var a = js.map(function (j, i) { return { j: j, i: i }; });
    var byArr = function (x, y) { return x.j.arrival - y.j.arrival || x.j.transfers - y.j.transfers; };
    if (k === "fastest") a.sort(function (x, y) { return (x.j.arrival - x.j.departure) - (y.j.arrival - y.j.departure) || byArr(x, y); });
    if (k === "fewest") a.sort(function (x, y) { return x.j.transfers - y.j.transfers || byArr(x, y); });
    if (k === "cheapest") a.sort(function (x, y) {
      var fx = x.j.fare ? x.j.fare.amount : Infinity, fy = y.j.fare ? y.j.fare.amount : Infinity;
      return fx - fy || byArr(x, y);
    });
    return a;
  }
  function shortRoute(n) { return String(n || "").replace(/（架空）/g, ""); }
  GT.shortRoute = shortRoute;
  function modeStrip(j) {
    var parts = [];
    j.legs.forEach(function (l) {
      if (l.type === "walk" && l.source === "change") return;
      var m = u.modeOfLeg(l);
      parts.push('<span class="ms ms-' + m + '">' + ic(m, "", t("mode." + m)) + '<span class="ms-t">' + (l.type === "transit" ? esc(shortRoute(l.routeName)) : Math.max(1, Math.round(l.duration / 60))) + "</span></span>");
    });
    return parts.join('<span class="ms-sep" aria-hidden="true"></span>');
  }
  function moveInd(el, animate) {
    var on = el.querySelector(".t3.on"), ind = el.querySelector(".t3-ind");
    if (!on || !ind) return;
    if (!animate) ind.style.transition = "none";
    ind.style.left = (on.offsetLeft + on.offsetWidth * 0.2) + "px";
    ind.style.width = (on.offsetWidth * 0.6) + "px";
    if (!animate) { ind.offsetWidth; ind.style.transition = ""; }
  }
  GT.screens.results = {
    title: function () { return t("results.title"); },
    render: function (p) {
      return '<div class="od-sum"><span>' + ic("origin") + esc(GT.placeName(p.from)) + "</span>" + GT.arrow + "<span>" + ic("pin") + esc(GT.placeName(p.to)) + "</span></div>" +
        '<div class="tabs3" role="tablist" aria-label="' + t("results.tabs") + '">' +
        ["fastest", "fewest", "cheapest"].map(function (k) { var on = k === tab; return '<button type="button" role="tab" class="t3 sl' + (on ? " on" : "") + '" aria-selected="' + on + '" data-k="' + k + '">' + ic(TIC[k]) + "<span>" + t("results." + k) + "</span></button>"; }).join("") +
        '<span class="t3-ind" aria-hidden="true"></span></div><div id="rl" role="tabpanel" aria-live="polite"></div>';
    },
    mount: function (el, p) {
      var rl = el.querySelector("#rl");
      moveInd(el, false);
      return GT.data.route({ from: p.from, to: p.to, mode: p.mode || "now", time: p.time }).then(function (res) {
        function draw(prev) {
          if (!res.journeys.length) { rl.innerHTML = '<div class="emptybox">' + ic("info") + "<p><b>" + t("results.empty") + "</b></p><p>" + t("results.emptyHint") + "</p></div>"; return; }
          var list = sortFor(res.journeys, tab);
          rl.innerHTML = (tab === "cheapest" ? '<p class="note">' + ic("info") + t("results.cheapNote") + "</p><div style=\"height:12px\"></div>" : "") +
            '<ol class="cards">' + list.map(function (x, n) {
              var j = x.j, f = u.fare(j.fare);
              return '<li><a class="jr sl" data-i="' + x.i + '" href="#/detail?' + u.qs({ from: p.from, to: p.to, i: x.i }) + '">' +
                '<div class="jr-top"><span class="jr-dur" role="text"></span>' + (n === 0 ? '<span class="badge">' + ic(TIC[tab]) + t("results." + tab) + "</span>" : "") + "</div>" +
                '<div class="jr-time"><time>' + u.hhmm(j.departureIso) + "</time>" + GT.arrow + "<time>" + u.hhmm(j.arrivalIso) + "</time></div>" +
                '<div class="jr-modes">' + modeStrip(j) + "</div>" +
                '<div class="jr-meta"><span class="meta">' + ic("swap") + (j.transfers ? t("results.transfers", { n: j.transfers }) : t("results.noTransfer")) + '</span><span class="meta ' + f.cls + '">' + ic(f.icon) + f.text + "</span></div>" +
                "</a></li>";
            }).join("") + "</ol>" + '<p class="fine center">' + t("results.searchMs", { n: res.searchMs }) + " · " + t("home.sampleNote") + "</p>";
          var durs = [];
          rl.querySelectorAll(".jr").forEach(function (a, n) {
            var j = res.journeys[Number(a.dataset.i)];
            var txt = u.dur(j.arrival - j.departure);
            durs.push(txt);
            GT.roll(a.querySelector(".jr-dur"), txt, prev ? prev[n] : null);
            a.addEventListener("click", function () {
              // 共有要素：押した行が詳細のシートに、所要時間が詳細の大きな数字になる
              a.style.viewTransitionName = "jr-hero";
              a.querySelector(".jr-dur").style.viewTransitionName = "jr-dur";
            });
          });
          return durs;
        }
        var cur = draw(null);
        el.querySelectorAll(".t3").forEach(function (b) {
          b.onclick = function () {
            if (tab === b.dataset.k) return;
            tab = b.dataset.k;
            el.querySelectorAll(".t3").forEach(function (o) { var on = o === b; o.classList.toggle("on", on); o.setAttribute("aria-selected", on); });
            moveInd(el, true);
            cur = draw(cur);
          };
        });
      });
    }
  };
})(window.GT = window.GT || {});
