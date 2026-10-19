// 駅の立体図：大きな駅の階・ホーム・改札・通路・階段／エスカレーター／エレベーターを光る枠線で描き、
// 乗るホームの号車・ドアから乗換先までの最短の道を光る線でたどる。いちばん早いドアも提案する。
// データは架空の見本（data/sample-station.json）。秒数が不明の区間は「不明」と出す。
(function (GT) {
  "use strict";
  var t = GT.t, ic = GT.icon, esc = GT.u.esc;
  var S = window.GT_STATION;
  var G = function () { return GT.stationGraph; };
  var state = { from: "P12", car: 7, door: 3, to: "P56", stepFree: false, spread: false };
  var view3d = null;

  function plat(id) { return G().platformOf(S, id); }
  function nodeName(id) { var n = S.nodes.find(function (x) { return x.id === id; }); return n ? n.name : id; }
  function targetName(id) { var p = plat(id); return p ? p.name + " " + p.line.replace(/（架空）/g, "") : nodeName(id); }
  function fmt(sec) {
    var s = Math.round(sec);
    return s >= 60 ? t("st.minsec", { m: Math.floor(s / 60), s: s % 60 }) : t("st.sec", { n: s });
  }
  function timeText(r) {
    if (!r.ok) return t("st.noRoute");
    if (r.same) return t("st.same");
    return (r.unknown && r.sec === 0 ? t("st.unknown") : fmt(r.sec)) + (r.unknown ? t("st.unknownPart", { n: r.unknown }) : "");
  }
  function opt(v, label, on) { return '<option value="' + esc(v) + '"' + (on ? " selected" : "") + ">" + esc(label) + "</option>"; }
  function range(n) { var a = []; for (var i = 1; i <= n; i++) a.push(i); return a; }

  function controls() {
    var p = plat(state.from);
    return '<div class="st-pick">' +
      '<label class="field st-f">' + ic("platform", "od-ic") + '<span class="sr-only">' + t("st.from") + '</span><select id="stFrom">' +
        S.platforms.map(function (x) { return opt(x.id, x.name + " " + x.line.replace(/（架空）/g, ""), x.id === state.from); }).join("") + "</select></label>" +
      '<div class="st-cd">' +
        '<label class="field st-f">' + ic("car", "od-ic") + '<span class="sr-only">' + t("st.car") + '</span><select id="stCar">' + range(p.cars).map(function (n) { return opt(n, t("st.carN", { n: n }), n === state.car); }).join("") + "</select></label>" +
        '<label class="field st-f">' + ic("door", "od-ic") + '<span class="sr-only">' + t("st.door") + '</span><select id="stDoor">' + range(p.doors).map(function (n) { return opt(n, t("st.doorN", { n: n }), n === state.door); }).join("") + "</select></label>" +
      "</div>" +
      '<label class="field st-f">' + ic("target", "od-ic") + '<span class="sr-only">' + t("st.to") + '</span><select id="stTo">' +
        S.targets.filter(function (id) { return id !== state.from; }).map(function (id) { return opt(id, targetName(id), id === state.to); }).join("") + "</select></label>" +
      "</div>";
  }

  function stepsHtml(r) {
    if (!r.ok || r.same) return "";
    var rows = [];
    r.steps.forEach(function (s, i) {
      // 同じ種類の通路が続く所はまとめる
      var prev = rows[rows.length - 1];
      if (prev && s.kind === "walk" && prev.kind === "walk") { prev.sec = prev.sec == null || s.sec == null ? null : prev.sec + s.sec; prev.b = s.b; return; }
      rows.push({ kind: s.kind, a: s.a, b: s.b, sec: s.sec, dist: s.dist, i: i });
    });
    return '<ol class="st-steps" aria-label="' + t("st.steps") + '">' + rows.map(function (s) {
      var icn = s.kind === "walk" ? "walk" : s.kind === "platform" ? "platform" : s.kind;
      var what = s.kind === "platform" ? t("st.walkPlatform", { m: Math.round(s.dist) }) + " → " + esc(nodeName(s.b)) :
        s.kind === "walk" ? esc(nodeName(s.b)) : esc(nodeName(s.a).replace(/（下）/, "")) ;
      var sec = s.sec == null ? '<span class="st-unk">' + ic("confUnknown") + t("st.unknown") + "</span>" : fmt(s.sec);
      return '<li class="st-step k-' + s.kind + '">' + ic(icn, "", t("st.kind." + s.kind)) + '<span class="st-what">' + what + '</span><span class="st-sec">' + sec + "</span></li>";
    }).join("") + "</ol>";
  }

  function compute() {
    var r = G().route(S, { platform: state.from, car: state.car, door: state.door }, state.to, { stepFree: state.stepFree });
    var b = G().bestDoor(S, state.from, state.to, { stepFree: state.stepFree });
    return { r: r, b: b };
  }

  function outHtml(c) {
    var r = c.r, b = c.b, prop = "";
    if (r.ok && !r.same && b) {
      var same = b.car === state.car && b.door === state.door;
      var gain = same ? 0 : (r.unknown - b.r.unknown) || (r.sec - b.r.sec);
      if (same) prop = '<p class="st-prop is-same">' + ic("confConfirmed") + "<span>" + t("st.proposalSame") + "</span></p>";
      else {
        var lab = t("st.proposal", { car: b.car, door: b.door, t: timeText(b.r), d: b.r.unknown < r.unknown ? t("st.unknown") : fmt(gain) });
        prop = '<button type="button" class="st-prop" id="stBest" aria-label="' + t("st.best") + "：" + esc(lab) + '">' + ic("target") + '<span><b>' + t("st.carN", { n: b.car }) + " " + t("st.doorN", { n: b.door }) + "</b><small>" + esc(timeText(b.r)) + "</small></span>" + ic("chev", "muted") + "</button>";
      }
    }
    return '<div class="st-read"><span class="lbl">' + t("st.total") + '</span><div class="st-big' + (r.unknown ? " has-unk" : "") + '">' + esc(timeText(r)) + "</div></div>" +
      prop + stepsHtml(r) +
      '<p class="note">' + ic("info") + t("st.sample") + "</p>" +
      '<p class="fine">' + ic("confUnknown") + " " + t("st.doorsSrc") + " · " + esc(S.assumptions.note) + "</p>";
  }

  function update(el, animate) {
    var c = compute();
    el.querySelector("#stOut").innerHTML = outHtml(c);
    if (view3d) { view3d.setSelection({ platform: state.from, car: state.car, door: state.door }); view3d.setRoute(c.r); }
    var bb = el.querySelector("#stBest");
    if (bb) bb.onclick = function () {
      state.car = c.b.car; state.door = c.b.door;
      el.querySelector("#stCar").value = String(state.car); el.querySelector("#stDoor").value = String(state.door);
      update(el, true);
      var big = el.querySelector(".st-big"); if (big && GT.M && !GT.M.reduced()) { var mv = GT.M.el(big); mv.set({ s: 0.94 }); mv.to({ s: 1 }, GT.M.SPRING.release); }
    };
    if (animate && GT.vfx) GT.vfx.enter(Array.prototype.slice.call(el.querySelectorAll(".st-step")), { gap: 35 });
  }

  GT.screens.station = {
    title: function () { return t("st.title"); },
    render: function () {
      return '<div class="st-stage">' +
        '<canvas id="stc" class="st-canvas" tabindex="0" role="img" aria-label="' + t("st.canvas") + '"></canvas>' +
        '<div class="st-tools">' +
          '<button type="button" class="iconbtn st-tool" id="stReset" aria-label="' + t("st.reset") + '">' + ic("reset") + "</button>" +
          '<button type="button" class="iconbtn st-tool" id="stSpread" aria-pressed="' + state.spread + '" aria-label="' + t("st.levels") + '">' + ic("layers") + "</button>" +
          '<button type="button" class="iconbtn st-tool" id="stStep" aria-pressed="' + state.stepFree + '" aria-label="' + t("st.stepFree") + '">' + ic("stepFree") + "</button>" +
        "</div>" +
        '<span class="st-name">' + esc(S.name) + "</span>" +
        "</div>" +
        controls() +
        '<div id="stOut" class="st-out" aria-live="polite"></div>';
    },
    mount: function (el) {
      var cv = el.querySelector("#stc");
      if (view3d) view3d.destroy();
      view3d = GT.station3d.create(cv, S);
      if (state.spread) view3d.setSpread(true);
      function rebuildPick() {
        var pick = el.querySelector(".st-pick"), tmp = document.createElement("div");
        tmp.innerHTML = controls(); pick.parentNode.replaceChild(tmp.firstChild, pick); bind();
      }
      function bind() {
        el.querySelector("#stFrom").onchange = function (e) {
          state.from = e.target.value; var p = plat(state.from);
          state.car = Math.min(state.car, p.cars); state.door = Math.min(state.door, p.doors);
          if (state.to === state.from) state.to = S.targets.find(function (id) { return id !== state.from; });
          rebuildPick(); update(el, true);
        };
        el.querySelector("#stCar").onchange = function (e) { state.car = Number(e.target.value); update(el, false); };
        el.querySelector("#stDoor").onchange = function (e) { state.door = Number(e.target.value); update(el, false); };
        el.querySelector("#stTo").onchange = function (e) { state.to = e.target.value; update(el, true); };
      }
      bind();
      el.querySelector("#stReset").onclick = function () { view3d.reset(); };
      el.querySelector("#stSpread").onclick = function (e) { state.spread = !state.spread; e.currentTarget.setAttribute("aria-pressed", state.spread); view3d.setSpread(state.spread); };
      el.querySelector("#stStep").onclick = function (e) { state.stepFree = !state.stepFree; e.currentTarget.setAttribute("aria-pressed", state.stepFree); update(el, true); };
      update(el, false);
      GT.station = { view: view3d, state: state, compute: compute };
    },
    resume: function (el) { if (view3d) view3d.resume(); else GT.screens.station.mount(el); },
    unmount: function () { if (view3d) { view3d.destroy(); view3d = null; } }
  };
})(window.GT = window.GT || {});
