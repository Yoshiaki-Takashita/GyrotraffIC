// モーション基盤（依存ゼロ・外部通信なし）。GT.M に置く。
// (a) ばねの積分器  (b) 中断できる動き（速度の引き継ぎ）  (c) FLIP  (d) ポインタ（速度・慣性・ラバーバンド・吸着）
// (e) タイムライン（スタッガー・イージング）  (f) 品質の自動調整  (g) 動きを減らす設定  (h) 触覚
// 方針：requestAnimationFrame は「動いているものがある間だけ」回す。待機中は完全に静止する。
// 書き込むのは transform と opacity だけ（と小さな Canvas）。
(function (GT) {
  "use strict";
  var M = GT.M = {};
  var rmq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  /** (g) 動きを減らす設定。テストから M.forceReduced で上書きできる */
  M.reduced = function () { return M.forceReduced != null ? M.forceReduced : !!(rmq && rmq.matches); };

  /* ================= 時計とループ ================= */
  // 手動の時計（検査でコマ送りするため）。通常は performance.now()。
  var manual = !!window.__GT_MANUAL, vnow = performance.now();   // __GT_MANUAL：検査で起動からコマ送り
  M.now = function () { return manual ? vnow : performance.now(); };
  var active = [];          // tick(dt, now) → true の間は動き続ける
  var timers = [];          // {at, fn}：ループに乗る遅延（コマ送りでも同期する）
  var raf = 0, last = 0;
  var MAX_DT = 1 / 30;      // 1 コマの上限（タブ復帰などの大きな飛びで暴れない）
  var stats = { work: [], gap: [] };   // 検査用：1 コマの処理時間と、コマの間隔（ms）
  M.stats = stats;
  stats.on = !!window.__GT_STATS;   // 検査用：起動の直後から測る

  function frame(t) {
    raf = 0;
    var now = manual ? vnow : t;
    var dt = last ? (now - last) / 1000 : 1 / 60;
    if (last) { Q.sample(now - last); if (stats.on) stats.gap.push(now - last); }
    last = now;
    step(Math.min(dt, MAX_DT), now);
    schedule();
  }
  function step(dt, now) {
    var w0 = performance.now();
    for (var i = timers.length - 1; i >= 0; i--) if (timers[i].at <= now) { var f = timers[i].fn; timers.splice(i, 1); try { f(); } catch (e) { console.error(e); } }
    var list = active.slice();
    for (var j = 0; j < list.length; j++) {
      var a = list[j], keep = false;
      try { keep = a.tick(dt, now); } catch (e) { console.error(e); }
      if (!keep) { var k = active.indexOf(a); if (k >= 0) active.splice(k, 1); if (a.done) a.done(); }
    }
    if (stats.on) stats.work.push(performance.now() - w0);
  }
  function schedule() {
    if (manual) return;
    if (active.length || timers.length) { if (!raf) raf = requestAnimationFrame(frame); }
    else last = 0;          // 止まった：次に動くときは dt を 1 コマ分から始める
  }
  M.add = function (a) { if (active.indexOf(a) < 0) active.push(a); schedule(); return a; };
  M.remove = function (a) { var k = active.indexOf(a); if (k >= 0) active.splice(k, 1); };
  M.after = function (ms, fn) { var o = { at: M.now() + ms, fn: fn }; timers.push(o); schedule(); return o; };
  M.cancel = function (o) { var k = timers.indexOf(o); if (k >= 0) timers.splice(k, 1); };
  M.busy = function () { return active.length + timers.length; };
  /** 検査用のコマ送り：ms だけ時間を進める（ばね・タイマー・CSS のアニメーションを同時に） */
  M.manual = function (on) { manual = !!on; vnow = performance.now(); last = 0; if (raf) { cancelAnimationFrame(raf); raf = 0; } if (!on) schedule(); };
  M.advance = function (ms) {
    var n = Math.max(1, Math.round(ms / (1000 / 60)));
    for (var i = 0; i < n; i++) {
      vnow += ms / n;
      step(Math.min(ms / n / 1000, MAX_DT), vnow);
    }
    if (document.getAnimations) document.getAnimations().forEach(function (an) { try { an.pause(); an.currentTime = (an.currentTime || 0) + ms; } catch (e) {} });
  };

  /* ================= (a) ばね ================= */
  // 減衰比 zeta：1＝臨界減衰（行き過ぎなし最速）、>1＝過減衰、<1＝弱減衰（行き過ぎあり）
  M.SPRING = {
    press: { k: 900, zeta: 1 },        // 押し込み：速く、行き過ぎなし
    release: { k: 520, zeta: 0.42 },   // 離したときの戻り：小さな行き過ぎ
    snappy: { k: 420, zeta: 0.82 },
    gentle: { k: 170, zeta: 1 },
    wobble: { k: 260, zeta: 0.38 },    // 針が定まる前の揺れ
    page: { k: 300, zeta: 0.92 },      // 画面の移り
    settle: { k: 220, zeta: 0.6 },
    over: { k: 200, zeta: 1.35 }       // 過減衰
  };
  function cfg(o) {
    o = typeof o === "string" ? M.SPRING[o] : (o || M.SPRING.snappy);
    var m = o.mass || 1, k = o.k || o.stiffness || 300;
    var c = o.c != null ? o.c : o.damping != null ? o.damping : (o.zeta != null ? o.zeta : 1) * 2 * Math.sqrt(k * m);
    return { m: m, k: k, c: c };
  }
  M.cfg = cfg;
  /** 1 本のばね。半陰的オイラーを 1/240 秒の小刻みで積分（フレーム間隔が揺れても安定） */
  function Spring(x, opts) {
    this.x = x; this.v = 0; this.target = x; this.set(opts);
    this.restDelta = 0.001; this.restSpeed = 0.01;
  }
  Spring.prototype.set = function (opts) { var c = cfg(opts); this.m = c.m; this.k = c.k; this.c = c.c; return this; };
  Spring.prototype.step = function (dt) {
    var h = 1 / 240, n = Math.ceil(dt / h); h = dt / n;
    for (var i = 0; i < n; i++) {
      var a = (-this.k * (this.x - this.target) - this.c * this.v) / this.m;
      this.v += a * h;            // 先に速度
      this.x += this.v * h;       // 新しい速度で位置（半陰的）
    }
    return !this.atRest();
  };
  Spring.prototype.atRest = function () {
    return Math.abs(this.x - this.target) < this.restDelta && Math.abs(this.v) < this.restSpeed;
  };
  M.Spring = Spring;

  /** 単独の値のばね。onUpdate(x, v) を毎コマ。retarget しても速度は引き継ぐ（中断できる動き） */
  M.spring = function (o) {
    var s = new Spring(o.from != null ? o.from : 0, o.spring);
    s.target = o.to; if (o.velocity) s.v = o.velocity;
    if (o.restDelta) { s.restDelta = o.restDelta; s.restSpeed = o.restDelta * 10; }
    var h = {
      s: s,
      to: function (t, sp) { if (sp) s.set(sp); s.target = t; M.add(anim); return h; },
      stop: function () { M.remove(anim); },
      onRest: o.onRest
    };
    var anim = {
      tick: function (dt) { var go = s.step(dt); if (!go) { s.x = s.target; s.v = 0; } o.onUpdate && o.onUpdate(s.x, s.v); return go; },
      done: function () { h.onRest && h.onRest(s.x); }
    };
    if (M.reduced()) { s.x = s.target; s.v = 0; o.onUpdate && o.onUpdate(s.x, 0); h.onRest && M.after(0, function () { h.onRest(s.x); }); return h; }
    M.add(anim);
    return h;
  };

  /** ばねの動きを CSS の linear() に写す（View Transitions など CSS 側で同じばねを使うため） */
  M.springEasing = function (sp, ms) {
    var s = new Spring(0, sp); s.target = 1;
    var pts = [], N = 40;
    for (var i = 0; i <= N; i++) { pts.push(+s.x.toFixed(4)); s.step(ms / 1000 / N); }
    pts[N] = 1;
    return "linear(" + pts.join(",") + ")";
  };

  /* ================= (b) 要素の動き（チャンネルごとのばね・中断で速度を引き継ぐ） ================= */
  var CH = { x: 0, y: 0, s: 1, sx: 1, sy: 1, r: 0, o: 1 };
  var live = [];   // 同時に動いている要素（上限で古いものから終点へ飛ばす）
  function Mover(el) {
    this.el = el; this.sp = {}; this.cur = {}; this.waiters = [];
    for (var k in CH) this.cur[k] = CH[k];
    var self = this;
    this.anim = { tick: function (dt) { return self.tick(dt); }, done: function () { self.rest(); } };
  }
  Mover.prototype.tick = function (dt) {
    var go = false;
    for (var k in this.sp) {
      var s = this.sp[k];
      if (s.step(dt)) go = true; else { s.x = s.target; s.v = 0; }
      this.cur[k] = s.x;
    }
    this.write();
    if (this.onFrame) this.onFrame(this.cur, this);
    return go;
  };
  Mover.prototype.write = function () {
    var c = this.cur, t = "", j = this.jit;
    if (j) c = { x: c.x + j.x, y: c.y + j.y, r: c.r + j.r, s: c.s * (1 + j.s), sx: c.sx, sy: c.sy, o: c.o };
    if (c.x || c.y) t += "translate3d(" + c.x.toFixed(2) + "px," + c.y.toFixed(2) + "px,0)";
    if (c.r) t += " rotate(" + c.r.toFixed(2) + "deg)";
    var sx = c.s * c.sx, sy = c.s * c.sy;
    if (sx !== 1 || sy !== 1) t += " scale(" + sx.toFixed(4) + "," + sy.toFixed(4) + ")";
    this.el.style.transform = t || "";
    this.el.style.opacity = c.o >= 0.999 ? "" : Math.max(0, c.o).toFixed(3);
  };
  Mover.prototype.rest = function () {
    var i = live.indexOf(this); if (i >= 0) live.splice(i, 1);
    this.el.style.willChange = "";
    var w = this.waiters; this.waiters = [];
    w.forEach(function (f) { f(); });
  };
  /** 即時に値を置く（速度は 0） */
  Mover.prototype.set = function (vals) {
    for (var k in vals) { this.cur[k] = vals[k]; if (this.sp[k]) { this.sp[k].x = this.sp[k].target = vals[k]; this.sp[k].v = 0; } }
    this.write(); return this;
  };
  /** 目標へ。動いている途中でも、今の位置と速度から向きを変える。Promise は止まったときに解決 */
  Mover.prototype.to = function (vals, spring, vel) {
    var self = this;
    if (M.reduced()) { this.set(vals); return Promise.resolve(); }
    for (var k in vals) {
      var s = this.sp[k];
      if (!s) { s = this.sp[k] = new Spring(this.cur[k], spring); s.restDelta = k === "x" || k === "y" ? 0.05 : 0.0005; s.restSpeed = s.restDelta * 10; }
      else if (spring) s.set(spring);
      s.target = vals[k];
      if (vel && vel[k] != null) s.v = vel[k];
    }
    if (live.indexOf(this) < 0) {
      live.push(this);
      if (live.length > Q.maxLive()) { var old = live[0]; old.finish(); }
    }
    this.el.style.willChange = "transform, opacity";   // 動く直前に付け、止まったら外す
    M.add(this.anim);
    return new Promise(function (r) { self.waiters.push(r); });
  };
  /** 今の速度（px/s など） */
  Mover.prototype.vel = function (k) { return this.sp[k] ? this.sp[k].v : 0; };
  Mover.prototype.kick = function (vel) { for (var k in vel) { if (!this.sp[k]) this.sp[k] = new Spring(this.cur[k]); this.sp[k].v += vel[k]; } M.add(this.anim); return this; };
  Mover.prototype.finish = function () { for (var k in this.sp) { this.sp[k].x = this.sp[k].target; this.sp[k].v = 0; this.cur[k] = this.sp[k].x; } this.write(); M.remove(this.anim); this.rest(); };
  Mover.prototype.moving = function () { return active.indexOf(this.anim) >= 0; };
  /** 状態を消して transform / opacity を外す */
  Mover.prototype.clear = function () { M.remove(this.anim); this.sp = {}; for (var k in CH) this.cur[k] = CH[k]; this.el.style.transform = ""; this.el.style.opacity = ""; this.rest(); };
  M.el = function (el) { return el.__mv || (el.__mv = new Mover(el)); };

  /* ================= (e) タイムライン ================= */
  M.ease = {
    linear: function (t) { return t; },
    outCubic: function (t) { return 1 - Math.pow(1 - t, 3); },
    outQuint: function (t) { return 1 - Math.pow(1 - t, 5); },
    inCubic: function (t) { return t * t * t; },
    inOutCubic: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
    outExpo: function (t) { return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); },
    outBack: function (t) { var c = 1.4; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
    inOutSine: function (t) { return -(Math.cos(Math.PI * t) - 1) / 2; }
  };
  /** 時間で進む動き。onUpdate(p 0..1 イージング後, raw) */
  M.tween = function (o) {
    var t0 = null, dur = o.dur || 300, ease = typeof o.ease === "function" ? o.ease : M.ease[o.ease || "outCubic"];
    var a = {
      tick: function (dt, now) {
        if (t0 == null) t0 = now + (o.delay || 0);
        var raw = Math.min(1, Math.max(0, (now - t0) / dur));
        if (now >= t0) o.onUpdate(ease(raw), raw);
        return raw < 1;
      },
      done: function () { o.onDone && o.onDone(); }
    };
    if (M.reduced() && !o.always) { o.onUpdate(1, 1); o.onDone && M.after(0, o.onDone); return a; }
    return M.add(a);
  };
  /** 段差をつけて順に。上限（品質の段）を超えたものは即時に最終状態 */
  M.stagger = function (els, gap, fn) {
    var cap = Q.maxLive();
    Array.prototype.forEach.call(els, function (el, i) {
      if (i >= cap || M.reduced()) fn(el, i, true);
      else M.after(i * gap, function () { fn(el, i, false); });
    });
  };
  /** 減衰する正弦波（拒否の震え）：x(t)=A·e^(-t/τ)·sin(2πft) */
  M.shake = function (el, o) {
    o = o || {};
    // 拒否：大きく速い横の震え＋ごくわずかな回転。時定数 dur/3.5 で減衰し dur で必ず止まる
    return M.tremor(el, { amp: o.amp || 10, freq: o.freq || 9, decay: (o.dur || 340) / 1000 / 4.2, dir: "xr", rot: o.rot != null ? o.rot : 0.04, noise: 0.2, dur: o.dur || 340, pri: 2 });
  };

  /* ================= 震え（視覚の主役。触覚は添え物） =================
     減衰する 3 つの周波数の合成＋微小な位相のずれ（ノイズ）。時間ベースで計算するのでコマ落ちでも形が崩れない。
     o: {amp(px・回転は deg・拡縮は比), freq(Hz 6〜20), decay(秒の時定数。0＝溜め続ける), dir:"x"|"y"|"r"|"s"|"xr", noise(0〜1), dur(ms 上限)}
     handle.amp(a) で振幅の目標を変える（ばねで滑らかに）。stop() は振幅を 0 へ減衰させて必ず静止。同時に震える要素は 2 つまで。 */
  var tremors = [];
  M.tremor = function (el, o) {
    o = o || {};
    if (M.reduced()) return { amp: function () {}, stop: function () {}, kill: function () {} };
    var mv = M.el(el);
    if (mv.__tr) mv.__tr.kill();
    var f = Math.min(20, Math.max(6, o.freq || 12)), dir = o.dir || "x", noise = o.noise != null ? o.noise : 0.35;
    var ph = [Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28];
    var parts = [[1, 1], [1.53, 0.45], [2.31, 0.22]];
    var A = new Spring(o.from != null ? o.from : (o.decay ? o.amp || 4 : 0), { k: 180, zeta: 1 });
    A.target = o.decay ? 0 : (o.amp || 2); if (o.decay) { A.k = 1 / (o.decay * o.decay); A.c = 2 / o.decay; }
    A.restDelta = 0.01; A.restSpeed = 0.05;
    var t = 0, h, dead = false, maxT = (o.dur || 4000) / 1000;
    var anim = { tick: function (dt) {
      t += dt;
      A.step(dt);
      var a = Math.max(0, A.x), sum = 0, sum2 = 0;
      for (var i = 0; i < 3; i++) {
        ph[i] += (Math.random() - 0.5) * noise * dt * 20;   // 位相がわずかに揺らぐ＝機械的に見えない
        sum += parts[i][1] * Math.sin(6.2832 * f * parts[i][0] * t + ph[i]);
        sum2 += parts[i][1] * Math.cos(6.2832 * f * parts[i][0] * 0.91 * t + ph[(i + 1) % 3]);
      }
      sum /= 1.67; sum2 /= 1.67;
      var j = { x: 0, y: 0, r: 0, s: 0 };
      if (dir === "x" || dir === "xr") j.x = a * sum;
      if (dir === "y") j.y = a * sum;
      if (dir === "xy") { j.x = a * sum; j.y = a * sum2 * 0.6; }
      if (dir === "r") j.r = a * sum;
      if (dir === "xr") j.r = a * sum2 * (o.rot || 0.12);
      if (dir === "s") j.s = a * sum;
      mv.jit = j; mv.write();
      var go = !dead && t < maxT && !(A.atRest() && A.target === 0);
      return go;
    }, done: function () { mv.jit = null; mv.write(); if (mv.__tr === h) mv.__tr = null; var k = tremors.indexOf(h); if (k >= 0) tremors.splice(k, 1); } };
    h = {
      amp: function (a, sp) { A.target = a; if (sp) { var c = cfg(sp); A.k = c.k; A.c = c.c; } M.add(anim); return h; },
      stop: function (sp) { var c = cfg(sp || { k: 400, zeta: 1 }); A.k = c.k; A.c = c.c; A.target = 0; return h; },
      kill: function () { dead = true; M.remove(anim); anim.done(); },
      level: function () { return A.x; }
    };
    mv.__tr = h;
    h.pri = o.pri || 0;
    tremors.push(h);
    // 同時に震えるのは 2 つまで：優先度の低い・古いものから止める（拒否などの意味の大きい震えを守る）
    while (tremors.length > 2) { var lo = tremors[0]; tremors.forEach(function (x) { if (x.pri < lo.pri) lo = x; }); lo.kill(); }
    M.add(anim);
    return h;
  };

  /* ================= (c) FLIP ================= */
  M.rect = function (el) { return el.getBoundingClientRect(); };
  /** First の矩形から今（Last）へ：反転した transform を置き、ばねで 0 へ再生 */
  M.flipFrom = function (el, first, opts) {
    opts = opts || {};
    var last = el.getBoundingClientRect();
    if (!last.width || !first) return Promise.resolve();
    var mv = M.el(el);
    var sx = opts.scale === false ? 1 : first.width / last.width, sy = opts.scaleY === false || opts.scale === false ? 1 : first.height / last.height;
    el.style.transformOrigin = "0 0";
    mv.set({ x: first.left - last.left, y: first.top - last.top, sx: sx, sy: opts.scaleY === false ? 1 : sy, o: opts.fromO != null ? opts.fromO : 1 });
    return mv.to({ x: 0, y: 0, sx: 1, sy: 1, o: 1 }, opts.spring || "page", opts.vel).then(function () { el.style.transformOrigin = ""; });
  };
  /** 並びの変更を FLIP で：mutate の前後で各要素の位置を比べて動かす */
  M.flip = function (els, mutate, spring) {
    var first = new Map();
    els.forEach(function (e) { first.set(e, e.getBoundingClientRect()); });
    mutate();
    return Promise.all(els.map(function (e) {
      var f = first.get(e), l = e.getBoundingClientRect();
      var mv = M.el(e); mv.set({ x: f.left - l.left + mv.cur.x, y: f.top - l.top + mv.cur.y });
      return mv.to({ x: 0, y: 0 }, spring || "snappy");
    }));
  };

  /* ================= (d) ポインタ ================= */
  /** 速度の推定：直近 100ms の点から（px/s）。古い点ほど軽く */
  function Tracker() { this.pts = []; }
  Tracker.prototype.add = function (x, y) { var t = M.now(); this.pts.push({ x: x, y: y, t: t }); while (this.pts.length > 2 && t - this.pts[0].t > 100) this.pts.shift(); };
  Tracker.prototype.vel = function () {
    var p = this.pts; if (p.length < 2) return { x: 0, y: 0 };
    var a = p[0], b = p[p.length - 1], dt = (b.t - a.t) / 1000;
    if (M.now() - b.t > 80 || dt <= 0) return { x: 0, y: 0 };   // 止まってから離した＝速度 0
    return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
  };
  M.Tracker = Tracker;
  /** 端でのゴムの抵抗（はみ出し量 x、寸法 d）：c·d·x/(d + c·x) */
  M.rubber = function (x, d, c) { c = c || 0.55; var s = x < 0 ? -1 : 1; x = Math.abs(x); return s * (c * d * x) / (d + c * x); };
  /** 範囲 [lo, hi] の外はゴムの抵抗で */
  M.rubberClamp = function (v, lo, hi, d) { return v < lo ? lo + M.rubber(v - lo, d) : v > hi ? hi + M.rubber(v - hi, d) : v; };
  /** 慣性で止まる位置の予測（減速率 0.998/ms 相当） */
  M.project = function (v, decel) { decel = decel || 0.998; return (v / 1000) * decel / (1 - decel); };
  /** 磁石のような吸着：予測位置にいちばん近い点 */
  M.snap = function (pos, v, points) {
    var p = pos + M.project(v), best = points[0];
    points.forEach(function (q) { if (Math.abs(q - p) < Math.abs(best - p)) best = q; });
    return best;
  };
  /**
   * ドラッグ。o: {hold(ms, タッチで持ち上げるまでの長押し), threshold(px), axis, onPress, onStart, onMove, onEnd, onCancel, onTap}
   * Pointer Events＋setPointerCapture。タッチは長押しで掴み、それまではスクロールに譲る。
   */
  M.drag = function (el, o) {
    var st = null;
    function down(e) {
      if (e.button > 0 || st) return;
      if (o.filter && !o.filter(e)) return;
      st = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, tr: new Tracker(), on: false, type: e.pointerType, t0: M.now() };
      st.tr.add(e.clientX, e.clientY);
      try { el.setPointerCapture(e.pointerId); } catch (er) {}   // 掴んだ要素の外へ出ても追い続ける
      o.onPress && o.onPress(st, e);
      var hold = st.type === "touch" ? (o.hold != null ? o.hold : 0) : (o.mouseHold || 0);
      if (hold) st.timer = M.after(hold, function () { if (st && !st.on) begin(e); });
      else if (!o.threshold) begin(e);
    }
    function begin(e) {
      st.on = true;
      try { el.setPointerCapture(st.id); } catch (er) {}
      o.onStart && o.onStart(st, e);
    }
    function move(e) {
      if (!st || e.pointerId !== st.id) return;
      st.x = e.clientX; st.y = e.clientY; st.tr.add(st.x, st.y);
      var dx = st.x - st.x0, dy = st.y - st.y0;
      if (!st.on) {
        var th = o.threshold || 6;
        if (Math.hypot(dx, dy) > th) {
          if (st.type === "touch" && o.hold) { end(e, true); return; }    // 長押しの前に動いた＝スクロール
          if (o.axis === "y" && Math.abs(dx) > Math.abs(dy)) { end(e, true); return; }
          begin(e);
        } else return;
      }
      e.preventDefault();
      o.onMove && o.onMove(st, dx, dy, e);
    }
    function end(e, cancel) {
      if (!st || (e && e.pointerId !== st.id)) return;
      var s = st; st = null;
      if (s.timer) M.cancel(s.timer);
      try { el.releasePointerCapture(s.id); } catch (er) {}
      if (s.on) { s.v = s.tr.vel(); if (cancel) { o.onCancel ? o.onCancel(s) : o.onEnd && o.onEnd(s); } else o.onEnd && o.onEnd(s); el.__dragged = M.now(); }
      else { o.onRelease && o.onRelease(s, cancel); if (!cancel) o.onTap && o.onTap(s); }
    }
    el.setAttribute("draggable", "false");   // リンクや画像の標準のドラッグに奪われない
    el.addEventListener("dragstart", function (e) { e.preventDefault(); });
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", function (e) { end(e, false); });
    el.addEventListener("pointercancel", function (e) { end(e, true); });
    // 持ち上げた後はスクロールさせない（touchmove を止める。passive にしない）
    el.addEventListener("touchmove", function (e) { if (st && st.on) e.preventDefault(); }, { passive: false });
    // ドラッグ直後の click（リンクの移動）を止める
    el.addEventListener("click", function (e) { if (el.__dragged && M.now() - el.__dragged < 400) { e.preventDefault(); e.stopPropagation(); } }, true);
    el.addEventListener("keydown", function (e) { if (e.key === "Escape" && st) end(null, true); });
    return { cancel: function () { if (st) end({ pointerId: st.id }, true); }, active: function () { return !!(st && st.on); } };
  };

  /* ================= (f) 品質の自動調整 ================= */
  // フレーム間隔の直近 40 コマの中央値で段を決める。2＝全部、1＝粒子と発光を減らす、0＝粒子なし・同時の動きを最小に
  var Q = M.q = {
    level: 2, forced: null, buf: [],
    sample: function (gap) {
      if (gap > 200) return;           // タブの非表示などの飛びは数えない
      this.buf.push(gap); if (this.buf.length > 40) this.buf.shift();
      if (this.buf.length < 40 || this.forced != null) return;
      var s = this.buf.slice().sort(function (a, b) { return a - b; }), med = s[20];
      var lv = med > 28 ? 0 : med > 19 ? 1 : 2;
      if (lv < this.level) { this.level = lv; this.buf = []; document.documentElement.dataset.q = lv; }
    },
    get: function () { return this.forced != null ? this.forced : this.level; },
    force: function (lv) { this.forced = lv; document.documentElement.dataset.q = lv == null ? this.level : lv; },
    particles: function () { return [0, 5, 10][this.get()]; },
    maxLive: function () { return [6, 12, 24][this.get()]; }
  };
  document.documentElement.dataset.q = 2;

  /* ================= (h) 触覚 ================= */
  // 対応しない端末（iPhone の Safari など）では何もしない。画面の見え方は対応の有無で変えない。
  var HAP = { tap: 6, tick: 4, confirm: [10, 40, 16], reject: [18, 30, 18, 30, 12], lift: 12, drop: [8, 24, 14] };
  M.haptic = function (name) {
    if (M.reduced() && name === "tick") return;
    try { if (navigator.vibrate && M._activated) navigator.vibrate(HAP[name] || 6); } catch (e) {}
  };
  document.addEventListener("pointerdown", function () { M._activated = true; }, { capture: true, passive: true });
})(window.GT = window.GT || {});
