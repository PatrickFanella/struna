/** Scratch-only control regressions for roadmap #2. Never deletes an existing fixture.
 * pnpm build && node scripts/smoke-controls.ts <new-scratch-dir> [issue=28]
 * All providers are stand-ins. Screenshots and checks stay in the scratch directory.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { chromium, type Page } from "playwright-core";
import { starterPlan } from "../server/generic/starter.ts";
import { normalizeProfile } from "../server/generic/studio.ts";
import { writeFakeBin } from "./fake-coach-cli.ts";

const dir = resolve(process.argv[2]!);
const issue = process.argv[3] ?? "28";
mkdirSync(dir); // Refuse to overwrite another run.
const home = join(dir, "home");
mkdirSync(join(home, "plan"), { recursive: true });
const date = new Date().toISOString();
const profile = normalizeProfile({ level: "beginner" }, date);
writeFileSync(join(home, "profile.json"), JSON.stringify(profile));
writeFileSync(join(home, "plan/plan.json"), JSON.stringify(starterPlan(profile, date.slice(0, 10))));
const fake = writeFakeBin(join(dir, "fake"));
const port = await new Promise<number>((resolve) => {
  const s = createServer().listen(0, "127.0.0.1", () => {
    const p = (s.address() as { port: number }).port;
    s.close(() => resolve(p));
  });
});
const base = `http://localhost:${port}`;
const server = spawn(process.execPath, ["server/index.ts"], {
  env: { ...process.env, NODE_ENV: "production", PORT: String(port), STRUNA_MODE: "studio",
    STRUNA_HOME: home, STRUNA_STATE_DIR: join(dir, "state"), STRUNA_CACHE_DIR: join(dir, "cache"),
    STRUNA_LIBRARY_DIRS: "", STRUNA_TABS_DIR: "", CLAUDE_BIN: fake, CODEX_BIN: fake },
  stdio: ["ignore", "ignore", "pipe"],
});
let serverLog = "";
server.stderr.on("data", (b) => { serverLog += b; });
const checks: string[] = [];
function check(ok: unknown, message: string) { assert(ok, message); checks.push(message); }
async function fits(page: Page) {
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "No page horizontal scroll");
}
async function theme(page: Page) {
  const group = page.getByRole("radiogroup", { name: "Theme", exact: true });
  for (const name of ["Light", "Dark", "Device"]) {
    const option = group.getByRole("radio", { name, exact: true });
    await option.focus();
    await page.keyboard.press("Space");
    check(await option.getAttribute("aria-checked") === "true", `${name}: keyboard selection`);
    check(await option.evaluate((e) => e.matches(":focus-visible") && getComputedStyle(e).outlineStyle !== "none"), `${name}: visible focus`);
    check(await option.evaluate((e) => e.scrollWidth <= e.clientWidth), `${name}: label fits`);
    await fits(page);
    await page.screenshot({ path: join(dir, `${page.viewportSize()!.width}-${name}.png`), fullPage: true });
  }
  await group.getByRole("radio").evaluateAll((els) => els.forEach((el) => { el.textContent = `${el.textContent} ${el.textContent}`; }));
  check(await group.getByRole("radio").evaluateAll((els) => els.every((e) => e.scrollWidth <= e.clientWidth)), "Doubled labels fit");
  await fits(page);
  await page.screenshot({ path: join(dir, `${page.viewportSize()!.width}-doubled.png`), fullPage: true });
}
try {
  for (let i = 0; ; i++) {
    if (server.exitCode !== null) throw new Error("Scratch server exited");
    if (await fetch(`${base}/api/health`).then((r) => r.ok, () => false)) break;
    assert(i < 100, "Scratch server starts");
    await new Promise((r) => setTimeout(r, 100));
  }
  const token = readFileSync(join(dir, "state/access-token"), "utf8").trim();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox"] });
  try {
    for (const [width, height] of [[320, 700], [390, 844], [1003, 814], [502, 407]]) {
      const context = await browser.newContext({ viewport: { width: width!, height: height! }, colorScheme: "light" });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
      await page.goto(`${base}/?token=${token}`);
      await page.locator(".gstart").waitFor();
      if (issue === "28") await theme(page);
      check(!errors.length, `${width}: no page errors`);
      await context.close();
    }
  } finally { await browser.close(); }
  writeFileSync(join(dir, "checks.json"), JSON.stringify({ issue, checks }, null, 2));
  console.log(`Issue #${issue}: ${checks.length} checks passed. Artifacts: ${dir}`);
} finally {
  writeFileSync(join(dir, "server.log"), serverLog);
  server.kill();
  await new Promise((resolve) => server.exitCode !== null ? resolve(null) : server.once("exit", resolve));
}
