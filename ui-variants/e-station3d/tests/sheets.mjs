// 動きのコンタクトシート：モーション基盤の時計を止め（M.manual）、33ms ずつ進めて撮り、ffmpeg で 1 枚に並べる。
// 使い方: NODE_PATH=/opt/node-tools/node_modules node ui-variants/e-station3d/tests/sheets.mjs [--round=r1] [--only=press,reject]
// 出力: docs/ui-variants/e-station3d/sheets/<round>/<動き>.png（各コマの左上に経過時間）
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, statSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..");
const url = pathToFileURL(join(root, "ui-variants", "e-station3d", "index.html")).href;
const round = (process.argv.find((a) => a.startsWith("--round=")) || "--round=final").slice(8);
const only = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7).split(",").filter(Boolean);
const outDir = join(root, "docs", "ui-variants", "e-station3d", "sheets", round);
mkdirSync(outDir, { recursive: true });
function findExe() { const base = "/opt/pw-browsers"; for (const d of readdirSync(base).sort().reverse()) for (const p of ["chrome-linux/chrome", "chrome-linux/headless_shell", "chrome-headless-shell-linux64/chrome-headless-shell"]) { try { if (statSync(join(base, d, p)).isFile()) return join(base, d, p); } catch {} } }
const browser = await chromium.launch({ executablePath: findExe() });
const STEP = 33;

const FAV = [0, 1].map((i) => ({ key: "k" + i, from: "S_HOKU", to: i ? "NISHI" : "BUS_KAI", i: 0, dep: "2026-10-20T08:0" + i + ":00+09:00", arr: "2026-10-20T08:4" + i + ":00+09:00", transfers: i, modes: [i ? "air" : "rail"] }));
FAV.push({ key: "k2", from: "BUS_KAI", to: "S_HOKU", i: 0, dep: "2026-10-20T09:10:00+09:00", arr: "2026-10-20T09:52:00+09:00", transfers: 2, modes: ["bus"] });

