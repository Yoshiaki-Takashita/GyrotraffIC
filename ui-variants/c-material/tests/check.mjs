// 案 C（c-material）の通し検査。ui/tests/check.mjs を元に、撮影先と枚数を変えたもの。
// UI の通し検査（ヘッドレス Chromium・playwright-core）。
// 使い方: NODE_PATH=/opt/node-tools/node_modules node ui/tests/check.mjs [--no-shots]
// 確かめること：コンソールエラー 0／検索→結果→詳細→保存→設定の通し／ライト・ダーク／横スクロールなし／
//               タップ領域 44px 以上／入力のラベル／文字のコントラスト（簡易・AA 4.5:1、大きい字 3:1）。
// スクリーンショット: docs/ui-screens/<幅>x<高さ>-<テーマ>-<画面>.png
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..");
const url = pathToFileURL(join(root, "ui-variants", "c-material", "index.html")).href;
const shotDir = join(root, "docs", "ui-variants", "c-material");
const shots = !process.argv.includes("--no-shots");
mkdirSync(shotDir, { recursive: true });

function findExe() {
  const base = "/opt/pw-browsers";
  for (const d of readdirSync(base).sort().reverse()) {
    for (const p of ["chrome-linux/chrome", "chrome-linux/headless_shell", "chrome-headless-shell-linux64/chrome-headless-shell"]) {
      try { if (statSync(join(base, d, p)).isFile()) return join(base, d, p); } catch {}
    }
  }
  return undefined;
}

const VIEWPORTS = [[390, 844], [360, 800], [320, 640]];
const THEMES = ["light", "dark"];
const failures = [];
const fail = (ctx, msg) => failures.push(`[${ctx}] ${msg}`);

