// 画面の切り替え（ハッシュルーティング）。#/home・#/results?…・#/detail?…・#/saved・#/settings・#/settings/account・#/settings/licenses
(function (GT) {
  "use strict";
  var t = GT.t, ic = GT.icon;
  GT.screens = GT.screens || {};
  var routes = {
    "/home": { s: "home", tab: "search" },
    "/results": { s: "results", tab: "search", back: "#/home" },
    "/detail": { s: "detail", tab: "search", back: "back" },
    "/saved": { s: "saved", tab: "saved" },
    "/settings": { s: "settings", tab: "settings" },
    "/settings/account": { s: "account", tab: "settings", back: "#/settings" },
    "/settings/licenses": { s: "licenses", tab: "settings", back: "#/settings" }
  };
  var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  GT.applyTheme = function () {
    var th = GT.store.settings.get().theme;
    var dark = th === "dark" || (th === "system" && mq && mq.matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.content = dark ? "#0f1419" : "#f6f7f9";
  };
  if (mq && mq.addEventListener) mq.addEventListener("change", GT.applyTheme);

  GT.toast = function (msg) {
    var el = document.getElementById("toast");
    el.textContent = msg; el.hidden = false;
    clearTimeout(GT._tt); GT._tt = setTimeout(function () { el.hidden = true; }, 2200);
  };

  function tabbar(active) {
    var tabs = [["search", "#/home", "search", "nav.search"], ["saved", "#/saved", "star", "nav.saved"], ["settings", "#/settings", "gear", "nav.settings"]];
    return tabs.map(function (x) {
      var on = x[0] === active;
      return '<a class="tab' + (on ? " on" : "") + '" href="' + x[1] + '"' + (on ? ' aria-current="page"' : "") + ">" + ic(x[2]) + "<span>" + t(x[3]) + "</span></a>";
    }).join("");
  }

  function render() {
    var h = location.hash.replace(/^#/, "") || "/home";
    var qi = h.indexOf("?");
    var path = qi >= 0 ? h.slice(0, qi) : h;
    var params = GT.u.parseQs(qi >= 0 ? h.slice(qi + 1) : "");
    var r = routes[path] || routes["/home"];
    var scr = GT.screens[r.s];
    var head = document.getElementById("top");
    var title = scr.title(params);
    head.innerHTML = (r.back ? '<button class="iconbtn" id="backBtn" type="button" aria-label="' + t("nav.back") + '">' + ic("back") + "</button>" : '<span class="brand">' + ic("origin", "brand-ic") + "<b>GyrotraffIC</b></span>") +
      (r.back ? "<h1>" + GT.u.esc(title) + "</h1>" : '<h1 class="sr-only">' + GT.u.esc(title) + "</h1>") + '<span class="top-sp"></span>';
    var bb = document.getElementById("backBtn");
    if (bb) bb.onclick = function () { if (r.back === "back" && history.length > 1 && GT._navCount > 1) history.back(); else location.hash = r.back === "back" ? "#/results?" + GT.u.qs({ from: params.from, to: params.to }) : r.back; };
    document.getElementById("tabs").innerHTML = tabbar(r.tab);
    var view = document.getElementById("view");
    view.innerHTML = scr.render(params);
    view.scrollTop = 0;
    document.title = title + " | GyrotraffIC";
    if (scr.mount) scr.mount(view, params);
    var h1 = head.querySelector("h1");
    if (GT._navCount++ > 0 && h1) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); }
  }
  GT._navCount = 0;
  GT.rerender = render;

  function start() {
    var st = GT.store.settings.get();
    GT.i18n.set(st.lang);
    GT.applyTheme();
    window.addEventListener("hashchange", render);
    render();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})(window.GT = window.GT || {});
