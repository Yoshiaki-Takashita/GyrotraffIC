// 設定・アカウント（模擬）・データの出典とライセンス。
(function (GT) {
  "use strict";
  var t = GT.t, ic = GT.icon, esc = GT.u.esc;
  function seg(name, opts, cur) {
    return '<div class="seg" role="radiogroup">' + opts.map(function (o) { return '<label class="seg-i"><input type="radio" name="' + name + '" value="' + o[0] + '"' + (cur === o[0] ? " checked" : "") + "><span>" + o[1] + "</span></label>"; }).join("") + "</div>";
  }
  GT.screens.settings = {
    title: function () { return t("settings.title"); },
    render: function () {
      var s = GT.store.settings.get(), a = GT.store.account.get();
      return (GT.store.available() ? "" : '<p class="note warn">' + ic("info") + t("settings.storageOff") + "</p>") +
        '<section class="sec"><h2>' + GT.fx.hd("settings.theme", "theme") + "</h2>" + seg("theme", [["system", t("settings.themeSystem")], ["light", t("settings.themeLight")], ["dark", t("settings.themeDark")]], s.theme) + "</section>" +
        '<section class="sec"><h2>' + GT.fx.hd("settings.lang", "globe") + "</h2>" + seg("lang", GT.i18n.langs.map(function (l) { return [l.id, l.label]; }), s.lang) + "</section>" +
        '<section class="sec"><h2>' + GT.fx.hd("settings.history", "history") + '</h2><p class="body">' + t("settings.historyNote") + '</p><button type="button" class="danger" id="clr">' + ic("trash") + "<span>" + t("settings.historyClear") + "</span></button></section>" +
        '<section class="sec"><ul class="list">' +
        '<li><a class="row" href="#/settings/account"><span class="row-ic">' + ic("user") + '</span><span class="row-main"><b>' + t("settings.account") + "</b>" + (a ? '<span class="fine">' + esc(a.email) + "</span>" : "") + "</span>" + ic("chev", "muted") + "</a></li>" +
        '<li><a class="row" href="#/settings/licenses"><span class="row-ic">' + ic("doc") + '</span><span class="row-main"><b>' + t("settings.licenses") + "</b></span>" + ic("chev", "muted") + "</a></li>" +
        "</ul></section>" +
        '<p class="fine center">' + t("app.name") + " · " + t("settings.version") + "</p>";
    },
    mount: function (el) {
      el.addEventListener("change", function (e) {
        if (e.target.name === "theme") { GT.store.settings.set({ theme: e.target.value }); GT.applyTheme(); }
        if (e.target.name === "lang") { GT.store.settings.set({ lang: e.target.value }); GT.i18n.set(e.target.value); GT.rerender(); }
      });
      el.querySelector("#clr").onclick = function () { GT.store.history.clear(); GT.toast(t("settings.historyCleared")); };
    }
  };
  GT.screens.account = {
    title: function () { return t("account.title"); },
    render: function () {
      var a = GT.store.account.get();
      return '<p class="note warn">' + ic("info") + t("account.mock") + "</p>" +
        (a ? '<div class="card"><p>' + ic("user") + t("account.loggedIn", { e: esc(a.email) }) + '</p><button type="button" class="secondary" id="lo">' + ic("login") + "<span>" + t("account.logout") + "</span></button></div>"
          : '<form class="card" id="li"><label class="field"><span class="fl">' + t("account.email") + '</span><input type="email" id="em" autocomplete="off" placeholder="name@example.com" required></label><button class="primary" type="submit">' + ic("login") + "<span>" + t("account.login") + "</span></button></form>") +
        '<p class="body">' + t("account.what") + '</p><button type="button" class="secondary" disabled>' + ic("trash") + "<span>" + t("account.delete") + "</span></button>";
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
      return '<section class="sec"><h2>' + GT.fx.hd("lic.title", "doc") + '</h2><ul class="lic">' +
        ["lic.osm", "lic.odpt", "lic.gtfs", "lic.sample", "lic.gmaps", "lic.software"].map(function (k) { return "<li>" + t(k) + "</li>"; }).join("") + "</ul></section>";
    }
  };
})(window.GT = window.GT || {});
