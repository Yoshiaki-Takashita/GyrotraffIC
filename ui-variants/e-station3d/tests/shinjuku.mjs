// 新宿駅の下書きを駅の立体図で読む試験（ヘッドレス Chromium・playwright-core・ブラウザは 1 本ずつ）。
// 使い方: NODE_PATH=/opt/node-tools/node_modules node ui-variants/e-station3d/tests/shinjuku.mjs
// 確かめること：駅の切り替え（見本／新宿）・コンソールのエラー 0・施設の数が元データと一致・床は水平（斜めは別の階を結ぶ階段・エスカレーターだけ）・
//               種類ごとの表示切り替え・階ごとの強調・経路（JR ホーム→改札→地上出口）と「経路不明」・1 コマの描画時間。
// 出力: docs/ui-variants/e-station3d/shinjuku-*.png と shinjuku-perf.json
import { createRequire } from "node:module";
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..");
const url = pathToFileURL(join(root, "ui-variants", "e-station3d", "index.html")).href;
const out = join(root, "docs", "ui-variants", "e-station3d");
mkdirSync(out, { recursive: true });
const raw = JSON.parse(readFileSync(join(root, "data", "shinjuku", "shinjuku-station.json"), "utf8"));

function findExe() {
  const base = "/opt/pw-browsers";
  for (const d of readdirSync(base).sort().reverse()) for (const p of ["chrome-linux/chrome", "chrome-linux/headless_shell", "chrome-headless-shell-linux64/chrome-headless-shell"]) {
    try { if (statSync(join(base, d, p)).isFile()) return join(base, d, p); } catch {}
  }
}
const failures = [];
const ok = (cond, c, m) => { if (!cond) failures.push(`[${c}] ${m}`); };
const browser = await chromium.launch({ executablePath: findExe(), headless: true });
const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: "dark", reducedMotion: "reduce" });
await c.addInitScript(() => { try { sessionStorage.setItem("gyrotraffic.splash", "1"); } catch (e) {} });
const p = await c.newPage();
const errs = [];
p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
p.on("pageerror", (e) => errs.push(String(e)));
p.on("request", (r) => { if (!r.url().startsWith("file:")) errs.push("外部通信: " + r.url()); });

await p.goto(url + "#/station");
await p.waitForSelector("#stWhich");
ok((await p.evaluate(() => GT.station.which)) === "sample", "switch", "最初は見本のはず");
await p.selectOption("#stWhich", "shinjuku");
await p.waitForFunction(() => GT.station && GT.station.which === "shinjuku" && GT.station.data, null, { timeout: 15000 });
await p.waitForTimeout(300);

// 施設の数・null の扱い
{
  const C = "data";
  const r = await p.evaluate(() => {
    const d = GT.station.data;
    return { counts: d._view.counts, dropped: d._view.dropped, levels: d.levels.length, tracks: d.tracks.length,
      plats: d.platforms.length, unnamed: d.platforms.filter((x) => !x.label).length,
      carDoor: document.querySelector(".sj-cd") && document.querySelector(".sj-cd").textContent,
      glyphs: GT.station.view._glyphs().reduce((m, g) => (m[g.kind] = (m[g.kind] || 0) + 1, m), {}) };
  });
  const want = {}; for (const n of raw.nodes) want[n.kind] = (want[n.kind] || 0) + 1;
  for (const k of ["toilet", "stairs", "escalator", "elevator", "exit", "gate"]) {
    ok(r.counts[k] === want[k], C, `${k} の数 ${r.counts[k]} ≠ 元データ ${want[k]}`);
    ok(r.glyphs[k] === want[k], C, `${k} の記号の数 ${r.glyphs[k]} ≠ 元データ ${want[k]}`);
  }
  ok(r.counts.platform === raw.platforms.length, C, "ホームの数が違う");
  ok(r.levels === raw.levels.length, C, "階の数が違う");
  ok(r.dropped.nodes === 0 && r.dropped.edges === 0, C, "元データの点・辺を捨てている " + JSON.stringify(r.dropped));
  ok(r.tracks === 0, C, "線路は空のまま（作らない）");
  ok(/不明/.test(r.carDoor || ""), C, "号車・ドアが「不明」と出ていない");
  const names = await p.$$eval("#sjFrom option", (o) => o.map((x) => x.textContent));
  ok(names.some((t) => /名前不明/.test(t)), C, "名前のないホームが「名前不明」と出ていない");
  ok(r.unnamed === raw.platforms.filter((x) => !x.name).length, C, "名前のないホームの数が違う");
}

