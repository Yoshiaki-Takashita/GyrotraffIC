// 新宿駅の下書きを駅の立体図で読む試験（ヘッドレス Chromium・playwright-core・ブラウザは 1 本ずつ）。
// 使い方: NODE_PATH=/opt/node-tools/node_modules node ui-variants/e-station3d/tests/shinjuku.mjs
// 確かめること：駅の切り替え（見本／新宿）・コンソールのエラー 0・施設の数が元データと一致・床は水平（斜めは階段・エスカレーターのモデルだけ）・
//               ルートの周りだけを描く（全体より線が少ない）・3 種のルート（最短・段差を避ける・トイレ）と「回避できない」の表示・
//               ルートの近くの施設だけ（上限・件数・記号が重ならない）・ルートに合わせたカメラと区間送り・拡大の上限・
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
const perf = {};
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
  for (const k of ["toilet", "stairs", "escalator", "elevator", "exit", "gate"]) ok(r.counts[k] === want[k], C, `${k} の数 ${r.counts[k]} ≠ 元データ ${want[k]}`);
  // 記号（引き出し線のアイコン）の元になる施設はトイレ・エレベーター・出口・改札。階段・エスカレーターは記号でなく 3D のモデル
  for (const k of ["toilet", "elevator", "exit", "gate"]) ok(r.glyphs[k] === want[k], C, `${k} の記号の元の数 ${r.glyphs[k]} ≠ 元データ ${want[k]}`);
  ok(!r.glyphs.stairs && !r.glyphs.escalator, C, "階段・エスカレーターが記号になっている");
  ok(r.counts.platform === raw.platforms.length, C, "ホームの数が違う");
  ok(r.levels === raw.levels.length, C, "階の数が違う");
  ok(r.dropped.nodes === 0 && r.dropped.edges === 0, C, "元データの点・辺を捨てている " + JSON.stringify(r.dropped));
  ok(r.tracks === 0, C, "線路は空のまま（作らない）");
  ok(/不明/.test(r.carDoor || ""), C, "号車・ドアが「不明」と出ていない");
  const names = await p.$$eval("#sjFrom option", (o) => o.map((x) => x.textContent));
  ok(names.some((t) => /名前不明/.test(t)), C, "名前のないホームが「名前不明」と出ていない");
  ok(r.unnamed === raw.platforms.filter((x) => !x.name).length, C, "名前のないホームの数が違う");
}

// 床は水平・斜めは階段・エスカレーターのモデルだけ（全体の形と、ルートの周りだけの形の両方）
{
  const C = "floors";
  const r = await p.evaluate(() => {
    const v = GT.station.view, H = Object.values(v._levelHeights());
    const chk = (S) => {
      const bad = [], floorBad = [];
      for (const s of S) {
        const dy = Math.abs(s.a[1] - s.b[1]), dh = Math.hypot(s.a[0] - s.b[0], s.a[2] - s.b[2]);
        if (dy > 1e-6 && dh > 1e-6 && s.tag !== "stairs" && s.tag !== "escalator") bad.push(s);
        if (s.tag === "floor" && (dy > 1e-9 || !H.some((h) => Math.abs(s.a[1] - h) < 1e-9))) floorBad.push(s);
      }
      return { n: S.length, floors: S.filter((s) => s.tag === "floor").length, bad: bad.length, floorBad: floorBad.length,
        stairs: S.filter((s) => s.tag === "stairs" && s.kind === "stairs").length, esc: S.filter((s) => s.tag === "escalator").length, elev: S.filter((s) => s.kind === "elevator").length };
    };
    return { all: chk(v._segsAll()), route: chk(v._segs()), scoped: v._state().scoped };
  });
  ok(r.all.floors > 1000, C, "床の線が少ない " + r.all.floors);
  for (const k of ["all", "route"]) {
    ok(r[k].floorBad === 0, C, `${k}：床が傾いている・階の高さと違う ` + r[k].floorBad);
    ok(r[k].bad === 0, C, `${k}：階段・エスカレーター以外に斜めの線 ` + r[k].bad);
  }
  ok(r.all.stairs > 400 && r.all.esc > 250 && r.all.elev > 100, C, "階段・エスカレーター・エレベーターのモデルが少ない " + JSON.stringify(r.all));
  ok(r.scoped, C, "ルートの周りだけを描く状態になっていない");
  ok(r.route.n < r.all.n * 0.6, C, `ルート表示の線が全体と比べて減っていない ${r.route.n} / ${r.all.n}`);
  perf._segs = { all: r.all.n, route: r.route.n };
}

