/** Scratch-only 20-second rest, skip, timing, focus and recovery regression.
 * pnpm build; node scripts/smoke-stage-breaks.ts
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright-core";

const dir = await mkdtemp(join(tmpdir(), "struna-stage-breaks-"));
await mkdir(join(dir, "shots"));
const reservation = createServer();
await new Promise<void>((r) => reservation.listen(0, "127.0.0.1", r));
const port = (reservation.address() as { port: number }).port;
await new Promise<void>((r) => reservation.close(() => r()));
const base = `http://localhost:${port}`;
const server = spawn(process.execPath, ["scripts/qualification-studio.ts", join(dir, "fixture")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox"] });
const checks: string[] = [];
try {
  for (let n = 0; ; n++) {
    assert.equal(server.exitCode, null, "owned fixture server must stay running");
    if (await fetch(`${base}/api/health`).then((r) => r.ok, () => false)) break;
    assert.ok(n < 100, "fixture starts");
    await new Promise((r) => setTimeout(r, 100));
  }
  for (const [width, height] of [[320, 700], [390, 844], [1003, 814], [502, 407]]) for (const theme of ["light", "dark", "device"]) {
    const context = width === 502
      ? await chromium.launchPersistentContext(join(dir, `zoom-${theme}`), { executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox"], viewport: { width: 1003, height: 814 }, colorScheme: theme === "light" ? "light" : "dark" })
      : await browser.newContext({ viewport: { width: width!, height: height! }, colorScheme: theme === "light" ? "light" : "dark" });
    if (width === 502) {
      const settings = await context.newPage(); await settings.goto("chrome://settings/appearance");
      await settings.evaluate(async () => {
        const { chrome } = globalThis as unknown as { chrome: { settingsPrivate: { setDefaultZoom: (factor: number) => Promise<void> } } };
        await chrome.settingsPrivate.setDefaultZoom(2);
      });
      await settings.close();
    }
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript((t) => { if (t !== "device") localStorage.setItem("struna.theme", t); }, theme);
    // Install before Session mounts so its interval belongs to the controlled clock.
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    await page.goto(`${base}/?token=${"0".repeat(64)}#practice`);
    await page.getByRole("button", { name: /^Start .* min practice/ }).click();
    await page.getByRole("button", { name: "Start the stage timer", exact: true }).click();
    await page.clock.fastForward(5_000);
    await page.locator(".tempocol").press("Enter");
    await page.getByRole("button", { name: /^Next stage/ }).press("Enter");
    const rest = page.getByRole("dialog", { name: "Take a short break", exact: true });
    await rest.waitFor();
    assert.match(await rest.getByRole("timer").innerText(), /^20\s*seconds$/);
    assert.equal(await rest.getByRole("timer").getAttribute("aria-live"), "off");
    assert.equal(await rest.getByRole("button", { name: "Skip break", exact: true }).evaluate((e) => e === document.activeElement), true);
    const snapshot = () => page.evaluate(() => JSON.parse(sessionStorage.getItem("struna.session")!));
    const before = await snapshot();
    assert.equal(before.stage, 0);
    assert.equal(before.resumedAt, null);
    assert.equal(before.activeBefore, 5000);
    assert.equal(before.stageBreak.running, true);
    await page.locator(".sessionstatus").getByRole("status").filter({ hasText: /^Click stopped$/ }).waitFor();
    await page.clock.fastForward(5000);
    assert.match(await rest.getByRole("timer").innerText(), /^15\s*seconds$/);
    assert.equal((await snapshot()).activeBefore, 5000);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (width === 502) assert.ok(await page.evaluate(() => innerWidth === 501 && devicePixelRatio === 2));
    // Preserve native zoom metrics; full-page screenshots can reset/crop this viewport.
    const cdp = await context.newCDPSession(page);
    const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(join(dir, "shots", `${width}-${theme}-break.png`), Buffer.from(shot.data, "base64"));
    await cdp.detach();
    await page.clock.fastForward(14_999);
    assert.equal(await rest.count(), 1, "break does not finish before 20 seconds");
    await page.clock.fastForward(251);
    await rest.waitFor({ state: "detached" });
    await page.getByRole("heading", { level: 1, name: /Technique$/ }).waitFor();
    let state = await snapshot();
    assert.equal(state.stage, 1);
    assert.equal(state.activeBefore, 5000);
    assert.notEqual(state.resumedAt, null);
    assert.equal(state.stageBreak, undefined);
    await page.waitForFunction(() => document.activeElement === document.querySelector(".clock"));
    await page.getByRole("button", { name: "Pause the stage timer", exact: true }).click();
    await page.getByRole("button", { name: /^Next stage/ }).click();
    await rest.waitFor();
    assert.equal((await snapshot()).stageBreak.running, false);
    await page.keyboard.press("Escape");
    await rest.waitFor({ state: "detached" });
    assert.equal((await snapshot()).resumedAt, null, "Escape skips rest while keeping a paused stage paused");
    await page.getByRole("button", { name: "Back", exact: true }).click();
    assert.equal(await rest.count(), 0, "Back is immediate");
    await page.getByRole("button", { name: /^Next stage/ }).click();
    await rest.waitFor();
    await page.clock.fastForward(5000);
    const recovering = await snapshot();
    await page.reload();
    await rest.waitFor();
    assert.deepEqual((await snapshot()).stageBreak, recovering.stageBreak, "reload does not reset the break deadline");
    await rest.getByRole("button", { name: "Skip break", exact: true }).press("Enter");
    await rest.waitFor({ state: "detached" });
    assert.equal((await snapshot()).resumedAt, null);
    await page.waitForFunction(() => document.activeElement === document.querySelector(".clock"));
    await page.getByRole("button", { name: /^Finish/ }).click();
    await page.getByRole("heading", { name: "How did it go?", exact: true }).waitFor();
    assert.equal(await rest.count(), 0, "Finish goes directly to review");
    assert.deepEqual(errors, []);
    checks.push(`${width}x${height} ${theme}: countdown, automatic completion, frozen active time/click, running/paused state, Escape/button skip, reload, focus, Back and Finish passed`);
    await context.close();
  }
  await writeFile(join(dir, "checks.json"), JSON.stringify(checks, null, 2));
  console.log(`Stage break smoke passed: ${checks.length} width/theme/native-zoom cases; artifacts ${dir}`);
} finally {
  await browser.close(); server.kill("SIGTERM");
  await new Promise<void>((r) => server.exitCode !== null ? r() : server.once("exit", () => r()));
}
