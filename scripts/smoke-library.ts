/**
 * Browser smoke test of the library viewers against the real media folder
 * (read only) and a vault copy: an ArtistWorks MP4, a remuxed CGO .mkv, a vault
 * PDF, a PDF inside the Music Sheets zip, a book PDF with its Calibre link, an
 * EPUB, and "Use in practice" handing a video to one session only.
 *
 *   node scripts/smoke-library.ts <vault-copy> <state-dir> <cache-dir> <screenshot-prefix>
 *
 * Needs `pnpm build`, Chromium, and GUITAR_MEDIA_ROOT (default: the real Guitar folder).
 */
import { spawn } from "node:child_process";
import { chromium, type Page } from "playwright-core";
const [vault, state, cache, out] = process.argv.slice(2) as [string, string, string, string];
const port = 5190;
const srv = spawn("node", ["server/index.ts"], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: "production", PORT: String(port), GUITAR_VAULT_ROOT: vault, GUITAR_STATE_DIR: state, GUITAR_CACHE_DIR: cache }, stdio: ["ignore", "ignore", "inherit"] });
const base = `http://localhost:${port}`;
for (let i = 0; i < 50 && !(await fetch(`${base}/api/health`).then((r) => r.ok, () => false)); i++) await new Promise((r) => setTimeout(r, 200));
for (let i = 0; i < 100; i++) { const s = await (await fetch(`${base}/api/library`)).json(); if (!s.scanning && s.scannedAt) break; await new Promise((r) => setTimeout(r, 300)); }
const find = async (q: string, pick: (x: any) => boolean = () => true) => (await (await fetch(`${base}/api/library?q=${encodeURIComponent(q)}`)).json()).items.find(pick);
const b = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
const ctx = await b.newContext({ viewport: { width: 820, height: 1180 } });
const p: Page = await ctx.newPage();
p.on("pageerror", (e) => console.error("page error", e.message));
async function open(q: string, pick?: (x: any) => boolean) {
  const it = await find(q, pick);
  if (!it) throw new Error(`not found: ${q}`);
  await p.goto(`${base}/#practice`);
  await p.goto(`${base}/#library`);
  await p.waitForTimeout(500);
  const back = p.getByRole("button", { name: "Back to the library" });
  if (await back.count()) await back.click();
  await p.getByRole("searchbox").fill(q);
  await p.waitForTimeout(700);
  await p.locator(".itemopen", { hasText: it.title }).first().click();
  return it;
}
const report = (name: string, ok: boolean, detail = "") => console.log(`${ok ? "OK  " : "FAIL"} ${name} ${detail}`);
try {
  for (const [name, q, pick] of [["ArtistWorks mp4", "Basic Rhythm Guitar Toolbox", (x: any) => x.source === "artistworks"], ["CGO mkv (remux)", "Old Joe Clark", (x: any) => x.source === "cgo"]] as const) {
    const it = await open(q, pick);
    const r = await p.evaluate(async () => {
      const v = document.querySelector(".viewer video") as HTMLVideoElement;
      for (let i = 0; i < 120 && v.readyState < 1; i++) await new Promise((r) => setTimeout(r, 500));
      if (v.readyState < 1) return { ok: false, err: v.error?.message };
      v.currentTime = Math.min(20, v.duration / 2);
      await new Promise((r) => v.addEventListener("seeked", r, { once: true }));
      return { ok: true, d: v.duration, t: v.currentTime, w: v.videoWidth };
    });
    report(name, r.ok, `${it.title} ${JSON.stringify(r)}`);
  }
  const pdfCheck = async (name: string, q: string, pick?: (x: any) => boolean) => {
    const it = await open(q, pick);
    const ok = await p.locator(".viewer canvas").waitFor({ timeout: 20000 }).then(() => p.evaluate(() => (document.querySelector(".viewer canvas") as HTMLCanvasElement).width > 100), () => false);
    report(name, ok, it.title);
    return it;
  };
  await pdfCheck("vault PDF", "Mirek Hulan", (x: any) => x.source === "vault");
  await pdfCheck("Music Sheets zip PDF", "Real Book Of Blues", (x: any) => x.source === "sheets");
  const tr = await pdfCheck("Tony Rice Collection Tab Book", "Tony Rice Collection Tab Book", (x: any) => x.source === "books");
  report("Calibre link", (await p.locator('a[href^="https://books.subcult.tv/book/"]').getAttribute("href")) === `https://books.subcult.tv/book/${tr.calibreId}`, String(tr.calibreId));
  await p.screenshot({ path: `${out}-pdf.png` });
  await open("Unlocking the Neck");
  const epubOk = await p.waitForFunction(() => { const f = document.querySelector(".epubpage iframe") as HTMLIFrameElement | null; return Boolean(f?.contentDocument?.body?.innerText.trim().length); }, null, { timeout: 30000 }).then(() => true, () => false);
  await p.getByRole("button", { name: "Next page" }).click();
  await p.waitForTimeout(800);
  report("EPUB Unlocking the Neck", epubOk, await p.locator(".epub .pager span").textContent() ?? "");
  await p.screenshot({ path: `${out}-epub.png` });
  // Use in practice: a video, then a short session shows it; the next session uses the block material again.
  await open("Old Joe Clark", (x: any) => x.source === "cgo");
  await p.getByRole("button", { name: "Use in practice" }).click();
  await p.waitForTimeout(500);
  await p.getByRole("button", { name: /^Short session/ }).click();
  const vid = await p.locator(".mat video").waitFor({ timeout: 5000 }).then(() => 1, () => 0);
  report("Use in practice shows the video in the session", vid === 1, await p.locator(".mat .matlabel").textContent() ?? "");
  await p.screenshot({ path: `${out}-session-video.png` });
  for (let i = 0; i < 3; i++) await p.getByRole("button", { name: /^Next stage/ }).click();
  await p.getByRole("button", { name: /^Finish/ }).click();
  p.once("dialog", (d) => void d.accept());
  await p.getByRole("button", { name: "Discard session" }).click();
  await p.getByRole("button", { name: /^Short session/ }).click();
  report("next session uses the block material", (await p.locator(".mat video").count()) === 0, await p.locator(".mat .matlabel").textContent() ?? "");
} finally { await b.close(); srv.kill(); }
