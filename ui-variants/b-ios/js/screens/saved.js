// 保存：お気に入りの経路・よく使う場所。クラウドに保存するのはこれと設定だけ（決定 #4）。
(function (GT) {
  "use strict";
  var t = GT.t, ic = GT.icon, esc = GT.u.esc, u = GT.u;
  GT.screens.saved = {
    title: function () { return t("saved.title"); },
    render: function () {
      var routes = GT.store.favRoutes.list(), places = GT.store.favPlaces.list(), acct = GT.store.account.get();
      return '<section class="group"><h2 class="g-head"><span>' + t("saved.routes") + "</span></h2>" +
        (routes.length ? '<ul class="g-body iconic">' + routes.map(function (r) {
          var m = r.modes[0] || "other";
          return '<li class="cell-wrap"><a class="cell" href="#/detail?' + u.qs({ from: r.from, to: r.to, i: r.i }) + '"><span class="ico ' + m + '">' + ic(m) + '</span><span class="cell-main"><b>' + esc(GT.short(GT.placeName(r.from))) + ' <span aria-hidden="true">→</span><span class="sr-only">から</span> ' + esc(GT.short(GT.placeName(r.to))) + '</b><span class="cap num">' + u.hhmm(r.dep) + " – " + u.hhmm(r.arr) + " · " + (r.transfers ? t("results.transfers", { n: r.transfers }) : t("results.noTransfer")) + "</span></span>" + ic("chev", "chev") + "</a>" +
            '<button type="button" class="delbtn" data-rk="' + esc(r.key) + '" aria-label="' + t("saved.remove") + '">' + ic("trash") + "</button></li>";
        }).join("") + "</ul>" : '<div class="g-body"><p class="empty">' + t("saved.routesEmpty") + "</p></div>") + "</section>" +
        '<section class="group"><h2 class="g-head"><span>' + t("saved.places") + "</span></h2>" +
        '<div class="g-body iconic">' +
        places.map(function (p, i) {
          return '<div class="cell-wrap"><span class="cell"><span class="ico tint">' + ic("pin") + '</span><span class="cell-main"><b>' + esc(p.label) + '</b><span class="cap">' + esc(GT.short(GT.placeName(p.stop))) + "</span></span></span>" +
            '<button type="button" class="delbtn" data-pi="' + i + '" aria-label="' + t("saved.remove") + "：" + esc(p.label) + '">' + ic("trash") + "</button></div>";
        }).join("") +
        (places.length ? "" : '<p class="empty">' + t("saved.placesEmpty") + "</p>") +
        "</div></section>" +
        '<section class="group"><h2 class="g-head"><span>' + t("saved.addPlace") + "</span></h2>" +
        '<form class="g-body" id="addp">' +
        '<label class="cell inputcell"><span class="k">' + t("saved.placeLabel").replace(/（.*）/, "") + '</span><input id="pl" required maxlength="20" placeholder="' + t("saved.placeLabel").replace(/^.*（例：|）$/g, "") + '"></label>' +
        '<label class="cell inputcell"><span class="k">' + t("saved.placeStop") + '</span><select id="ps">' + GT.places().map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(GT.short(p.name)) + "</option>"; }).join("") + "</select>" + ic("swap", "selic") + "</label>" +
        '<button class="cell tinted" type="submit"><span class="ico tint">' + ic("plus") + '</span><span class="cell-main">' + t("saved.add") + "</span></button></form>" +
        '<p class="g-foot">' + (acct ? "" : t("saved.localOnly") + "。") + t("saved.cloudNote") + "</p></section>";
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
