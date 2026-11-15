/** Scratch-only anonymous first-practice checks for #103. Run after pnpm build.
 * node scripts/verify-guest.ts [evidence-directory]
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
const scratch = mkdtempSync(join(tmpdir(), "struna-guest-"));
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
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : chromium.executablePath()) });
  for (const [width, height] of [[320, 700], [390, 844], [844, 390], [820, 1180], [1153, 814], [1440, 900]]) for (const theme of ["light", "dark", "device"]) {
    const context = await browser.newContext({ viewport: { width: width!, height: height! }, colorScheme: theme === "dark" ? "dark" : "light" });
    const page = await context.newPage();
    const requests: string[] = [], errors: string[] = [];
    page.on("request", (req) => requests.push(new URL(req.url()).pathname));
    page.on("pageerror", (error) => errors.push(error.message));
    await context.route("**/*", (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    await page.addInitScript((theme) => {
      if (theme !== "device") localStorage.setItem("struna.theme", theme);
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: () => { throw new Error("Guest requested microphone"); } });
    }, theme);
    // No owner access token or authenticated cookie.
    await page.goto(`${base}/try`);
    await page.getByRole("heading", { name: "A little music, at your pace", exact: true }).waitFor();
    assert.equal((await context.cookies()).length, 0);
    await page.getByRole("button", { name: "Try the 2-minute exercise", exact: true }).click();
    await page.getByRole("heading", { name: "Give one open string room", exact: true }).waitFor();
    await page.getByRole("button", { name: "Edit my choices", exact: true }).click();
    await page.locator(".guest-choices summary").click();
    await page.getByRole("radio", { name: "Steady rhythm", exact: true }).check();
    await page.getByRole("radio", { name: "I have played before", exact: true }).check();
    assert.match(await page.locator(".guest-preview").innerText(), /Make space in a rhythm/);
    await page.getByRole("button", { name: "Try the 2-minute exercise", exact: true }).click();
    await page.getByRole("button", { name: "Edit my choices", exact: true }).click();
    await page.locator(".guest-choices summary").click();
    assert.equal(await page.getByRole("radio", { name: "Steady rhythm", exact: true }).isChecked(), true);
    await page.getByRole("button", { name: "Try the 2-minute exercise", exact: true }).click();
    await page.getByRole("button", { name: "Finish practice", exact: true }).click();
    await page.getByRole("textbox", { name: "My reflection (optional)", exact: true }).fill("My hand felt relaxed; this is my own observation.");
    await page.reload();
    assert.match(await page.getByRole("textbox", { name: "My reflection (optional)", exact: true }).inputValue(), /own observation/);
    await page.getByRole("button", { name: "Keep this on this device", exact: true }).click();
    await page.getByRole("heading", { name: "Practice marked complete", exact: true }).waitFor();
    await page.reload();
    await page.getByRole("heading", { name: "Practice marked complete", exact: true }).waitFor();
    await page.screenshot({ path: join(evidence, `${width}-${theme}-guest.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole("button", { name: "Choose a different focus", exact: true }).click();
    await page.getByRole("button", { name: "Try the 2-minute exercise", exact: true }).click();
    await page.getByRole("button", { name: "Finish practice", exact: true }).click();
    assert.equal(await page.getByRole("textbox", { name: "My reflection (optional)", exact: true }).inputValue(), "", "a different attempt never inherits a completed reflection");
    await page.getByRole("textbox", { name: "My reflection (optional)", exact: true }).fill("This note will be skipped");
    await page.getByRole("button", { name: "Skip reflection", exact: true }).click();
    assert.equal(await page.locator("blockquote").count(), 0, "skipped reflection is not saved against the next activity");
    await page.getByRole("button", { name: "Choose a different focus", exact: true }).click();
    await page.getByRole("button", { name: "Explore without a guitar", exact: true }).click();
    await page.getByRole("button", { name: "Finish exploring", exact: true }).click();
    await page.getByRole("button", { name: "Skip reflection", exact: true }).click();
    await page.getByRole("heading", { name: "Exercise explored", exact: true }).waitFor();
    await page.getByRole("button", { name: "Clear guest practice on this device", exact: true }).click();
    await page.reload();
    await page.getByRole("heading", { name: "A little music, at your pace", exact: true }).waitFor();
    assert.deepEqual(requests.filter((path) => path.startsWith("/api/") || path.startsWith("/auth/")), [], "guest never calls private APIs or account/model endpoints");
    assert.deepEqual(errors, []);
    results.push({ width, height, theme, requests: [...new Set(requests)] });
    await context.close();
  }
  const context = await browser.newContext();
  await context.addInitScript(() => { Object.defineProperty(Storage.prototype, "setItem", { value: () => { throw new Error("storage unavailable"); } }); });
  const page = await context.newPage(); await page.goto(`${base}/try`);
  await page.getByRole("status").filter({ hasText: "Browser storage is unavailable" }).waitFor();
  await page.getByRole("button", { name: "Explore without a guitar", exact: true }).click();
  await page.getByRole("button", { name: "Finish exploring", exact: true }).click();
  await page.getByRole("button", { name: "Skip reflection", exact: true }).click();
  await page.getByText("available in this open page only", { exact: false }).waitFor();
  await context.close();
  assert.equal((await fetch(`${base}/api/profile`)).status, 403, "public starter does not open private APIs");
  assert.equal((await fetch(`${base}/brand/missing.svg`)).status, 404, "missing public assets never fall back to owner HTML");
  const shell = await (await fetch(`${base}/try`)).text();
  assert.match(shell, /"mode":"guest"/); assert.doesNotMatch(shell, /"mode":"studio"|"profile":true/);
  writeFileSync(join(evidence, "guest.json"), JSON.stringify({ cases: results, storageUnavailable: true, privateAPIsDenied: true }, null, 2));
  console.log(`PASS ${results.length} guest cases, storage-unavailable recovery, public shell and denied private APIs. Evidence: ${evidence}`);
} finally {
  await browser?.close();
  if (child.exitCode === null && child.signalCode === null) { const stopped = once(child, "exit"); child.kill("SIGTERM"); await stopped; }
}
