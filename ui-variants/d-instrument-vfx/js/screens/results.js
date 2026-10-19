// 結果一覧：最速・乗換最少・安値のタブ。各案の所要時間・時刻・乗換回数・手段のアイコン列・運賃。
(function (GT) {
  "use strict";
  var t = GT.t, ic = GT.icon, esc = GT.u.esc, u = GT.u;
  var tab = "fastest";
  function sortFor(js, k) {
    var a = js.map(function (j, i) { return { j: j, i: i }; });
    var byArr = function (x, y) { return x.j.arrival - y.j.arrival || x.j.transfers - y.j.transfers; };
    if (k === "fastest") a.sort(function (x, y) { return (x.j.arrival - x.j.departure) - (y.j.arrival - y.j.departure) || byArr(x, y); });
    if (k === "fewest") a.sort(function (x, y) { return x.j.transfers - y.j.transfers || byArr(x, y); });
    if (k === "cheapest") a.sort(function (x, y) {
      var fx = x.j.fare ? x.j.fare.amount : Infinity, fy = y.j.fare ? y.j.fare.amount : Infinity;
      return fx - fy || byArr(x, y);
    });
    return a;
  }
  function modeStrip(j) {
    var parts = [];
    j.legs.forEach(function (l) {
      if (l.type === "walk" && l.source === "change") return;
      var m = u.modeOfLeg(l);
      parts.push('<span class="ms ms-' + m + '">' + ic(m, "", t("mode." + m)) + (l.type === "transit" ? '<span class="ms-t">' + esc(shortRoute(l.routeName)) + "</span>" : '<span class="ms-t">' + Math.max(1, Math.round(l.duration / 60)) + "</span>") + "</span>");
    });
    return parts.join('<span class="ms-sep" aria-hidden="true"></span>');
  }
  function shortRoute(n) { return String(n || "").replace(/（架空）/g, ""); }
  GT.shortRoute = shortRoute;
  GT.screens.results = {
    title: function () { return t("results.title"); },
    render: function (p) {
      return '<div class="od-sum"><span>' + ic("origin") + esc(GT.placeName(p.from)) + '</span><span class="arrow" aria-hidden="true">→</span><span>' + ic("pin") + esc(GT.placeName(p.to)) + "</span></div>" +
        '<div class="panel">' + GT.inst.gyro() + '<div class="readout" aria-live="polite"><span class="lbl">' + t("inst.best") + '</span><div class="readout-v" id="ro">--</div><div class="readout-s" id="ros">' + t("inst.searching") + "</div></div></div>" +
        '<div class="tabs3" role="tablist" aria-label="' + t("results.tabs") + '">' +
        ["fastest", "fewest", "cheapest"].map(function (k) { var on = k === tab; return '<button type="button" role="tab" class="t3' + (on ? " on" : "") + '" aria-selected="' + on + '" data-k="' + k + '">' + ic(k === "fastest" ? "clock" : k === "fewest" ? "swap" : "yen") + "<span>" + t("results." + k) + "</span></button>"; }).join("") +
        '</div><div id="rl" role="tabpanel" aria-live="polite"></div>';
    },
    mount: function (el, p) {
      var rl = el.querySelector("#rl"), panel = el.querySelector(".panel");
      var t0 = performance.now(), qkey = p.from + ">" + p.to + ">" + (p.mode || "") + (p.time || "");
      var again = GT._lastResKey === qkey && (GT._navKind === "back" || GT._navKind === "dismiss");   // 詳細から戻った：探し直さず、すぐ出す
      GT.data.route({ from: p.from, to: p.to, mode: p.mode || "now", time: p.time }).then(function (res) {
        // 姿勢計が「探している」ことを読み取れる最小の時間（動きを減らす設定では待たない）
        var wait = GT.inst.reduced() || again ? 0 : Math.max(0, 560 - (performance.now() - t0));
        return new Promise(function (ok) { setTimeout(function () { ok(res); }, wait); });
      }).then(function (res) {
        GT._lastResKey = qkey;
        var g = panel.querySelector(".gyro"), ro = panel.querySelector("#ro"), ros = panel.querySelector("#ros");
        if (again) g.classList.remove("spin"); else GT.inst.settleGyro(g);
        if (res.journeys.length) {
          var best = sortFor(res.journeys, "fastest")[0].j;
          ro.innerHTML = GT.inst.odo(GT.inst.durParts(best.arrival - best.departure), u.dur(best.arrival - best.departure));
          ros.textContent = u.hhmm(best.departureIso) + " → " + u.hhmm(best.arrivalIso);
          GT.inst.rollOdo(ro, again);
        } else { ro.textContent = "--"; ros.textContent = t("results.empty"); }
        function draw(how) {
          if (!res.journeys.length) { rl.innerHTML = '<div class="emptybox">' + ic("info") + "<p><b>" + t("results.empty") + "</b></p><p>" + t("results.emptyHint") + "</p></div>"; GT.M.tremor(rl.firstChild, { amp: 3, freq: 11, decay: 0.07, dir: "x", dur: 300 }); return; }
          var list = sortFor(res.journeys, tab);
          rl.innerHTML = (tab === "cheapest" ? '<p class="note">' + ic("info") + t("results.cheapNote") + "</p>" : "") +
            '<ol class="cards">' + list.map(function (x, n) {
              var j = x.j, f = u.fare(j.fare);
              return '<li><a class="jr" href="#/detail?' + u.qs({ from: p.from, to: p.to, i: x.i }) + '">' +
                '<div class="jr-top"><span class="jr-dur">' + GT.inst.durHtml(j.arrival - j.departure) + '</span>' + (n === 0 ? '<span class="badge">' + ic(tab === "fastest" ? "clock" : tab === "fewest" ? "swap" : "yen") + t("results." + tab) + "</span>" : "") + "</div>" +
                '<div class="jr-time"><time>' + u.hhmm(j.departureIso) + '</time><span class="arrow" aria-hidden="true">→</span><span class="sr-only">→</span><time>' + u.hhmm(j.arrivalIso) + "</time></div>" +
                GT.inst.ribbon(j, false) +
                '<div class="jr-modes">' + modeStrip(j) + "</div>" +
                '<div class="jr-meta"><span class="meta">' + ic("swap") + (j.transfers ? t("results.transfers", { n: j.transfers }) : t("results.noTransfer")) + '</span><span class="meta ' + f.cls + '">' + ic(f.icon) + f.text + "</span></div>" +
                "</a></li>";
            }).join("") + "</ol>" + '<p class="fine">' + t("results.searchMs", { n: res.searchMs }) + " · " + t("vfx.dragHint") + "</p>";
          var cards = rl.querySelectorAll(".jr");
          cards.forEach(function (a) {
            var i = Number(GT.u.parseQs(a.getAttribute("href").split("?")[1]).i), j = res.journeys[i];
            // 結果→詳細：選んだ案のリボンの場所を覚える（詳細のリボンへ移る）
            a.addEventListener("click", function () { GT._shared = { el: a.querySelector(".rib"), rect: a.querySelector(".rib").getBoundingClientRect(), at: GT.M.now(), i: i }; });
            GT.vfx.carryToTab(a, { onDrop: function () {
              var key = u.journeyKey(res.id, j);
              if (GT.store.favRoutes.has(key)) { GT.toast(t("vfx.already")); return false; }
              GT.store.favRoutes.toggle({ key: key, from: p.from, to: p.to, i: i, dep: j.departureIso, arr: j.arrivalIso, transfers: j.transfers, modes: j.legs.filter(function (l) { return l.type === "transit"; }).map(function (l) { return l.mode; }) });
              GT.toast(t("vfx.savedTo")); return true;
            } });
          });
          // 詳細から戻った：詳細のリボンから、この案のリボンへ（共有要素の逆向き）
          var back = GT._sharedBack && GT.M.now() - GT._sharedBack.at < 1200 ? GT._sharedBack : null;
          GT._sharedBack = null;
          var items = Array.prototype.slice.call(rl.querySelectorAll(".cards > li"));
          if (back) {
            items.forEach(function (li) { var a = li.querySelector(".jr"); if (a.getAttribute("href").indexOf("i=" + back.i) >= 0) GT.M.flipFrom(a.querySelector(".rib"), back.rect, { spring: "page", scaleY: false }); });
          } else if (how !== "sort") GT.vfx.enter(items, { gap: 45 });
        }
        draw();
        var tseg = GT.vfx.segment(el.querySelector(".tabs3"), ".t3", function (b) { return b.classList.contains("on"); });
        el.querySelectorAll(".t3").forEach(function (b) {
          b.onclick = function () {
            if (tab === b.dataset.k) return;
            tab = b.dataset.k;
            el.querySelectorAll(".t3").forEach(function (o) { var on = o === b; o.classList.toggle("on", on); o.setAttribute("aria-selected", on); });
            tseg(true);
            // 並び替え：同じ案は FLIP で新しい位置へ（行がばねで入れ替わる）
            var old = {};
            rl.querySelectorAll(".jr").forEach(function (a) { old[a.getAttribute("href")] = a.getBoundingClientRect(); });
            draw("sort");
            var k = 0;
            rl.querySelectorAll(".jr").forEach(function (a) { var f = old[a.getAttribute("href")]; if (f && k++ < GT.M.q.maxLive()) GT.M.flipFrom(a, f, { scale: false, spring: { k: 340, zeta: 0.8 } }); });
          };
        });
      });
    }
  };
})(window.GT = window.GT || {});
