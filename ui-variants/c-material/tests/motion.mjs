// 見せ場の動きの測定（requestAnimationFrame の間隔）。この環境（ヘッドレス Chromium）での参考値。実機の値は不明。
// 使い方: NODE_PATH=/opt/node-tools/node_modules node ui-variants/c-material/tests/motion.mjs
import { createRequire } from "node:module";
import { readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const { chromium } = createRequire(import.meta.url)("playwright-core");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const url = pathToFileURL(join(root, "index.html")).href;
const exe = (() => { for (const d of readdirSync("/opt/pw-browsers").sort().reverse()) for (const p of ["chrome-linux/chrome", "chrome-linux/headless_shell", "chrome-headless-shell-linux64/chrome-headless-shell"]) { try { if (statSync(join("/opt/pw-browsers", d, p)).isFile()) return join("/opt/pw-browsers", d, p); } catch {} } })();
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const startMeter = () => page.evaluate(() => { window.__f = []; let last = performance.now(); const tick = (t) => { window.__f.push(t - last); last = t; if (window.__f.length < 400) window.__rq = requestAnimationFrame(tick); }; window.__rq = requestAnimationFrame(tick); });
const readMeter = async (label) => {
  const f = await page.evaluate(() => { cancelAnimationFrame(window.__rq); return window.__f.slice(1); });
  const avg = f.reduce((a, b) => a + b, 0) / f.length; const max = Math.max(...f);
  const fps = 1000 / avg; const jank = f.filter((x) => x > 25).length;
  console.log(`${label}: 平均 ${fps.toFixed(1)} fps・最長のフレーム ${max.toFixed(1)} ms・25ms 超 ${jank}/${f.length}`);
};
await page.goto(url + "#/results?from=S_HOKU&to=NISHI");
await page.waitForSelector(".jr");
await page.waitForTimeout(400);
await startMeter(); await page.click('.t3[data-k="cheapest"]'); await page.waitForTimeout(700); await readMeter("③数字の切り替え（並び替え）");
await page.click('.t3[data-k="fastest"]'); await page.waitForTimeout(700);
const vt = await page.evaluate(() => typeof document.startViewTransition === "function");
await startMeter(); await page.locator(".jr").first().click(); await page.waitForTimeout(700); await readMeter(`①共有要素の遷移（View Transitions ${vt ? "あり" : "なし"}）`);
await startMeter(); await page.waitForTimeout(1500); await readMeter("②経路の線が描かれる（詳細を開いた後の 1.5 秒）");
const draw = await page.locator(".timeline.draw").count();
await page.emulateMedia({ reducedMotion: "reduce" });
await page.goto(url + "#/detail?from=S_HOKU&to=NISHI&i=0"); await page.reload();
await page.waitForSelector(".timeline");
const drawR = await page.locator(".timeline.draw").count();
console.log(`動きを減らす設定：通常 draw=${draw}・減らす draw=${drawR}（0 なら即時表示）`);
console.log(errors.length ? "エラー: " + errors.join(" / ") : "コンソールエラー 0");
await browser.close();
