// 画面の切り替え（ハッシュルーティング）。#/home・#/results?…・#/detail?…・#/saved・#/settings・#/settings/account・#/settings/licenses
(function (GT) {
  "use strict";
  var t = GT.t, ic = GT.icon;
  GT.screens = GT.screens || {};
  var routes = {
    "/home": { s: "home", tab: "search" },
    "/results": { s: "results", tab: "search", back: "#/home" },
    "/detail": { s: "detail", tab: "search", back: "back" },
    "/station": { s: "station", tab: "station" },
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
    if (m) m.content = dark ? "#0c1014" : "#ecebe6";
  };
  if (mq && mq.addEventListener) mq.addEventListener("change", GT.applyTheme);

  GT.toast = function (msg) {
    var el = document.getElementById("toast");
    el.textContent = msg; el.hidden = false;
    clearTimeout(GT._tt); GT._tt = setTimeout(function () { el.hidden = true; }, 2200);
  };

  function tabbar(active) {
    var tabs = [["search", "#/home", "search", "nav.search"], ["station", "#/station", "cube", "nav.station"], ["saved", "#/saved", "star", "nav.saved"], ["settings", "#/settings", "gear", "nav.settings"]];
    return tabs.map(function (x) {
      var on = x[0] === active;
      return '<a class="tab' + (on ? " on" : "") + '" href="' + x[1] + '"' + (on ? ' aria-current="page"' : "") + ' aria-label="' + t(x[3]) + '">' + ic(x[2]) + "</a>";   // アイコンだけ（名前は aria-label）
    }).join("");
  }

  // 画面の深さ（進む／戻るの向きを決める）とタブの順（左右の向き）
  var DEPTH = { station: 0, home: 0, results: 1, detail: 2, saved: 0, settings: 0, account: 1, licenses: 1 };
  var TABS = ["search", "station", "saved", "settings"];
  var prev = null, ghost = null, prevScr = null;
  GT._navId = 0;

  function parse() {
    var h = location.hash.replace(/^#/, "") || "/home";
    var qi = h.indexOf("?");
    var path = qi >= 0 ? h.slice(0, qi) : h;
    var r = routes[path] || routes["/home"];
    return { hash: "#" + h, path: path, r: r, params: GT.u.parseQs(qi >= 0 ? h.slice(qi + 1) : ""), scr: GT.screens[r.s], depth: DEPTH[r.s] || 0, tabIdx: TABS.indexOf(r.tab) };
  }

  function chrome(c) {
    var r = c.r, params = c.params, scr = c.scr;
    var head = document.getElementById("top");
    var title = scr.title(params);
    head.innerHTML = (r.back ? '<button class="iconbtn" id="backBtn" type="button" aria-label="' + t("nav.back") + '">' + ic("back") + "</button>" : '<span class="brand">' + ic("gyro", "brand-ic") + "<b>GyrotraffIC</b></span>") +
      (r.back ? "<h1>" + GT.u.esc(title) + "</h1>" : '<h1 class="sr-only">' + GT.u.esc(title) + "</h1>") + '<span class="top-sp"></span>' + (r.back ? "" : '<time class="clock" id="clock" aria-hidden="true"></time>') + '<i class="top-line" aria-hidden="true"></i>';
    var bb = document.getElementById("backBtn");
    if (bb) bb.onclick = function () { if (r.back === "back" && history.length > 1 && GT._navCount > 1) history.back(); else location.hash = r.back === "back" ? "#/results?" + GT.u.qs({ from: params.from, to: params.to }) : r.back; };
    var nav = document.getElementById("tabs");
    var oldInd = nav.querySelector(".tab-ind"), fromX = oldInd && oldInd.__mv ? oldInd.__mv.cur.x : null, fromV = oldInd && oldInd.__mv ? oldInd.__mv.vel("x") : 0;
    nav.innerHTML = tabbar(r.tab) + '<i class="tab-ind" aria-hidden="true"></i>';
    GT.vfx && GT.vfx.tabIndicator(nav, fromX, fromV);
    document.title = title + " | GyrotraffIC";
    GT.inst.clock();
    var h1 = head.querySelector("h1");
    if (GT._navCount++ > 0 && h1) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); }
  }

  /** 移りの途中の古い画面を即座に片づける */
  function dropGhost() {
    if (!ghost) return;
    var g = ghost; ghost = null;
    g.mv.clear();
    if (g.el.parentNode) g.el.parentNode.removeChild(g.el);
  }
  function makeGhost(view, hash) {
    var app = document.getElementById("app");
    var g = document.createElement("div");
    g.className = "ghost"; g.setAttribute("aria-hidden", "true"); g.inert = true;
    var inner = document.createElement("div"); inner.className = "ghost-in";
    inner.style.transform = "translate3d(0," + (-view.scrollTop) + "px,0)";
    while (view.firstChild) inner.appendChild(view.firstChild);
    g.appendChild(inner);
    g.style.top = view.offsetTop + "px"; g.style.height = view.clientHeight + "px";
    app.insertBefore(g, view.nextSibling);
    return { el: g, inner: inner, hash: hash, scroll: view.scrollTop, mv: GT.M.el(g) };
  }
  function exitGhost(g, vals, vel) {
    g.mv.to(vals, "page", vel).then(function () { if (ghost === g) dropGhost(); });
    // 古い画面は速く薄れ、新しい画面はゆっくり定まる（2 枚の文字が重なって濁る時間を短く）
    if (g.mv.sp.o) g.mv.sp.o.set({ k: 620, zeta: 1 });
  }

  function render() {
    var c = parse();
    var view = document.getElementById("view");
    var M = GT.M, W = view.clientWidth || 390;
    var kind = !prev ? "boot" : GT._navHint === "dismiss" ? "dismiss" : c.tabIdx !== prev.tabIdx ? "tab" : c.depth > prev.depth ? "fwd" : c.depth < prev.depth ? "back" : c.hash === prev.hash ? "same" : "swap";
    var dir = kind === "tab" ? (c.tabIdx > prev.tabIdx ? 1 : -1) : kind === "back" ? -1 : 1;
    var shared = (kind === "fwd" && GT._shared && M.now() - GT._shared.at < 1200) || (kind === "back" && GT._sharedBack && M.now() - GT._sharedBack.at < 1200);
    GT._navKind = kind;
    GT._navHint = null;
    var vmv = M.el(view);

    // (c) 戻る操作の中断：移りの途中で元の画面へ戻るなら、作り直さず、今の位置と速度から向きを変える
    if (ghost && ghost.hash === c.hash && !M.reduced() && kind !== "dismiss") {
      var old = ghost;
      var ng = makeGhost(view, prev.hash);
      ng.mv.set({ x: vmv.cur.x, y: vmv.cur.y, o: vmv.cur.o, s: vmv.cur.s });
      var vIn = { x: vmv.vel("x"), o: vmv.vel("o") };
      ng.mv.to({ x: vmv.cur.x, o: vmv.cur.o }, "page", vIn);
      while (old.inner.firstChild) view.appendChild(old.inner.firstChild);
      view.scrollTop = old.scroll;
      var vOld = { x: old.mv.vel("x"), o: old.mv.vel("o") };
      vmv.set({ x: old.mv.cur.x, y: old.mv.cur.y, o: old.mv.cur.o, s: old.mv.cur.s });
      old.mv.clear(); if (old.el.parentNode) old.el.parentNode.removeChild(old.el);
      ghost = ng;
      var back = kind === "back" || (kind === "tab" && dir < 0) ? -1 : 1;
      exitGhost(ng, { x: 28 * back, o: 0 }, null);
      vmv.to({ x: 0, y: 0, o: 1, s: 1 }, "page", vOld);
      GT.vfx && GT.vfx.parallax(dir);
      prev = c; GT._navId++;
      chrome(c);
      if (c.scr.resume) c.scr.resume(view);   // 移りを戻した画面の描画（駅の立体図の描画の繰り返し）を再開
      prevScr = c.scr;
      GT.scrollbar && GT.scrollbar.refresh();
      return;
    }

    dropGhost();
    var animate = kind !== "boot" && kind !== "same" && !M.reduced() && view.firstChild;
    if (animate) ghost = makeGhost(view, prev.hash);
    else view.innerHTML = "";
    prev = c; GT._navId++;
    chrome(c);
    view.innerHTML = c.scr.render(c.params);
    view.scrollTop = 0;
    if (c.scr.mount) c.scr.mount(view, c.params);
    if (prevScr && prevScr.unmount && prevScr !== c.scr) prevScr.unmount();
    prevScr = c.scr;
    GT.scrollbar && GT.scrollbar.refresh();

    if (!animate) { vmv.clear(); return; }
    var g = ghost;
    if (kind === "dismiss") {
      // 払って閉じた：古い画面は今の位置から下へ抜け、下にあった画面が奥から定まる
      g.el.classList.add("sheet-out");   // 払って閉じるシートは不透明（下の画面を覆ったまま抜ける）
      g.mv.set({ y: vmv.cur.y });
      vmv.clear();
      exitGhost(g, { y: view.clientHeight, o: 0 }, { y: GT._dismissV || 0 });
      g.mv.sp.o.set({ k: 60, zeta: 1 });   // シートは薄れずに、下へ抜けきる
      vmv.set({ s: 0.965, o: 0.4 });
      vmv.to({ s: 1, o: 1 }, "page");
    } else if (shared) {
      // 共有要素の移り：画面は滑らせず、リボンだけが場所を移る（detail 側で FLIP）
      vmv.set({ x: 0, o: 0 });
      vmv.to({ o: 1 }, { k: 380, zeta: 1 });
      var src = GT._shared && GT._shared.el; if (kind === "fwd" && src) src.style.opacity = 0;   // リボンは「移った」ので元の場所から消す
      exitGhost(g, { o: 0 }, null);
    } else {
      vmv.set({ x: 56 * dir, o: 0 });
      vmv.to({ x: 0, o: 1 }, "page");
      exitGhost(g, { x: -28 * dir, o: 0 }, null);
      GT.vfx && GT.vfx.parallax(dir);
    }
  }
  GT._navCount = 0;
  GT.rerender = render;

  function start() {
    var st = GT.store.settings.get();
    GT.i18n.set(st.lang);
    GT.applyTheme();
    window.addEventListener("hashchange", render);
    render();
    GT.inst.splash();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})(window.GT = window.GT || {});
