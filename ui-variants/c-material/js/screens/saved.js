// 保存：お気に入りの経路・よく使う場所。クラウドに保存するのはこれと設定だけ（決定 #4）。
(function (GT) {
  "use strict";
  var t = GT.t, ic = GT.icon, esc = GT.u.esc, u = GT.u;
  GT.screens.saved = {
    title: function () { return t("saved.title"); },
    render: function () {
      var routes = GT.store.favRoutes.list(), places = GT.store.favPlaces.list(), acct = GT.store.account.get();
      return '<h2 class="hero-h">' + t("saved.title") + "</h2>" +
        '<p class="note cloud">' + ic("info") + "<span>" + t("saved.cloudNote") + "</span></p>" +
        (acct ? "" : '<p class="tag block">' + ic("user") + t("saved.localOnly") + "</p>") +
        '<section class="sec"><h2 class="sec-h">' + ic("star") + t("saved.routes") + "</h2>" +
        (routes.length ? '<ul class="list">' + routes.map(function (r) {
          return '<li class="row-wrap"><a class="row sl" href="#/detail?' + u.qs({ from: r.from, to: r.to, i: r.i }) + '"><span class="row-ic">' + ic(r.modes[0] || "other") + '</span><span class="row-main"><b>' + esc(GT.placeName(r.from)) + " " + GT.arrow + " " + esc(GT.placeName(r.to)) + '</b><span class="fine">' + u.hhmm(r.dep) + " → " + u.hhmm(r.arr) + " · " + (r.transfers ? t("results.transfers", { n: r.transfers }) : t("results.noTransfer")) + "</span></span></a>" +
            '<button type="button" class="iconbtn sl" data-rk="' + esc(r.key) + '" aria-label="' + t("saved.remove") + '">' + ic("trash") + "</button></li>";
        }).join("") + "</ul>" : '<p class="empty">' + ic("star") + t("saved.routesEmpty") + "</p>") + "</section>" +
        '<section class="sec"><h2 class="sec-h">' + ic("pin") + t("saved.places") + "</h2>" +
        (places.length ? '<ul class="list">' + places.map(function (p, i) {
          return '<li class="row-wrap"><span class="row"><span class="row-ic">' + ic("pin") + '</span><span class="row-main"><b>' + esc(p.label) + '</b><span class="fine">' + esc(GT.placeName(p.stop)) + "</span></span></span>" +
            '<button type="button" class="iconbtn sl" data-pi="' + i + '" aria-label="' + t("saved.remove") + "：" + esc(p.label) + '">' + ic("trash") + "</button></li>";
        }).join("") + "</ul>" : '<p class="empty">' + ic("pin") + t("saved.placesEmpty") + "</p>") +
        '<form class="panel addp" id="addp"><h3>' + ic("plus") + t("saved.addPlace") + "</h3>" +
        '<label class="field"><span class="fl">' + t("saved.placeLabel") + '</span><input id="pl" required maxlength="20"></label>' +
        '<label class="field"><span class="fl">' + t("saved.placeStop") + '</span><select id="ps">' + GT.places().map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + "</option>"; }).join("") + "</select></label>" +
        '<button class="tonal sl" type="submit">' + ic("plus") + "<span>" + t("saved.add") + "</span></button></form></section>";
    },
    mount: function (el) {
      el.querySelectorAll("[data-rk]").forEach(function (b) { b.onclick = function () { GT.store.favRoutes.remove(b.dataset.rk); GT.rerender(); }; });
      el.querySelectorAll("[data-pi]").forEach(function (b) { b.onclick = function () { GT.store.favPlaces.remove(Number(b.dataset.pi)); GT.rerender(); }; });
      el.querySelector("#addp").onsubmit = function (e) {
        e.preventDefault();
        var l = el.querySelector("#pl").value.trim();
        if (!l) { el.querySelector("#pl").focus(); return; }
        GT.store.favPlaces.add({ label: l, stop: el.querySelector("#ps").value });
        GT.rerender();
      };
    }
  };
})(window.GT = window.GT || {});
