// 結果一覧（発車標）：最速・乗換最少・安値。並び順を変えると、行は動かさずに各行の桁が流れて差し替わる。
(function (GT) {
  "use strict";
  var t = GT.t, ic = GT.icon, esc = GT.u.esc, u = GT.u, fx = GT.fx;
  var tab = "fastest";
  var TAB_IC = { fastest: "clock", fewest: "swap", cheapest: "yen" };
  function sortFor(js, k) {
    var a = js.map(function (j, i) { return { j: j, i: i }; });
    var byArr = function (x, y) { return x.j.arrival - y.j.arrival || x.j.transfers - y.j.transfers; };
    if (k === "fastest") a.sort(function (x, y) { return (x.j.arrival - x.j.departure) - (y.j.arrival - y.j.departure) || byArr(x, y); });
    if (k === "fewest") a.sort(function (x, y) { return x.j.transfers - y.j.transfers || byArr(x, y); });
    if (k === "cheapest") a.sort(function (x, y) {
      var fx_ = x.j.fare ? x.j.fare.amount : Infinity, fy = y.j.fare ? y.j.fare.amount : Infinity;
      return fx_ - fy || byArr(x, y);
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
      parts.push('<span class="ms ms-' + m + '"' + fx.lc(m) + '><span class="ms-sw" aria-hidden="true"></span>' + ic(m, "", t("mode." + m)) +
        (l.type === "transit" ? "<span>" + esc(shortRoute(l.routeName)) + "</span>" : '<span class="num">' + Math.max(1, Math.round(l.duration / 60)) + "</span><small>" + (GT.i18n.lang === "ja" ? "分" : "min") + "</small>") + "</span>");
    });
    return parts.join('<span class="ms-sep" aria-hidden="true"></span>');
  }
  /** 所要時間：数字は大きく、単位は小さく（「45 分」「4 時間 20 分」） */
  function durParts(sec) {
    var m = Math.round(sec / 60);
    return m >= 60 ? { h: String(Math.floor(m / 60)), m: ("0" + (m % 60)).slice(-2) } : { h: null, m: String(m) };
  }
  function setDur(el, sec, delay) {
    var d = durParts(sec), sig = (d.h ? "h" : "m");
    if (el.getAttribute("data-shape") !== sig) {
      el.setAttribute("data-shape", sig);
      var ja = GT.i18n.lang === "ja";
      el.innerHTML = (d.h ? '<span class="num dh"></span><small>' + (ja ? "時間" : "h") + "</small>" : "") + '<span class="num dm"></span><small>' + (ja ? "分" : "min") + "</small>";
    }
    if (d.h) fx.roll(el.querySelector(".dh"), d.h, delay);
    fx.roll(el.querySelector(".dm"), d.m, delay + 40);
    el.setAttribute("aria-label", u.dur(sec));
  }
  function rowShell() {
    return '<a class="jr">' +
      '<div class="badge-slot"></div>' +
      '<div class="jr-l1"><div class="jr-time num"><time class="dep"></time><span class="arrow" aria-hidden="true">→</span><span class="sr-only">→</span><time class="to arr"></time></div><div class="jr-dur"></div></div>' +
      '<div class="jr-modes"></div><div class="jr-meta"></div></a>';
  }
  function fillRow(li, x, n, p, animate) {
    var j = x.j, f = u.fare(j.fare), a = li.querySelector(".jr"), delay = animate ? n * 70 : 0;
    a.href = "#/detail?" + u.qs({ from: p.from, to: p.to, i: x.i });
    var dep = a.querySelector(".dep"), arr = a.querySelector(".arr");
    if (!animate) { dep.removeAttribute("data-v"); arr.removeAttribute("data-v"); }
    fx.roll(dep, u.hhmm(j.departureIso), delay);
    fx.roll(arr, u.hhmm(j.arrivalIso), delay + 60);
    setDur(a.querySelector(".jr-dur"), j.arrival - j.departure, delay + 120);
    var swap = function (sel, html) {
      var el = a.querySelector(sel);
      if (el.innerHTML === html) return;
      el.innerHTML = html;
      if (animate && !fx.reduced()) { el.classList.remove("fade-swap"); void el.offsetWidth; el.classList.add("fade-swap"); }
    };
    swap(".badge-slot", n === 0 ? '<span class="badge">' + ic(TAB_IC[tab]) + t("results." + tab) + "</span>" : "");
    swap(".jr-modes", modeStrip(j));
    swap(".jr-meta", '<span class="meta">' + ic("swap") + (j.transfers ? t("results.transfers", { n: j.transfers }) : t("results.noTransfer")) + '</span><span class="meta ' + f.cls + '">' + ic(f.icon) + f.text + "</span>");
  }
  GT.screens.results = {
    title: function () { return t("results.title"); },
    render: function (p) {
      return '<div class="od-sum"><span>' + ic("origin") + esc(GT.placeName(p.from)) + '</span><span class="arrow" aria-hidden="true">→</span><span class="sr-only">→</span><span>' + ic("pin") + esc(GT.placeName(p.to)) + "</span></div>" +
        '<div class="tabs3" role="tablist" aria-label="' + t("results.tabs") + '">' +
        ["fastest", "fewest", "cheapest"].map(function (k) { var on = k === tab; return '<button type="button" role="tab" class="t3' + (on ? " on" : "") + '" aria-selected="' + on + '" data-k="' + k + '">' + ic(TAB_IC[k]) + "<span>" + t("results." + k) + "</span></button>"; }).join("") +
        '</div><div id="rl" role="tabpanel" aria-live="polite"></div>';
    },
    mount: function (el, p) {
      var rl = el.querySelector("#rl");
      GT.data.route({ from: p.from, to: p.to, mode: p.mode || "now", time: p.time }).then(function (res) {
        if (!res.journeys.length) { rl.innerHTML = '<div class="emptybox">' + ic("info") + "<p><b>" + t("results.empty") + "</b></p><p class=\"fine\">" + t("results.emptyHint") + "</p></div>"; return; }
        rl.innerHTML = '<p class="note" id="cheapNote"' + (tab === "cheapest" ? "" : " hidden") + ">" + ic("info") + "<span>" + t("results.cheapNote") + "</span></p>" +
          '<div class="board-head" aria-hidden="true"><span>' + t("results.colTime") + "</span><span>" + t("results.colDur") + "</span></div>" +
          '<ol class="cards">' + res.journeys.map(function () { return "<li>" + rowShell() + "</li>"; }).join("") + "</ol>" +
          '<p class="fine center">' + t("results.searchMs", { n: res.searchMs }) + " · " + t("home.sampleNote") + "</p>";
        var lis = rl.querySelectorAll(".cards > li");
        function draw(animate) {
          sortFor(res.journeys, tab).forEach(function (x, n) { fillRow(lis[n], x, n, p, animate); });
          rl.querySelector("#cheapNote").hidden = tab !== "cheapest";
        }
        draw(false);
        el.querySelectorAll(".t3").forEach(function (b) {
          b.onclick = function () {
            if (tab === b.dataset.k) return;
            tab = b.dataset.k;
            el.querySelectorAll(".t3").forEach(function (o) { var on = o === b; o.classList.toggle("on", on); o.setAttribute("aria-selected", on); });
            draw(true);
          };
        });
      });
    }
  };
})(window.GT = window.GT || {});
