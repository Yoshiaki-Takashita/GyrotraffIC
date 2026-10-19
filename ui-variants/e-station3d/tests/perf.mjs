// 動きごとのフレーム時間（実時間・ヘッドレス Chromium・この環境の参考値）。
// gap＝requestAnimationFrame の間隔、work＝モーション基盤の 1 コマの処理時間（ms）。動きを減らす設定と、品質の段の確認も。
// 使い方: NODE_PATH=/opt/node-tools/node_modules node ui-variants/e-station3d/tests/perf.mjs
import { createRequire } from "node:module";
import { readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..");
const url = pathToFileURL(join(root, "ui-variants", "e-station3d", "index.html")).href;
function findExe() { const base = "/opt/pw-browsers"; for (const d of readdirSync(base).sort().reverse()) for (const p of ["chrome-linux/chrome", "chrome-linux/headless_shell", "chrome-headless-shell-linux64/chrome-headless-shell"]) { try { if (statSync(join(base, d, p)).isFile()) return join(base, d, p); } catch {} } }
const browser = await chromium.launch({ executablePath: findExe() });
const FAV = [0, 1, 2].map((i) => ({ key: "k" + i, from: "S_HOKU", to: "BUS_KAI", i: 0, dep: "2026-10-20T08:0" + i + ":00+09:00", arr: "2026-10-20T08:4" + i + ":00+09:00", transfers: i, modes: ["rail"] }));
const out = {}, problems = [];
const q = (a, p) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(2); };

async function page(o = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark", reducedMotion: o.reduced ? "reduce" : "no-preference" });
  await ctx.addInitScript((a) => { if (!a.splash) sessionStorage.setItem("gyrotraffic.splash", "1"); localStorage.setItem("gyrotraffic.cloud.favRoutes", JSON.stringify(a.fav)); }, { fav: FAV, splash: !!o.splash });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => problems.push(String(e)));
  p.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  p.on("request", (r) => { if (!r.url().startsWith("file:")) problems.push("外部通信 " + r.url()); });
  return { ctx, p };
}
async function measure(p, name, act) {
  await p.evaluate(() => { GT.M.stats.on = true; GT.M.stats.gap = []; GT.M.stats.work = []; });
  const t0 = Date.now();
  await act();
  await p.waitForFunction(() => GT.M.busy() === 0, null, { timeout: 6000 }).catch(() => problems.push(name + ": 動きが 6 秒で止まらない"));
  const s = await p.evaluate(() => { GT.M.stats.on = false; return { gap: GT.M.stats.gap, work: GT.M.stats.work }; });
  out[name] = { ms: Date.now() - t0, frames: s.gap.length, gap: { med: q(s.gap, 0.5), p95: q(s.gap, 0.95), p99: q(s.gap, 0.99), max: q(s.gap, 1) }, work: { med: q(s.work, 0.5), p99: q(s.work, 0.99), max: q(s.work, 1) } };
}
const c = async (p, sel) => { const b = await p.locator(sel).first().boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };

