// 結果：最速・乗換最少・安値のセグメント。行の位置は動かさず、中身の数字が桁ごとに流れて入れ替わる（見せ場 3）。
(function (GT) {
  "use strict";
  var t = GT.t, ic = GT.icon, esc = GT.u.esc, u = GT.u, fx = GT.fx;
  var tab = "fastest";
  var TAB_IC = { fastest: "bolt", fewest: "swap", cheapest: "yen" };
  function sortFor(js, k) {
    var a = js.map(function (j, i) { return { j: j, i: i }; });
    var byArr = function (x, y) { return x.j.arrival - y.j.arrival || x.j.transfers - y.j.transfers; };
    if (k === "fastest") a.sort(function (x, y) { return (x.j.arrival - x.j.departure) - (y.j.arrival - y.j.departure) || byArr(x, y); });
    if (k === "fewest") a.sort(function (x, y) { return x.j.transfers - y.j.transfers || byArr(x, y); });
    if (k === "cheapest") a.sort(function (x, y) {
      var fx_ = x.j.fare ? x.j.fare.amount : Infinity, fy = y.j.fare ? y.j.fare.amount : Infinity;
      return fx_ - fy || byArr(x, y);
    });
    return a;
  }
  function modes(j) {
    var ms = j.legs.filter(function (l) { return l.type === "transit"; }).map(function (l) { return ic(l.mode, "", t("mode." + l.mode)); });
    return '<span class="modes">' + ms.join(ic("chev", "ar")) + "</span>";
  }
  function bar(j) {
    var span = Math.max(1, j.arrival - j.departure);
    return j.legs.filter(function (l) { return !(l.type === "walk" && l.source === "change"); }).map(function (l) {
      var d = l.type === "walk" ? l.duration : l.arrival - l.departure;
      return '<i class="' + (l.type === "walk" ? "walk" : l.mode) + '" style="flex:' + Math.max(0.02, d / span).toFixed(3) + '"></i>';
    }).join("");
  }
  function fareHtml(j) {
    var f = u.fare(j.fare);
    return '<span class="fare ' + (j.fare ? "" : "unknown") + '">' + ic(j.fare ? "yen" : "confUnknown") + esc(f.text) + "</span>";
  }
  function meta(j, n) {
    return (n === 0 ? '<span class="best">' + ic(TAB_IC[tab]) + t("results." + tab) + '</span><span class="sepdot" aria-hidden="true"></span>' : "") +
      modes(j) + '<span class="sepdot" aria-hidden="true"></span><span>' + (j.transfers ? t("results.transfers", { n: j.transfers }) : t("results.noTransfer")) + '</span><span class="sepdot" aria-hidden="true"></span>' + fareHtml(j);
  }
  GT.screens.results = {
    title: function () { return t("results.title"); },
    render: function (p) {
      return '<p class="route-head">' + ic("origin") + "<b>" + esc(GT.short(GT.placeName(p.from))) + "</b>" + ic("arrowR") + "<b>" + esc(GT.short(GT.placeName(p.to))) + "</b></p>" +
        '<div class="seg results-seg" id="sortSeg" role="radiogroup" aria-label="' + t("results.tabs") + '">' +
        ["fastest", "fewest", "cheapest"].map(function (k) { return '<label class="seg-i"><input type="radio" name="sort" value="' + k + '"' + (k === tab ? " checked" : "") + "><span>" + ic(TAB_IC[k]) + t("results." + k) + "</span></label>"; }).join("") +
        '</div><div id="rl" aria-live="polite"></div>';
    },
    mount: function (el, p) {
      var rl = el.querySelector("#rl");
      GT.fx.seg(el.querySelector("#sortSeg"));
      GT.data.route({ from: p.from, to: p.to, mode: p.mode || "now", time: p.time }).then(function (res) {
        if (!res.journeys.length) { rl.innerHTML = '<div class="emptybox">' + ic("search") + "<b>" + t("results.empty") + "</b><p>" + t("results.emptyHint") + "</p></div>"; return; }
        function href(x) { return "#/detail?" + u.qs({ from: p.from, to: p.to, i: x.i }); }
        function build() {
          var list = sortFor(res.journeys, tab);
          rl.innerHTML = '<p class="note" id="cheapNote" style="padding:0 var(--s4) var(--s3)"' + (tab === "cheapest" ? "" : " hidden") + ">" + ic("info") + "<span>" + t("results.cheapNote") + "</span></p>" +
            '<ol class="g-body" id="jl">' + list.map(function (x, n) {
              var j = x.j;
              return '<li><a class="cell jrow" href="' + href(x) + '">' +
                '<span class="jt"><time class="r-dep">' + fx.rollHtml(u.hhmm(j.departureIso)) + '</time><span class="dash" aria-hidden="true">–</span><span class="sr-only">→</span><time class="r-arr">' + fx.rollHtml(u.hhmm(j.arrivalIso)) + "</time></span>" +
                '<span class="jd r-dur">' + fx.rollHtml(u.dur(j.arrival - j.departure)) + "</span>" +
                ic("chev", "chev") +
                '<span class="bar" aria-hidden="true">' + bar(j) + "</span>" +
                '<span class="jm">' + meta(j, n) + "</span></a></li>";
            }).join("") + "</ol>" +
            '<p class="g-foot">' + t("results.searchMs", { n: res.searchMs }) + " · " + t("home.sampleNote") + "</p>";
        }
        function update() {
          var list = sortFor(res.journeys, tab);
          el.querySelector("#cheapNote").hidden = tab !== "cheapest";
          el.querySelectorAll("#jl > li").forEach(function (li, n) {
            var x = list[n], j = x.j, a = li.querySelector("a");
            a.href = href(x);
            fx.roll(li.querySelector(".r-dep .roll"), u.hhmm(j.departureIso));
            fx.roll(li.querySelector(".r-arr .roll"), u.hhmm(j.arrivalIso));
            fx.roll(li.querySelector(".r-dur .roll"), u.dur(j.arrival - j.departure));
            li.querySelector(".bar").innerHTML = bar(j);
            li.querySelector(".jm").innerHTML = meta(j, n);
          });
        }
        build();
        el.querySelector("#sortSeg").addEventListener("change", function (e) { tab = e.target.value; update(); });
        rl.addEventListener("click", function (e) {
          var a = e.target.closest("a.jrow"); if (!a) return;
          var jt = a.querySelector(".jt"), r = jt.getBoundingClientRect();
          GT._flip = { rect: r, html: jt.innerHTML, font: getComputedStyle(jt).font };
        });
      });
    }
  };
})(window.GT = window.GT || {});
