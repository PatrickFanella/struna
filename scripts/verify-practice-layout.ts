/** Scratch-only reading geometry and continuity checks for #98/#99. Run after pnpm build.
 * node scripts/verify-practice-layout.ts [evidence-directory]
 * Owns a temporary Studio, a free loopback port and one browser; no model or owner data.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type BrowserContext } from "playwright-core";
import { normalizeProfile, validatePlan } from "../server/generic/studio.ts";
import { starterPlan } from "../server/generic/starter.ts";

const root = resolve(import.meta.dirname, "..");
const scratch = mkdtempSync(join(tmpdir(), "struna-reading-"));
const evidence = resolve(process.argv[2] ?? join(scratch, "evidence"));
const home = join(scratch, "studio");
mkdirSync(join(home, "materials"), { recursive: true });
mkdirSync(join(home, "plan"));
mkdirSync(evidence, { recursive: true });
const profile = normalizeProfile({}, new Date().toISOString());
const plan = starterPlan(profile, "2026-11-15");
plan.sessions = [{ id: "reading", label: "Read and play", stages: [{ key: "technique", title: "Play open strings", minutes: 3, task: "Play each open string gently. Let it ring before the next note.", targetBpm: 60 }] }];
for (const phase of plan.phases) phase.focus = {};
writeFileSync(join(home, "profile.json"), JSON.stringify(profile));
writeFileSync(join(home, "materials", "open-strings.md"), "```text\ne|--0---0---0---0--|\nB|----------------|\nG|----------------|\nD|----------------|\nA|----------------|\nE|--0---0---0---0--|\n```\n" + "\nOriginal reading-position fixture.\n".repeat(80));
for (const kind of plan.sessions) for (const stage of kind.stages) stage.material = { file: "materials/open-strings.md" };
plan.materials = [{ label: "Open strings", file: "materials/open-strings.md" }];
assert.deepEqual(validatePlan(plan).errors, []);
writeFileSync(join(home, "plan", "plan.json"), JSON.stringify(plan));

const socket = createServer();
socket.listen(0, "127.0.0.1");
await once(socket, "listening");
const port = (socket.address() as { port: number }).port;
await new Promise<void>((resolve) => socket.close(() => resolve()));
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["server/index.ts"], {
  cwd: root,
  env: { ...process.env, NODE_ENV: "production", HOST: "127.0.0.1", PORT: String(port),
    STRUNA_MODE: "studio", STRUNA_HOME: home, STRUNA_STATE_DIR: join(scratch, "state"),
    STRUNA_CACHE_DIR: join(scratch, "cache"), STRUNA_LIBRARY_DIRS: "", STRUNA_TABS_DIR: "",
    STRUNA_COACH_HOST_LOGINS: "0", STRUNA_COACH_DEVICE_SIGNIN: "0", STRUNA_COACH_WEB: "0",
    STRUNA_VAULT_ROOT: join(scratch, "vault"), STRUNA_MEDIA_ROOT: join(scratch, "media"),
    CLAUDE_BIN: "/bin/false", CODEX_BIN: "/bin/false", EDGE_SECRET_FILE: "", SOCKET_PATH: "", REQUIRE_USER: "", ALLOWED_HOSTS: "" },
  stdio: "ignore",
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const results: object[] = [];
try {
  for (let i = 0; ; i++) {
    if (child.exitCode !== null) throw new Error("Scratch server exited");
    if (await fetch(`${base}/api/health`).then((r) => r.ok, () => false)) break;
    if (i > 100) throw new Error("Scratch server unavailable");
    await new Promise((r) => setTimeout(r, 100));
  }
  const token = readFileSync(join(scratch, "state/access-token"), "utf8").trim();
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : chromium.executablePath()) });
  for (const [width, height] of [[390, 844], [320, 700], [844, 390], [820, 1180], [1003, 814], [1153, 814], [1440, 900], [576, 407]]) for (const theme of ["light", "dark", "device"]) {
    const options = { viewport: { width: width === 576 ? 1153 : width!, height: width === 576 ? 814 : height! }, colorScheme: theme === "dark" ? "dark" as const : "light" as const, extraHTTPHeaders: { "x-struna-token": token } };
    const context: BrowserContext = width === 576
      ? await chromium.launchPersistentContext(join(scratch, `zoom-${theme}`), { ...options, executablePath: process.env.CHROMIUM ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : chromium.executablePath()) })
      : await browser.newContext(options);
    if (width === 576) {
      const settings = await context.newPage(); await settings.goto("chrome://settings/appearance");
      await settings.evaluate(async () => {
        const c = (globalThis as unknown as { chrome: { settingsPrivate: { setDefaultZoom: (factor: number) => Promise<void> } } }).chrome;
        await c.settingsPrivate.setDefaultZoom(2);
      });
      await settings.close();
    }
    // A ready offline stand-in exposes the composer for pin/draft continuity. Nothing is sent.
    await context.route("**/api/providers", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ last: "scratch", list: [{ id: "scratch", label: "Offline fixture", ok: true, detail: "Scratch only" }] }) }));
    const page = await context.newPage();
    await page.addInitScript((theme) => { if (theme !== "device") localStorage.setItem("struna.theme", theme); }, theme);
    await page.goto(base);
    await page.locator(".practice-choice > .btn").click();
    await page.locator(".pane-file pre").waitFor();
    await page.evaluate(() => document.fonts.ready);
    const geometry = await page.evaluate(() => {
      const rect = (selector: string) => { const r = document.querySelector(selector)!.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; };
      return { tab: rect(".pane-file pre"), reader: rect(".pane-file .panescroll"), click: rect(".tempocol"), clean: rect(".passes"), miss: rect(".miss"), next: rect(".nextb"), nav: rect(".tabs"), overflow: document.documentElement.scrollWidth > innerWidth };
    });
    await page.screenshot({ path: join(evidence, `${width}-${theme}.png`) });
    console.log(`Reading case ${width} ${theme}`);
    if (width === 576) assert.equal(await page.evaluate(() => devicePixelRatio), 2, "native desktop zoom is 200%");
    assert.equal(geometry.overflow, false);
    for (const name of ["click", "clean", "miss", "next"] as const) {
      assert(geometry[name].height >= 48 && geometry[name].width >= 48, `${name} has a 48px target`);
    }
    if ([390, 820, 1003, 1153, 1440].includes(width!)) {
      assert(geometry.tab.top >= geometry.reader.top && geometry.tab.bottom <= geometry.reader.bottom, "complete six-string block fits in the reader");
      const boundary = geometry.nav.height ? geometry.nav.top : height!;
      assert(geometry.clean.bottom <= boundary && geometry.click.bottom <= boundary, "music and playing controls share the initial viewport");
      assert(geometry.nav.bottom <= height! + 1, "navigation fits in the viewport");
    }
    assert.equal(await page.locator(".pane-coach").count(), 0, "Coach never opens automatically");
    const reader = page.locator(".pane-file .panescroll");
    await reader.evaluate((el) => { el.scrollTop = 60; el.dataset.continuity = "kept"; });
    const before = await page.evaluate(() => sessionStorage.getItem("struna.session"));
    await page.getByRole("button", { name: "Expand reader", exact: true }).click();
    await page.keyboard.press("Escape");
    assert.equal(await reader.getAttribute("data-continuity"), "kept");
    assert.equal(await reader.evaluate((el) => el.scrollTop), 60);
    assert.equal(await page.evaluate(() => sessionStorage.getItem("struna.session")), before);
    await page.getByRole("button", { name: "Metronome", exact: true }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    assert.equal(await reader.getAttribute("data-continuity"), "kept");
    assert.equal(await reader.evaluate((el) => el.scrollTop), 60);
    if (width! >= 1000) {
      await page.locator(".top").getByRole("button", { name: "Coach", exact: true }).click();
      const coach = page.getByRole("dialog", { name: "Coach", exact: true });
      await coach.getByRole("textbox", { name: "Message", exact: true }).fill("Keep this reading draft");
      await coach.getByRole("button", { name: "Pin beside music", exact: true }).click();
      await page.getByRole("button", { name: "Unpin Coach", exact: true }).click();
      await page.locator(".top").getByRole("button", { name: "Coach", exact: true }).click();
      assert.equal(await coach.getByRole("textbox", { name: "Message", exact: true }).inputValue(), "Keep this reading draft");
      await coach.getByRole("button", { name: "Done", exact: true }).click();
      assert.equal(await reader.getAttribute("data-continuity"), "kept");
      assert.equal(await reader.evaluate((el) => el.scrollTop), 60);
    }
    await page.setViewportSize({ width: height!, height: width! });
    await page.setViewportSize({ width: width!, height: height! });
    assert.equal(await reader.getAttribute("data-continuity"), "kept");
    results.push({ width, height, theme, geometry });
    await context.close();
  }
  writeFileSync(join(evidence, "reading.json"), JSON.stringify(results, null, 2));
  console.log(`PASS ${results.length} scratch reading cases. Evidence: ${evidence}`);
} finally {
  await browser?.close();
  if (child.exitCode === null && child.signalCode === null) { const stopped = once(child, "exit"); child.kill("SIGTERM"); await stopped; }
}
