/** Issue #23: scratch-only tool states; synthetic audio, no real microphone/provider.
 * node scripts/smoke-tools.ts [artifact-directory] (directory must not exist)
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

import { normalizeProfile } from "../server/generic/studio.ts";
import { nextStage } from "./practice-steps.ts";
import { starterPlan } from "../server/generic/starter.ts";
import { writeFakeBin } from "./fake-coach-cli.ts";

const dir = resolve(process.argv[2] ?? join(tmpdir(), `struna-tools-${Date.now()}`));
assert.ok(!existsSync(dir), "use a fresh artifact directory; existing scratch data is never removed");
mkdirSync(join(dir, "home/plan"), { recursive: true });
const profile = normalizeProfile({ level: "beginner" }, "2026-11-14");
writeFileSync(join(dir, "home/profile.json"), JSON.stringify(profile));
writeFileSync(join(dir, "home/plan/plan.json"), JSON.stringify(starterPlan(profile, "2026-11-14")));
const bin = writeFakeBin(join(dir, "fake"), "bin/codex");
const reservation = createServer();
await new Promise<void>((r) => reservation.listen(0, "127.0.0.1", r));
const port = (reservation.address() as { port: number }).port;
await new Promise<void>((r) => reservation.close(() => r()));
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["server/index.ts"], {
  env: { ...process.env, NODE_ENV: "production", PORT: String(port), HOST: "127.0.0.1", STRUNA_MODE: "studio", STRUNA_HOME: join(dir, "home"), STRUNA_STATE_DIR: join(dir, "state"), STRUNA_CACHE_DIR: join(dir, "cache"), STRUNA_LIBRARY_DIRS: "", STRUNA_TABS_DIR: "", CLAUDE_BIN: bin, CODEX_BIN: bin },
  stdio: ["ignore", "ignore", "pipe"],
});
let stderr = "";
server.stderr.on("data", (b) => { stderr += String(b); });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox"] });
const results: string[] = [];
try {
  for (let i = 0; i < 100; i++) {
    assert.equal(server.exitCode, null, "owned server must still be running");
    if (await fetch(`${base}/api/health`).then((r) => r.ok, () => false)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const token = readFileSync(join(dir, "state/access-token"), "utf8").trim();
  const sizes = [[320, 700], [390, 844], [1003, 814], [502, 407]] as const;
  for (const [width, height] of sizes) for (const theme of ["light", "dark", "device-light", "device-dark"] as const) {
    const label = `${width}x${height}-${theme}`;
    const context = width === 502
      ? await chromium.launchPersistentContext(join(dir, `zoom-${theme}`), { executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox"], viewport: { width: 1003, height: 814 }, colorScheme: theme.endsWith("dark") ? "dark" : "light" })
      : await browser.newContext({ viewport: { width, height }, colorScheme: theme.endsWith("dark") ? "dark" : "light" });
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
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await page.addInitScript(() => {
      const w = window as unknown as { micCalls: number; micMode: string; streams: MediaStream[]; resolveMic: (() => void) | null };
      w.micCalls = 0; w.micMode = "success"; w.streams = []; w.resolveMic = null;
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async () => {
        w.micCalls++;
        if (w.micMode === "pending") await new Promise<void>((r) => { w.resolveMic = r; });
        if (w.micMode !== "success" && w.micMode !== "pending") throw new DOMException("scratch fixture", w.micMode);
        const ctx = new AudioContext();
        const stream = ctx.createMediaStreamDestination().stream;
        w.streams.push(stream);
        return stream;
      } });
    });
    await page.goto(`${base}/?token=${token}`);
    await page.waitForURL(`${base}/`);
    if (width === 502) assert.ok(await page.evaluate(() => innerWidth === 501 && devicePixelRatio === 2), "native desktop 200% zoom");
    await page.evaluate((theme) => {
      if (theme.startsWith("device")) document.documentElement.removeAttribute("data-theme");
      else document.documentElement.dataset.theme = theme;
    }, theme);
    const shot = async (name: string) => {
      await page.screenshot({ path: join(dir, `${label}-${name}.png`), fullPage: true });
      const overflow = await page.evaluate(() => [...document.querySelectorAll("body *")].filter((e) => e.getClientRects().length && e.getBoundingClientRect().right > innerWidth + 1).slice(0, 8).map((e) => `${e.tagName}.${e.className}: ${e.getBoundingClientRect().right}`));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label}/${name}: no horizontal page overflow: ${overflow.join(", ")}`);
    };
    const calls = () => page.evaluate(() => (window as unknown as { micCalls: number }).micCalls);
    await page.locator(".top").getByRole("button", { name: "Metronome", exact: true }).click();
    await page.locator("#metronome").waitFor();
    await page.getByLabel("BPM", { exact: true }).fill("83");
    await page.getByLabel("BPM", { exact: true }).press("Enter");
    await page.getByRole("tab", { name: "Metronome", exact: true }).focus();
    await page.keyboard.press("Escape");
    await page.locator(".top").getByRole("button", { name: "Metronome", exact: true }).waitFor();
    assert.equal(await page.locator(".top").getByRole("button", { name: "Metronome", exact: true }).evaluate((el) => el === document.activeElement), true);
    await page.locator(".top").getByRole("button", { name: "Metronome", exact: true }).click();
    assert.equal(await page.getByLabel("BPM", { exact: true }).inputValue(), "83");
    assert.equal(await calls(), 0);
    await shot("metronome");
    await page.getByRole("tab", { name: "Tuner", exact: true }).click();
    await page.getByRole("button", { name: "Start microphone", exact: true }).waitFor();
    assert.equal(await calls(), 0);
    await shot("idle");
    for (const [mode, text] of [["NotAllowedError", "Microphone permission denied"], ["NotFoundError", "No microphone found"], ["NotReadableError", "Microphone unavailable"]]) {
      await page.evaluate((m) => { (window as unknown as { micMode: string }).micMode = m!; }, mode);
      await page.getByRole("button", { name: /^(Start microphone|Try again)$/ }).click();
      await page.getByText(text!, { exact: true }).waitFor();
      await shot(mode!);
    }
    await page.getByRole("button", { name: "Open Metronome without a microphone" }).click();
    const before = await calls();
    await page.getByRole("tab", { name: "Tuner", exact: true }).click();
    await page.evaluate(() => { (window as unknown as { micMode: string }).micMode = "pending"; });
    await page.getByRole("button", { name: "Start microphone", exact: true }).click();
    await page.getByText("Starting the microphone", { exact: true }).waitFor();
    assert.equal(await calls(), before + 1);
    await shot("requesting");
    await page.evaluate(() => { (window as unknown as { resolveMic: () => void }).resolveMic(); });
    await page.getByText("Play a string", { exact: true }).waitFor();
    await shot("active");
    // A second native MediaStream stands in for another consumer's recorder lease.
    await page.evaluate(async () => {
      (window as unknown as { micMode: string }).micMode = "success";
      await navigator.mediaDevices.getUserMedia({ audio: true });
    });
    await page.getByRole("button", { name: "Stop microphone", exact: true }).click();
    await page.getByRole("button", { name: "Start microphone", exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => (window as unknown as { streams: MediaStream[] }).streams.map((s) => s.getTracks()[0]?.readyState)), ["ended", "live"]);
    await page.getByRole("button", { name: "Start microphone", exact: true }).click();
    await page.getByText("Play a string", { exact: true }).waitFor();
    await page.locator("#tuner").getByRole("button", { name: "Done", exact: true }).click();
    assert.deepEqual(await page.evaluate(() => (window as unknown as { streams: MediaStream[] }).streams.map((s) => s.getTracks()[0]?.readyState)), ["ended", "live", "ended"]);
    // An in-flight request that resolves after unmount must release its late stream too.
    await page.locator(".top").getByRole("button", { name: "Tuner", exact: true }).click();
    await page.evaluate(() => { (window as unknown as { micMode: string }).micMode = "pending"; });
    await page.getByRole("button", { name: "Start microphone", exact: true }).click();
    await page.getByText("Starting the microphone", { exact: true }).waitFor();
    await page.getByRole("tab", { name: "Metronome", exact: true }).click();
    await page.evaluate(() => { (window as unknown as { resolveMic: () => void }).resolveMic(); });
    await page.waitForFunction(() => (window as unknown as { streams: MediaStream[] }).streams.at(-1)?.getTracks()[0]?.readyState === "ended");
    await page.locator("#metronome").getByRole("button", { name: "Done", exact:true }).click();
    const noMic = await calls();
    await page.locator(".practice-choice > .btn").click();
    await page.getByRole("heading", { name:/Tune up/ }).waitFor();
    assert.equal(await page.locator(".stage-tempo").count(),0,"Tune up suppresses irrelevant BPM");
    assert.equal(await page.getByRole("button",{name:"Open tuner",exact:true}).count(),1);
    assert.equal(await page.getByRole("button",{name:/Log clean pass/}).count(),0);
    await page.getByRole("button",{name:"Tools",exact:true}).click();
    assert.equal(await calls(),noMic,"Tools disclosure requests no microphone");
    await page.getByRole("button",{name:"Open tuner",exact:true}).click();
    assert.equal(await calls(),noMic,"Opening tuner still requires explicit microphone activation");
    await page.getByRole("tab",{name:"Metronome",exact:true}).click();
    assert.equal(await page.getByRole("button",{name:"Use stage tempo",exact:true}).count(),0);
    await page.getByLabel("BPM",{exact:true}).fill("91");
    await page.getByLabel("BPM",{exact:true}).press("Enter");
    await page.getByRole("button",{name:"Done",exact:true}).click();
    await page.getByRole("button",{name:"Tools",exact:true}).click();
    await nextStage(page);
    await page.getByRole("button",{name:/Log clean pass/}).waitFor();
    assert.equal(await page.getByRole("button",{name:"Record take",exact:true}).count(),0,"Playing leads with click and passes");
    await page.getByRole("button",{name:"Tools",exact:true}).click();
    await page.evaluate(() => { (window as unknown as {micMode:string}).micMode="NotAllowedError"; });
    await page.getByRole("button",{name:"Record take",exact:true}).click();
    await page.getByRole("status").filter({hasText:"Microphone access is off"}).waitFor();
    assert.equal(await calls(),noMic+1,"Only deliberate Record requests microphone");
    await page.getByRole("button",{name:"Tools",exact:true}).click();
    await page.getByRole("status").filter({hasText:"Microphone access is off"}).waitFor();
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    await page.evaluate(() => { (window as unknown as { micMode: string }).micMode = "success"; });
    await page.getByRole("button", { name: "Record take", exact: true }).click();
    await page.getByRole("button", { name: /Stop take/ }).waitFor();
    const recordingCalls = await calls();
    await page.locator(".top").getByRole("button", { name: "Tuner", exact: true }).click();
    await page.getByRole("button", { name: "Start microphone", exact: true }).click();
    await page.getByText("Stop the recording before starting the tuner.", { exact: true }).waitFor();
    assert.equal(await calls(), recordingCalls, "tuner never requests a second capture during recording");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: /Stop take/ }).click();
    await page.locator(".takebox").getByRole("button", { name: "Discard", exact: true }).click();
    await page.evaluate(() => { (window as unknown as { micMode: string }).micMode = "pending"; });
    await page.getByRole("button", { name: "Record take", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Waiting for microphone permission" }).waitFor();
    await page.getByRole("button", { name: "End session", exact: true }).click();
    await page.getByRole("button", { name: "Resume session", exact: true }).click();
    await page.evaluate(() => { (window as unknown as { resolveMic: () => void }).resolveMic(); });
    await page.waitForFunction(() => (window as unknown as { streams: MediaStream[] }).streams.at(-1)?.getTracks()[0]?.readyState === "ended");
    await page.evaluate(() => { (window as unknown as { micMode: string }).micMode = "success"; });
    await page.getByRole("button", { name: "Record take", exact: true }).click();
    await page.getByRole("button", { name: /Stop take/ }).waitFor();
    await page.getByRole("button", { name: /Stop take/ }).click();
    await page.locator(".takebox").getByRole("button", { name: "Discard", exact: true }).click();
    assert.deepEqual(errors, []);
    results.push(`${label}: direct click, idle, denied/missing/unavailable, retry, requesting/active/stop, independent lease, close and late release passed`);
    await context.close();
  }
  console.log(results.join("\n"));
  console.log(`Artifacts: ${dir}`);
} finally {
  writeFileSync(join(dir, "checks.txt"), results.join("\n") + "\n");
  writeFileSync(join(dir, "server-stderr.log"), stderr);
  await browser.close();
  if (server.exitCode === null) { server.kill(); await new Promise((r) => server.once("exit", r)); }
}