// 床は水平・斜めは別の階を結ぶ階段・エスカレーターだけ
{
  const C = "floors";
  const r = await p.evaluate(() => {
    const v = GT.station.view, S = v._segs(), H = Object.values(v._levelHeights());
    const bad = [], floorBad = [];
    for (const s of S) {
      const dy = Math.abs(s.a[1] - s.b[1]), dh = Math.hypot(s.a[0] - s.b[0], s.a[2] - s.b[2]);
      if (dy > 1e-6 && dh > 1e-6 && s.tag !== "stairs" && s.tag !== "escalator") bad.push(s);
      if (s.tag === "floor" && (dy > 1e-9 || !H.some((h) => Math.abs(s.a[1] - h) < 1e-9))) floorBad.push(s);
    }
    return { n: S.length, floors: S.filter((s) => s.tag === "floor").length, bad: bad.length, floorBad: floorBad.length };
  });
  ok(r.floors > 1000, C, "床の線が少ない " + r.floors);
  ok(r.floorBad === 0, C, "床が傾いている・階の高さと違う " + r.floorBad);
  ok(r.bad === 0, C, "階段・エスカレーター以外に斜めの線 " + r.bad);
}

// 1 コマの描画時間（全体・1 階だけ強調・拡大）。各 60 コマを同期で描いて測る
const perf = {};
async function measure(name) {
  const r = await p.evaluate(() => {
    const v = GT.station.view; v._perfReset();
    const t = [];
    for (let i = 0; i < 60; i++) t.push(v._drawOnce());
    t.sort((a, b) => a - b);
    const pf = v._perf();
    return { med: +t[30].toFixed(2), p95: +t[57].toFixed(2), max: +t[59].toFixed(2), segs: pf.segs, glyphs: pf.glyphs, drawn: pf.drawn, culled: pf.culled };
  });
  perf[name] = r;
}
await p.screenshot({ path: join(out, "shinjuku-all.png") });
await measure("全体");

// 経路：JR 14 番線（山手線内回り）→ 改札 → 地上出口
{
  const C = "route";
  const r = await p.evaluate(() => {
    const L = GT.station.last.r, d = GT.station.data;
    const kinds = L.path.map((id) => (d.nodes.find((n) => n.id === id) || {}).kind);
    return { ok: L.ok, sec: L.sec, guessed: L.guessed, gates: kinds.filter((k) => k === "gate").length, end: kinds[kinds.length - 1], big: document.querySelector("#sjBig").textContent,
      from: GT.station.sj.from, plat: (d.platforms.find((x) => x.id === GT.station.sj.from) || {}).label };
  });
  ok(r.ok, C, "既定の経路（JR ホーム→出口）が出ない");
  ok(r.gates >= 1, C, "改札を通っていない");
  ok(r.end === "exit", C, "出口で終わっていない");
  ok(/^14/.test(r.plat || ""), C, "出発が 14 番線でない " + r.plat);
  ok((await p.inputValue("#sjFrom")) === r.from, C, "選択欄の表示と経路の出発が違う");
  perf._route = r;
  // 推測の接続を使った時は画面に出る
  if (r.guessed) ok(await p.locator(".sj-guessnote").count() === 1, C, "推測の接続の注記がない");
  // つながらない 2 点 → 「経路不明」
  const iso = await p.evaluate(() => {
    const d = GT.station.data, C = GT.stationGraph.components(d);
    const plat = d.platforms.find((x) => !x.access.some((id) => C.of[id] === 0));
    return plat && plat.id;
  });
  ok(!!iso, C, "つながらないホームが見つからない");
  await p.selectOption("#sjFrom", iso);
  await p.waitForTimeout(200);
  ok(/経路不明/.test(await p.textContent("#sjBig")), C, "つながらない時に「経路不明」と出ない");
  ok(await p.locator(".sj-noroute").count() === 1, C, "経路不明の理由がない");
  await p.selectOption("#sjFrom", perf._route.from);
  await p.waitForTimeout(200);
}

