// 触って気持ちいい動き（案 D「計器」VFX）。GT.M（motion.js）の上に作る。
// 押す・拒否の震え・長押し・入れ替え・並べ替え・タブへ運ぶ・払って閉じる・選択の点灯・タブの指示線・視差。
(function (GT) {
  "use strict";
  var M = GT.M, V = GT.vfx = {};

  /* ---------- 押す：全ボタン共通 ----------
     押している間：わずかに沈む（臨界減衰で速く・行き過ぎなし）。離した瞬間：弱減衰のばねで戻り、小さく行き過ぎる。 */
  var PRESS = "button, .primary, .secondary, .danger, .iconbtn, .chip, .t3, .tab, .jr, a.row, .seg-i";
  function depth(el) { return el.matches(".jr, a.row") ? 0.985 : el.matches(".primary, .secondary, .danger") ? 0.965 : el.matches(".tab") ? 0.9 : 0.93; }
  var pressed = null;
  document.addEventListener("pointerdown", function (e) {
    if (e.button > 0) return;
    var el = e.target.closest && e.target.closest(PRESS);
    if (!el || el.disabled || el.closest(".ghost")) return;
    pressed = el;
    var tgt = el.matches(".seg-i") ? el.querySelector("span") : el.matches(".tab") ? el.querySelector(".ic") : el;
    el.__pt = tgt;
    if (M.reduced()) { el.classList.add("is-down"); return; }
    M.el(tgt).to({ s: depth(el) }, M.SPRING.press);
    if (el.matches(".primary") && !el.disabled) V.burst(el, e);
  }, true);
  function release(e) {
    var el = pressed; if (!el) return;
    pressed = null;
    el.classList.remove("is-down");
    if (M.reduced() || !el.__pt) return;
    var mv = M.el(el.__pt);
    // 沈んだ量に応じて上向きの初速を与える＝小さな行き過ぎ
    mv.to({ s: 1 }, M.SPRING.release, { s: (1 - mv.cur.s) * 14 });
    // 戻った後の小さな減衰振動（主操作と大きなボタンだけ・縦に 1px 未満）
    if (el.matches(".primary, .secondary, .danger, .iconbtn")) M.after(60, function () { M.tremor(el.__pt, { amp: 0.9, freq: 15, decay: 0.05, dir: "y", dur: 220 }); });
  }
  document.addEventListener("pointerup", release, true);
  document.addEventListener("pointercancel", release, true);

  /** 主操作：押した点から光が広がり、計器のランプが点く */
  V.burst = function (btn, e) {
    var r = btn.getBoundingClientRect();
    var b = document.createElement("i");
    b.className = "burst"; b.setAttribute("aria-hidden", "true");
    var x = (e && e.clientX ? e.clientX : r.left + r.width / 2) - r.left, y = (e && e.clientY ? e.clientY : r.top + r.height / 2) - r.top;
    var R = Math.hypot(Math.max(x, r.width - x), Math.max(y, r.height - y));
    b.style.left = x + "px"; b.style.top = y + "px";
    btn.appendChild(b);
    var mb = M.el(b);
    mb.set({ s: 0.02, o: 0.55 });
    var sc = R / 10;   // .burst は直径 20px
    M.tween({ dur: 420, ease: "outQuint", onUpdate: function (p) { mb.set({ s: 0.02 + p * sc, o: 0.55 * (1 - p) }); }, onDone: function () { b.remove(); } });
    var lamp = btn.querySelector(".lamp");
    if (lamp) { lamp.classList.add("on"); var ml = M.el(lamp); ml.set({ s: 1.9 }); ml.to({ s: 1 }, { k: 380, zeta: 0.45 }); }
    M.haptic("tap");
  };

  /* ---------- 拒否：減衰する横の震え（約 280ms）＋短い振動。動きを減らす設定では、枠の色と文言の即時切り替え ---------- */
  V.reject = function (el, msgEl) {
    M.haptic("reject");
    el.classList.add("bad");
    if (el.__badT) M.cancel(el.__badT);
    el.__badT = M.after(1600, function () { el.classList.remove("bad"); el.__badT = null; });
    if (msgEl) { var mm = M.el(msgEl); mm.set({ o: 0, y: -4 }); mm.to({ o: 1, y: 0 }, "snappy"); }
    if (M.reduced()) return;
    M.shake(el, { amp: 10, dur: 340 });
  };

  /* ---------- 長押し：輪が満ちて、満ちた瞬間に確定の衝撃 ---------- */
  V.longPress = function (btn, o) {
    var HOLD = o.ms || 560;
    var ring = document.createElement("canvas");
    var S = 40, dpr = Math.min(2, window.devicePixelRatio || 1);
    ring.className = "hold-ring"; ring.width = S * dpr; ring.height = S * dpr; ring.setAttribute("aria-hidden", "true");
    var icon = btn.querySelector(".ic");
    var host = document.createElement("span"); host.className = "hold-host";
    btn.insertBefore(host, btn.firstChild);
    if (icon) host.appendChild(icon);
    host.appendChild(ring);
    var ctx = ring.getContext("2d"); ctx.scale(dpr, dpr);
    var prog = 0, sp = null, fired = false, st = null, trem = null;
    function draw(p) {
      ctx.clearRect(0, 0, S, S);
      if (p <= 0.001) return;
      var col = getComputedStyle(btn).getPropertyValue("--accent").trim() || "#5fd6c3";
      ctx.lineWidth = 2; ctx.lineCap = "round";
      ctx.strokeStyle = col; ctx.globalAlpha = 0.22;
      ctx.beginPath(); ctx.arc(S / 2, S / 2, 15, 0, 6.283); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(S / 2, S / 2, 15, -Math.PI / 2, -Math.PI / 2 + Math.min(1, p) * 6.283); ctx.stroke();
    }
    function start(e) {
      if (e.button > 0) return;
      fired = false;
      st = M.now();
      if (sp) sp.stop();
      // 満ちる：時間に比例（予測できる速さ）。最初の 1 コマで必ず見える量を置く（応答の即時性）
      prog = Math.max(prog, 0.04); draw(prog);
      // 溜め：輪が満ちるほど震えが強まる（張りつめる）
      trem = M.tremor(btn, { amp: 0.2, freq: 13, dir: "xy", noise: 0.5, dur: HOLD + 600 });
      var base = prog;
      sp = M.tween({ dur: HOLD * (1 - prog), ease: "linear", always: true, onUpdate: function (p) { prog = base + (1 - base) * p; draw(prog); if (trem) trem.amp(0.2 + prog * prog * 1.8); }, onDone: function () { if (st != null) fire(); } });
      if (M.reduced()) { M.remove(sp); sp = null; st = M.now(); btn.__holdT = setTimeout(function () { if (st != null) fire(); }, HOLD); }
    }
    function fire() {
      fired = true; st = null; prog = 0; draw(0);
      if (trem) { trem.kill(); trem = null; }   // 震えは一気に消え、衝撃の拡がりに変わる
      M.haptic("confirm");
      o.onConfirm();
      if (M.reduced()) return;
      // 確定の衝撃：拡がる輪＋沈み込み
      var w = document.createElement("i"); w.className = "shock"; w.setAttribute("aria-hidden", "true");
      host.appendChild(w);
      var mw = M.el(w); mw.set({ s: 0.6, o: 0.9 });
      M.tween({ dur: 460, ease: "outCubic", onUpdate: function (p) { mw.set({ s: 0.6 + p * 1.9, o: 0.9 * (1 - p) }); }, onDone: function () { w.remove(); } });
      var mb = M.el(btn); mb.set({ s: 0.94 }); mb.to({ s: 1 }, M.SPRING.release, { s: 1.2 });
      if (icon) { var mi = M.el(icon); mi.set({ s: 1.5 }); mi.to({ s: 1 }, { k: 360, zeta: 0.4 }); }
    }
    function stop() {
      if (st == null) return;
      var held = M.now() - st; st = null;
      clearTimeout(btn.__holdT);
      if (sp) { M.remove(sp); sp = null; }
      if (trem) { trem.stop(); trem = null; }
      if (fired) return;
      // 途中で離した：輪はばねで戻る。短いタップなら、長押しの案内
      var from = prog;
      M.spring({ from: from, to: 0, spring: { k: 300, zeta: 1 }, restDelta: 0.002, onUpdate: function (x) { prog = x; draw(x); } });
      if (held < 220 && o.onTapHint) o.onTapHint();
    }
    btn.addEventListener("pointerdown", start);
    btn.addEventListener("pointerup", stop);
    btn.addEventListener("pointerleave", stop);
    btn.addEventListener("pointercancel", stop);
    btn.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    // キーボード（Enter・Space）は即時に確定（長押しは指の操作のためだけ）
    btn.addEventListener("click", function (e) { if (e.detail === 0) { fired = false; st = M.now(); fire(); } });
  };

  /* ---------- 入れ替え：2 つの欄の文字が弧を描いて入れ替わり、速度に応じて伸びる（中断できる） ---------- */
  V.swap = function (btn, a, b) {
    var state = null;   // { p: ばね, ga, gb }
    function textGhost(inp) {
      var r = inp.getBoundingClientRect(), cs = getComputedStyle(inp);
      var g = document.createElement("span");
      g.className = "swap-ghost"; g.setAttribute("aria-hidden", "true");
      g.textContent = inp.value || inp.placeholder;
      if (!inp.value) g.classList.add("ph");
      g.style.left = r.left + parseFloat(cs.paddingLeft) + "px";
      g.style.top = r.top + "px"; g.style.height = r.height + "px"; g.style.lineHeight = r.height + "px";
      g.style.fontSize = cs.fontSize;
      document.body.appendChild(g);
      return g;
    }
    btn.addEventListener("click", function () {
      var icon = btn.querySelector(".ic");
      if (M.reduced() || (!a.value && !b.value)) {
        var v = a.value; a.value = b.value; b.value = v;
        if (M.reduced()) { btn.classList.add("flash"); setTimeout(function () { btn.classList.remove("flash"); }, 300); }
        return;
      }
      M.haptic("tap");
      if (icon) { var mi = M.el(icon); mi.to({ r: (Math.round(mi.cur.r / 180) + 1) * 180 }, { k: 260, zeta: 0.62 }); }
      if (state) { state.target = state.target ? 0 : 1; state.sp.to(state.target); return; }   // 途中でもう一度：今の位置と速度から戻る
      var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(), dy = rb.top - ra.top;
      var ga = textGhost(a), gb = textGhost(b);
      a.classList.add("swapping"); b.classList.add("swapping");
      var ma = M.el(ga), mb = M.el(gb);
      state = { target: 1, ga: ga, gb: gb };
      state.sp = M.spring({ from: 0, to: 1, spring: { k: 230, zeta: 0.72 }, restDelta: 0.001,
        onUpdate: function (p, v) {
          var arc = Math.sin(Math.PI * Math.max(0, Math.min(1, p))) * 26;     // 弧：中ほどで横へふくらむ
          var st = Math.min(0.35, Math.abs(v) * dy / 1000 * 0.12);           // 速度に応じた伸び
          // 出発地の文字は手前を右へふくらみ、目的地の文字は奥（小さく・薄く）を通る＝すれ違いに奥行き
          var mid = Math.sin(Math.PI * Math.max(0, Math.min(1, p)));
          ma.set({ x: arc * 1.5, y: dy * p, sy: 1 + st, sx: 1 - st * 0.5, s: 1 + mid * 0.04 });
          mb.set({ x: arc * 0.35, y: -dy * p, sy: 1 + st, sx: 1 - st * 0.5, s: 1 - mid * 0.12, o: 1 - mid * 0.6 });
        },
        onRest: function () {
          if (state.target === 1) { var v = a.value; a.value = b.value; b.value = v; }
          a.classList.remove("swapping"); b.classList.remove("swapping");
          ga.remove(); gb.remove(); state = null;
        } });
    });
  };

  /* ---------- 選択の点灯（ラジオ相当）：指示の面がばねで移り、点が灯る ---------- */
  V.segment = function (group, itemSel, isOn) {
    var ind = document.createElement("i");
    ind.className = "seg-ind"; ind.setAttribute("aria-hidden", "true");
    group.classList.add("has-ind");
    group.insertBefore(ind, group.firstChild);
    var items = group.querySelectorAll(itemSel);
    function place(animate) {
      var on = null; items.forEach(function (it) { if (isOn(it)) on = it; });
      if (!on) { ind.style.opacity = 0; return; }
      var gr = group.getBoundingClientRect(), r = on.getBoundingClientRect();
      ind.style.width = r.width + "px"; ind.style.height = r.height + "px"; ind.style.top = (r.top - gr.top) + "px";
      var x = r.left - gr.left - group.clientLeft, mv = M.el(ind);
      if (!animate || !ind.__placed) { mv.set({ x: x }); ind.__placed = 1; return; }
      var dist = x - mv.cur.x;
      mv.to({ x: x }, { k: 360, zeta: 0.78 });
      // 移る間、進む向きにわずかに伸びる
      mv.set({ sx: 1 + Math.min(0.12, Math.abs(dist) / r.width * 0.08) }); mv.to({ sx: 1 }, { k: 260, zeta: 0.7 });
      var dot = on.querySelector(".dot");
      if (dot && !M.reduced()) { var md = M.el(dot); md.set({ s: 0.2, o: 0.3 }); md.to({ s: 1, o: 1 }, { k: 420, zeta: 0.45 }); }
      M.haptic("tick");
    }
    requestAnimationFrame(function () { place(false); });
    return place;
  };

  /* ---------- 下部のタブの指示線：前の位置と速度から、今のタブへ ---------- */
  V.tabIndicator = function (nav, fromX, fromV) {
    var ind = nav.querySelector(".tab-ind"), on = nav.querySelector(".tab.on");
    if (!ind || !on) return;
    var nr = nav.getBoundingClientRect(), r = on.getBoundingClientRect();
    var w = r.width * 0.32, x = r.left - nr.left + (r.width - w) / 2;
    ind.style.width = w + "px";
    var mv = M.el(ind);
    if (fromX == null || M.reduced()) { mv.set({ x: x }); return; }
    mv.set({ x: fromX });
    mv.to({ x: x }, { k: 340, zeta: 0.74 }, { x: fromV });
    var ic = on.querySelector(".ic");
    if (ic && fromX !== x) { var mi = M.el(ic); mi.set({ y: 3 }); mi.to({ y: 0 }, { k: 420, zeta: 0.5 }); }
  };

  /* ---------- 背景の計器の視差：画面の移りの向きと逆に、わずかにずれて戻る ---------- */
  V.parallax = function (dir) {
    var bg = document.querySelector(".bgi");
    if (!bg || M.reduced()) return;
    var mv = M.el(bg);
    mv.to({ x: 0 }, { k: 120, zeta: 1 }, { x: -dir * 380 });
  };

  /* ---------- 入る：奥行きの順に段差 ---------- */
  V.enter = function (els, o) {
    o = o || {};
    M.stagger(els, o.gap || 40, function (el, i, instant) {
      var mv = M.el(el);
      if (instant) { mv.clear(); return; }
      mv.set({ o: 0, y: o.y || 12 });
      mv.to({ o: 1, y: 0 }, o.spring || "page").then(function () { mv.clear(); });
    });
    if (!M.reduced()) els.forEach(function (el, i) { if (i < M.q.maxLive()) { el.style.opacity = 0; } });
  };

  /* ---------- 並べ替え：つかむと持ち上がり、ほかの行がばねで道を開け、離すと吸い込まれるように収まる ---------- */
  V.reorder = function (list, o) {
    var rows = function () { return Array.prototype.slice.call(list.children); };
    list.querySelectorAll(o.handle).forEach(function (h) {
      var row = h.closest("li");
      var from, slots, H, cur;
      M.drag(h, {
        threshold: 0, axis: null,
        onStart: function (s) {
          var rs = rows(); from = rs.indexOf(row); cur = from;
          slots = rs.map(function (r) { return r.getBoundingClientRect(); });
          H = slots[from].height;
          row.classList.add("lifted");
          list.classList.add("sorting");
          M.el(row).to({ s: 1.03 }, { k: 500, zeta: 0.7 });
          M.haptic("lift");
        },
        onMove: function (s, dx, dy) {
          var rs = rows(), n = rs.length;
          var top = slots[0].top - slots[from].top, bot = slots[n - 1].top - slots[from].top;
          var y = M.rubberClamp(dy, top, bot, 120);       // 端はゴムの抵抗
          M.el(row).set({ y: y });
          M.el(row).sp.y && (M.el(row).sp.y.v = 0);
          var mid = slots[from].top + y + H / 2, to = from;
          for (var i = 0; i < n; i++) if (mid > slots[i].top && mid < slots[i].bottom) to = i;
          if (to !== cur) { cur = to; M.haptic("tick"); }
          rs.forEach(function (r, i) {
            if (r === row) return;
            var shift = 0;
            if (from < cur && i > from && i <= cur) shift = -H;
            if (from > cur && i < from && i >= cur) shift = H;
            var mv = M.el(r);
            if (!mv.sp.y || mv.sp.y.target !== shift) mv.to({ y: shift }, { k: 420, zeta: 0.8 });
          });
        },
        onEnd: function (s) {
          var rs = rows(), mv = M.el(row);
          var target = slots[cur].top - slots[from].top;
          row.classList.remove("lifted"); row.classList.add("settling");
          M.haptic("drop");
          // 離した速度を引き継いで、行き過ぎ付きで収まる
          mv.to({ y: target, s: 1 }, { k: 380, zeta: 0.55 }, { y: s.v.y }).then(function () {
            list.classList.remove("sorting"); row.classList.remove("settling");
            rs.forEach(function (r) { M.el(r).clear(); });
            if (cur !== from) {
              var ref = rows().filter(function (r) { return r !== row; })[cur] || null;
              list.insertBefore(row, ref);
              o.onCommit(from, cur);
            }
          });
        },
        onCancel: function (s) { this.onEnd(s); }
      });
      // キーボード：上下の矢印で 1 行ずつ（FLIP で動かす）
      h.addEventListener("keydown", function (e) {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault();
        var rs = rows(), i = rs.indexOf(row), j = i + (e.key === "ArrowUp" ? -1 : 1);
        if (j < 0 || j >= rs.length) { V.reject(row); return; }
        M.flip(rs, function () { list.insertBefore(row, e.key === "ArrowUp" ? rs[j] : rs[j].nextSibling); }, { k: 420, zeta: 0.7 });
        o.onCommit(i, j);
        h.focus();
      });
    });
  };

  /* ---------- 結果の案を「保存」タブへ運ぶ ---------- */
  V.carryToTab = function (card, o) {
    var tab = function () { return document.querySelector('.tab[href="#/saved"]'); };
    var ghost, gm, first, tr, armed = false, prox = 0, gtrem = null, ttrem = null;
    M.drag(card, {
      hold: 300, mouseHold: 0, threshold: 8,
      onPress: function () { card.classList.add("pre-lift"); },
      onRelease: function () { card.classList.remove("pre-lift"); },
      onStart: function (s) {
        card.classList.remove("pre-lift");
        first = card.getBoundingClientRect();
        var app = document.getElementById("app").getBoundingClientRect();
        ghost = card.cloneNode(true);
        ghost.removeAttribute("href"); ghost.removeAttribute("id");
        ghost.className += " carry"; ghost.setAttribute("aria-hidden", "true");
        ghost.style.left = (first.left - app.left) + "px"; ghost.style.top = (first.top - app.top) + "px"; ghost.style.width = first.width + "px";
        document.getElementById("app").appendChild(ghost);
        gm = M.el(ghost);
        gm.set({ s: 1 });
        gm.to({ s: 1.04 }, { k: 500, zeta: 0.7 });
        card.classList.add("carried");
        gtrem = M.tremor(ghost, { amp: 0, freq: 14, dir: "xy", noise: 0.6, dur: 60000 });
        var t = tab(); t && t.classList.add("receptive");
        tr = t && t.getBoundingClientRect();
        M.haptic("lift");
      },
      onMove: function (s, dx, dy) {
        // 指に付いてくる（ばねで少し遅れ＝重さ）。動きの向きにわずかに傾く
        var v = s.tr.vel(), sp = Math.hypot(v.x, v.y);
        // 引きずる抵抗：速いほど細かく震える。保存タブの上では共鳴して強まる
        if (gtrem) gtrem.amp(armed ? 1.6 : Math.min(1.2, sp / 1400), { k: 260, zeta: 1 });
        gm.to({ x: dx, y: dy, r: Math.max(-6, Math.min(6, v.x / 220)) }, { k: 900, zeta: 0.9 });
        var t = tab(); if (!t) return;
        var cx = tr.left + tr.width / 2, cy = tr.top + tr.height / 2;
        var d = Math.hypot(s.x - cx, s.y - cy);
        var p = Math.max(0, Math.min(1, 1 - (d - 40) / 260));
        var isArmed = d < 70 || (s.y > tr.top - 24 && Math.abs(s.x - cx) < tr.width);
        if (isArmed !== armed) {
          armed = isArmed; t.classList.toggle("armed", armed); M.haptic("tick");
          if (armed) ttrem = M.tremor(t.querySelector(".ic"), { amp: 1.4, freq: 14, dir: "xy", noise: 0.6, dur: 60000 });
          else if (ttrem) { ttrem.stop(); ttrem = null; }
        }
        if (Math.abs(p - prox) > 0.02 || isArmed) {
          prox = p;
          var ti = t.querySelector(".ic");
          M.el(ti).to({ s: 1 + p * 0.22 + (armed ? 0.12 : 0), y: -p * 3 }, { k: 420, zeta: 0.7 });
          t.style.setProperty("--prox", p.toFixed(3));
        }
        gm.to({ s: armed ? 0.82 : 1.04, o: armed ? 0.85 : 1 }, { k: 420, zeta: 0.8 });
      },
      onEnd: function (s) {
        var t = tab();
        if (armed && t) drop(t, s); else back(s);
      },
      onCancel: function (s) { back(s); }
    });
    function cleanTab(t) {
      if (ttrem) { ttrem.stop(); ttrem = null; }
      if (gtrem) { gtrem.stop(); gtrem = null; }
      if (!t) return;
      t.classList.remove("receptive", "armed"); t.style.removeProperty("--prox");
      armed = false; prox = 0;
    }
    function drop(t, s) {
      var r = t.querySelector(".ic").getBoundingClientRect(), g = ghost.getBoundingClientRect();
      var tx = r.left + r.width / 2 - (g.left + g.width / 2) + gm.cur.x, ty = r.top + r.height / 2 - (g.top + g.height / 2) + gm.cur.y;
      var x0 = gm.cur.x, y0 = gm.cur.y, s0 = gm.cur.s, r0 = gm.cur.r;
      var gg = ghost; ghost = null;
      M.remove(gm.anim);
      if (gtrem) { gtrem.stop({ k: 120, zeta: 1 }); gtrem = null; }   // 吸い込まれながら震えが収束
      // 縮みながら弧を描いて吸い込まれる（2 次ベジェ：上へふくらむ制御点）
      var cxp = (x0 + tx) / 2 + (s.v.x || 0) * 0.06, cyp = Math.min(y0, ty) - 60;
      M.tween({ dur: 300, ease: function (t) { return t * t * (2.2 - 1.2 * t); }, onUpdate: function (p) {
        var q = 1 - p;
        var x = q * q * x0 + 2 * q * p * cxp + p * p * tx, y = q * q * y0 + 2 * q * p * cyp + p * p * ty;
        gm.set({ x: x, y: y, s: s0 * (1 - p * 0.94), o: 1 - p * p, r: r0 * q });
      }, onDone: function () {
        gg.remove();
        card.classList.remove("carried");
        cleanTab(t);
        var ok = o.onDrop();
        var ti = M.el(t.querySelector(".ic"));
        ti.set({ s: 1.45, y: 0 }); ti.to({ s: 1, y: 0 }, { k: 380, zeta: 0.38 });   // タブのアイコンが脈打つ
        M.haptic(ok ? "confirm" : "tap");
        if (!M.reduced()) { var ring = document.createElement("i"); ring.className = "shock"; t.appendChild(ring); var mr = M.el(ring); mr.set({ s: 0.5, o: 0.8 }); M.tween({ dur: 420, onUpdate: function (p) { mr.set({ s: 0.5 + p * 1.6, o: 0.8 * (1 - p) }); }, onDone: function () { ring.remove(); } }); }
      } });
    }
    function back(s) {
      cleanTab(tab());
      var t = tab(); if (t) M.el(t.querySelector(".ic")).to({ s: 1, y: 0 }, "snappy");
      if (!ghost) return;
      var gg = ghost; ghost = null;
      // 離した速度を引き継いで元の場所へ戻る
      gm.to({ x: 0, y: 0, s: 1, r: 0, o: 1 }, { k: 320, zeta: 0.78 }, { x: s.v ? s.v.x : 0, y: s.v ? s.v.y : 0 }).then(function () { gg.remove(); card.classList.remove("carried"); });
    }
  };

  /* ---------- 詳細のシート：下に払って閉じる（速度で閉じる／戻るを決める） ---------- */
  V.sheet = function (view, handles, onClose) {
    handles.forEach(function (h) {
      M.drag(h, {
        threshold: 6, axis: "y",
        filter: function (e) { return view.scrollTop <= 0 && !e.target.closest("a, button"); },
        onStart: function () { view.classList.add("dragging"); M.haptic("lift"); },
        onMove: function (s, dx, dy) {
          var y = dy < 0 ? M.rubber(dy, 300, 0.4) : dy;   // 上へはゴムの抵抗
          var mv = M.el(view); mv.set({ y: y, s: 1 - Math.min(0.04, Math.max(0, y) / 4000) });
        },
        onEnd: function (s) {
          view.classList.remove("dragging");
          var mv = M.el(view), y = mv.cur.y, H = view.clientHeight;
          var landing = y + M.project(s.v.y, 0.995);
          if (y > 0 && (landing > H * 0.42 || s.v.y > 900)) {
            GT._dismissV = s.v.y; M.haptic("drop");
            onClose();
          } else mv.to({ y: 0, s: 1 }, { k: 420, zeta: 0.72 }, { y: s.v.y });
        }
      });
    });
  };
})(window.GT = window.GT || {});