// ページ内で走らせる検査
function audit() {
  const out = { hscroll: false, smallTaps: [], unlabeled: [], lowContrast: [] };
  const de = document.documentElement;
  const view = document.getElementById("view");
  if (de.scrollWidth > window.innerWidth + 1 || view.scrollWidth > view.clientWidth + 1) out.hscroll = true;
  document.querySelectorAll("#app *").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > window.innerWidth + 1 && getComputedStyle(el).position !== "absolute") out.hscroll = out.hscroll || `${el.tagName}.${el.className}`;
  });
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !el.closest("[hidden]"); };
  const name = (el) => (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30);
  document.querySelectorAll("#app a[href], #app button, #app select, #app input:not([type=radio]), #app .seg-i").forEach((el) => {
    if (!vis(el)) return;
    const r = el.getBoundingClientRect();
    if (el.matches("input, select")) { const f = el.closest(".field"); const fr = f ? f.getBoundingClientRect() : r; if (fr.height < 44) out.smallTaps.push(`${el.tagName} ${Math.round(fr.width)}x${Math.round(fr.height)}`); return; }
    if (r.height < 44 || r.width < 44) out.smallTaps.push(`${el.tagName} "${name(el)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    if (el.matches("a, button") && !name(el)) out.unlabeled.push(el.outerHTML.slice(0, 80));
  });
  document.querySelectorAll("#app input, #app select").forEach((el) => {
    if (el.type === "radio") { if (!el.closest("label")) out.unlabeled.push("radio " + el.value); return; }
    if (!el.closest("label") && !el.getAttribute("aria-label")) out.unlabeled.push(el.id || el.name);
  });
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(",").map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] == null ? 1 : p[3] }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0.5) return c; } return parse(getComputedStyle(document.body).backgroundColor); };
  const walker = document.createTreeWalker(document.getElementById("app"), NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const n = walker.currentNode; const el = n.parentElement;
    if (!n.textContent.trim() || seen.has(el) || !vis(el) || el.closest(".sr-only,[disabled]")) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    const fg = parse(cs.color); const bg = bgOf(el);
    if (!fg || !bg) continue;
    const L1 = lum(fg), L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize); const bold = Number(cs.fontWeight) >= 700;
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    if (ratio < need) out.lowContrast.push(`"${n.textContent.trim().slice(0, 16)}" ${ratio.toFixed(2)}`);
  }
  return out;
}

const browser = await chromium.launch({ executablePath: findExe(), headless: true });
let shotCount = 0;
for (const [w, h] of VIEWPORTS) {
  for (const theme of THEMES) {
    const ctxName = `${w}x${h}-${theme}`;
    const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, colorScheme: theme, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("request", (r) => { if (!r.url().startsWith("file:")) errors.push("外部通信: " + r.url()); });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(url);
    const check = async (screen) => {
      await page.waitForTimeout(80);
      const a = await page.evaluate(audit);
      const c = `${ctxName} ${screen}`;
      if (a.hscroll) fail(c, `横スクロール ${a.hscroll}`);
      for (const s of a.smallTaps) fail(c, `タップ領域が小さい ${s}`);
      for (const s of a.unlabeled) fail(c, `ラベルなし ${s}`);
      for (const s of a.lowContrast) fail(c, `コントラスト不足 ${s}`);
      const th = await page.evaluate(() => document.documentElement.dataset.theme);
      if (th !== theme) fail(c, `テーマが ${th}`);
      if (shots && (w === 390 || (w === 320 && theme === "light")) && !/6-|7-/.test(screen)) { await page.screenshot({ path: join(shotDir, `${ctxName}-${screen}.png`) }); shotCount++; }
    };
    // 1 ホーム（よく使う場所を 1 件入れておくため、先に保存画面で追加）
    await page.goto(url + "#/saved");
    await page.fill("#pl", "自宅");
    await page.selectOption("#ps", "S_HOKU");
    await page.click("#addp button[type=submit]");
    await page.goto(url + "#/home");
    await page.fill("#fFrom", "北見台（架空）");
    await page.fill("#fTo", "海浜公園（架空）");
    await check("1-home");
    // 2 結果
    await page.click(".dock .primary");
    await page.waitForSelector(".jr");
    if ((await page.locator(".jr").count()) < 2) fail(ctxName, "結果の案が 2 件未満");
    await check("2-results");
    await page.click('.t3[data-k="cheapest"]');
    const firstFare = await page.locator(".jr .meta").nth(1).textContent();
    if (!/目安/.test(firstFare)) fail(ctxName, "安値タブの先頭が運賃ありの案でない: " + firstFare);
    await page.click('.t3[data-k="fastest"]');
    // 3 詳細
    await page.locator(".jr").first().click();
    await page.waitForSelector(".timeline");
    const gm = await page.getAttribute('a[href^="https://www.google.com/maps/dir/?api=1"]', "href");
    if (!gm || !/travelmode=transit/.test(gm)) fail(ctxName, "Google マップのリンクの形が違う");
    if ((await page.locator(".conf").count()) < 3) fail(ctxName, "確からしさの表示がない");
    await check("3-detail");
    await page.click("#saveBtn");
    // 3b 飛行機を含む詳細
    await page.goto(url + "#/detail?from=S_HOKU&to=NISHI&i=0");
    await page.waitForSelector(".callout");
    await page.evaluate(() => { const c = document.querySelector(".callout"); c.closest(".tl").scrollIntoView(); });
    await check("3b-detail-air");
    // 4 保存
    await page.click('.tab[href="#/saved"]');
    await page.waitForSelector(".row-wrap");
    if ((await page.locator('a.row[href^="#/detail"]').count()) < 1) fail(ctxName, "お気に入りの経路が保存されていない");
    await check("4-saved");
    // 5 設定
    await page.click('.tab[href="#/settings"]');
    await page.waitForSelector("#clr");
    await check("5-settings");
    await page.click("#clr");
    const hist = await page.evaluate(() => localStorage.getItem("gyrotraffic.local.history"));
    if (hist !== "[]") fail(ctxName, "履歴が消えていない");
    if (w === 390) {
      await page.goto(url + "#/settings/licenses");
      await check("6-licenses");
      await page.goto(url + "#/settings/account");
      await check("7-account");
    }
    for (const e of errors) fail(ctxName, "コンソール: " + e);
    await context.close();
  }
}
// PC 表示（中央のスマホ枠）と、保存が使えない環境
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(url);
  const box = await page.locator("#app").boundingBox();
  if (Math.round(box.width) !== 390 || Math.round(box.height) !== 844) fail("desktop", `枠の大きさ ${box.width}x${box.height}`);
  
  await context.close();
  const c2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await c2.newPage();
  const errs = [];
  p2.on("pageerror", (e) => errs.push(String(e)));
  await p2.addInitScript(() => { Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } }); });
  await p2.goto(url + "#/settings");
  if (!(await p2.locator(".note.warn").count())) fail("no-storage", "保存不可の表示がない");
  await p2.goto(url + "#/results?from=S_HOKU&to=BUS_KAI");
  await p2.waitForSelector(".jr");
  for (const e of errs) fail("no-storage", e);
  await c2.close();
}
await browser.close();

let total = 0;
for (const f of readdirSync(shotDir)) total += statSync(join(shotDir, f)).size;
console.log(`撮影 ${shotCount} 枚・docs/ui-screens 合計 ${(total / 1024 / 1024).toFixed(2)} MB`);
if (total > 2 * 1024 * 1024) fail("shots", "スクリーンショットが 2MB を超えた");
if (failures.length) {
  console.log(`失敗 ${failures.length} 件`);
  for (const f of failures) console.log("  " + f);
  process.exitCode = 1;
} else console.log("すべて合格");
