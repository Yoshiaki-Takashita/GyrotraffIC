// 経路（ホーム）：出発地・目的地・時刻（今・出発・到着）・よく使う場所・最近の検索（端末内）。
(function (GT) {
  "use strict";
  var t = GT.t, ic = GT.icon, esc = GT.u.esc;
  var form = { from: "", to: "", mode: "now", time: "" };
  var places = [];
  GT.data.places().then(function (p) { places = p; });
  function nameOf(id) { var p = places.find(function (x) { return x.id === id; }); return p ? p.name : id; }
  function idOf(name) { var p = places.find(function (x) { return x.name === name.trim() || x.id === name.trim(); }); return p ? p.id : null; }
  GT.placeName = nameOf;
  GT.places = function () { return places; };
  GT.short = function (n) { return String(n || "").replace(/（架空）/g, ""); };

  GT.screens.home = {
    title: function () { return t("b.tabsHome"); },
    render: function () {
      var recent = GT.store.history.list();
      var favs = GT.store.favPlaces.list();
      return '<form id="sf" novalidate>' +
        '<section class="group"><h2 class="sr-only">' + t("b.searchSec") + "</h2>" +
        '<div class="g-body od">' +
        '<label class="cell from">' + ic("origin", "od-ic") + '<span class="od-f"><span class="lb">' + t("home.from") + '</span><input id="fFrom" name="from" list="plist" autocomplete="off" enterkeyhint="next" placeholder="' + t("home.fromPh") + '" value="' + esc(form.from ? nameOf(form.from) : "") + '"></span></label>' +
        '<label class="cell to">' + ic("pin", "od-ic") + '<span class="od-f"><span class="lb">' + t("home.to") + '</span><input id="fTo" name="to" list="plist" autocomplete="off" enterkeyhint="search" placeholder="' + t("home.toPh") + '" value="' + esc(form.to ? nameOf(form.to) : "") + '"></span></label>' +
        '<button type="button" class="swapbtn" id="swap" aria-label="' + t("home.swap") + '">' + ic("swap") + "</button>" +
        "</div>" +
        '<p class="err" id="ferr" role="alert"></p>' +
        '<datalist id="plist">' + places.map(function (p) { return '<option value="' + esc(p.name) + '"></option>'; }).join("") + "</datalist>" +
        "</section>" +
        '<section class="group"><h2 class="g-head" aria-hidden="true"><span>' + t("home.when") + '</span></h2><div class="g-body">' +
        '<fieldset class="seg-wrap"><legend class="sr-only">' + t("home.when") + '</legend><div class="seg" id="modeSeg">' +
        ["now", "depart", "arrive"].map(function (m) { return '<label class="seg-i"><input type="radio" name="mode" value="' + m + '"' + (form.mode === m ? " checked" : "") + "><span>" + t("home." + m) + "</span></label>"; }).join("") +
        "</div></fieldset>" +
        '<label class="cell dtcell"' + (form.mode === "now" ? " hidden" : "") + ' id="dtRow"><span class="cell-main">' + t("home.datetime") + '</span><input type="datetime-local" id="fTime" value="' + esc(form.time || "2026-10-20T08:00") + '"></label>' +
        "</div>" +
        '<p class="note">' + ic("info") + "<span>" + t("home.sampleNote") + "</span></p></section>" +
        '<div class="dock"><button class="btn filled" type="submit">' + ic("search") + "<span>" + t("home.submit") + "</span></button></div>" +
        "</form>" +
        '<section class="group"><h2 class="g-head"><span>' + t("home.favPlaces") + "</span></h2>" +
        (favs.length ? '<div class="g-body iconic">' + favs.map(function (f) { return '<button type="button" class="cell" data-place="' + esc(f.stop) + '"><span class="ico tint">' + ic("pin") + '</span><span class="cell-main"><b>' + esc(f.label) + '</b><span class="cap">' + esc(GT.short(nameOf(f.stop))) + "</span></span></button>"; }).join("") + "</div>"
          : '<div class="g-body"><p class="empty">' + t("home.favEmpty") + "</p></div>") +
        "</section>" +
        '<section class="group"><h2 class="g-head"><span>' + t("home.recent") + "</span></h2>" +
        (recent.length ? '<div class="g-body iconic">' + recent.map(function (r) { return '<a class="cell" href="#/results?' + GT.u.qs({ from: r.from, to: r.to }) + '"><span class="ico">' + ic("history") + '</span><span class="cell-main"><b>' + esc(GT.short(nameOf(r.from))) + ' <span aria-hidden="true">→</span><span class="sr-only">から</span> ' + esc(GT.short(nameOf(r.to))) + "</b></span>" + ic("chev", "chev") + "</a>"; }).join("") + "</div>"
          : '<div class="g-body"><p class="empty">' + t("home.recentEmpty") + "</p></div>") +
        '<p class="g-foot">' + t("home.recentNote") + "</p></section>";
    },
    mount: function (el) {
      var f = el.querySelector("#sf");
      var fFrom = el.querySelector("#fFrom"), fTo = el.querySelector("#fTo"), err = el.querySelector("#ferr");
      GT.fx.seg(el.querySelector("#modeSeg"));
      var sw = el.querySelector("#swap");
      sw.onclick = function () { var a = fFrom.value; fFrom.value = fTo.value; fTo.value = a; sw.classList.toggle("turn"); };
      f.addEventListener("change", function (e) {
        if (e.target.name === "mode") { form.mode = e.target.value; el.querySelector("#dtRow").hidden = form.mode === "now"; }
      });
      el.querySelectorAll("[data-place]").forEach(function (b) {
        b.onclick = function () { var n = nameOf(b.dataset.place); if (!fFrom.value) fFrom.value = n; else fTo.value = n; };
      });
      f.onsubmit = function (e) {
        e.preventDefault();
        var from = idOf(fFrom.value), to = idOf(fTo.value);
        if (!from || !to) { err.innerHTML = ic("info") + t("home.needBoth"); (from ? fTo : fFrom).focus(); return; }
        if (from === to) { err.innerHTML = ic("info") + t("home.sameStop"); return; }
        form.from = from; form.to = to; form.time = (el.querySelector("#fTime") || {}).value || "";
        GT.store.history.add({ from: from, to: to });
        location.hash = "#/results?" + GT.u.qs({ from: from, to: to, mode: form.mode, time: form.mode === "now" ? "" : form.time });
      };
    }
  };
})(window.GT = window.GT || {});