// 1 コマの描画時間（全体・1 階だけ強調・拡大）。各 60 コマを同期で描いて測る
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
await p.screenshot({ path: join(out, "shinjuku-route.png") });
await measure("ルート全体");
// 比べるため：ルートなし（駅の全部を描く・以前の「全体」と同じ量）
await p.evaluate(() => GT.station.view.setRoute(null));
await p.waitForTimeout(100);
await p.screenshot({ path: join(out, "shinjuku-all.png") });
await measure("全体（ルートなし）");
await p.evaluate(() => GT.station.view.setRoute(GT.station.last.r));
await p.waitForTimeout(100);

// ルートの近くの施設だけ：上限・件数・記号が重ならない・行き先の出口が入る
{
  const C = "near";
  const r = await p.evaluate(() => { const v = GT.station.view; v._drawOnce(); return { info: v.nearInfo(), icons: v._icons(), text: document.querySelector("#stNear").textContent }; });
  ok(r.info.shown > 0 && r.info.shown <= 8, C, "記号の数が上限を超える・0 " + r.info.shown);
  ok(r.info.items >= r.info.shown && r.info.items < r.info.all, C, "件数が変 " + JSON.stringify(r.info));
  ok(r.info.list.some((g) => g.goal), C, "行き先の施設が記号に入っていない");
  ok(r.info.list.some((g) => g.n > 1), C, "近いものがまとまっていない（件数つきの記号がない）");
  ok(r.info.list.every((g) => g.d <= 40), C, "ルートから遠い施設が入っている");
  ok(new RegExp(r.info.items + " 件").test(r.text), C, "件数の表示がない " + r.text);
  for (let i = 0; i < r.icons.length; i++) for (let j = i + 1; j < r.icons.length; j++) {
    const a = r.icons[i].box, b = r.icons[j].box;
    ok(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1], C, "記号が重なる");
  }
  perf._near = r.info;
}

// ルートに合わせたカメラ・区間送り・拡大の上限
{
  const C = "camera";
  const r0 = await p.evaluate(() => { const v = GT.station.view, d = GT.station.last.r; const pts = d.path.map((id) => GT.station.data.nodes.find((n) => n.id === id)).filter(Boolean);
    const q = pts.map((n) => v._project(n.x, n.y, n.level, 0.6)).filter(Boolean); const W = v._state(); return { inside: q.filter((s) => s[0] >= 0 && s[0] <= 390 && s[1] >= 0 && s[1] <= 470).length, n: q.length, px: v._pxPerM(), lim: v._zoomLimits(), secs: v.sectionCount() }; });
  ok(r0.inside === r0.n, C, `ルートが画面に収まっていない ${r0.inside}/${r0.n}`);
  ok(r0.lim.max >= 100, C, "拡大の上限が小さい " + r0.lim.max);
  ok(r0.secs >= 3, C, "区間が少ない " + r0.secs);
  await p.click("#stNext");
  await p.waitForTimeout(150);
  const r1 = await p.evaluate(() => ({ sec: GT.station.view.section(), px: GT.station.view._pxPerM(), cur: document.querySelectorAll('.st-step[aria-current="true"]').length, label: document.querySelector("#stSecN").textContent }));
  ok(r1.sec === 0, C, "次の区間へ進まない " + r1.sec);
  ok(r1.px > r0.px * 1.5, C, `区間に寄らない ${r0.px} → ${r1.px}`);
  ok(r1.cur === 1, C, "手順の一覧で今の区間が強調されない");
  ok(/区間 1／/.test(r1.label), C, "区間の表示がない " + r1.label);
  // 階段かエスカレーターの区間を探して、もっと寄る（モデルのアップ）
  const k = await p.evaluate(() => { const v = GT.station.view, S = GT.stationGraph.sections(GT.station.last.r); const f = (g) => S.findIndex((s) => (s.kind === "stairs" || s.kind === "escalator") && (g || !s.guess)); return f(false) >= 0 ? f(false) : f(true); });
  ok(k >= 0, C, "経路に階段・エスカレーターの区間がない");
  await p.evaluate((k) => GT.station.view.setSection(k), k);
  await p.waitForTimeout(150);
  await p.screenshot({ path: join(out, "shinjuku-route-zoom.png") });
  await measure("区間に寄った時");
  await p.evaluate(() => GT.station.view._setCam(-40 * Math.PI / 180, 30 * Math.PI / 180));
  await p.focus("#stc"); for (let i = 0; i < 12; i++) await p.keyboard.press("+");
  await p.waitForTimeout(100);
  const r2 = await p.evaluate(() => GT.station.view._pxPerM());
  ok(r2 > 20, C, "画面上 1 m が 20 px より大きくならない（拡大の限界・区間に寄ってさらに＋12 回） " + r2.toFixed(1));
  await p.screenshot({ path: join(out, "shinjuku-models.png") });
  await p.click("#stPrev"); await p.waitForTimeout(100);
  ok((await p.evaluate(() => GT.station.view.section())) === k - 1, C, "前の区間へ戻らない");
  await p.click("#stFit"); await p.evaluate(() => GT.station.view.reset()); await p.waitForTimeout(100);
  ok((await p.evaluate(() => GT.station.view.section())) === -1, C, "ルート全体に戻らない");
  // 手順の行を押すとその区間へ
  await p.click('.st-step[data-sec="1"]'); await p.waitForTimeout(100);
  ok((await p.evaluate(() => GT.station.view.section())) === 1, C, "手順の行を押しても区間に寄らない");
  await p.click("#stFit");
  perf._zoom = { wholePxPerM: +r0.px.toFixed(2), sectionPxPerM: +r1.px.toFixed(2), maxedPxPerM: +r2.toFixed(1) };
}

