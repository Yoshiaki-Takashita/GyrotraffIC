// 案 B の通し検査と撮影（ヘッドレス Chromium・playwright-core）。
// 使い方: NODE_PATH=/opt/node-tools/node_modules node ui-variants/b-ios/tests/check.mjs [撮影の接頭辞 例 r1] [--no-shots]
// 確かめること：コンソールエラー 0／検索→結果→詳細（シート）→保存→設定の通し／ライト・ダーク／横スクロールなし（390・360・320）／
//               タップ領域 44px 以上／動きを減らす設定／シートのつかみ／主な動きのフレーム速度（この環境の参考値）。
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..");
const url = pathToFileURL(join(root, "ui-variants", "b-ios", "index.html")).href;
const shotDir = join(root, "docs", "ui-variants", "b-ios");
const prefix = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "r";
const shots = !process.argv.includes("--no-shots");
mkdirSync(shotDir, { recursive: true });

function findExe() {
  const base = "/opt/pw-browsers";
  for (const d of readdirSync(base).sort().reverse()) {
    for (const p of ["chrome-linux/chrome", "chrome-linux/headless_shell", "chrome-headless-shell-linux64/chrome-headless-shell"]) {
      try { if (statSync(join(base, d, p)).isFile()) return join(base, d, p); } catch {}
    }
  }
}
const failures = [], notes = [];
const fail = (c, m) => failures.push(`[${c}] ${m}`);

