// e-station3d で足した所の試験（ヘッドレス Chromium・playwright-core・ブラウザは 1 本ずつ）。
// 使い方: NODE_PATH=/opt/node-tools/node_modules node ui-variants/e-station3d/tests/station.mjs [--no-video]
// 確かめること：始発・終電のボタン（最上部・アイコン・aria-label・押すと 1 案だけ）／極細のスクロールの棒（標準の棒なし・当たり判定 24px 以上・ドラッグで動く）／
//               駅の立体図（描けている・最短の道の秒数・おすすめのドア・段差なしで「不明」・回転・拡大・キー操作）／動きを減らす設定／コンソールのエラー 0。
// 出力: docs/ui-variants/e-station3d/*.png と videos/*.webm
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, statSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..");
const url = pathToFileURL(join(root, "ui-variants", "e-station3d", "index.html")).href;
const out = join(root, "docs", "ui-variants", "e-station3d");
const vids = join(out, "videos");
mkdirSync(vids, { recursive: true });
const video = !process.argv.includes("--no-video");

function findExe() {
  const base = "/opt/pw-browsers";
  for (const d of readdirSync(base).sort().reverse()) for (const p of ["chrome-linux/chrome", "chrome-linux/headless_shell", "chrome-headless-shell-linux64/chrome-headless-shell"]) {
    try { if (statSync(join(base, d, p)).isFile()) return join(base, d, p); } catch {}
  }
}
const failures = [];
const fail = (c, m) => failures.push(`[${c}] ${m}`);
const ok = (cond, c, m) => { if (!cond) fail(c, m); };
const browser = await chromium.launch({ executablePath: findExe(), headless: true });
async function ctx(o = {}) {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: "dark", ...o });
  await c.addInitScript(() => { try { sessionStorage.setItem("gyrotraffic.splash", "1"); } catch (e) {} });
  const p = await c.newPage();
  p.__errs = [];
  p.on("console", (m) => { if (m.type() === "error") p.__errs.push(m.text()); });
  p.on("pageerror", (e) => p.__errs.push(String(e)));
  p.on("request", (r) => { if (!r.url().startsWith("file:")) p.__errs.push("外部通信: " + r.url()); });
  return { c, p };
}
const done = async (name, { c, p }) => { for (const e of p.__errs) fail(name, "コンソール: " + e); await c.close(); };

// 1 始発・終電
for (const theme of ["dark", "light"]) {
  const k = await ctx({ colorScheme: theme }), p = k.p, C = "quick-" + theme;
  await p.goto(url + "#/home");
  await p.waitForTimeout(400);
  for (const id of ["#qFirst", "#qLast"]) {
    const b = await p.locator(id).boundingBox();
    ok(b && b.y < 140 && b.height >= 44 && b.width >= 44, C, `${id} が最上部にない・小さい ${JSON.stringify(b)}`);
    ok(!!(await p.getAttribute(id, "aria-label")), C, `${id} に aria-label がない`);
    ok((await p.locator(id + " svg").count()) === 1, C, `${id} にアイコンがない`);
  }
  // スクロールしても上に貼り付いたまま
  await p.evaluate(() => { document.getElementById("view").scrollTop = 400; });
  await p.waitForTimeout(100);
  const b2 = await p.locator("#qFirst").boundingBox();
  ok(b2.y < 140, C, "スクロールすると始発のボタンが隠れる " + b2.y);
  await p.evaluate(() => { document.getElementById("view").scrollTop = 0; });
  await p.fill("#fFrom", "北見台（架空）");
  await p.fill("#fTo", "海浜公園（架空）");
  if (theme === "dark") await p.screenshot({ path: join(out, "home-quick-dark.png") });
  else await p.screenshot({ path: join(out, "home-quick-light.png") });
  await p.click("#qFirst");
  await p.waitForSelector(".jr");
  ok(/mode=first/.test(p.url()), C, "始発で mode=first にならない");
  ok((await p.locator(".jr").count()) === 1, C, "始発で 1 案にならない");
  const tFirst = await p.locator(".jr-time time").first().textContent();
  ok((await p.locator(".note").first().textContent()).includes("始発"), C, "始発の注記がない");
  await p.waitForTimeout(900);
  if (theme === "dark") await p.screenshot({ path: join(out, "results-first-dark.png") });
  await p.goto(url + "#/home");
  await p.fill("#fFrom", "北見台（架空）");
  await p.fill("#fTo", "海浜公園（架空）");
  await p.click("#qLast");
  await p.waitForSelector(".jr");
  const tLast = await p.locator(".jr-time time").first().textContent();
  ok(tLast > tFirst, C, `終電(${tLast})が始発(${tFirst})より遅くない`);
  // 何も入れずに押すと拒否（震え＋文言）
  await p.goto(url + "#/home");
  await p.fill("#fFrom", ""); await p.fill("#fTo", "");
  await p.click("#qLast");
  ok(((await p.textContent("#ferr")) || "").length > 0, C, "空のまま押しても拒否されない");
  // タブはアイコンだけ・名前は aria-label
  const tabs = await p.$$eval(".tab", (a) => a.map((x) => ({ l: x.getAttribute("aria-label"), txt: x.textContent.trim(), svg: !!x.querySelector("svg") })));
  ok(tabs.length === 4 && tabs.every((x) => x.l && !x.txt && x.svg), C, "タブがアイコンだけ＋aria-label でない " + JSON.stringify(tabs));
  await done(C, k);
}

