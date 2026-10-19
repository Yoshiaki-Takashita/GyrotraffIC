// 3D 駅マップの注視点まわりの回転の試験（ヘッドレス Chromium・ブラウザ 1 本）。
// 使い方: NODE_PATH=/opt/node-tools/node_modules node ui-variants/e-station3d/tests/orbit.mjs
// 確かめること：回転の中心＝キャンバスの見た目の中心の下に描かれている物の点（回し始めに採り、回転中は固定）／
//               拡大→パン→回転・区間送り→回転・階を選択→回転（見本と新宿）で、中心の下の点のずれが 1px 未満（ヨー・ピッチとも、実際のドラッグ）／
//               カーソルの下の点がズームの前後で動かない／パンで注視点が動く／拡大＋回転で拡大していた場所が画面から消えない。
//               ライト・ダークの配色（紙の面にインク／黒い面に白）。出力: docs/ui-variants/e-station3d/orbit-*.png・map-*.png
import { createRequire } from "node:module";
import { readdirSync, statSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..");
const url = pathToFileURL(join(root, "ui-variants", "e-station3d", "index.html")).href;
const out = join(root, "docs", "ui-variants", "e-station3d"); mkdirSync(out, { recursive: true });
function findExe() {
  for (const d of readdirSync("/opt/pw-browsers").sort().reverse()) for (const p of ["chrome-linux/chrome", "chrome-linux/headless_shell", "chrome-headless-shell-linux64/chrome-headless-shell"]) {
    try { if (statSync(join("/opt/pw-browsers", d, p)).isFile()) return join("/opt/pw-browsers", d, p); } catch {}
  }
}
const failures = [], ok = (c, m) => { if (!c) failures.push(m); };
const near = (a, b, e = 1.5) => a && b && Math.hypot(a[0] - b[0], a[1] - b[1]) <= e;
const browser = await chromium.launch({ executablePath: findExe(), headless: true });
const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: "dark" });
await c.addInitScript(() => { try { sessionStorage.setItem("gyrotraffic.splash", "1"); } catch (e) {} });
const p = await c.newPage(); const errs = [];
p.on("pageerror", (e) => errs.push(String(e))); p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
await p.goto(url + "#/station"); await p.waitForTimeout(1500);
const V = (f, a) => p.evaluate(f, a);
// 1 回転の前後で注視点の画面位置が同じ
let a = await V(() => GT.station.view._pivot());
await V(() => GT.station.view._rotate(0.7, 0.2));
let b = await V(() => GT.station.view._pivot());
ok(near(b.screen, b.center, 1) && near(b.center, [195, (await p.locator("#stc").boundingBox()).height / 2], 0.6), "回転の中心がキャンバスの見た目の中心でない " + JSON.stringify([a, b]));
// 2 カーソルの下の点がズームで動かない（ホイール・実際のマウス）
const cb = await p.locator("#stc").boundingBox();
const sx = 120, sy = 150;
const w0 = await V(([x, y]) => GT.station.view._unproject(x, y), [sx, sy]);
await p.mouse.move(cb.x + sx, cb.y + sy); for (let i = 0; i < 5; i++) { await p.mouse.wheel(0, -200); await p.waitForTimeout(40); }
const s0 = await V((w) => GT.station.view._projW(w), w0);
ok(near(s0, [sx, sy], 1.5), "ズームでカーソルの下の点が動く " + JSON.stringify(s0));
ok(await V(() => GT.station.view._state().cam.zoom * GT.station.view._state().k) > 2, "ホイールで拡大しない");
await p.screenshot({ path: join(out, "orbit-zoom-before-rotate.png") });
// 3 拡大したままドラッグで回しても、拡大していた点が画面に残り、注視点は中央のまま
const pv0 = await V(() => GT.station.view._pivot());
await p.mouse.move(cb.x + 200, cb.y + 200); await p.mouse.down(); await p.mouse.move(cb.x + 260, cb.y + 220, { steps: 5 });
const pvMid = await V(() => GT.station.view._pivot());
await p.mouse.move(cb.x + 320, cb.y + 240, { steps: 5 }); await p.mouse.up();
await p.waitForTimeout(1500);   // 慣性が止まるまで
const pv1 = await V(() => GT.station.view._pivot());
ok(near(pv1.screen, pv1.center, 1) && Math.hypot(pv1.t[0] - pvMid.t[0], pv1.t[1] - pvMid.t[1], pv1.t[2] - pvMid.t[2]) < 1e-6, "ドラッグ中に回転の中心が動く " + JSON.stringify([pvMid, pv1]));
const s1 = await V((w) => GT.station.view._projW(w), w0);
ok(s1 && s1[0] > 0 && s1[0] < 390 && s1[1] > 0 && s1[1] < cb.height, "回転すると拡大していた点が画面の外へ飛ぶ " + JSON.stringify(s1));
await p.screenshot({ path: join(out, "orbit-zoom-after-rotate.png") });
// 4 パン（API とシフト+ドラッグ）で注視点が動き、画面上で指についてくる
const t0 = (await V(() => GT.station.view._pivot())).t;
const wc = await V(() => { const v = GT.station.view, c = v._pivot().center; return v._unproject(c[0], c[1], v._pivot().t[1]); });
await V(() => GT.station.view._pan(40, -30));
const t1 = (await V(() => GT.station.view._pivot())).t, sw = await V((w) => GT.station.view._projW(w), wc), cc = (await V(() => GT.station.view._pivot())).center;
ok(Math.hypot(t1[0] - t0[0], t1[2] - t0[2]) > 0.01, "パンで注視点が動かない");
ok(near(sw, [cc[0] + 40, cc[1] - 30], 1.5), "パンで床が指についてこない " + JSON.stringify(sw));
await p.keyboard.down("Shift"); await p.mouse.move(cb.x + 200, cb.y + 200); await p.mouse.down(); await p.mouse.move(cb.x + 150, cb.y + 260, { steps: 6 }); await p.mouse.up(); await p.keyboard.up("Shift");
const st2 = await V(() => GT.station.view._state().cam), t2 = (await V(() => GT.station.view._pivot())).t;
ok(Math.hypot(t2[0] - t1[0], t2[2] - t1[2]) > 0.01, "シフト+ドラッグでパンしない");
// 5 区間送りの後も回転の中心は画面の中心の下の物（区間が変わっても採り直す）
const n = await V(() => GT.station.view.sectionCount());
ok(n > 0, "ルートの区間がない（試験の前提が崩れた）");
// 6 視点リセットは従来どおり（初めの向き・ルート全体の倍率）
await p.click("#stReset");
const r = await V(() => ({ c: GT.station.view._state().cam, f: GT.station.view._state().fitted }));
ok(!r.f || Math.abs(r.c.zoom - r.f.zoom) < 1e-9, "視点を戻せない");
for (const e of errs) failures.push("コンソール: " + e);
await c.close();