function audit() {
  const out = { hscroll: false, small: [] };
  const v = document.getElementById("view");
  if (document.documentElement.scrollWidth > innerWidth + 1 || v.scrollWidth > v.clientWidth + 1) out.hscroll = "view";
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !el.closest("[hidden]") && getComputedStyle(el).visibility !== "hidden" && !el.closest(".sheet-layer:not(.open)"); };
  document.querySelectorAll("#app a[href], #app button, #app .seg-i").forEach((el) => {
    if (!vis(el)) return;
    const r = el.getBoundingClientRect();
    if (r.height < 43.5 || r.width < 43.5) out.small.push(`${el.tagName}.${el.className} "${(el.getAttribute("aria-label") || el.textContent).trim().slice(0, 20)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
  });
  document.querySelectorAll("#app *").forEach((el) => { const r = el.getBoundingClientRect(); if (vis(el) && r.width > 0 && r.right > innerWidth + 1 && !el.closest(".ghost")) out.hscroll = out.hscroll || `${el.tagName}.${el.className}`; });
  return out;
}

const seed = (theme) => `(() => { if (sessionStorage.getItem("seeded")) return; sessionStorage.setItem("seeded", 1);
  const P = "gyrotraffic.";
  localStorage.setItem(P + "cloud.settings", JSON.stringify({ theme: "${theme}", lang: "ja" }));
  localStorage.setItem(P + "local.history", JSON.stringify([{ from: "S_HOKU", to: "BUS_KAI", at: 1 }, { from: "S_HOKU", to: "NISHI", at: 2 }]));
  localStorage.setItem(P + "cloud.favPlaces", JSON.stringify([{ label: "自宅", stop: "S_HOKU" }, { label: "職場", stop: "S_CHUO" }]));
})()`;

const browser = await chromium.launch({ executablePath: findExe(), args: ["--no-sandbox"] });
async function session(w, h, theme, reduced) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: reduced ? "reduce" : "no-preference", hasTouch: false });
  await ctx.addInitScript(seed(theme));
  const page = await ctx.newPage();
  const errs = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(url + "#/home");
  await page.waitForTimeout(300);
  return { ctx, page, errs };
}
const shot = async (page, name) => { if (shots) await page.screenshot({ path: join(shotDir, `${prefix}-${name}.png`) }); };
const check = async (page, ctx) => { const a = await page.evaluate(audit); if (a.hscroll) fail(ctx, "横スクロール " + a.hscroll); if (a.small.length) fail(ctx, "小さいタップ " + a.small.join(" | ")); };

for (const [w, h] of [[390, 844], [360, 800], [320, 640]]) {
  for (const theme of ["light", "dark"]) {
    const tag = `${w}-${theme}`;
    const main = w === 390;
    const { ctx, page, errs } = await session(w, h, theme, false);
    await check(page, tag + " home");
    if (main) await shot(page, `${theme}-home`);
    // 検索 → 結果
    await page.fill("#fFrom", "北見台（架空）");
    await page.fill("#fTo", "海浜公園（架空）");
    await page.click("button[type=submit]");
    await page.waitForSelector(".jrow");
    await page.waitForTimeout(450);
    await check(page, tag + " results");
    // 並び順の切り替え（桁が流れる）
    await page.click('.seg-i:has(input[value="fewest"])');
    await page.waitForTimeout(600);
    if (main) await shot(page, `${theme}-results`);
    // 結果 → 詳細（シート）
    await page.click(".jrow >> nth=0");
    await page.waitForTimeout(900);
    if (!(await page.evaluate(() => GT.sheet.detent() === "medium"))) fail(tag, "シートが中間の高さで止まらない");
    await check(page, tag + " detail");
    if (main) await shot(page, `${theme}-detail`);
    // つかんで上へ
    const g = await page.locator(".grabber").boundingBox();
    await page.mouse.move(g.x + 18, g.y + 2); await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(g.x + 18, g.y - i * 50); await page.waitForTimeout(12); }
    await page.mouse.up();
    await page.waitForTimeout(800);
    if (!(await page.evaluate(() => GT.sheet.detent() === "large"))) fail(tag, "上に払ってもシートが大きい高さにならない");
    if (main) await shot(page, `${theme}-detail-large`);
    // 保存
    await page.click("#saveBtn");
    await page.waitForTimeout(100);
    // つかんで下へ払う → 閉じて結果に戻る
    const g2 = await page.locator(".grabber").boundingBox();
    await page.mouse.move(g2.x + 18, g2.y + 2); await page.mouse.down();
    for (let i = 1; i <= 6; i++) { await page.mouse.move(g2.x + 18, g2.y + i * 120); await page.waitForTimeout(10); }
    await page.mouse.up();
    await page.waitForTimeout(900);
    if (await page.evaluate(() => GT.sheet.isOpen())) fail(tag, "下に払ってもシートが閉じない");
    if (!(await page.evaluate(() => location.hash.startsWith("#/results")))) fail(tag, "閉じた後に結果に戻らない: " + (await page.evaluate(() => location.hash)));
    if (main && theme === "light") notes.push("fps " + JSON.stringify(await page.evaluate(() => GT.fx.stats)));
    // 保存・設定
    await page.click('.tab[href="#/saved"]');
    await page.waitForTimeout(400);
    await check(page, tag + " saved");
    if (main) await shot(page, `${theme}-saved`);
    await page.click('.tab[href="#/settings"]');
    await page.waitForTimeout(400);
    await check(page, tag + " settings");
    if (main) await shot(page, `${theme}-settings`);
    // 大きな見出し → スクロールでバーの題名
    await page.evaluate(() => { const v = document.getElementById("view"); v.scrollTop = 200; v.dispatchEvent(new Event("scroll")); });
    await page.waitForTimeout(300);
    if (!(await page.evaluate(() => document.getElementById("top").classList.contains("scrolled")))) {
      const can = await page.evaluate(() => { const v = document.getElementById("view"); return v.scrollHeight > v.clientHeight + 60; });
      if (can) fail(tag, "スクロールしてもバーに題名が出ない");
    }
    await page.goto(url + "#/settings/licenses"); await page.waitForTimeout(300); await check(page, tag + " licenses");
    await page.goto(url + "#/settings/account"); await page.waitForTimeout(300); await check(page, tag + " account");
    if (w === 320 && shots && theme === "light") { await page.goto(url + "#/detail?from=S_HOKU&to=NISHI&i=0"); await page.waitForTimeout(900); await shot(page, "320-light-detail-air"); await check(page, tag + " detail-air"); }
    if (errs.length) fail(tag, "コンソール " + errs.join(" / "));
    await ctx.close();
  }
}
// 動きを減らす設定
{
  const { ctx, page, errs } = await session(390, 844, "light", true);
  await page.goto(url + "#/results?from=S_HOKU&to=NISHI");
  await page.waitForSelector(".jrow");
  await page.click(".jrow >> nth=0");
  await page.waitForTimeout(120);
  const r = await page.evaluate(() => ({ det: GT.sheet.detent(), y: GT.sheet.y(), top: GT.sheet.finalTop(), ghost: !!document.querySelector(".ghost"), clip: document.querySelector("#rmap rect")?.getAttribute("width") }));
  if (r.det !== "medium" || Math.abs(r.y - r.top) > 1) fail("reduced", "シートが即座に置かれない " + JSON.stringify(r));
  if (r.ghost) fail("reduced", "共有要素の動きが出ている");
  notes.push("reduced " + JSON.stringify(r));
  if (errs.length) fail("reduced", errs.join(" / "));
  await ctx.close();
}
await browser.close();
console.log(notes.join("\n"));
if (failures.length) { console.log("NG\n" + failures.join("\n")); process.exit(1); }
console.log("OK");
