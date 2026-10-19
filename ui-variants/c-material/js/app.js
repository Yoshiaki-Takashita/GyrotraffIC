// 画面の切り替え（ハッシュルーティング）。結果→詳細は View Transitions の共有要素（見せ場①）。
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
  var rm = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  GT.reduced = function () { return !!(rm && rm.matches); };
  GT.applyTheme = function () {
    var th = GT.store.settings.get().theme;
    var dark = th === "dark" || (th === "system" && mq && mq.matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.content = dark ? "#0E1514" : "#F4FBFA";
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
      return '<a class="tab" href="' + x[1] + '"' + (on ? ' aria-current="page"' : "") + ' data-tab="' + x[0] + '"><span class="pill sl">' + ic(on && x[2] === "star" ? "starFill" : x[2]) + "</span><span>" + t(x[3]) + "</span></a>";
    }).join("");
  }
  var lastPath = null;

  function render() {
    var h = location.hash.replace(/^#/, "") || "/home";
    var qi = h.indexOf("?");
    var path = qi >= 0 ? h.slice(0, qi) : h;
    var params = GT.u.parseQs(qi >= 0 ? h.slice(qi + 1) : "");
    var r = routes[path] || routes["/home"];
    var scr = GT.screens[r.s];
    var head = document.getElementById("top");
    var title = scr.title(params);
    head.innerHTML = (r.back ? '<button class="iconbtn std sl" id="backBtn" type="button" aria-label="' + t("nav.back") + '">' + ic("back") + "</button>" : '<span class="brand">' + GT.mark("brand-mark") + "<b>GyrotraffIC</b></span>") +
      (r.back ? "<h1>" + GT.u.esc(title) + "</h1>" : '<h1 class="sr-only">' + GT.u.esc(title) + "</h1>") + '<span class="top-sp"></span>';
    var bb = document.getElementById("backBtn");
    if (bb) bb.onclick = function () { if (r.back === "back" && history.length > 1 && GT._navCount > 1) history.back(); else location.hash = r.back === "back" ? "#/results?" + GT.u.qs({ from: params.from, to: params.to }) : r.back; };
    var tabs = document.getElementById("tabs");
    if (!tabs.firstChild) tabs.innerHTML = tabbar(r.tab);
    // 活性の印は同じ要素のまま付け替える（印が横に広がる動き）
    tabs.querySelectorAll(".tab").forEach(function (a) {
      var on = a.dataset.tab === r.tab;
      if (on !== a.classList.contains("on")) {
        a.classList.toggle("on", on);
        if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
        a.querySelector(".pill").innerHTML = ic(on && a.dataset.tab === "saved" ? "starFill" : a.dataset.tab === "search" ? "search" : a.dataset.tab === "saved" ? "star" : "gear");
      }
    });
    var view = document.getElementById("view");
    view.className = "view v-" + r.s;
    view.innerHTML = scr.render(params);
    view.scrollTop = 0;
    document.title = title + " | GyrotraffIC";
    var p = scr.mount ? scr.mount(view, params) : null;
    var h1 = head.querySelector("h1");
    if (GT._navCount++ > 0 && h1) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); }
    lastPath = path;
    return p;
  }
  GT._navCount = 0;
  GT.rerender = render;

  function onHash() {
    var h = location.hash.replace(/^#/, "") || "/home";
    var path = h.split("?")[0];
    var shared = (lastPath === "/results" && path === "/detail") || (lastPath === "/detail" && path === "/results");
    if (shared && document.startViewTransition && !GT.reduced()) {
      document.startViewTransition(function () { return Promise.resolve(render()); });
    } else render();
  }

  function start() {
    var st = GT.store.settings.get();
    GT.i18n.set(st.lang);
    GT.applyTheme();
    window.addEventListener("hashchange", onHash);
    render();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})(window.GT = window.GT || {});
