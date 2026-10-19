// 設定・アカウント（模擬）・データの出典とライセンス。
(function (GT) {
  "use strict";
  var t = GT.t, ic = GT.icon, esc = GT.u.esc;
  function seg(name, opts, cur) {
    return '<div class="seg" data-seg role="radiogroup">' + opts.map(function (o) { return '<label class="seg-i"><input type="radio" name="' + name + '" value="' + o[0] + '"' + (cur === o[0] ? " checked" : "") + "><span>" + o[1] + "</span></label>"; }).join("") + "</div>";
  }
  GT.screens.settings = {
    title: function () { return t("settings.title"); },
    render: function () {
      var s = GT.store.settings.get(), a = GT.store.account.get();
      return (GT.store.available() ? "" : '<p class="note" style="padding:0 var(--s4) var(--s4)">' + ic("info") + "<span>" + t("settings.storageOff") + "</span></p>") +
        '<section class="group"><div class="g-body iconic">' +
        '<a class="cell" href="#/settings/account"><span class="ico tint">' + ic("user") + '</span><span class="cell-main"><b>' + t("settings.account") + "</b>" + (a ? '<span class="cap">' + esc(a.email) + "</span>" : "") + "</span>" + ic("chev", "chev") + "</a>" +
        "</div></section>" +
        '<section class="group"><h2 class="g-head"><span>' + t("settings.theme") + '</span></h2><div class="g-body"><div class="seg-wrap">' +
        seg("theme", [["system", t("settings.themeSystem")], ["light", t("settings.themeLight")], ["dark", t("settings.themeDark")]], s.theme) + "</div></div></section>" +
        '<section class="group"><h2 class="g-head"><span>' + t("settings.lang") + '</span></h2><div class="g-body"><div class="seg-wrap">' +
        seg("lang", GT.i18n.langs.map(function (l) { return [l.id, l.label]; }), s.lang) + "</div></div></section>" +
        '<section class="group"><h2 class="g-head"><span>' + t("settings.history") + '</span></h2><div class="g-body">' +
        '<button type="button" class="cell destructive" id="clr">' + t("settings.historyClear") + "</button></div>" +
        '<p class="g-foot">' + t("settings.historyNote") + "</p></section>" +
        '<section class="group"><div class="g-body iconic">' +
        '<a class="cell" href="#/settings/licenses"><span class="ico">' + ic("doc") + '</span><span class="cell-main"><b>' + t("settings.licenses") + "</b></span>" + ic("chev", "chev") + "</a>" +
        "</div>" +
        '<p class="g-foot center">' + t("app.name") + " · " + t("settings.version") + "</p></section>";
    },
    mount: function (el) {
      el.querySelectorAll("[data-seg]").forEach(GT.fx.seg);
      el.addEventListener("change", function (e) {
        if (e.target.name === "theme") { GT.store.settings.set({ theme: e.target.value }); GT.applyTheme(); }
        if (e.target.name === "lang") { GT.store.settings.set({ lang: e.target.value }); GT.i18n.set(e.target.value); setTimeout(GT.rerender, 260); }
      });
      el.querySelector("#clr").onclick = function () { GT.store.history.clear(); GT.toast(t("settings.historyCleared")); };
    }
  };
  GT.screens.account = {
    title: function () { return t("account.title"); },
    render: function () {
      var a = GT.store.account.get();
      return '<div style="height:var(--s4)"></div>' +
        (a ? '<section class="group"><div class="g-body iconic"><div class="cell"><span class="ico tint">' + ic("user") + '</span><span class="cell-main"><b>' + esc(a.email) + '</b><span class="cap">' + t("account.loggedIn", { e: "" }).replace(/[：:]\s*$/, "") + '</span></span></div><button type="button" class="cell tinted" id="lo"><span class="ico tint">' + ic("login") + '</span><span class="cell-main">' + t("account.logout") + "</span></button></div>" +
          '<p class="g-foot">' + t("account.mock") + "</p></section>"
          : '<form class="group" id="li"><div class="g-body"><label class="cell inputcell"><span class="k">' + t("account.email") + '</span><input type="email" id="em" autocomplete="off" placeholder="name@example.com" required></label></div>' +
            '<p class="g-foot">' + t("account.mock") + '</p><div class="dock" style="position:static"><button class="btn filled" type="submit">' + ic("login") + "<span>" + t("account.login") + "</span></button></div></form>") +
        '<section class="group"><div class="g-body"><button type="button" class="cell destructive" disabled style="opacity:.5">' + t("account.delete") + '</button></div><p class="g-foot">' + t("account.what") + "</p></section>";
    },
    mount: function (el) {
      var f = el.querySelector("#li");
      if (f) f.onsubmit = function (e) { e.preventDefault(); var v = el.querySelector("#em").value.trim(); if (!/^\S+@\S+$/.test(v)) { el.querySelector("#em").focus(); return; } GT.store.account.set({ email: v }); GT.rerender(); };
      var lo = el.querySelector("#lo");
      if (lo) lo.onclick = function () { GT.store.account.set(null); GT.rerender(); };
    }
  };
  GT.screens.licenses = {
    title: function () { return t("settings.licenses"); },
    render: function () {
      return '<div style="height:var(--s4)"></div><section class="group"><h2 class="g-head"><span>' + t("lic.title") + '</span></h2><ul class="g-body lic">' +
        ["lic.osm", "lic.odpt", "lic.gtfs", "lic.sample", "lic.gmaps", "lic.software"].map(function (k) { return "<li>" + t(k) + "</li>"; }).join("") + "</ul></section>";
    }
  };
})(window.GT = window.GT || {});