// 7 場面ごとに、回す前に画面の中心の下に見えている点（_pick）が、実際のドラッグで回した後も中心から 1px 未満
async function scene(name, sj, setup, theme = "dark") {
  const cx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: theme });
  await cx.addInitScript((sj) => { try { sessionStorage.setItem("gyrotraffic.splash", "1"); localStorage.setItem("gyrotraffic.station", sj ? "shinjuku" : "sample"); } catch (e) {} }, sj);
  const pg = await cx.newPage(); const er = [];
  pg.on("pageerror", (e) => er.push(String(e))); pg.on("console", (m) => { if (m.type() === "error") er.push(m.text()); });
  await pg.goto(url + "#/station"); await pg.waitForFunction(() => GT.station && GT.station.view, null, { timeout: 15000 }); await pg.waitForTimeout(1200);
  await setup(pg); await pg.waitForTimeout(900);
  const bb = await pg.locator("#stc").boundingBox(), res = [];
  for (const [dx, dy, lab] of [[90, 0, "ヨー"], [0, 50, "ピッチ"]]) {
    const a0 = await pg.evaluate(() => GT.station.view._pick());
    await pg.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await pg.mouse.down();
    await pg.mouse.move(bb.x + bb.width / 2 + dx, bb.y + bb.height / 2 + dy, { steps: 8 }); await pg.mouse.up(); await pg.waitForTimeout(1500);
    const s1 = await pg.evaluate((w) => GT.station.view._projW(w), a0.p), ctr = [bb.width / 2, bb.height / 2];
    const d = s1 ? Math.hypot(s1[0] - ctr[0], s1[1] - ctr[1]) : 1e9;
    res.push(lab + " " + d.toFixed(2) + "px(" + a0.src + ")");
    ok(d < 1, `${name}：${lab}の回転で中心の下の点が ${d.toFixed(2)}px ずれる`);
  }
  console.log("  " + name + "：" + res.join("・"));
  for (const e of er) failures.push(name + " コンソール: " + e);
  return { cx, pg };
}
const zoomPan = async (pg) => { const bb = await pg.locator("#stc").boundingBox(); await pg.mouse.move(bb.x + 150, bb.y + 170); for (let i = 0; i < 6; i++) { await pg.mouse.wheel(0, -200); await pg.waitForTimeout(40); } await pg.evaluate(() => GT.station.view._pan(30, -20)); };
const secStep = async (pg) => { await pg.evaluate(() => GT.station.view.setSection(1)); await pg.waitForTimeout(800); };
for (const [name, sj, fn] of [["見本・拡大→パン→回転", false, zoomPan], ["見本・区間送り→回転", false, secStep], ["新宿・拡大→パン→回転", true, zoomPan], ["新宿・区間送り→回転", true, secStep], ["新宿・階を選択→回転", true, async (pg) => { await pg.locator(".sj-lv").nth(2).click(); }]]) {
  const k = await scene(name, sj, fn); await k.cx.close();
}
// 8 配色：ライト＝紙の面に濃い線／ダーク＝黒い面に白い線（テーマに従う）。両方の画像
for (const theme of ["light", "dark"]) {
  for (const sj of [false, true]) {
    const cx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: theme });
    await cx.addInitScript((sj) => { try { sessionStorage.setItem("gyrotraffic.splash", "1"); localStorage.setItem("gyrotraffic.station", sj ? "shinjuku" : "sample"); } catch (e) {} }, sj);
    const pg = await cx.newPage();
    await pg.goto(url + "#/station"); await pg.waitForFunction(() => GT.station && GT.station.view, null, { timeout: 15000 }); await pg.waitForTimeout(3600);
    const th = await pg.evaluate(() => GT.station.view._theme());
    const px = await pg.evaluate(() => { const c = document.querySelector("#stc"), x = c.getContext("2d").getImageData(4, 4, 1, 1).data; return [x[0], x[1], x[2]]; });
    const lum = (px[0] + px[1] + px[2]) / 3;
    ok(theme === "light" ? (!th.dark && lum > 220) : (th.dark && lum < 30), `${theme} の背景の色がテーマに合わない ${JSON.stringify(px)}`);
    if (sj) { await pg.evaluate(() => GT.station.view.setSection(1)); await pg.waitForTimeout(900); }
    await pg.screenshot({ path: join(out, `map-${sj ? "shinjuku" : "sample"}-${theme}.png`) });
    await cx.close();
  }
}
await browser.close();
if (failures.length) { console.log(`失敗 ${failures.length} 件`); for (const f of failures) console.log("  " + f); process.exitCode = 1; } else console.log("すべて合格");
