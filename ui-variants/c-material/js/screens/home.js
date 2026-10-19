// ホーム／検索：出発地・目的地・時刻の指定（セグメントボタン）・よく使う場所（チップ）・最近の検索（端末内）。主操作は拡張 FAB。
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
  GT.seg = function (name, opts, cur) {
    return '<div class="seg" role="radiogroup">' + opts.map(function (o) { return '<label class="seg-i sl"><input type="radio" name="' + name + '" value="' + o[0] + '"' + (cur === o[0] ? " checked" : "") + '><span><span class="ck">' + ic("check") + "</span>" + o[1] + "</span></label>"; }).join("") + "</div>";
  };
  var arrow = '<span class="arrow" aria-hidden="true">' + ic("arrowR") + '</span><span class="sr-only">→</span>';
  GT.arrow = arrow;

  GT.screens.home = {
    title: function () { return t("home.title"); },
    render: function () {
      var recent = GT.store.history.list();
      var favs = GT.store.favPlaces.list();
      return '<h2 class="hero-h">' + t("home.title") + "</h2>" +
        '<form id="sf" class="search" novalidate>' +
        '<div class="od"><div class="od-rows">' +
        '<label class="field">' + ic("origin", "od-ic") + '<span class="fl">' + t("home.from") + '</span><input id="fFrom" name="from" list="plist" autocomplete="off" placeholder="' + t("home.fromPh") + '" value="' + esc(form.from ? nameOf(form.from) : "") + '"></label>' +
        '<label class="field">' + ic("pin", "od-ic") + '<span class="fl">' + t("home.to") + '</span><input id="fTo" name="to" list="plist" autocomplete="off" placeholder="' + t("home.toPh") + '" value="' + esc(form.to ? nameOf(form.to) : "") + '"></label>' +
        '</div><button type="button" class="iconbtn swap sl" id="swap" aria-label="' + t("home.swap") + '">' + ic("swap") + "</button></div>" +
        '<datalist id="plist">' + places.map(function (p) { return '<option value="' + esc(p.name) + '"></option>'; }).join("") + "</datalist>" +
        '<fieldset class="when"><legend>' + ic("clock") + t("home.when") + "</legend>" +
        GT.seg("mode", ["now", "depart", "arrive"].map(function (m) { return [m, t("home." + m)]; }), form.mode) +
        '<label class="field dt"' + (form.mode === "now" ? " hidden" : "") + '><span class="fl">' + t("home.datetime") + '</span><input type="datetime-local" id="fTime" value="' + esc(form.time || "2026-10-20T08:00") + '"></label></fieldset>' +
        '<p class="err" id="ferr" role="alert"></p>' +
        "</form>" +
        '<p class="note">' + ic("info") + t("home.sampleNote") + "</p>" +
        '<section class="sec"><h2 class="sec-h">' + ic("star") + t("home.favPlaces") + "</h2>" +
        (favs.length ? '<div class="chips">' + favs.map(function (f) { return '<button type="button" class="chip sl" data-place="' + esc(f.stop) + '">' + ic("pin") + "<span>" + esc(f.label) + "</span></button>"; }).join("") + "</div>" : '<p class="empty">' + ic("info") + t("home.favEmpty") + "</p>") +
        "</section>" +
        '<section class="sec"><h2 class="sec-h">' + ic("history") + t("home.recent") + " <small>" + ic("info") + t("home.recentNote") + "</small></h2>" +
        (recent.length ? '<ul class="list">' + recent.map(function (r) { return '<li><a class="row sl" href="#/results?' + GT.u.qs({ from: r.from, to: r.to }) + '"><span class="row-ic plain">' + ic("history") + '</span><span class="row-main">' + esc(nameOf(r.from)) + " " + arrow + " " + esc(nameOf(r.to)) + "</span>" + ic("chev", "muted") + "</a></li>"; }).join("") + "</ul>" : '<p class="empty">' + ic("history") + t("home.recentEmpty") + "</p>") +
        "</section>" +
        '<div class="dock"><button class="primary sl" form="sf" type="submit">' + ic("search") + "<span>" + t("home.submit") + "</span></button></div>";
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
