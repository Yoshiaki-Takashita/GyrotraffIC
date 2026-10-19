// 画面の切り替え（ハッシュルーティング）。#/home・#/results?…・#/detail?…（結果の上にシート）・#/saved・#/settings・#/settings/account・#/settings/licenses
(function (GT) {
  "use strict";
  var t = GT.t, ic = GT.icon, esc = GT.u.esc;
  GT.screens = GT.screens || {};
  // depth：横の移動の向きを決める。large：大きな見出しを使うか。back：戻る先と、その名前（題名）
  var routes = {
    "/home": { s: "home", tab: "search", depth: 0, large: true },
    "/results": { s: "results", tab: "search", depth: 1, large: true, back: "#/home", backLabel: "b.tabsHome" },
    "/detail": { s: "results", tab: "search", depth: 1, large: true, back: "#/home", backLabel: "b.tabsHome", sheet: true },
    "/saved": { s: "saved", tab: "saved", depth: 0, large: true },
    "/settings": { s: "settings", tab: "settings", depth: 0, large: true },
    "/settings/account": { s: "account", tab: "settings", depth: 1, back: "#/settings", backLabel: "settings.title" },
    "/settings/licenses": { s: "licenses", tab: "settings", depth: 1, back: "#/settings", backLabel: "settings.title" }
  };
  var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  GT.applyTheme = function () {
    var th = GT.store.settings.get().theme;
    var dark = th === "dark" || (th === "system" && mq && mq.matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.content = dark ? "#000000" : "#F2F2F7";
  };
  if (mq && mq.addEventListener) mq.addEventListener("change", GT.applyTheme);

  GT.toast = function (msg) {
    var el = document.getElementById("toast");
    el.textContent = msg; el.hidden = false;
    clearTimeout(GT._tt); GT._tt = setTimeout(function () { el.hidden = true; }, 2200);
  };

  function tabbar(active) {
    var tabs = [["search", "#/home", "search", "b.tabsHome"], ["saved", "#/saved", "star", "nav.saved"], ["settings", "#/settings", "gear", "nav.settings"]];
    return tabs.map(function (x) {
      var on = x[0] === active;
      return '<a class="tab' + (on ? " on" : "") + '" href="' + x[1] + '"' + (on ? ' aria-current="page"' : "") + ">" + ic(on && x[2] === "star" ? "starFill" : x[2]) + "<span>" + t(x[3]) + "</span></a>";
    }).join("");
  }

  var cur = { key: null, depth: 0, path: null, params: {} };
  function parse() {
    var h = location.hash.replace(/^#/, "") || "/home";
    var qi = h.indexOf("?");
    return { path: qi >= 0 ? h.slice(0, qi) : h, params: GT.u.parseQs(qi >= 0 ? h.slice(qi + 1) : "") };
  }
  function resultsHash(p) { return "#/results?" + GT.u.qs({ from: p.from, to: p.to, mode: p.mode, time: p.time }); }

  function render() {
    var loc = parse(), path = routes[loc.path] ? loc.path : "/home", r = routes[path], params = loc.params;
    var scr = GT.screens[r.s];
    var key = r.s + "?" + (r.s === "results" ? params.from + ">" + params.to : JSON.stringify(params));
    var view = document.getElementById("view"), head = document.getElementById("top");

    if (!r.sheet && GT.sheet.isOpen()) GT.sheet.closeSilently();

    if (key !== cur.key) {
      var title = scr.title(params);
      head.className = "navbar" + (r.large ? "" : " inline");
      head.innerHTML = (r.back ? '<button class="backbtn" id="backBtn" type="button" aria-label="' + t("nav.back") + '">' + ic("back") + "<span>" + esc(t(r.backLabel)) + "</span></button>" : "<span></span>") +
        '<span class="nb-title" aria-hidden="' + (r.large ? "true" : "false") + '">' + esc(title) + '</span><span class="nb-r"></span>';
      var bb = document.getElementById("backBtn");
      if (bb) bb.onclick = function () { location.hash = r.back; };
      document.getElementById("tabs").innerHTML = tabbar(r.tab);
      view.innerHTML = (r.large ? '<h1 class="lt" tabindex="-1">' + esc(title) + "</h1>" : '<h1 class="sr-only" tabindex="-1">' + esc(title) + "</h1>") + scr.render(params);
      view.scrollTop = 0;
      head.classList.remove("scrolled");
      document.title = title + " | GyrotraffIC";
      if (scr.mount) scr.mount(view, params);
      if (GT._navCount > 0) {
        view.classList.remove("push-in", "pop-in"); void view.offsetWidth;
        if (r.depth !== cur.depth || r.tab === cur.tab) view.classList.add(r.depth >= cur.depth ? "push-in" : "pop-in");
        var h1 = view.querySelector("h1"); if (h1 && !r.sheet) h1.focus({ preventScroll: true });
      }
      cur.key = key; cur.depth = r.depth; cur.tab = r.tab;
    }
    if (r.sheet) {
      GT.screens.detail.fill(params);
      GT.sheet.open(function () {
        // 下に払った・×・背景：結果に戻る（結果から来たなら履歴を戻す）
        if (cur.cameFromResults) history.back(); else location.replace(resultsHash(params));
      });
    }
    cur.cameFromResults = cur.path === "/results" && path === "/detail";
    cur.path = path; cur.params = params;
    GT._navCount++;
  }
  GT._navCount = 0;
  GT.rerender = function () { cur.key = null; render(); };

  function onScroll() {
    var v = document.getElementById("view"), head = document.getElementById("top");
    var lt = v.querySelector(".lt");
    var th = lt ? lt.offsetTop + lt.offsetHeight - 52 : 4;
    head.classList.toggle("scrolled", v.scrollTop > Math.max(4, th));
  }

  function start() {
    var st = GT.store.settings.get();
    GT.i18n.set(st.lang);
    GT.applyTheme();
    GT.sheet.init();
    document.getElementById("sheetClose").setAttribute("aria-label", t("b.close"));
    document.getElementById("sheetClose").firstChild.innerHTML = ic("xmark");
    document.getElementById("view").addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("hashchange", render);
    GT.data.places().then(render);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})(window.GT = window.GT || {});