// 2 スクロールの棒
{
  const k = await ctx({ viewport: { width: 320, height: 640 }, colorScheme: "dark", isMobile: false, hasTouch: false }), p = k.p, C = "scrollbar";
  await p.goto(url + "#/station");
  await p.waitForTimeout(600);
  const g = await p.evaluate(() => { const v = document.getElementById("view"); return { native: v.offsetWidth - v.clientWidth, sh: v.scrollHeight, ch: v.clientHeight }; });
  ok(g.native === 0, C, "標準のスクロールの棒が幅を取っている " + g.native);
  ok(g.sh > g.ch + 50, C, "試験の画面がスクロールしない");
  ok(await p.evaluate(() => !document.querySelector(".sb").classList.contains("on")), C, "最初から棒が出ている");
  await p.mouse.move(150, 560);
  await p.mouse.wheel(0, 120);
  await p.waitForTimeout(200);
  const st = await p.evaluate(() => {
    const th = document.querySelector(".sb-th"), r = th.getBoundingClientRect(), vis = getComputedStyle(th, "::before");
    return { on: document.querySelector(".sb").classList.contains("on"), hitW: r.width, hitH: r.height, visW: parseFloat(vis.width), op: parseFloat(vis.opacity), pe: getComputedStyle(th).pointerEvents, x: r.left, y: r.top };
  });
  ok(st.on, C, "スクロールしても棒が出ない");
  ok(st.hitW >= 24, C, "当たり判定が 24px 未満 " + st.hitW);
  ok(st.visW <= 5, C, "見た目の棒が太い " + st.visW);
  ok(st.pe === "auto", C, "出ている間につまみを掴めない");
  await p.waitForTimeout(150);
  await p.screenshot({ path: join(out, "scrollbar-320.png") });
  // 見た目の棒から 10px 左（透明な当たり判定）を掴んでドラッグ
  const s0 = await p.evaluate(() => document.getElementById("view").scrollTop);
  const th = await p.locator(".sb-th").boundingBox();
  await p.mouse.move(th.x + th.width - 14, th.y + th.height / 2);
  await p.mouse.down();
  await p.mouse.move(th.x + th.width - 14, th.y + th.height / 2 + 60, { steps: 6 });
  const mid = await p.evaluate(() => document.querySelector(".sb").classList.contains("drag"));
  await p.mouse.up();
  const s1 = await p.evaluate(() => document.getElementById("view").scrollTop);
  ok(mid, C, "ドラッグ中の表示にならない");
  ok(s1 > s0 + 40, C, `ドラッグでスクロールしない ${s0}→${s1}`);
  // 消える（0.9 秒）
  await p.waitForTimeout(1400);
  ok(await p.evaluate(() => !document.querySelector(".sb").classList.contains("on")), C, "棒が消えない");
  // 隠れている間は右端の操作を邪魔しない
  ok(await p.evaluate(() => getComputedStyle(document.querySelector(".sb-th")).pointerEvents === "none"), C, "隠れたつまみが押せてしまう");
  await done(C, k);
}