{
  const { ctx, p } = await page();
  await p.goto(url + "#/home"); await p.waitForTimeout(500);
  await p.fill("#fFrom", "北見台（架空）"); await p.fill("#fTo", "北見台（架空）");
  await measure(p, "reject", () => p.click(".dock .primary"));
  await p.fill("#fTo", "海浜公園（架空）");
  await measure(p, "swap", () => p.click("#swap"));
  await measure(p, "segment", () => p.click(".seg-i:nth-child(3)"));
  // 待機中は rAF が止まっている（電池を使わない）
  await p.waitForTimeout(300);
  const idle = await p.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); GT.M.stats.on = true; GT.M.stats.gap = []; setTimeout(() => { r(GT.M.stats.gap.length); GT.M.stats.on = false; }, 1000); }));
  out.idle_frames_1s = idle;
  if (idle > 0) problems.push("待機中にモーションのループが回っている " + idle);
  await p.fill("#fFrom", "北見台（架空）"); await p.fill("#fTo", "海浜公園（架空）");
  await measure(p, "press_search_to_results", async () => { const [x, y] = await c(p, ".dock .primary"); await p.mouse.move(x, y); await p.mouse.down(); await p.waitForTimeout(90); await p.mouse.up(); await p.waitForSelector(".jr"); await p.waitForTimeout(400); });
  await measure(p, "carry_to_tab", async () => {
    const [x, y] = await c(p, ".jr"), [tx, ty] = await c(p, '.tab[href="#/saved"]');
    await p.mouse.move(x, y); await p.mouse.down();
    for (let i = 1; i <= 20; i++) { await p.mouse.move(x + (tx - x) * i / 20, y + (ty - y) * i / 20); await p.waitForTimeout(16); }
    await p.waitForTimeout(150); await p.mouse.up();
  });
  await measure(p, "results_to_detail_shared", async () => { await p.click(".jr .rib"); await p.waitForTimeout(200); });
  await p.waitForTimeout(400);
  await measure(p, "sheet_dismiss", async () => { const [x, y] = await c(p, ".grab"); await p.mouse.move(x, y); await p.mouse.down(); for (let i = 1; i <= 8; i++) { await p.mouse.move(x, y + i * 35); await p.waitForTimeout(16); } await p.mouse.up(); });
  await p.waitForTimeout(400); await p.click(".jr .rib"); await p.waitForTimeout(1500);
  await measure(p, "hold_save", async () => { await p.locator("#saveBtn").scrollIntoViewIfNeeded(); const [x, y] = await c(p, "#saveBtn"); await p.mouse.move(x, y); await p.mouse.down(); await p.waitForTimeout(750); await p.mouse.up(); });
  await p.goto(url + "#/home"); await p.waitForTimeout(300);
  await measure(p, "tab_switch", () => p.click('.tab[href="#/saved"]'));
  await measure(p, "reorder", async () => { const [x, y] = await c(p, ".grip"); await p.mouse.move(x, y); await p.mouse.down(); for (let i = 1; i <= 12; i++) { await p.mouse.move(x, y + i * 12); await p.waitForTimeout(16); } await p.mouse.up(); });
  await measure(p, "back_interrupt", async () => { await p.click('.tab[href="#/settings"]'); await p.waitForTimeout(120); await p.click('.tab[href="#/saved"]'); });
  // 応答性：pointerdown から最初の transform の書き込みまで
  out.press_latency_ms = await p.evaluate(() => new Promise((r) => {
    const b = document.querySelector(".tab"); const t0 = performance.now();
    b.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 9, isPrimary: true }));
    const ic = b.querySelector(".ic");
    const chk = () => { if (ic.style.transform) { r(+(performance.now() - t0).toFixed(1)); document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 9 })); } else requestAnimationFrame(chk); };
    requestAnimationFrame(chk);
  }));
  // 品質の段を 0 に（遅い端末の想定）：粒子なし・発光なし
  await p.evaluate(() => GT.M.q.force(0));
  await p.goto(url + "#/detail?from=S_HOKU&to=BUS_KAI&i=0");
  await p.waitForTimeout(2000);
  out.q0 = await p.evaluate(() => ({ glow: getComputedStyle(document.documentElement).getPropertyValue("--glow").trim(), particles: GT.M.q.particles(), maxLive: GT.M.q.maxLive() }));
  await ctx.close();
}
{
  const { ctx, p } = await page({ splash: true });
  await ctx.addInitScript(() => { window.__GT_STATS = true; });
  const t0 = Date.now();
  await p.goto(url + "#/home");
  await p.waitForFunction(() => GT.M.busy() === 0, null, { timeout: 6000 });
  { const st = await p.evaluate(() => ({ gap: GT.M.stats.gap, work: GT.M.stats.work })); out.boot = { ms: Date.now() - t0, frames: st.gap.length, gap: { med: q(st.gap, 0.5), p95: q(st.gap, 0.95), p99: q(st.gap, 0.99), max: q(st.gap, 1) }, work: { med: q(st.work, 0.5), p99: q(st.work, 0.99), max: q(st.work, 1) } }; }
  out.boot_splash_left = await p.locator(".splash").count();
  await ctx.close();
}
// 動きを減らす設定：transform が書かれない・状態は色と形で伝わる
{
  const { ctx, p } = await page({ reduced: true, splash: true });
  await p.goto(url + "#/home"); await p.waitForTimeout(300);
  const red = {};
  red.splash = await p.locator(".splash").count();
  await p.fill("#fFrom", "北見台（架空）"); await p.fill("#fTo", "北見台（架空）");
  await p.click(".dock .primary");
  red.reject = await p.evaluate(() => ({ bad: document.querySelector(".od").classList.contains("bad"), tf: document.querySelector(".od").style.transform, err: document.getElementById("ferr").textContent }));
  await p.fill("#fTo", "海浜公園（架空）");
  await p.click("#swap");
  red.swapInstant = await p.evaluate(() => [document.getElementById("fFrom").value, !document.querySelector(".swap-ghost")]);
  await p.goto(url + "#/detail?from=S_HOKU&to=BUS_KAI&i=0"); await p.waitForTimeout(300);
  red.ribbonLit = await p.evaluate(() => [...document.querySelectorAll(".rib-big .rib-s,.rib-big .rib-end")].every((n) => n.classList.contains("lit")));
  red.anyTransform = await p.evaluate(() => [...document.querySelectorAll("#view *")].filter((e) => e.style.transform && e.style.transform !== "none").length);
  red.busy = await p.evaluate(() => GT.M.busy());
  out.reduced = red;
  if (red.splash || !red.reject.bad || red.reject.tf || red.anyTransform) problems.push("動きを減らす設定 " + JSON.stringify(red));
  await ctx.close();
}
await browser.close();
const dir = join(root, "docs", "ui-variants", "e-station3d");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "perf.json"), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
console.log(problems.length ? "問題 " + problems.length + "\n" + problems.join("\n") : "問題なし（この検査の範囲）");
