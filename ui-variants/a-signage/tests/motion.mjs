// 見せ場の動きの計測（この環境のヘッドレス Chromium での参考値。実機の値ではない）と、動きを減らす設定の確認。
// 使い方: NODE_PATH=/opt/node-tools/node_modules node ui-variants/a-signage/tests/motion.mjs
import { createRequire } from "node:module";
import { readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const here = dirname(fileURLToPath(import.meta.url));
const url = pathToFileURL(resolve(here, "..", "index.html")).href;
function findExe() {
  for (const d of readdirSync("/opt/pw-browsers").sort().reverse())
    for (const p of ["chrome-linux/chrome", "chrome-linux/headless_shell", "chrome-headless-shell-linux64/chrome-headless-shell"]) {
      try { if (statSync(join("/opt/pw-browsers", d, p)).isFile()) return join("/opt/pw-browsers", d, p); } catch {}
    }
}
const failures = [];
const browser = await chromium.launch({ executablePath: findExe(), headless: true });
// rAF の間隔を ms 単位で集める
const startRec = () => { window.__f = []; let last = performance.now(); const loop = (t) => { window.__f.push(t - last); last = t; if (window.__rec) requestAnimationFrame(loop); }; window.__rec = true; requestAnimationFrame(loop); };
const stopRec = () => { window.__rec = false; const f = window.__f.slice(1); const avg = f.reduce((a, b) => a + b, 0) / f.length; const sorted = [...f].sort((a, b) => a - b); return { frames: f.length, fps: +(1000 / avg).toFixed(1), p95ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1), maxms: +Math.max(...f).toFixed(1), over33: f.filter((x) => x > 33.4).length }; };
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.addInitScript(startRec);
await page.goto(url + "#/results?from=S_HOKU&to=BUS_KAI");
await page.waitForTimeout(950);
const boot = await page.evaluate(stopRec);
const bootGone = await page.locator(".boot").count();
if (bootGone) failures.push("起動の演出が 950ms 後も残っている");
await page.waitForSelector(".jr");
await page.evaluate(startRec);
await page.click('.t3[data-k="cheapest"]');
await page.waitForTimeout(900);
const flap = await page.evaluate(stopRec);
const dep0 = await page.locator(".jr .dep").first().getAttribute("data-v");
if (dep0 !== "08:05") failures.push("安値の先頭の時刻が 08:05 でない: " + dep0);
await page.evaluate(startRec);
await page.locator(".jr").first().click();
await page.waitForTimeout(1700);
const sheet = await page.evaluate(stopRec);
const lit = await page.locator(".node.lit").count(), nodes = await page.locator(".node").count();
if (lit !== nodes) failures.push(`点灯した駅 ${lit}/${nodes}`);
// 指で下げて離す（速い払い）→ 閉じる
const bar = await page.locator("#sheetBar").boundingBox();
await page.evaluate(startRec);
await page.mouse.move(bar.x + 250, bar.y + 20);
await page.mouse.down();
for (let i = 1; i <= 6; i++) { await page.mouse.move(bar.x + 250, bar.y + 20 + i * 30); await page.waitForTimeout(16); }
await page.mouse.up();
await page.waitForTimeout(600);
const drag = await page.evaluate(stopRec);
if (await page.locator("#sheetWrap.open").count()) failures.push("払ってもシートが閉じない");
if (!/#\/results/.test(page.url())) failures.push("閉じた後の場所が結果でない: " + page.url());
// 少しだけ下げて離す → 戻る
await page.locator(".jr").first().click();
await page.waitForTimeout(1200);
await page.mouse.move(bar.x + 250, bar.y + 20); await page.mouse.down();
await page.mouse.move(bar.x + 250, bar.y + 60, { steps: 10 }); await page.waitForTimeout(200); await page.mouse.up();
await page.waitForTimeout(500);
if (!(await page.locator("#sheetWrap.open").count())) failures.push("少し下げただけで閉じた");
const y = await page.evaluate(() => new DOMMatrixReadOnly(getComputedStyle(document.getElementById("sheet")).transform).m42);
if (Math.abs(y) > 1) failures.push("シートが元の位置に戻らない: " + y);
await ctx.close();

// 動きを減らす設定
const rc = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
const rp = await rc.newPage();
rp.on("pageerror", (e) => errors.push(String(e)));
await rp.goto(url);
if (await rp.locator(".boot").count()) failures.push("動きを減らす設定で起動の演出が出た");
await rp.goto(url + "#/detail?from=S_HOKU&to=NISHI&i=0");
await rp.waitForTimeout(150);
const rl = await rp.locator(".node.lit").count(), rn = await rp.locator(".node").count();
if (rl !== rn) failures.push(`動きを減らす設定で線がすぐに描かれない ${rl}/${rn}`);
await rc.close();
await browser.close();
for (const e of errors) failures.push("コンソール: " + e);
console.log(JSON.stringify({ boot, flap, sheet, drag }, null, 1));
if (failures.length) { console.log("失敗"); failures.forEach((f) => console.log("  " + f)); process.exitCode = 1; } else console.log("すべて合格");