// 3 駅の立体図
const litPixels = (p) => p.evaluate(() => {
  const c = document.getElementById("stc"), g = document.createElement("canvas");
  g.width = c.width; g.height = c.height; const x = g.getContext("2d"); x.drawImage(c, 0, 0);
  const d = x.getImageData(0, 0, g.width, g.height).data; let n = 0, acc = 0;
  for (let i = 0; i < d.length; i += 4) { if (d[i] + d[i + 1] + d[i + 2] > 300) n++; if (d[i + 1] > 150 && d[i] < 140) acc++; }
  return { n, acc };
});
for (const theme of ["dark", "light"]) {
  const k = await ctx({ colorScheme: theme }), p = k.p, C = "station-" + theme;
  await p.goto(url + "#/home");
  await p.click('.tab[href="#/station"]');
  await p.waitForSelector("#stc");
  await p.waitForTimeout(2600);
  const px = await litPixels(p);
  ok(px.n > 1500, C, "白い線がほとんど描けていない " + px.n);
  ok(px.acc > 200, C, "経路の光る線が描けていない " + px.acc);
  ok((await p.textContent(".st-big")).trim() === "3分40秒", C, "7号車3番ドア→環線の時間が違う " + (await p.textContent(".st-big")));
  ok((await p.locator(".st-step").count()) >= 4, C, "手順の一覧が短い");
  await p.screenshot({ path: join(out, `station-${theme}.png`) });
  await p.click("#stBest");
  await p.waitForTimeout(300);
  ok((await p.inputValue("#stCar")) === "5" && (await p.inputValue("#stDoor")) === "4", C, "おすすめのドアが 5号車4番ドアでない");
  ok((await p.textContent(".st-big")).trim() === "3分6秒", C, "おすすめの時間が違う " + (await p.textContent(".st-big")));
  ok((await p.locator(".st-prop.is-same").count()) === 1, C, "おすすめにした後も別のドアを勧める");
  // 段差なし：エレベーター3 の秒数は不明
  await p.click("#stStep");
  await p.waitForTimeout(300);
  ok((await p.getAttribute("#stStep", "aria-pressed")) === "true", C, "段差なしの押下の状態");
  const big = (await p.textContent(".st-big")).trim();
  ok(/不明/.test(big), C, "段差なしで不明が出ない " + big);
  ok((await p.locator(".st-step .st-unk").count()) === 1, C, "手順に不明の区間が出ない");
  ok(await p.evaluate(() => [...document.querySelectorAll(".st-step")].every((li) => !li.classList.contains("k-stairs") && !li.classList.contains("k-escalator"))), C, "段差なしで階段・エスカレーターを使う");
  if (theme === "dark") { await p.waitForTimeout(1400); await p.screenshot({ path: join(out, "station-stepfree-dark.png") }); }
  await p.click("#stStep");
  // 回転・拡大・キー
  const s0 = await p.evaluate(() => GT.station.view._state().cam);
  const cb = await p.locator("#stc").boundingBox();
  await p.mouse.move(cb.x + 150, cb.y + 200); await p.mouse.down(); await p.mouse.move(cb.x + 260, cb.y + 230, { steps: 8 }); await p.mouse.up();
  const s1 = await p.evaluate(() => GT.station.view._state().cam);
  ok(Math.abs(s1.yaw - s0.yaw) > 0.3 && s1.pitch !== s0.pitch, C, "ドラッグで回らない");
  await p.mouse.move(cb.x + 150, cb.y + 200); await p.mouse.wheel(0, -400); await p.waitForTimeout(100);
  const s2 = await p.evaluate(() => GT.station.view._state().cam);
  ok(s2.zoom > s1.zoom * 1.3, C, "ホイールで拡大しない");
  await p.focus("#stc"); await p.keyboard.press("ArrowLeft"); await p.keyboard.press("-");
  const s3 = await p.evaluate(() => GT.station.view._state().cam);
  ok(s3.zoom < s2.zoom && s3.yaw !== s2.yaw, C, "キー操作が効かない");
  await p.click("#stReset");
  const s4 = await p.evaluate(() => GT.station.view._state().cam);
  ok(Math.abs(s4.yaw - s0.yaw) < 1e-6 && s4.zoom === 1, C, "視点を戻せない");
  // 2 本指のつまみ（CDP のタッチ）
  if (theme === "dark") {
    const cdp = await k.c.newCDPSession(p);
    const tp = (pts) => pts.map((q, i) => ({ x: q[0], y: q[1], id: i }));
    const cxp = cb.x + cb.width / 2, cyp = cb.y + cb.height / 2;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: tp([[cxp - 30, cyp], [cxp + 30, cyp]]) });
    for (let i = 1; i <= 8; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: tp([[cxp - 30 - i * 10, cyp], [cxp + 30 + i * 10, cyp]]) });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const s5 = await p.evaluate(() => GT.station.view._state().cam);
    ok(s5.zoom > 1.5, C, "ピンチで拡大しない " + s5.zoom);
    await p.click("#stSpread");
    await p.waitForTimeout(900);
    ok((await p.evaluate(() => GT.station.view._state().spread)) > 4.9, C, "階の間隔が広がらない");
    await p.screenshot({ path: join(out, "station-spread-zoom-dark.png") });
    // 他のホーム・出口へ
    await p.selectOption("#stFrom", "P34");
    await p.selectOption("#stTo", "EXN");
    await p.waitForTimeout(1500);
    ok(/秒/.test(await p.textContent(".st-big")), C, "3・4番線→北口の時間が出ない");
    await p.click("#stSpread");
  }
  // 画面を離れると描画の繰り返しが止まる
  await p.click('.tab[href="#/saved"]');
  await p.waitForTimeout(800);
  ok(await p.evaluate(() => !GT.station.view._state().running), C, "画面を離れても描画が回り続ける");
  await done(C, k);
}

