// ホーム／検索：出発地・目的地（案内板のように罫線で区切った 2 行）・時刻・よく使う場所・最近の検索（端末内）。
(function (GT) {
  "use strict";
  var t = GT.t, ic = GT.icon, esc = GT.u.esc, hd = function (k, i) { return GT.fx.hd(k, i); };
  GT.screens = GT.screens || {};
  var form = { from: "", to: "", mode: "now", time: "" };
  var places = [];
  GT.data.places().then(function (p) { places = p; });
  function nameOf(id) { var p = places.find(function (x) { return x.id === id; }); return p ? p.name : id; }
  function idOf(name) { var p = places.find(function (x) { return x.name === name.trim() || x.id === name.trim(); }); return p ? p.id : null; }
  GT.placeName = nameOf;
  GT.places = function () { return places; };

  GT.screens.home = {
    title: function () { return t("home.title"); },
    render: function () {
      var recent = GT.store.history.list();
      var favs = GT.store.favPlaces.list();
      var modes = ["now", "depart", "arrive"];
      return '<form id="sf" class="board search" novalidate>' +
        '<div class="od"><div class="od-rows">' +
        '<label class="field">' + ic("origin", "od-ic") + '<span class="fl">' + t("home.from") + '</span><input id="fFrom" name="from" list="plist" autocomplete="off" placeholder="' + t("home.fromPh") + '" value="' + esc(form.from ? nameOf(form.from) : "") + '"></label>' +
        '<label class="field">' + ic("pin", "od-ic") + '<span class="fl">' + t("home.to") + '</span><input id="fTo" name="to" list="plist" autocomplete="off" placeholder="' + t("home.toPh") + '" value="' + esc(form.to ? nameOf(form.to) : "") + '"></label>' +
        '</div><button type="button" class="iconbtn swap" id="swap" aria-label="' + t("home.swap") + '">' + ic("swap") + "</button></div>" +
        '<datalist id="plist">' + places.map(function (p) { return '<option value="' + esc(p.name) + '"></option>'; }).join("") + "</datalist>" +
        '<fieldset class="when"><legend>' + hd("home.when", "clock") + '</legend><div class="seg" role="radiogroup">' +
        modes.map(function (m) { return '<label class="seg-i"><input type="radio" name="mode" value="' + m + '"' + (form.mode === m ? " checked" : "") + "><span>" + t("home." + m) + "</span></label>"; }).join("") +
        '</div><label class="field dt"' + (form.mode === "now" ? " hidden" : "") + '><span class="fl">' + t("home.datetime") + '</span><input type="datetime-local" id="fTime" value="' + esc(form.time || "2026-10-20T08:00") + '"></label></fieldset>' +
        '<p class="err" id="ferr" role="alert"></p>' +
        "</form>" +
        '<section class="sec"><h2>' + hd("home.favPlaces", "star") + "</h2>" +
        (favs.length ? '<div class="chips">' + favs.map(function (f) { return '<button type="button" class="chip" data-place="' + esc(f.stop) + '">' + ic("pin") + "<span>" + esc(f.label) + "</span></button>"; }).join("") + "</div>" : '<p class="empty">' + t("home.favEmpty") + "</p>") +
        "</section>" +
        '<section class="sec recent"><h2>' + hd("home.recent", "history") + "</h2>" +
        (recent.length ? '<ul class="list">' + recent.map(function (r) { return '<li><a class="row" href="#/results?' + GT.u.qs({ from: r.from, to: r.to }) + '"><span class="row-main">' + esc(nameOf(r.from)) + ' <span class="arrow" aria-hidden="true">→</span><span class="sr-only">→</span> ' + esc(nameOf(r.to)) + "</span>" + ic("chev", "muted") + "</a></li>"; }).join("") + "</ul>" : '<p class="empty">' + t("home.recentEmpty") + "</p>") +
        '<p class="note">' + ic("info") + "<span>" + t("home.recentNote") + " · " + t("home.sampleNote") + "</span></p>" +
        "</section>" +
        '<div class="dock"><button class="primary" form="sf" type="submit">' + ic("search") + "<span>" + t("home.submit") + "</span></button></div>";
    },
    mount: function (el) {
      var f = el.querySelector("#sf");
      var fFrom = el.querySelector("#fFrom"), fTo = el.querySelector("#fTo"), err = el.querySelector("#ferr");
      el.querySelector("#swap").onclick = function () { var a = fFrom.value; fFrom.value = fTo.value; fTo.value = a; };
      f.addEventListener("change", function (e) {
        if (e.target.name === "mode") { form.mode = e.target.value; el.querySelector(".dt").hidden = form.mode === "now"; }
      });
      el.querySelectorAll("[data-place]").forEach(function (b) {
        b.onclick = function () { var n = nameOf(b.dataset.place); if (!fFrom.value) fFrom.value = n; else fTo.value = n; };
      });
      f.onsubmit = function (e) {
        e.preventDefault();
        var from = idOf(fFrom.value), to = idOf(fTo.value);
        if (!from || !to) { err.textContent = t("home.needBoth"); (from ? fTo : fFrom).focus(); return; }
        if (from === to) { err.textContent = t("home.sameStop"); return; }
        form.from = from; form.to = to; form.time = (el.querySelector("#fTime") || {}).value || "";
        GT.store.history.add({ from: from, to: to });
        location.hash = "#/results?" + GT.u.qs({ from: from, to: to, mode: form.mode, time: form.mode === "now" ? "" : form.time });
      };
    }
  };
})(window.GT = window.GT || {});
