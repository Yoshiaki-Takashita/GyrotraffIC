// 画面の切り替え（ハッシュルーティング）と、詳細のシート・起動の演出。
// #/home・#/results?…・#/detail?…（結果の上に下から出るシート）・#/saved・#/settings・#/settings/account・#/settings/licenses
(function (GT) {
  "use strict";
  var t = GT.t, ic = GT.icon;
  var routes = {
    "/home": { s: "home", tab: "search" },
    "/results": { s: "results", tab: "search", back: "#/home" },
    "/detail": { s: "detail", tab: "search", sheet: true },
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
    if (m) m.content = dark ? "#0b0c0d" : "#f6f6f3";
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

  function parse() {
    var h = location.hash.replace(/^#/, "") || "/home";
    var qi = h.indexOf("?");
    var path = qi >= 0 ? h.slice(0, qi) : h;
    return { path: routes[path] ? path : "/home", params: GT.u.parseQs(qi >= 0 ? h.slice(qi + 1) : "") };
  }

  var baseKey = null;
  function renderBase(path, params) {
    var r = routes[path], scr = GT.screens[r.s];
    var key = path + "?" + (path === "/results" ? params.from + ">" + params.to : JSON.stringify(params));
    var head = document.getElementById("top");
    var title = scr.title(params);
    document.getElementById("tabs").innerHTML = tabbar(r.tab);
    if (key === baseKey && path === "/results") return title;
    baseKey = key;
    head.innerHTML = (r.back ? '<button class="iconbtn" id="backBtn" type="button" aria-label="' + t("nav.back") + '">' + ic("back") + "</button><h1>" + GT.u.esc(title) + "</h1>"
      : '<span class="brand"><span class="brand-mark" aria-hidden="true"></span><b>GyrotraffIC</b></span><h1 class="sr-only">' + GT.u.esc(title) + "</h1>") + '<span class="top-sp"></span>';
    var bb = document.getElementById("backBtn");
    if (bb) bb.onclick = function () { location.hash = r.back; };
    var view = document.getElementById("view");
    view.dataset.s = r.s;
    view.innerHTML = scr.render(params);
    view.scrollTop = 0;
    if (scr.mount) scr.mount(view, params);
    var h1 = head.querySelector("h1");
    if (GT._navCount > 0 && h1) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); }
    return title;
  }

  // ── 詳細のシート：下から出る。バーを指で下げて離すと、その速さを引き継いで閉じる ──
  var wrap, sheet, body, sheetOpen = false, anim = null;
  var EASE = "cubic-bezier(.16,1,.3,1)";
  function sheetY() { var m = new DOMMatrixReadOnly(getComputedStyle(sheet).transform); return m.m42; }
  function slide(fromY, toY, dur, easing, done) {
    if (anim) anim.cancel();
    if (GT.fx.reduced() || !sheet.animate) {
      sheet.style.transform = "translateY(" + toY + ")"; sheet.style.opacity = "1"; if (done) done(); return;
    }
    anim = sheet.animate([{ transform: "translateY(" + fromY + ")" }, { transform: "translateY(" + toY + ")" }], { duration: dur, easing: easing, fill: "forwards" });
    anim.onfinish = function () { sheet.style.transform = "translateY(" + toY + ")"; anim.cancel(); anim = null; if (done) done(); };
  }
  function openSheet(params) {
    var scr = GT.screens.detail;
    document.getElementById("sheetTitle").textContent = scr.title(params);
    body.innerHTML = scr.render(params);
    body.scrollTop = 0;
    var ready = scr.mount(body, params);
    var wasOpen = sheetOpen;
    sheetOpen = true;
    wrap.classList.add("open"); wrap.setAttribute("aria-hidden", "false");
    document.getElementById("view").setAttribute("aria-hidden", "true");
    var play = function () { Promise.resolve(ready).then(function () { scr.play(body); }); };
    if (wasOpen) { play(); return; }
    slide("105%", "0px", 460, EASE, function () { document.getElementById("sheetTitle").focus({ preventScroll: true }); play(); });
  }
  function closeSheet(fromPx, dur) {
    if (!sheetOpen) return;
    sheetOpen = false;
    wrap.classList.remove("open"); wrap.setAttribute("aria-hidden", "true");
    document.getElementById("view").removeAttribute("aria-hidden");
    slide(fromPx != null ? fromPx + "px" : "0px", "105%", dur || 320, "cubic-bezier(.4,0,.8,.6)", function () { body.innerHTML = ""; });
  }
  GT.closeDetail = function () {
    var p = parse().params;
    if (GT._navCount > 1) history.back();
    else location.hash = "#/results?" + GT.u.qs({ from: p.from, to: p.to });
  };
  function bindDrag() {
    var bar = document.getElementById("sheetBar"), y0 = 0, last = [], dragging = false;
    bar.addEventListener("pointerdown", function (e) {
      if (e.target.closest("button")) return;
      dragging = true; y0 = e.clientY; last = [[e.timeStamp, 0]];
      if (anim) { anim.cancel(); anim = null; }
      bar.setPointerCapture(e.pointerId);
    });
    bar.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      var dy = Math.max(0, e.clientY - y0);
      // 上へは少しだけ（抵抗をつける）
      if (e.clientY < y0) dy = -Math.sqrt(y0 - e.clientY) * 2;
      sheet.style.transform = "translateY(" + dy + "px)";
      last.push([e.timeStamp, dy]); if (last.length > 5) last.shift();
    });
    function end() {
      if (!dragging) return;
      dragging = false;
      var dy = sheetY(), a = last[0], b = last[last.length - 1];
      var v = b && a && b[0] > a[0] ? (b[1] - a[1]) / (b[0] - a[0]) : 0; // px/ms
      if (dy > 140 || v > 0.55) {
        var remain = sheet.offsetHeight - dy;
        var dur = Math.max(140, Math.min(340, remain / Math.max(v, 1.2)));
        sheetOpen = true; // closeSheet が動かすよう
        closeSheetFrom = { y: dy, dur: dur };
        GT.closeDetail();
      } else {
        slide(dy + "px", "0px", 380, EASE);
      }
    }
    bar.addEventListener("pointerup", end);
    bar.addEventListener("pointercancel", end);
  }
  var closeSheetFrom = null;

  function render() {
    var q = parse(), r = routes[q.path];
    if (r.sheet) {
      // 下に結果の画面を置いてから、シートを出す
      renderBase("/results", { from: q.params.from, to: q.params.to });
      document.title = GT.screens.detail.title(q.params) + " | GyrotraffIC";
      openSheet(q.params);
    } else {
      if (sheetOpen) { var c = closeSheetFrom || {}; closeSheetFrom = null; closeSheet(c.y, c.dur); }
      var title = renderBase(q.path, q.params);
      document.title = title + " | GyrotraffIC";
    }
    GT._navCount++;
  }
  GT._navCount = 0;
  GT.rerender = function () { baseKey = null; render(); };

  // ── 起動：案内板の文字が順に出る（900ms 以内。動きを減らす設定では出さない） ──
  function boot() {
    if (GT.fx.reduced() || sessionStorageGet()) return;
    var name = "GyrotraffIC";
    var el = document.createElement("div");
    el.className = "boot"; el.setAttribute("aria-hidden", "true");
    el.innerHTML = '<div class="boot-line"><div class="boot-name">' + name.split("").map(function (c, i) { return '<span style="animation-delay:' + (120 + i * 34) + 'ms">' + c + "</span>"; }).join("") +
      '</div><div class="boot-sub"><i></i>' + GT.u.esc(t("boot.sub")) + "</div></div>";
    document.getElementById("app").appendChild(el);
    setTimeout(function () { el.classList.add("out"); }, 720);
    setTimeout(function () { el.remove(); }, 920);
  }
  function sessionStorageGet() { try { var v = sessionStorage.getItem("gyrotraffic.booted"); sessionStorage.setItem("gyrotraffic.booted", "1"); return !!v; } catch (e) { return false; } }

  function start() {
    var st = GT.store.settings.get();
    GT.i18n.set(st.lang);
    GT.applyTheme();
    wrap = document.getElementById("sheetWrap"); sheet = document.getElementById("sheet"); body = document.getElementById("sheetBody");
    var cb = document.getElementById("sheetClose");
    cb.setAttribute("aria-label", t("detail.close")); cb.innerHTML = ic("down");
    cb.onclick = GT.closeDetail;
    document.getElementById("scrim").onclick = GT.closeDetail;
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && sheetOpen) GT.closeDetail(); });
    bindDrag();
    boot();
    window.addEventListener("hashchange", render);
    render();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})(window.GT = window.GT || {});