async function newPage(o = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: o.theme || "dark", reducedMotion: o.reduced ? "reduce" : "no-preference" });
  await ctx.addInitScript((a) => {
    if (!a.splash) sessionStorage.setItem("gyrotraffic.splash", "1");
    if (a.boot) window.__GT_MANUAL = true;
    if (a.fav) localStorage.setItem("gyrotraffic.cloud.favRoutes", JSON.stringify(a.fav));
  }, { splash: !!o.splash, boot: !!o.boot, fav: o.fav || null });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  return { ctx, page };
}
async function label(page, txt) {
  await page.evaluate((t) => {
    let l = document.getElementById("__lbl");
    if (!l) { l = document.createElement("div"); l.id = "__lbl"; l.style.cssText = "position:fixed;left:2px;top:2px;z-index:99999;font:600 11px monospace;background:#000c;color:#ff0;padding:1px 4px;pointer-events:none"; document.body.appendChild(l); }
    l.textContent = t;
  }, txt);
}
/** frames 枚を撮る。before(i) で各コマの前に操作（ポインタを動かすなど） */
async function shoot(page, name, { frames = 18, clip, cols = 6, scale = 1, before } = {}) {
  const tmp = join(tmpdir(), "gt-sheet-" + name);
  rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
  for (let i = 0; i < frames; i++) {
    if (before) await before(i);
    await label(page, `${name} ${i * STEP}ms`);
    await page.screenshot({ path: join(tmp, `f${String(i).padStart(2, "0")}.png`), clip });
    await page.evaluate((s) => GT.M.advance(s), STEP);
  }
  const rows = Math.ceil(frames / cols);
  const vf = (scale !== 1 ? `scale=iw*${scale}:-1,` : "") + `tile=${cols}x${rows}:padding=3:color=0x444444`;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "1", "-i", join(tmp, "f%02d.png"), "-vf", vf, "-frames:v", "1", join(outDir, name + ".png")]);
  rmSync(tmp, { recursive: true, force: true });
  console.log("sheet", name);
}
const manual = (page) => page.evaluate(() => GT.M.manual(true));
const center = async (page, sel) => { const b = await page.locator(sel).first().boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
const want = (n) => !only.length || only.includes(n);

// 1 押す（主操作）：0ms で押し、100ms で離す
if (want("press")) {
  const { ctx, page } = await newPage();
  await page.goto(url + "#/home"); await page.waitForTimeout(400);
  await page.fill("#fFrom", "北見台（架空）"); await page.fill("#fTo", "海浜公園（架空）");
  await manual(page);
  await page.evaluate(() => { document.querySelector("#sf").onsubmit = (e) => e.preventDefault(); });   // 画面を移さず押す動きだけを見る
  const [x, y] = await center(page, ".dock .primary");
  await page.mouse.move(x - 60, y);
  const b = await page.locator(".dock .primary").boundingBox();
  await shoot(page, "press", { frames: 18, clip: { x: 0, y: b.y - 16, width: 390, height: b.height + 32 }, cols: 3, before: async (i) => { if (i === 1) await page.mouse.down(); if (i === 4) await page.mouse.up(); } });
  await ctx.close();
}
// 2 拒否の震え：出発地と目的地が同じ
if (want("reject")) {
  const { ctx, page } = await newPage();
  await page.goto(url + "#/home"); await page.waitForTimeout(400);
  await page.fill("#fFrom", "北見台（架空）"); await page.fill("#fTo", "北見台（架空）");
  await manual(page);
  const b = await page.locator(".od").boundingBox();
  const [x, y] = await center(page, ".dock .primary");
  await shoot(page, "reject", { frames: 15, clip: { x: 0, y: b.y - 8, width: 390, height: b.height + 60 }, cols: 3, before: async (i) => { if (i === 1) { await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.up(); } } });
  await ctx.close();
}
// 3 長押し：溜め（震えが強まる）→ 確定の衝撃
if (want("hold")) {
  const { ctx, page } = await newPage();
  await page.goto(url + "#/detail?from=S_HOKU&to=BUS_KAI&i=0"); await page.waitForTimeout(1800);
  await page.locator("#saveBtn").scrollIntoViewIfNeeded();
  await manual(page);
  const b = await page.locator("#saveBtn").boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await shoot(page, "hold", { frames: 30, clip: { x: b.x - 12, y: b.y - 14, width: b.width + 24, height: b.height + 28 }, cols: 6, before: async (i) => { if (i === 1) await page.mouse.down(); if (i === 26) await page.mouse.up(); } });
  await ctx.close();
}
// 4 入れ替え
if (want("swap")) {
  const { ctx, page } = await newPage();
  await page.goto(url + "#/home"); await page.waitForTimeout(400);
  await page.fill("#fFrom", "北見台（架空）"); await page.fill("#fTo", "海浜公園（架空）");
  await manual(page);
  const b = await page.locator(".od").boundingBox();
  const [x, y] = await center(page, "#swap");
  await shoot(page, "swap", { frames: 18, clip: { x: 0, y: b.y - 6, width: 390, height: b.height + 12 }, cols: 3, before: async (i) => { if (i === 1) { await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.up(); } } });
  await ctx.close();
}
// 5 並べ替え：1 行目をつかんで 3 行目へ（ゆっくり運び、離す）
if (want("reorder")) {
  const { ctx, page } = await newPage({ fav: FAV });
  await page.goto(url + "#/saved"); await page.waitForTimeout(800);
  await manual(page);
  const l = await page.locator(".sec .list").first().boundingBox();
  const [x, y] = await center(page, ".grip");
  await shoot(page, "reorder", { frames: 24, clip: { x: 0, y: l.y - 10, width: 390, height: l.height + 30 }, cols: 4, before: async (i) => {
    if (i === 1) { await page.mouse.move(x, y); await page.mouse.down(); }
    if (i >= 2 && i <= 12) await page.mouse.move(x, y + (i - 1) * 13);
    if (i === 14) await page.mouse.up();
  } });
  await ctx.close();
}
// 6 保存タブへ運ぶ：案をつかみ、下へ運び、タブの上で離す
if (want("carry")) {
  const { ctx, page } = await newPage();
  await page.goto(url + "#/results?from=S_HOKU&to=BUS_KAI"); await page.waitForTimeout(1600);
  await manual(page);
  const [x, y] = await center(page, ".jr");
  const [tx, ty] = await center(page, '.tab[href="#/saved"]');
  await shoot(page, "carry", { frames: 30, cols: 6, scale: 0.5, before: async (i) => {
    if (i === 1) { await page.mouse.move(x, y); await page.mouse.down(); }
    if (i >= 2 && i <= 16) { const p = (i - 1) / 15, e = p * p * (3 - 2 * p); await page.mouse.move(x + (tx - x) * e, y + (ty - y) * e); }
    if (i === 19) await page.mouse.up();
  } });
  await ctx.close();
}
// 6b 運んで戻す（キャンセル）
if (want("carrycancel")) {
  const { ctx, page } = await newPage();
  await page.goto(url + "#/results?from=S_HOKU&to=BUS_KAI"); await page.waitForTimeout(1600);
  await manual(page);
  const [x, y] = await center(page, ".jr");
  await shoot(page, "carrycancel", { frames: 18, cols: 6, scale: 0.5, before: async (i) => {
    if (i === 1) { await page.mouse.move(x, y); await page.mouse.down(); }
    if (i >= 2 && i <= 7) await page.mouse.move(x + i * 14, y + i * 30);
    if (i === 8) await page.mouse.up();
  } });
  await ctx.close();
}
// 7 結果→詳細（共有要素のリボン）
if (want("todetail")) {
  const { ctx, page } = await newPage();
  await page.goto(url + "#/results?from=S_HOKU&to=BUS_KAI"); await page.waitForTimeout(1600);
  await manual(page);
  const [x, y] = await center(page, ".jr .rib");
  await shoot(page, "todetail", { frames: 24, cols: 6, scale: 0.5, before: async (i) => { if (i === 1) await page.mouse.click(x, y); if (i === 2) await page.evaluate(() => new Promise((r) => setTimeout(r, 30))); } });
  await ctx.close();
}
// 8 戻る（途中で中断：詳細へ進む途中で戻る＝速度を引き継いで向きを変える）
if (want("interrupt")) {
  const { ctx, page } = await newPage();
  await page.goto(url + "#/home"); await page.waitForTimeout(500);
  await manual(page);
  await shoot(page, "interrupt", { frames: 24, cols: 6, scale: 0.5, before: async (i) => {
    if (i === 1) await page.click('.tab[href="#/settings"]');
    if (i === 6) await page.click('.tab[href="#/home"]');
  } });
  await ctx.close();
}
// 9 タブの切り替え（右から入る・背景の視差）
if (want("tab")) {
  const { ctx, page } = await newPage({ fav: FAV });
  await page.goto(url + "#/home"); await page.waitForTimeout(500);
  await manual(page);
  await shoot(page, "tab", { frames: 18, cols: 6, scale: 0.5, before: async (i) => { if (i === 1) await page.click('.tab[href="#/saved"]'); } });
  await ctx.close();
}
// 10 起動（View Transitions を使わない側＝自前の FLIP。動画は実際の経路）
if (want("boot")) {
  const { ctx, page } = await newPage({ splash: true, boot: true });
  await page.goto(url + "#/home");
  await page.evaluate(() => { GT.M.noVT = true; });
  await shoot(page, "boot", { frames: 30, cols: 6, scale: 0.5 });
  await ctx.close();
}
// 11 払って閉じる
if (want("dismiss")) {
  const { ctx, page } = await newPage();
  await page.goto(url + "#/results?from=S_HOKU&to=BUS_KAI"); await page.waitForTimeout(1500);
  await page.click(".jr"); await page.waitForTimeout(1500);
  await manual(page);
  const [x, y] = await center(page, ".grab");
  await shoot(page, "dismiss", { frames: 24, cols: 6, scale: 0.5, before: async (i) => {
    if (i === 1) { await page.mouse.move(x, y); await page.mouse.down(); }
    if (i >= 2 && i <= 7) await page.mouse.move(x, y + (i - 1) * 40);
    if (i === 8) await page.mouse.up();
  } });
  await ctx.close();
}
// 12 姿勢計とカウンターが定まる（針の震え）
if (want("settle")) {
  const { ctx, page } = await newPage();
  await page.goto(url + "#/home"); await page.waitForTimeout(300);
  await page.evaluate(() => { location.hash = "#/results?from=S_HOKU&to=NISHI"; });
  await page.waitForTimeout(200);
  await manual(page);
  await page.waitForTimeout(600);   // 探索の最短待ち（実時間）が終わるまで
  const b = await page.locator(".panel").boundingBox();
  await shoot(page, "settle", { frames: 30, cols: 5, clip: { x: 0, y: b.y - 4, width: 390, height: b.height + 8 } });
  await ctx.close();
}
await browser.close();