// 3 種のルート：段差を避ける（回避できない時の表示）・トイレ
{
  const C = "modes";
  const fast = await p.evaluate(() => GT.station.last.r.stepEdges);
  ok((await p.getAttribute("#stMode-fast", "aria-pressed")) === "true", C, "最初は最短のはず");
  await p.click("#stStep"); await p.waitForTimeout(200);
  const a = await p.evaluate(() => ({ r: GT.station.last.r, no: document.querySelectorAll(".st-avoid-no").length, okN: document.querySelectorAll(".st-avoid-ok").length, text: (document.querySelector(".st-avoid-no") || {}).textContent }));
  ok(a.r.ok, C, "段差を避けるルートが出ない");
  ok(a.r.stepEdges <= fast, C, `段差を避けても階段・エスカレーターが減らない ${fast} → ${a.r.stepEdges}`);
  ok(a.r.stepEdges ? a.no === 1 && /回避できない/.test(a.text) && new RegExp(a.r.stepEdges + " 区間").test(a.text) : a.okN === 1, C, "回避できる／できないの表示が違う " + JSON.stringify({ n: a.r.stepEdges, no: a.no, ok: a.okN }));
  await p.screenshot({ path: join(out, "shinjuku-avoid.png") });
  perf._avoid = { fastStepEdges: fast, avoidStepEdges: a.r.stepEdges, sec: a.r.sec };
  await p.click("#stMode-toilet"); await p.waitForTimeout(200);
  const w = await p.evaluate(() => { const r = GT.station.last.r, d = GT.station.data; return { ok: r.ok, goalKind: (d.nodes.find((n) => n.id === r.goal) || {}).kind, note: (document.querySelector(".st-toilet") || {}).textContent, big: document.querySelector("#sjBig").textContent, goalIcon: GT.station.view.nearInfo().list.some((g) => g.goal && g.kind === "toilet") }; });
  ok(w.ok && w.goalKind === "toilet", C, "トイレのルートの終点がトイレでない");
  ok(/最寄りのトイレ/.test(w.note || ""), C, "最寄りのトイレの表示がない");
  ok(w.goalIcon, C, "行き先のトイレが記号に出ない");
  await p.screenshot({ path: join(out, "shinjuku-toilet.png") });
  perf._toilet = w;
  // トイレへの道がない時（つながらないホーム）は「経路不明」
  const iso = await p.evaluate(() => { const d = GT.station.data, Cc = GT.stationGraph.components(d); const pl = d.platforms.find((x) => !x.access.some((id) => Cc.of[id] === 0) && !GT.stationGraph.route(d, { platform: x.id }, { kind: "toilet" }).ok); return pl && pl.id; });
  if (iso) {
    const keep = await p.inputValue("#sjFrom");
    await p.selectOption("#sjFrom", iso); await p.waitForTimeout(150);
    ok(/経路不明/.test(await p.textContent("#sjBig")) && (await p.locator(".st-toilet-none").count()) === 1, C, "トイレへ行けない時に「経路不明」と出ない");
    await p.selectOption("#sjFrom", keep); await p.waitForTimeout(150);
  } else ok(false, C, "トイレへ行けないホームが見つからない（試験の前提）");
  await p.click("#stMode-fast"); await p.waitForTimeout(150);
  ok((await p.evaluate(() => GT.station.last.r.stepEdges)) === fast, C, "最短に戻らない");
}

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
