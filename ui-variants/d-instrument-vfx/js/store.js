// 保存層。localStorage が使えない（プライベート閲覧・拒否）ときはメモリに置き、動きは止めない。
// 区分：local＝端末の中だけ（検索の履歴）、cloud＝ログイン時にクラウドへ同期する予定のもの（お気に入りの経路・よく使う場所・設定）。
(function (GT) {
  "use strict";
  var PREFIX = "gyrotraffic.";
  var mem = {};
  var ok = true;
  try { var k = PREFIX + "_probe"; localStorage.setItem(k, "1"); localStorage.removeItem(k); } catch (e) { ok = false; }
  function get(key, def) {
    try {
      var v = ok ? localStorage.getItem(PREFIX + key) : mem[key];
      return v == null ? def : JSON.parse(v);
    } catch (e) { return def; }
  }
  function set(key, val) {
    var s = JSON.stringify(val);
    try { if (ok) localStorage.setItem(PREFIX + key, s); else mem[key] = s; }
    catch (e) { mem[key] = s; }
  }
  GT.store = {
    available: function () { return ok; },
    // 端末の中だけ（クラウドに送らない）
    history: {
      list: function () { return get("local.history", []); },
      add: function (q) {
        var h = get("local.history", []).filter(function (x) { return !(x.from === q.from && x.to === q.to); });
        h.unshift({ from: q.from, to: q.to, at: Date.now() });
        set("local.history", h.slice(0, 8));
      },
      clear: function () { set("local.history", []); }
    },
    // クラウド同期の対象（試作では端末にだけ保存）
    favRoutes: {
      list: function () { return get("cloud.favRoutes", []); },
      has: function (key) { return get("cloud.favRoutes", []).some(function (r) { return r.key === key; }); },
      toggle: function (item) {
        var l = get("cloud.favRoutes", []);
        var i = l.findIndex(function (r) { return r.key === item.key; });
        if (i >= 0) l.splice(i, 1); else l.unshift(item);
        set("cloud.favRoutes", l);
        return i < 0;
      },
      move: function (from, to) { var l = get("cloud.favRoutes", []); var x = l.splice(from, 1)[0]; if (x) l.splice(to, 0, x); set("cloud.favRoutes", l); },
      remove: function (key) { set("cloud.favRoutes", get("cloud.favRoutes", []).filter(function (r) { return r.key !== key; })); }
    },
    favPlaces: {
      list: function () { return get("cloud.favPlaces", []); },
      add: function (p) { var l = get("cloud.favPlaces", []); l.push(p); set("cloud.favPlaces", l); },
      remove: function (i) { var l = get("cloud.favPlaces", []); l.splice(i, 1); set("cloud.favPlaces", l); }
    },
    settings: {
      get: function () { return Object.assign({ theme: "system", lang: "ja" }, get("cloud.settings", {})); },
      set: function (patch) { set("cloud.settings", Object.assign(GT.store.settings.get(), patch)); }
    },
    account: {
      get: function () { return get("local.mockAccount", null); },
      set: function (a) { set("local.mockAccount", a); }
    }
  };
})(window.GT = window.GT || {});