// 種類ごとの表示切り替え
{
  const C = "kinds";
  const n0 = await p.evaluate(() => (GT.station.view._drawOnce(), GT.station.view._perf().drawn));
  await p.click('.sj-kind[data-kind="platform"]');
  await p.click('.sj-kind[data-kind="toilet"]');
  const r = await p.evaluate(() => ({ h: GT.station.view.hidden(), drawn: (GT.station.view._drawOnce(), GT.station.view._perf().drawn), pressed: document.querySelector('.sj-kind[data-kind="toilet"]').getAttribute("aria-pressed") }));
  ok(r.h.toilet && r.h.platform, C, "隠せていない");
  ok(r.pressed === "false", C, "ボタンの状態が変わらない");
  ok(r.drawn < n0, C, "ホームを隠しても描く線が減らない");
  await p.click('.sj-kind[data-kind="platform"]');
  await p.click('.sj-kind[data-kind="toilet"]');
  for (const k of ["toilet", "stairs", "escalator", "elevator", "exit", "gate", "platform"]) {
    const lab = await p.getAttribute(`.sj-kind[data-kind="${k}"]`, "aria-label");
    ok(!!lab, C, `${k} のボタンに aria-label がない`);
    const b = await p.locator(`.sj-kind[data-kind="${k}"]`).boundingBox();
    ok(b && b.width >= 44 && b.height >= 44, C, `${k} のボタンが小さい`);
  }
}

// 階ごとの強調：1F とホーム階の拡大
{
  const C = "levels";
  await p.click('.sj-lv[data-lv="1F"]');
  await p.waitForTimeout(150);
  ok((await p.evaluate(() => GT.station.view.focus())) === "1F", C, "1F が強調されない");
  await p.screenshot({ path: join(out, "shinjuku-1f.png") });
  await measure("1F 強調");
  // ホーム（JR）の辺りを拡大
  const ctr = await p.evaluate(() => {
    const d = GT.station.data, ps = d.platforms.filter((x) => /^\d+\s/.test(x.label || ""));
    const a = ps.map((x) => d.areas.find((ar) => ar.id === x.area)).filter(Boolean);
    const xs = a.flatMap((ar) => [ar.rect[0], ar.rect[2]]), ys = a.flatMap((ar) => [ar.rect[1], ar.rect[3]]);
    return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  });
  await p.evaluate((q) => { GT.station.view._setCam(-28 * Math.PI / 180, 62 * Math.PI / 180); GT.station.view.zoomTo(q[0], q[1], 3); }, ctr);
  await p.waitForTimeout(200);
  await p.screenshot({ path: join(out, "shinjuku-platform-zoom.png") });
  await measure("1F 強調・ホーム拡大");
  await p.click('.sj-lv[data-lv=""]');
  ok((await p.evaluate(() => GT.station.view.focus())) === null, C, "全部の階に戻らない");
  await p.evaluate(() => GT.station.view.reset());
}

// 見本に戻しても壊れない
{
  await p.selectOption("#stWhich", "sample");
  await p.waitForFunction(() => GT.station && GT.station.which === "sample");
  const r = await p.evaluate(() => GT.station.compute().r);
  ok(r.ok && r.sec === 219.5, "back", "見本に戻した時の経路が元と違う " + r.sec);
}

for (const e of errs) failures.push("[console] " + e);
await c.close();
await browser.close();
writeFileSync(join(out, "shinjuku-perf.json"), JSON.stringify(perf, null, 1) + "\n");
console.log(JSON.stringify(perf, null, 1));
if (failures.length) { console.log("失敗:\n" + failures.join("\n")); process.exit(1); }
console.log("すべて合格");
