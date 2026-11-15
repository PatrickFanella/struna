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
const plan = starterPlan(profile, date.slice(0, 10));
if (issue === "18") {
  mkdirSync(join(home, "materials"), { recursive: true });
  plan.materials = Array.from({ length: 30 }, (_, i) => {
    const label = i === 0 ? "Old Joe Clark — melody and alternating bass practice" : i === 1 ? "ArtistWorks/Bluegrass guitar/" + "Long musical title with slow variations ".repeat(4) + ".md" : `Exercise ${i + 1}`;
    const file = `materials/exercise-${i}.md`;
    writeFileSync(join(home, file), `# Exercise ${i + 1}\n\nPlay slowly.`);
    return { label, file, note: "Scratch lesson source; melody and accompaniment" };
  });
}
writeFileSync(join(home, "plan/plan.json"), JSON.stringify(plan));
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
async function panePicker(page: Page) {
  await page.getByRole("button", { name: /^Short session/ }).click();
  const add = page.getByRole("button", { name: "Add pane", exact: true });
  const menu = page.getByRole("menu", { name: "Choose pane content" });
  for (const mode of ["light", "dark", "Device"]) {
    await page.evaluate((mode) => {
      if (mode === "Device") delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = mode;
    }, mode);
    await add.focus();
    await page.keyboard.press("Enter");
    await menu.waitFor();
    check(await menu.getByRole("menuitem").first().evaluate((e) => e === document.activeElement), "Picker initially focuses first choice");
    check(await menu.evaluate((e) => e.scrollHeight > e.clientHeight && e.clientHeight <= innerHeight - 24), "Long picker scrolls within viewport");
    check(await menu.getByRole("menuitem").evaluateAll((els) => els.every((e) => e.scrollWidth <= e.clientWidth)), "Complete choice labels wrap without clipping");
    check(await menu.evaluate((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }), "Picker edges stay in viewport");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    const long = menu.getByRole("menuitem").nth(2);
    check(await long.locator("span").textContent() === plan.materials[1]!.label.split("/").pop()!.replace(/\.md$/, ""), "Musical title comes before source");
    check((await long.getAttribute("role")) === "menuitem" && (await long.innerText()).includes(plan.materials[1]!.label), "Full resource label remains in accessible choice text");
    await page.screenshot({ path: join(dir, `${page.viewportSize()!.width}-${mode}-picker.png`), fullPage: true });
    await page.keyboard.press("Escape");
    check(await add.evaluate((e) => e === document.activeElement), "Escape restores exact Add opener");
    await add.click();
    await page.mouse.click(2, 2);
    check(await add.evaluate((e) => e === document.activeElement), "Outside close restores Add opener");
    await add.click();
    await menu.getByRole("menuitem").nth(2).click();
    await menu.waitFor({ state: "detached" });
    check(await page.locator(".pane:visible .mdoc").filter({ hasText: "Exercise 2" }).innerText() === "Exercise 2\n\nPlay slowly.", "Touch/pointer choice opens selected resource");
    const change = page.locator(".pane:visible").last().getByRole("button", { name: /^Change what/ });
    await change.focus();
    await page.keyboard.press("Enter");
    await menu.waitFor();
    await page.keyboard.press("Escape");
    check(await change.evaluate((e) => e === document.activeElement), "Escape restores exact replacement opener");
    await change.focus();
    await page.keyboard.press("Enter");
    await menu.waitFor();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await menu.waitFor({ state: "detached" });
    check(await page.locator(".pane:visible .mdoc").filter({ hasText: "Exercise 3" }).innerText() === "Exercise 3\n\nPlay slowly.", "Keyboard replacement opens selected resource");
    await fits(page);
  }
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
      if (issue === "18") await panePicker(page);
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