// 4 動きを減らす設定
{
  const k = await ctx({ reducedMotion: "reduce" }), p = k.p, C = "reduced";
  await p.goto(url + "#/station");
  await p.waitForSelector("#stc");
  await p.waitForTimeout(150);
  const s = await p.evaluate(() => GT.station.view._state());
  ok(s.routeT === 1, C, "経路の線が最初から全部出ていない");
  await p.waitForTimeout(400);
  ok(!(await p.evaluate(() => GT.station.view._state().running)), C, "描画の繰り返しが止まらない（光の粒・慣性が動いている）");
  const cb = await p.locator("#stc").boundingBox();
  await p.mouse.move(cb.x + 100, cb.y + 200); await p.mouse.down(); await p.mouse.move(cb.x + 220, cb.y + 200, { steps: 4 }); await p.mouse.up();
  const y1 = await p.evaluate(() => GT.station.view._state().cam.yaw);
  await p.waitForTimeout(300);
  const y2 = await p.evaluate(() => GT.station.view._state().cam.yaw);
  ok(y1 === y2, C, "手を離した後も慣性で回る");
  await p.click("#stSpread");
  ok((await p.evaluate(() => GT.station.view._state().spread)) > 4.9, C, "階の間隔が即時に変わらない");
  await p.screenshot({ path: join(out, "station-reduced.png") });
  await done(C, k);
}

// 5 短い動画（駅の立体図：経路が伸びる→回す→おすすめのドア→段差なし）
if (video) {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: "dark", recordVideo: { dir: vids, size: { width: 390, height: 844 } } });
  await c.addInitScript(() => { try { sessionStorage.setItem("gyrotraffic.splash", "1"); } catch (e) {} });
  const p = await c.newPage();
  await p.goto(url + "#/home");
  await p.waitForTimeout(600);
  await p.click('.tab[href="#/station"]');
  await p.waitForTimeout(2200);
  const cb = await p.locator("#stc").boundingBox();
  await p.mouse.move(cb.x + 120, cb.y + 220); await p.mouse.down();
  await p.mouse.move(cb.x + 280, cb.y + 250, { steps: 30 }); await p.mouse.up();
  await p.waitForTimeout(1200);
  await p.mouse.move(cb.x + 200, cb.y + 220); for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, -90); await p.waitForTimeout(60); }
  await p.waitForTimeout(600);
  await p.click("#stReset"); await p.waitForTimeout(500);
  await p.click("#stBest"); await p.waitForTimeout(2200);
  await p.click("#stSpread"); await p.waitForTimeout(1200);
  await p.click("#stStep"); await p.waitForTimeout(1800);
  // スクロールの棒（つまみを掴んで下へ）
  await p.mouse.move(200, 600); await p.mouse.wheel(0, 100); await p.waitForTimeout(250);
  const th = await p.locator(".sb-th").boundingBox();
  await p.mouse.move(th.x + th.width - 12, th.y + th.height / 2); await p.mouse.down();
  await p.mouse.move(th.x + th.width - 12, th.y + th.height / 2 + 120, { steps: 20 }); await p.mouse.up();
  await p.waitForTimeout(1500);
  const v = p.video();
  await c.close();
  const src = await v.path();
  renameSync(src, join(vids, "station3d.webm"));
  // 始発・終電
  const c2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: "dark", recordVideo: { dir: vids, size: { width: 390, height: 844 } } });
  await c2.addInitScript(() => { try { sessionStorage.setItem("gyrotraffic.splash", "1"); } catch (e) {} });
  const p2 = await c2.newPage();
  await p2.goto(url + "#/home");
  await p2.waitForTimeout(500);
  await p2.click("#qFirst"); await p2.waitForTimeout(900);
  await p2.fill("#fFrom", "北見台（架空）"); await p2.fill("#fTo", "海浜公園（架空）");
  await p2.waitForTimeout(400);
  await p2.click("#qFirst"); await p2.waitForTimeout(2200);
  await p2.click("#backBtn"); await p2.waitForTimeout(900);
  await p2.click("#qLast"); await p2.waitForTimeout(2200);
  const v2 = p2.video();
  await c2.close();
  renameSync(await v2.path(), join(vids, "first-last.webm"));
}
await browser.close();
if (failures.length) { console.log(`失敗 ${failures.length} 件`); for (const f of failures) console.log("  " + f); process.exitCode = 1; }
else console.log("すべて合格");
