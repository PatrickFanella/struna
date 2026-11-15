/** #107: scratch fresh/returning keyboard, orientation and denied-capture checks. pnpm build first. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const scratch = mkdtempSync(join(tmpdir(), "struna-help-"));
const evidence = resolve(process.argv[2] ?? join(scratch, "evidence"));
mkdirSync(evidence, { recursive: true });
const reservation = createServer();
await new Promise<void>((r) => reservation.listen(0, "127.0.0.1", r));
const port = (reservation.address() as { port: number }).port;
await new Promise<void>((r) => reservation.close(() => r()));
const child = spawn(process.execPath, ["scripts/qualification-studio.ts", join(scratch, "fixture")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const base = `http://localhost:${port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : chromium.executablePath()) });
const results: object[] = [];
try {
  for (let i = 0; ; i++) {
    if (child.exitCode !== null) throw new Error("Owned fixture exited");
    if (await fetch(base + "/api/health").then((r) => r.ok, () => false)) break;
    if (i > 100) throw new Error("Fixture did not start");
    await new Promise((r) => setTimeout(r, 100));
  }
  for (const width of [320, 390]) for (const theme of ["light", "dark", "device-light", "device-dark"]) {
    const context = await browser.newContext({ viewport: { width, height: width === 320 ? 700 : 844 }, colorScheme: theme.endsWith("dark") ? "dark" : "light", reducedMotion: "reduce" });
    await context.addInitScript((theme) => {
      if (!theme.startsWith("device")) localStorage.setItem("struna.theme", theme);
      Object.assign(window, { captureRequests: 0 });
      navigator.mediaDevices.getUserMedia = async () => { (window as unknown as { captureRequests: number }).captureRequests++; throw new DOMException("Denied fixture", "NotAllowedError"); };
    }, theme);
    await context.route("**/api/providers", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ last: "scratch", list: [{ id: "scratch", label: "Offline fixture", ok: true, detail: "Scratch only" }] }) }));
    const page = await context.newPage();
    const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/try");
    await page.getByRole("button", { name: "Explore without a guitar", exact: true }).click();
    const guest = await page.evaluate(() => localStorage.getItem("struna.guest.v1"));
    assert.ok(guest, "guest state was saved before help dismissal");
    const reading = page.locator(".task-help");
    assert.equal(await reading.getAttribute("open"), "");
    await reading.getByRole("button", { name: "Got it, hide tip" }).click();
    assert.equal(await reading.getAttribute("open"), null);
    await page.setViewportSize({ width: 844, height: 390 });
    await page.setViewportSize({ width, height: width === 320 ? 700 : 844 });
    assert.equal(await page.evaluate(() => localStorage.getItem("struna.guest.v1")), guest);
    await page.reload();
    assert.equal(await reading.getAttribute("open"), null);
    await reading.locator("summary").focus(); await page.keyboard.press("Enter");
    await reading.getByRole("button", { name: "Got it, hide tip" }).waitFor();
    await page.goto(base + "/?token=" + "0".repeat(64));
    await page.getByRole("button", { name: "Tuner", exact: true }).click();
    const help = page.locator(".tool-sheet .task-help");
    await help.getByRole("button", { name: "Got it, hide tip" }).click();
    assert.equal(await page.evaluate(() => (window as unknown as { captureRequests: number }).captureRequests), 0);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Tuner", exact: true }).click();
    assert.equal(await help.getAttribute("open"), null);
    await help.locator("summary").focus(); await page.keyboard.press("Enter");
    await help.getByRole("button", { name: "Got it, hide tip" }).waitFor();
    await help.getByRole("button", { name: "Got it, hide tip" }).click();
    await page.getByRole("button", { name: "Start microphone", exact: true }).click();
    await page.getByRole("button", { name: "Open Metronome without a microphone" }).waitFor();
    assert.equal(await page.evaluate(() => (window as unknown as { captureRequests: number }).captureRequests), 1);
    await page.getByRole("button", { name: "Open Metronome without a microphone" }).click();
    await page.locator(".task-help").getByRole("button", { name: "Got it, hide tip" }).click();
    await page.keyboard.press("Escape");
    await page.locator(".practice-choice > .btn").click();
    await page.locator(".session").waitFor();
    const reader = page.locator(".pane-file .panescroll");
    await reader.evaluate((el) => { el.scrollTop = 60; el.dataset.continuity = "kept"; });
    await page.locator(".tabs .nav-coach").click();
    const coach = page.getByRole("dialog", { name: "Coach", exact: true });
    await coach.getByRole("textbox", { name: "Message", exact: true }).fill("Unsent help continuity draft");
    await coach.getByRole("button", { name: "Done", exact: true }).click();
    const before = await page.evaluate(() => sessionStorage.getItem("struna.session"));
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    await page.locator(".task-help").getByRole("button", { name: "Got it, hide tip" }).click();
    await page.setViewportSize({ width: 844, height: 390 });
    await page.setViewportSize({ width, height: width === 320 ? 700 : 844 });
    const after = await page.evaluate(() => sessionStorage.getItem("struna.session"));
    assert.equal(await reader.getAttribute("data-continuity"), "kept");
    assert.equal(await reader.evaluate((el) => el.scrollTop), 60);
    await page.locator(".tabs .nav-coach").click();
    assert.equal(await coach.getByRole("textbox", { name: "Message", exact: true }).inputValue(), "Unsent help continuity draft");
    await coach.getByRole("button", { name: "Done", exact: true }).click();
    assert.deepEqual(JSON.parse(after!), JSON.parse(before!), "help and orientation leave session/timer/panes untouched");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: join(evidence, `${width}-${theme}.png`) });
    results.push({ width, theme, guestRetained: true, sessionRetained: true, deniedCaptureAfterExplicitAction: true, keyboardReopen: true, reducedMotion: true });
    await context.close();
  }
  writeFileSync(join(evidence, "help.json"), JSON.stringify({ scratch, results }, null, 2));
  console.log(`Contextual help passed ${results.length} fresh/returning phone cases; ${evidence}`);
} finally { await browser.close(); child.kill("SIGTERM"); }
