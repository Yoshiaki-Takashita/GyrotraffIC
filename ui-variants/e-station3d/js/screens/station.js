// 駅の立体図：大きな駅の階・ホーム・改札・通路・階段／エスカレーター／エレベーターを光る枠線で描き、
// 乗るホームの号車・ドアから乗換先までの最短の道を光る線でたどる。いちばん早いドアも提案する。
// データは架空の見本（data/sample-station.json）と、新宿駅の下書き（data/shinjuku/shinjuku-station.json → data/shinjuku-view.js で変換）。
// 秒数が不明の区間は「不明」、つながらない時は「経路不明」、推測の接続を通る時はその区間の数を出す。
(function (GT) {
  "use strict";
  var t = GT.t, ic = GT.icon, esc = GT.u.esc;
  var SAMPLE = window.GT_STATION, SJ = null, S = SAMPLE;
  var KINDS = ["toilet", "stairs", "escalator", "elevator", "exit", "gate", "platform"];
  var sj = { from: null, to: null, hidden: {}, focus: null, loading: false, failed: false };
  var which = "sample";
  try { if (localStorage.getItem("gyrotraffic.station") === "shinjuku") which = "shinjuku"; } catch (e) {}
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

  // ── 新宿（下書き）
  function loadShinjuku(done) {
    if (SJ) return done(true);
    if (window.GT_SHINJUKU_RAW) { SJ = GT.shinjukuView.convert(window.GT_SHINJUKU_RAW); return done(true); }
    var sc = document.createElement("script");
    sc.src = "data/shinjuku-station.js";
    sc.onload = function () { try { SJ = GT.shinjukuView.convert(window.GT_SHINJUKU_RAW); done(true); } catch (e) { done(false); } };
    sc.onerror = function () { done(false); };
    document.head.appendChild(sc);
  }
  function sjNode(id) { return SJ.nodes.find(function (x) { return x.id === id; }); }
  function kindLabel(k) { return k === "stairs" || k === "escalator" || k === "elevator" ? t("st.kind." + k) : k === "walk" ? t("sj.walkNode") : t("sj.kind." + k) === "sj.kind." + k ? k : t("sj.kind." + k); }
  function sjName(id) {
    var p = G().platformOf(SJ, id);
    if (p) return (p.label || t("sj.noName") + " " + t("sj.kind.platform")) + "（" + p.level + "）";
    var n = sjNode(id); if (!n) return id;
    return (n.name || kindLabel(n.kind)) + "（" + n.level + "）";
  }
  function sjDefaults() {
    if (sj.from) return;
    var p = SJ.platforms.find(function (x) { return /^14\s/.test(x.label || ""); }) || SJ.platforms[0];
    sj.from = p.id;
    var ex = SJ.nodes.find(function (n) { return n.kind === "exit" && n.ground && n.name === "出口 21"; }) || SJ.nodes.find(function (n) { return n.kind === "exit" && n.ground; });
    sj.to = ex ? ex.id : SJ.targets[0];
  }
  function sjOptions(sel) {
    var groups = [
      [t("sj.kind.platform"), SJ.platforms.map(function (p) { return p.id; })],
      [t("sj.kind.gate"), SJ.nodes.filter(function (n) { return n.kind === "gate"; }).map(function (n) { return n.id; })],
      [t("sj.kind.exitGround"), SJ.nodes.filter(function (n) { return n.kind === "exit" && n.ground; }).map(function (n) { return n.id; })]
    ];
    return groups.map(function (g) {
      return '<optgroup label="' + esc(g[0]) + '">' + g[1].map(function (id) { return opt(id, sjName(id), id === sel); }).join("") + "</optgroup>";
    }).join("");
  }
  function sjControls() {
    return '<div class="st-pick">' +
      '<label class="field st-f">' + ic("origin", "od-ic") + '<span class="sr-only">' + t("sj.from") + '</span><select id="sjFrom">' + sjOptions(sj.from) + "</select></label>" +
      '<p class="fine sj-cd">' + ic("car") + ic("door") + " " + esc(t("sj.carDoor")) + "</p>" +
      '<label class="field st-f">' + ic("target", "od-ic") + '<span class="sr-only">' + t("sj.to") + '</span><select id="sjTo">' + sjOptions(sj.to) + "</select></label>" +
      "</div>";
  }
  function sjFrom(id) { return G().platformOf(SJ, id) ? { platform: id } : { node: id }; }
  function sjCompute() {
    var o = { stepFree: state.stepFree };
    var r = G().route(SJ, sjFrom(sj.from), sj.to, o);
    var strict = r.ok && r.guessed ? G().route(SJ, sjFrom(sj.from), sj.to, Object.assign({ noGuess: true }, o)) : null;
    return { r: r, strict: strict };
  }
  function sjSteps(r) {
    if (!r.ok || r.same) return "";
    var rows = [];
    r.steps.forEach(function (s) {
      var prev = rows[rows.length - 1];
      if (prev && s.kind === prev.kind && !s.guess && !prev.guess && s.kind !== "platform") { prev.sec = prev.sec == null || s.sec == null ? null : prev.sec + s.sec; prev.b = s.b; return; }
      rows.push({ kind: s.kind, a: s.a, b: s.b, sec: s.sec, guess: s.guess, unknownDoor: s.unknownDoor });
    });
    return '<ol class="st-steps" aria-label="' + t("st.steps") + '">' + rows.map(function (s) {
      var icn = s.kind === "walk" ? "walk" : s.kind === "platform" ? "platform" : s.kind === "vertical" || s.kind === "ramp" || s.kind === "step" ? "layers" : s.kind;
      var what = s.unknownDoor ? esc(t("sj.platStart")) + " → " + esc(sjName(s.b)) : esc(sjName(s.b));
      var sec = s.unknownDoor ? '<span class="st-unk">' + ic("confUnknown") + t("st.unknown") + "</span>" : s.sec == null ? '<span class="st-unk">' + ic("confUnknown") + t("st.unknown") + "</span>" : fmt(s.sec);
      var g = s.guess ? '<span class="sj-guess">' + ic("confInferred", "", t("sj.guessStep")) + "</span>" : "";
      return '<li class="st-step k-' + esc(s.kind) + (s.guess ? " is-guess" : "") + '">' + ic(icn, "", t("st.kind." + s.kind)) + '<span class="st-what">' + g + what + '</span><span class="st-sec">' + sec + "</span></li>";
    }).join("") + "</ol>";
  }
  function sjOut(c) {
    var r = c.r, v = SJ._view, R = v.reach;
    var big = !r.ok ? t("sj.noRoute") : r.same ? t("st.same") : fmt(r.sec) + (r.unknown ? t("st.unknownPart", { n: r.unknown }) : "");
    var notes = "";
    if (!r.ok) notes += '<p class="note sj-noroute">' + ic("confUnknown") + esc(t("sj.noRouteWhy")) + "</p>";
    if (r.ok && r.guessed) notes += '<p class="note sj-guessnote">' + ic("confInferred") + esc(t("sj.guessed", { n: r.guessed })) + (c.strict && !c.strict.ok ? " · " + esc(t("sj.strictNone")) : "") + "</p>";
    var counts = KINDS.map(function (k) { return '<span class="sj-count">' + ic(k === "exit" ? "exit" : k, "", t(k === "stairs" || k === "escalator" || k === "elevator" ? "st.kind." + k : "sj.kind." + k)) + v.counts[k] + "</span>"; }).join("");
    return '<div class="st-read"><span class="lbl">' + t("sj.total") + '</span><div class="st-big' + (!r.ok || r.unknown ? " has-unk" : "") + '" id="sjBig">' + esc(big) + "</div></div>" +
      notes + sjSteps(r) +
      '<p class="note">' + ic("info") + esc(t("sj.draft")) + "</p>" +
      '<p class="fine">' + esc(t("sj.timeNote")) + "</p>" +
      '<p class="fine sj-counts" aria-label="' + t("sj.counts") + '">' + counts + "</p>" +
      '<p class="fine" id="sjNet">' + esc(t("sj.net", { n: v.components.before.length, m: v.components.after.length, p: R.strict.platforms, pt: R.strict.platformsTotal, pg: R.withGuess.platforms, e: R.withGuess.groundExits, et: R.withGuess.groundExitsTotal, g: R.withGuess.gates, gt: R.withGuess.gatesTotal })) + "</p>" +
      '<p class="fine">' + ic("confUnknown") + " " + esc(t("sj.unknowns")) + "：" + esc(SJ.unknown.join("・")) + "</p>" +
      '<p class="fine">' + esc(SJ.sources.tmg.text) + "（" + esc(SJ.sources.tmg.license) + "）／" + esc(SJ.sources.mlit.text) + "</p>";
  }
  function sjUpdate(el, animate) {
    var c = sjCompute();
    el.querySelector("#stOut").innerHTML = sjOut(c);
    if (view3d) view3d.setRoute(c.r);
    if (animate && GT.vfx) GT.vfx.enter(Array.prototype.slice.call(el.querySelectorAll(".st-step")), { gap: 25 });
    GT.station.last = c;
  }
  function sjBar() {
    return '<div class="sj-bar" role="group" aria-label="' + t("sj.kinds") + '">' + KINDS.map(function (k) {
      var lab = k === "stairs" || k === "escalator" || k === "elevator" ? t("st.kind." + k) : t("sj.kind." + k);
      return '<button type="button" class="iconbtn st-tool sj-kind" data-kind="' + k + '" aria-pressed="' + !sj.hidden[k] + '" aria-label="' + esc(lab) + '">' + ic(k) + "</button>";
    }).join("") + "</div>" +
      '<div class="sj-levels" role="group" aria-label="' + t("sj.levels") + '">' +
      '<button type="button" class="sj-lv" data-lv="" aria-pressed="' + !sj.focus + '" aria-label="' + t("sj.allLevels") + '">' + ic("layers") + "</button>" +
      SJ.levels.slice().reverse().map(function (l) { return '<button type="button" class="sj-lv" data-lv="' + esc(l.id) + '" aria-pressed="' + (sj.focus === l.id) + '">' + esc(l.name) + "</button>"; }).join("") +
      "</div>";
  }
  function stationPick() {
    return '<label class="field st-f sj-which">' + ic("cube", "od-ic") + '<span class="sr-only">' + t("sj.station") + '</span><select id="stWhich">' +
      opt("sample", t("sj.sample"), which === "sample") + opt("shinjuku", t("sj.shinjuku"), which === "shinjuku") + "</select></label>";
  }

  GT.screens.station = {
    title: function () { return t("st.title"); },
    render: function () {
      var isSj = which === "shinjuku" && SJ;
      S = isSj ? SJ : SAMPLE;
      if (isSj) sjDefaults();   // 選択欄の初期値に使うので、描く前に決める
      return stationPick() + '<div class="st-stage">' +
        '<canvas id="stc" class="st-canvas" tabindex="0" role="img" aria-label="' + t("st.canvas") + '"></canvas>' +
        '<div class="st-tools">' +
          '<button type="button" class="iconbtn st-tool" id="stReset" aria-label="' + t("st.reset") + '">' + ic("reset") + "</button>" +
          '<button type="button" class="iconbtn st-tool" id="stSpread" aria-pressed="' + state.spread + '" aria-label="' + t("st.levels") + '">' + ic("layers") + "</button>" +
          '<button type="button" class="iconbtn st-tool" id="stStep" aria-pressed="' + state.stepFree + '" aria-label="' + t("st.stepFree") + '">' + ic("stepFree") + "</button>" +
        "</div>" +
        '<span class="st-name">' + esc(S.name) + "</span>" +
        (which === "shinjuku" && !SJ ? '<p class="sj-loading" id="sjLoading">' + esc(t(sj.failed ? "sj.loadFail" : "sj.loading")) + "</p>" : "") +
        "</div>" +
        (isSj ? sjBar() + sjControls() : which === "shinjuku" ? "" : controls()) +
        '<div id="stOut" class="st-out" aria-live="polite"></div>';
    },
    mount: function (el) {
      var self = GT.screens.station;
      function remount() { el.innerHTML = self.render(); self.mount(el); }
      el.querySelector("#stWhich").onchange = function (e) {
        which = e.target.value;
        try { localStorage.setItem("gyrotraffic.station", which); } catch (er) {}
        if (view3d) { view3d.destroy(); view3d = null; }
        remount();
      };
      if (which === "shinjuku" && !SJ) {
        if (!sj.loading) {
          sj.loading = true;
          loadShinjuku(function (ok) { sj.loading = false; sj.failed = !ok; if (el.isConnected && which === "shinjuku") remount(); });
        }
        return;
      }
      var cv = el.querySelector("#stc");
      if (view3d) view3d.destroy();
      view3d = GT.station3d.create(cv, S);
      if (state.spread) view3d.setSpread(true);
      if (S === SJ) {
        sjDefaults();
        KINDS.forEach(function (k) { if (sj.hidden[k]) view3d.setHidden(k, true); });
        if (sj.focus) view3d.setFocus(sj.focus);
        Array.prototype.forEach.call(el.querySelectorAll(".sj-kind"), function (b) {
          b.onclick = function () { var k = b.dataset.kind; sj.hidden[k] = !sj.hidden[k]; b.setAttribute("aria-pressed", String(!sj.hidden[k])); view3d.setHidden(k, sj.hidden[k]); };
        });
        Array.prototype.forEach.call(el.querySelectorAll(".sj-lv"), function (b) {
          b.onclick = function () {
            sj.focus = b.dataset.lv || null; view3d.setFocus(sj.focus);
            Array.prototype.forEach.call(el.querySelectorAll(".sj-lv"), function (x) { x.setAttribute("aria-pressed", String((x.dataset.lv || null) === sj.focus)); });
          };
        });
        el.querySelector("#sjFrom").onchange = function (e) { sj.from = e.target.value; sjUpdate(el, true); };
        el.querySelector("#sjTo").onchange = function (e) { sj.to = e.target.value; sjUpdate(el, true); };
        el.querySelector("#stReset").onclick = function () { view3d.reset(); };
        el.querySelector("#stSpread").onclick = function (e) { state.spread = !state.spread; e.currentTarget.setAttribute("aria-pressed", state.spread); view3d.setSpread(state.spread); };
        el.querySelector("#stStep").onclick = function (e) { state.stepFree = !state.stepFree; e.currentTarget.setAttribute("aria-pressed", state.stepFree); sjUpdate(el, true); };
        GT.station = { view: view3d, state: state, sj: sj, data: SJ, which: which, compute: sjCompute };
        sjUpdate(el, false);
        return;
      }
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
      GT.station = { view: view3d, state: state, compute: compute, which: which };
    },
    resume: function (el) { if (view3d) view3d.resume(); else GT.screens.station.mount(el); },
    unmount: function () { if (view3d) { view3d.destroy(); view3d = null; } }
  };
})(window.GT = window.GT || {});
