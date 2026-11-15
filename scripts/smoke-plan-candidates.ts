/** Scratch-only end-to-end Coach proposals, real OS write boundary and stand-in providers. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright-core";
import { writeFakeBin } from "./fake-coach-cli.ts";
import { normalizeProfile } from "../server/generic/studio.ts";
import { starterPlan } from "../server/generic/starter.ts";

const root = await mkdtemp(join(tmpdir(), "struna-proposals-browser-"));
const home = join(root, "home"); const state = join(root, "state"); const fakeDir = join(root, "fake");
for (const dir of ["plan", "materials"]) await mkdir(join(home, dir), { recursive: true });
await mkdir(fakeDir); await mkdir(join(root, "shots"));
const profile = normalizeProfile({}, new Date().toISOString());
await writeFile(join(home, "profile.json"), JSON.stringify(profile));
const plan = starterPlan(profile, "2026-11-14");
const original = JSON.stringify(plan, null, 2);
await writeFile(join(home, "plan/plan.json"), original);
await writeFile(join(fakeDir, "good-plan.json"), JSON.stringify(plan));
const fake = writeFakeBin(fakeDir); const codex = writeFakeBin(fakeDir, "codex-install/bin/codex");
const socket = createServer(); await new Promise<void>((r) => socket.listen(0, "127.0.0.1", r));
const port = (socket.address() as { port: number }).port; await new Promise<void>((r) => socket.close(() => r()));
const base = `http://localhost:${port}`;
const child = spawn(process.execPath, ["server/index.ts"], { env: { ...process.env, NODE_ENV: "production", STRUNA_MODE: "studio", STRUNA_HOME: home, STRUNA_STATE_DIR: state, STRUNA_CACHE_DIR: join(root, "cache"), STRUNA_NO_SCAN: "1", STRUNA_LIBRARY_DIRS: "", STRUNA_TABS_DIR: "", STRUNA_COACH_HOST_LOGINS: "1", CLAUDE_BIN: fake, CODEX_BIN: codex, HOST: "127.0.0.1", PORT: String(port), SOCKET_PATH: "", EDGE_SECRET_FILE: "", REQUIRE_USER: "" }, stdio: "ignore" });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox"] });
try {
  for (let i = 0; ; i++) {
    if (child.exitCode !== null) throw new Error("Scratch server stopped");
    if (await fetch(`${base}/api/health`).then((r) => r.ok, () => false)) break;
    if (i > 100) throw new Error("Scratch server did not start");
    await new Promise(r => setTimeout(r, 100));
  }
  const token = (await readFile(join(state, "access-token"), "utf8")).trim();
  const headers = { "x-struna": "1", "content-type": "application/json", "x-struna-token": token };
  // Seed through the actual token-protected chat route; the stand-in attempts live writes as well.
  const propose = async (provider = "claude") => {
    const r = await fetch(`${base}/api/chat`, { method: "POST", headers, body: JSON.stringify({ provider, message: "PROPOSE PLAN; TRY LIVE WRITE" }) });
    assert.equal(r.status, 200); const text = await r.text();
    assert.doesNotMatch(text, /event: error/); assert.match(text, /proposed plan is ready/);
    assert.deepEqual(JSON.parse(await readFile(join(fakeDir, "denied-writes.json"), "utf8")), [true, true]);
    assert.equal(await readFile(join(home, "plan/plan.json"), "utf8"), original);
    assert.equal((await readdir(join(home, "plan/archive"))).length, 0);
  };
  for (const [width, height] of [[320, 700], [390, 844], [1003, 814], [502, 407]]) for (const theme of ["light", "dark", "device"]) {
    await propose(theme === "dark" ? "codex" : "claude");
    const context = width === 502
      ? await chromium.launchPersistentContext(join(root, `zoom-${theme}`), { executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox"], viewport: { width: 1003, height: 814 }, colorScheme: theme === "dark" ? "dark" : "light" })
      : await browser.newContext({ viewport: { width: width!, height: height! }, colorScheme: theme === "dark" ? "dark" : "light" });
    if (width === 502) {
      const settings = await context.newPage(); await settings.goto("chrome://settings/appearance");
      await settings.evaluate(async () => {
        const { chrome } = globalThis as unknown as { chrome: { settingsPrivate: { setDefaultZoom: (factor: number) => Promise<void> } } };
        await chrome.settingsPrivate.setDefaultZoom(2);
      });
      await settings.close();
    }
    const page = await context.newPage();
    await page.addInitScript((t) => { if (t !== "device") localStorage.setItem("struna.theme", t); }, theme);
    await page.goto(`${base}/?token=${token}#practice`);
    await page.getByRole("button", { name: "Coach", exact: true }).click();
    const proposal = page.locator(".plan-proposal");
    await proposal.getByRole("heading", { name: "Proposed plan change", exact: true }).waitFor();
    assert.match(await proposal.innerText(), /Before.*After/s);
    await page.reload();
    await page.getByRole("button", { name: "Coach", exact: true }).click();
    await proposal.waitFor();
    await page.screenshot({ path: join(root, "shots", `${width}-${theme}-preview.png`), fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (width === 502) assert.ok(await page.evaluate(() => innerWidth === 501 && devicePixelRatio === 2));
    await proposal.getByRole("button", { name: "Dismiss proposal", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".plan-proposal").length === 0);
    assert.equal(await readFile(join(home, "plan/plan.json"), "utf8"), original);
    await context.close();
  }
  await propose();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage(); await page.goto(`${base}/?token=${token}#practice`);
  await page.locator(".practice-choice > .btn").first().click();
  await page.getByRole("button", { name: "Coach", exact: true }).click();
  await page.locator(".plan-proposal").waitFor();
  assert.equal(await page.getByRole("button", { name: "Apply plan change", exact: true }).isDisabled(), true);
  await page.getByRole("dialog", { name: "Coach", exact: true }).getByRole("button", { name: "Done", exact: true }).click();
  await page.route("**/api/practice-state", (route) => route.abort());
  await page.reload();
  await page.getByRole("heading", { name: "Reconnect practice", exact: true }).waitFor();
  assert.equal(await page.locator(".clock").count(), 0, "unregistered restored practice cannot run");
  assert.ok(await page.evaluate(() => sessionStorage.getItem("struna.session")));
  await page.unroute("**/api/practice-state");
  await page.getByRole("button", { name: "Retry practice connection", exact: true }).click();
  await page.locator(".clock").waitFor();
  await page.getByRole("button", { name: "End session", exact: true }).click();
  await page.getByRole("button", { name: "Discard session", exact: true }).click();
  await page.getByRole("button", { name: "Yes, discard session", exact: true }).click();
  await page.getByRole("button", { name: "Coach", exact: true }).click();
  await page.getByRole("button", { name: "Apply plan change", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector(".plan-proposal"));
  assert.equal(JSON.parse(await readFile(join(home, "plan/plan.json"), "utf8")).next, "Play the proposed slow roll");
  await page.screenshot({ path: join(root, "shots", "applied.png"), fullPage: true });
  await context.close();
  console.log(`Plan candidate browser smoke passed: 12 width/theme/zoom cases plus active-session guard and explicit Apply; artifacts ${root}`);
} finally { await browser.close(); child.kill("SIGTERM"); await new Promise<void>(r => child.exitCode !== null ? r() : child.once("exit", () => r())); }
