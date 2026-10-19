// 3D 駅マップの注視点まわりの回転の試験（ヘッドレス Chromium・ブラウザ 1 本）。
// 使い方: NODE_PATH=/opt/node-tools/node_modules node ui-variants/e-station3d/tests/orbit.mjs
// 確かめること：回転の前後で注視点の画面位置が変わらない／カーソルの下の点がズームの前後で動かない／パンで注視点が動く／
//               区間送り後の回転が新しい注視点まわり／拡大＋回転で拡大していた場所が画面から消えない。出力: docs/ui-variants/e-station3d/orbit-*.png
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
ok(near(a.center, b.screen) && near(b.screen, b.center), "回転で注視点が画面中央から動く " + JSON.stringify([a, b]));
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
await p.mouse.move(cb.x + 200, cb.y + 200); await p.mouse.down(); await p.mouse.move(cb.x + 320, cb.y + 240, { steps: 10 }); await p.mouse.up();
await p.waitForTimeout(1500);   // 慣性が止まるまで
const pv1 = await V(() => GT.station.view._pivot());
ok(near(pv1.screen, pv1.center) && Math.hypot(pv1.t[0] - pv0.t[0], pv1.t[2] - pv0.t[2]) < 1e-6, "ドラッグの回転が注視点まわりでない " + JSON.stringify([pv0, pv1]));
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
// 5 区間送りの後の回転は新しい注視点まわり
const n = await V(() => GT.station.view.sectionCount());
if (n > 0) {
  await V(() => GT.station.view.setSection(0)); await p.waitForTimeout(900);
  const f = await V(() => GT.station.view._state().fitted);
  const q0 = await V((f) => GT.station.view._projW([f.tx, f.ty, f.tz]), f);
  await V(() => GT.station.view._rotate(0.8, -0.1));
  const q1 = await V((f) => GT.station.view._projW([f.tx, f.ty, f.tz]), f);
  ok(near(q0, q1, 3), "区間送りの後の回転で区間の中心がずれる " + JSON.stringify([q0, q1]));
} else ok(false, "ルートの区間がない（試験の前提が崩れた）");
// 6 視点リセットは従来どおり（初めの向き・ルート全体の倍率）
await p.click("#stReset");
const r = await V(() => ({ c: GT.station.view._state().cam, f: GT.station.view._state().fitted }));
ok(!r.f || Math.abs(r.c.zoom - r.f.zoom) < 1e-9, "視点を戻せない");
for (const e of errs) failures.push("コンソール: " + e);
await browser.close();
if (failures.length) { console.log(`失敗 ${failures.length} 件`); for (const f of failures) console.log("  " + f); process.exitCode = 1; } else console.log("すべて合格");
