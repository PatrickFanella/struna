/**
 * Browser smoke test of the tab browser against the real Guitar Pro collection
 * (read only): opens a gp3, a gp4 and a gp5, checks that each renders, that the
 * player loads its sound font and plays, and that tempo and a bar loop apply.
 *
 *   node scripts/smoke-tabs.ts <state-dir> <screenshot-prefix>
 *
 * Needs `pnpm build`, Chromium, and GUITAR_MEDIA_ROOT (default: the real Guitar folder).
 */
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
const [state, out] = process.argv.slice(2) as [string, string];
const port = 5191;
const srv = spawn("node", ["server/index.ts"], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: "production", PORT: String(port), GUITAR_STATE_DIR: state }, stdio: ["ignore", "ignore", "inherit"] });
const base = `http://localhost:${port}`;
for (let i = 0; i < 50 && !(await fetch(`${base}/api/health`).then((r) => r.ok, () => false)); i++) await new Promise((r) => setTimeout(r, 200));
for (let i = 0; i < 200; i++) { const s = await (await fetch(`${base}/api/tabs`)).json(); if (!s.scanning && s.total) { console.log("tabs indexed:", s.total); break; } await new Promise((r) => setTimeout(r, 300)); }
const b = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
try {
  for (const [ext, q] of [["gp3", "311 amber"], ["gp4", "tony rice"], ["gp5", ""]] as const) {
    const list = await (await fetch(`${base}/api/tabs?q=${encodeURIComponent(q)}`)).json();
    let tab = list.items.find((t: any) => t.ext === ext);
    if (!tab) { for (let off = 0; off < 30000 && !tab; off += 50) { const l = await (await fetch(`${base}/api/tabs?offset=${off}`)).json(); tab = l.items.find((t: any) => t.ext === ext); if (!l.items.length) break; } }
    const ctx = await b.newContext({ viewport: { width: 820, height: 1180 }, colorScheme: ext === "gp4" ? "dark" : "light" });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => console.error("page error", e.message));
    await p.goto(`${base}/#tabs`);
    await p.getByRole("searchbox").fill(tab.title);
    await p.waitForTimeout(600);
    await p.locator(".itemopen", { hasText: tab.title }).filter({ hasText: ext.toUpperCase() }).filter({ hasText: tab.artist }).first().click();
    const shown = await p.locator(".tabview .srcnote").textContent();
    if (!shown?.includes(ext.toUpperCase())) throw new Error(`opened the wrong file: ${shown}`);
    const rendered = await p.waitForFunction(() => document.querySelectorAll(".tabscroll svg, .tabscroll canvas").length > 0, null, { timeout: 30000 }).then(() => true, () => false);
    const ready = await p.getByRole("button", { name: "Play" }).waitFor({ timeout: 60000 }).then(() => true, () => false);
    await p.getByLabel("Playback tempo, percent").fill("75");
    await p.getByLabel("Loop from bar").fill("1");
    await p.getByLabel("Loop to bar").fill("2");
    await p.getByRole("button", { name: "Loop" }).click();
    await p.getByRole("button", { name: "Play" }).click();
    const playing = await p.getByRole("button", { name: "Pause" }).waitFor({ timeout: 10000 }).then(() => true, () => false);
    await p.waitForTimeout(2500);
    await p.screenshot({ path: `${out}-${ext}.png` });
    const tempo = await p.locator(".tempoctl .num").textContent();
    const range = `${await p.getByLabel("Loop from bar").inputValue()}-${await p.getByLabel("Loop to bar").inputValue()}`;
    console.log(`${ext}: ${tab.artist} - ${tab.title} rendered=${rendered} playerReady=${ready} playing=${playing} tempo=${tempo} loopPressed=${await p.getByRole("button", { name: "Loop" }).getAttribute("aria-pressed")} bars=${range}`);
    await ctx.close();
  }
} finally { await b.close(); srv.kill(); }
