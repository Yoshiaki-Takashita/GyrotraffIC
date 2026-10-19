// 主要な操作の通しを 390×844 で録画（webm）。ブラウザは 1 本ずつ・1 本の動画ずつ。
// 使い方: NODE_PATH=/opt/node-tools/node_modules node ui-variants/e-station3d/tests/videos.mjs
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, statSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..");
const url = pathToFileURL(join(root, "ui-variants", "e-station3d", "index.html")).href;
const out = join(root, "docs", "ui-variants", "e-station3d", "videos");
mkdirSync(out, { recursive: true });
function findExe() { const base = "/opt/pw-browsers"; for (const d of readdirSync(base).sort().reverse()) for (const p of ["chrome-linux/chrome", "chrome-linux/headless_shell", "chrome-headless-shell-linux64/chrome-headless-shell"]) { try { if (statSync(join(base, d, p)).isFile()) return join(base, d, p); } catch {} } }
const FAV = [["S_HOKU", "BUS_KAI", "rail", 0], ["S_HOKU", "NISHI", "air", 1], ["BUS_KAI", "S_HOKU", "bus", 2]].map((a, i) => ({ key: "k" + i, from: a[0], to: a[1], i: 0, dep: "2026-10-20T08:0" + i + ":00+09:00", arr: "2026-10-20T08:4" + i + ":00+09:00", transfers: a[3], modes: [a[2]] }));
const W = (p, ms) => p.waitForTimeout(ms);
const c = async (p, sel) => { const b = await p.locator(sel).first().boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
async function glide(p, x0, y0, x1, y1, n = 24, step = 16) { for (let i = 1; i <= n; i++) { const t = i / n, e = t * t * (3 - 2 * t); await p.mouse.move(x0 + (x1 - x0) * e, y0 + (y1 - y0) * e); await W(p, step); } }

const scenes = {
  "01-boot": { splash: true, run: async (p) => { await p.goto(url + "#/home"); await W(p, 2500); await p.evaluate(() => sessionStorage.removeItem("gyrotraffic.splash")); await p.reload(); await W(p, 2500); } },
  "02-press-reject": { run: async (p) => {
    await p.goto(url + "#/home"); await W(p, 700);
    await p.fill("#fFrom", "北見台（架空）"); await p.fill("#fTo", "北見台（架空）"); await W(p, 400);
    for (let k = 0; k < 2; k++) { const [x, y] = await c(p, ".dock .primary"); await p.mouse.move(x - 40, y); await p.mouse.down(); await W(p, 140); await p.mouse.up(); await W(p, 1300); }
    await p.fill("#fTo", "海浜公園（架空）"); await W(p, 500);
    const [x, y] = await c(p, ".dock .primary"); await p.mouse.move(x + 50, y); await p.mouse.down(); await W(p, 160); await p.mouse.up(); await W(p, 3000);
  } },
  "03-swap": { run: async (p) => {
    await p.goto(url + "#/home"); await W(p, 600);
    await p.fill("#fFrom", "北見台（架空）"); await p.fill("#fTo", "海浜公園（架空）"); await W(p, 500);
    const [x, y] = await c(p, "#swap"); await p.mouse.move(x, y);
    for (const gap of [1200, 1200, 160, 1400]) { await p.mouse.down(); await W(p, 70); await p.mouse.up(); await W(p, gap); }
    await p.locator(".seg-i").nth(1).click(); await W(p, 700); await p.locator(".seg-i").nth(2).click(); await W(p, 700); await p.locator(".seg-i").nth(0).click(); await W(p, 1000);
  } },
  "04-reorder": { fav: true, run: async (p) => {
    await p.goto(url + "#/saved"); await W(p, 1000);
    let [x, y] = await c(p, ".grip"); await p.mouse.move(x, y); await p.mouse.down(); await W(p, 250); await glide(p, x, y, x, y + 170, 40, 20); await W(p, 300); await p.mouse.up(); await W(p, 1300);
    [x, y] = await c(p, ".list li:nth-child(3) .grip"); await p.mouse.move(x, y); await p.mouse.down(); await W(p, 200); await glide(p, x, y, x, y - 230, 30, 16); await p.mouse.up(); await W(p, 1500);
  } },
  "05-carry-to-tab": { run: async (p) => {
    await p.goto(url + "#/results?from=S_HOKU&to=BUS_KAI"); await W(p, 2200);
    let [x, y] = await c(p, ".cards li:nth-child(2) .jr"); let [tx, ty] = await c(p, '.tab[href="#/saved"]');
    await p.mouse.move(x, y); await p.mouse.down(); await W(p, 200); await glide(p, x, y, x + 60, y + 200, 20, 20); await W(p, 300); await p.mouse.up(); await W(p, 1300);   // 途中で戻す
    [x, y] = await c(p, ".jr");
    await p.mouse.move(x, y); await p.mouse.down(); await W(p, 200); await glide(p, x, y, tx, ty, 40, 20); await W(p, 700); await p.mouse.up(); await W(p, 2200);
    await p.click('.tab[href="#/saved"]'); await W(p, 1500);
  } },
  "06-detail-back": { run: async (p) => {
    await p.goto(url + "#/results?from=S_HOKU&to=NISHI"); await W(p, 2600);
    await p.click(".jr .rib"); await W(p, 2600);
    await p.click("#backBtn"); await W(p, 1800);
    await p.click(".jr .rib"); await W(p, 1800);
    const [x, y] = await c(p, ".grab"); await p.mouse.move(x, y); await p.mouse.down(); await glide(p, x, y, x, y + 140, 14, 22); await W(p, 200); await glide(p, x, y + 140, x, y + 40, 8, 16); await p.mouse.up(); await W(p, 900);   // 戻る
    await p.mouse.move(x, y); await p.mouse.down(); await glide(p, x, y, x, y + 260, 8, 14); await p.mouse.up(); await W(p, 1800);   // 払って閉じる
  } },
  "07-hold-save": { run: async (p) => {
    await p.goto(url + "#/detail?from=S_HOKU&to=BUS_KAI&i=0"); await W(p, 2200);
    await p.locator("#saveBtn").scrollIntoViewIfNeeded(); await W(p, 500);
    const [x, y] = await c(p, "#saveBtn"); await p.mouse.move(x, y);
    await p.mouse.down(); await W(p, 300); await p.mouse.up(); await W(p, 1100);   // 途中で離す
    await p.mouse.down(); await W(p, 900); await p.mouse.up(); await W(p, 1800);   // 確定
  } },
  "08-tabs-interrupt": { fav: true, run: async (p) => {
    await p.goto(url + "#/home"); await W(p, 900);
    for (const [t, ms] of [["saved", 1100], ["settings", 1100], ["home", 1100], ["settings", 130], ["home", 1300], ["saved", 160], ["home", 1400]]) { await p.click(`.tab[href="#/${t}"]`); await W(p, ms); }
  } }
};
const browser = await chromium.launch({ executablePath: findExe() });
for (const [name, sc] of Object.entries(scenes)) {
  const tmp = join(out, "_tmp"); rmSync(tmp, { recursive: true, force: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark", recordVideo: { dir: tmp, size: { width: 390, height: 844 } } });
  await ctx.addInitScript((a) => { if (!a.splash) sessionStorage.setItem("gyrotraffic.splash", "1"); if (a.fav) localStorage.setItem("gyrotraffic.cloud.favRoutes", JSON.stringify(a.fav)); }, { splash: !!sc.splash, fav: sc.fav ? FAV : null });
  const p = await ctx.newPage();
  await sc.run(p);
  const v = p.video(); await ctx.close();
  renameSync(await v.path(), join(out, name + ".webm"));
  rmSync(tmp, { recursive: true, force: true });
  console.log(name, (statSync(join(out, name + ".webm")).size / 1024).toFixed(0) + "KB");
}
await browser.close();
