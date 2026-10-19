// 保存：お気に入りの経路・よく使う場所。クラウドに保存するのはこれと設定だけ（決定 #4）。
(function (GT) {
  "use strict";
  var t = GT.t, ic = GT.icon, esc = GT.u.esc, u = GT.u;
  GT.screens.saved = {
    title: function () { return t("saved.title"); },
    render: function () {
      var routes = GT.store.favRoutes.list(), places = GT.store.favPlaces.list(), acct = GT.store.account.get();
      return '<p class="note cloud">' + ic("info") + "<span>" + t("saved.cloudNote") + "</span></p>" +
        (acct ? "" : '<p class="tag block">' + t("saved.localOnly") + "</p>") +
        '<section class="sec"><h2>' + ic("star") + t("saved.routes") + "</h2>" +
        (routes.length ? '<ul class="list">' + routes.map(function (r) {
          return '<li class="row-wrap"><button type="button" class="iconbtn grip" aria-label="' + t("vfx.grip") + '">' + ic("grip") + '</button><a class="row" href="#/detail?' + u.qs({ from: r.from, to: r.to, i: r.i }) + '">' + '<span class="row-ic">' + ic(r.modes[0] || "other") + '</span><span class="row-main"><b>' + esc(GT.placeName(r.from)) + " → " + esc(GT.placeName(r.to)) + '</b><span class="fine">' + u.hhmm(r.dep) + " → " + u.hhmm(r.arr) + " · " + (r.transfers ? t("results.transfers", { n: r.transfers }) : t("results.noTransfer")) + "</span></span></a>" +
            '<button type="button" class="iconbtn" data-rk="' + esc(r.key) + '" aria-label="' + t("saved.remove") + '">' + ic("trash") + "</button></li>";
        }).join("") + "</ul>" : '<p class="empty">' + t("saved.routesEmpty") + "</p>") + "</section>" +
        '<section class="sec"><h2>' + ic("pin") + t("saved.places") + "</h2>" +
        (places.length ? '<ul class="list">' + places.map(function (p, i) {
          return '<li class="row-wrap"><span class="row">' + '<span class="row-ic">' + ic("pin") + '</span><span class="row-main"><b>' + esc(p.label) + '</b><span class="fine">' + esc(GT.placeName(p.stop)) + "</span></span></span>" +
            '<button type="button" class="iconbtn" data-pi="' + i + '" aria-label="' + t("saved.remove") + "：" + esc(p.label) + '">' + ic("trash") + "</button></li>";
        }).join("") + "</ul>" : '<p class="empty">' + t("saved.placesEmpty") + "</p>") +
        '<form class="card addp" id="addp"><h3>' + ic("plus") + t("saved.addPlace") + "</h3>" +
        '<label class="field"><span class="fl">' + t("saved.placeLabel") + '</span><input id="pl" required maxlength="20"></label>' +
        '<label class="field"><span class="fl">' + t("saved.placeStop") + '</span><select id="ps">' + GT.places().map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + "</option>"; }).join("") + "</select></label>" +
        '<button class="secondary" type="submit">' + ic("plus") + "<span>" + t("saved.add") + "</span></button></form></section>";
    },
    mount: function (el) {
      var rlist = el.querySelector(".sec .list");
      if (rlist && rlist.querySelector(".grip")) GT.vfx.reorder(rlist, { handle: ".grip", onCommit: function (a, b) { GT.store.favRoutes.move(a, b); GT.toast(t("vfx.moved", { n: b + 1 })); } });
      GT.vfx.enter(Array.prototype.slice.call(el.querySelectorAll(".sec, .note.cloud")), { gap: 50 });
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
