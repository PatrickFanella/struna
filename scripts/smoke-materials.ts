/** Materials issue smoke. Fresh, retained scratch home/state/cache; no live providers or external requests.
 * pnpm build && node scripts/smoke-materials.ts <artifact-directory> [13|14|22]
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright-core";
import { starterPlan } from "../server/generic/starter.ts";
import { normalizeProfile } from "../server/generic/studio.ts";

const issue = Number(process.argv[3] ?? 13);
const out = resolve(process.argv[2] ?? "captures/materials-13");
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "struna-materials-"));
const home = join(scratch, "home");
mkdirSync(join(home, "materials"), { recursive: true });
mkdirSync(join(home, "plan"));
const profile = normalizeProfile({ level: "intermediate" }, "2026-11-14T12:00:00Z");
writeFileSync(join(home, "profile.json"), JSON.stringify(profile));
const plan = starterPlan(profile, "2026-11-14");
plan.materials = [{ label: "Black Mountain Rag", url: "https://publisher.example/rag" }];
writeFileSync(join(home, "plan/plan.json"), JSON.stringify(plan));
const entries = [
  { url: "https://publisher.example/rag", title: "Flatpicking Guitar Magazine — November lesson: Black Mountain Rag", provider: "Flatpicking Guitar Magazine", level: "Intermediate", note: "Work through the melody slowly." },
  { url: "https://teacher.example/waltz", title: "Publisher lesson: First Waltz", shortTitle: "First Waltz", provider: "Independent Teacher" },
  { url: "https://legacy.example/lesson", title: "Legacy lesson" },
  ...Array.from({ length: 20 }, (_, n) => ({ url: `https://teacher.example/lesson-${n}`, title: `Practice lesson ${String(n).padStart(2, "0")}` })),
];
writeFileSync(join(home, "materials/links.json"), JSON.stringify(entries));
writeFileSync(join(home, "materials/Notes.md"), "# Notes\n\nPlay the melody slowly.");
const fake = join(scratch, "fake.cjs");
writeFileSync(fake, '#!/usr/bin/env node\nconsole.log("stand-in unavailable"); process.exit(1);', { mode: 0o755 });
const server = spawn("node", ["server/index.ts"], {
  cwd: resolve(import.meta.dirname, ".."),
  env: { ...process.env, HOST: "127.0.0.1", PORT: process.env.SMOKE_PORT ?? "5283", SOCKET_PATH: "", EDGE_SECRET_FILE: "", REQUIRE_USER: "", NODE_ENV: "production", STRUNA_MODE: "studio", STRUNA_HOME: home, STRUNA_STATE_DIR: join(scratch, "state"), STRUNA_CACHE_DIR: join(scratch, "cache"), STRUNA_LIBRARY_DIRS: "", STRUNA_TABS_DIR: "", CLAUDE_BIN: fake, CODEX_BIN: fake },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
server.stdout.on("data", b => output += b.toString());
server.stderr.on("data", b => output += b.toString());
let browser;
const results: string[] = [];
try {
  // The server reports the ephemeral port; never log its access token.
  for (let i = 0; i < 100 && !/http:\/\/127\.0\.0\.1:\d+/.test(output); i++) {
    assert.equal(server.exitCode, null, "scratch server is running");
    await new Promise(r => setTimeout(r, 100));
  }
  const base = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
  assert.ok(base, "scratch server reports its port");
  const token = readFileSync(join(scratch, "state/access-token"), "utf8").trim();
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox"] });
  for (const [width, height] of [[320, 700], [390, 844], [1003, 814]] as const) {
    for (const theme of ["light", "dark", "device-light", "device-dark"] as const) {
      const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme.endsWith("dark") ? "dark" : "light" });
      await context.addInitScript(t => { if (t.startsWith("device")) localStorage.removeItem("struna.theme"); else localStorage.setItem("struna.theme", t); }, theme);
      await context.addCookies([{ name: `struna_${new URL(base).port}`, value: token, url: base, httpOnly: true, sameSite: "Strict" }]);
      await context.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", e => errors.push(e.message));
      await page.goto(`${base}/#materials`);
      const row = page.locator(".matitem").filter({ hasText: "Black Mountain Rag" });
      await row.waitFor();
      assert.equal(await row.locator(".itemtitle").textContent(), "Black Mountain Rag");
      assert.match(await row.textContent() ?? "", /Flatpicking Guitar Magazine.*Intermediate.*In your plan/s);
      assert.equal(await page.locator(".itemtitle").filter({ hasText: "Legacy lesson" }).count(), 1);
      const prefix = `${width}x${height}-${theme}`;
      await screenshot(page, `${prefix}-list`);
      await row.locator(".itemopen").click();
      await page.getByRole("heading", { name: "Black Mountain Rag", exact: true }).waitFor();
      const link = page.getByRole("link", { name: "Open lesson on Flatpicking Guitar Magazine (new tab)", exact: true });
      assert.equal(await link.getAttribute("href"), entries[0]!.url);
      assert.equal(await link.getAttribute("target"), "_blank");
      await screenshot(page, `${prefix}-details`);
      if (issue >= 14) await routeChecks(page, base, prefix);
      // Text zoom equivalent, explicitly distinct from browser chrome zoom.
      await page.evaluate(() => document.documentElement.style.fontSize = "200%");
      await screenshot(page, `${prefix}-text-200`);
      assert.deepEqual(errors, []);
      if (issue >= 14) results.push(`${prefix}: item reload/paste, text/link routes, list search/kind/scroll, back/forward, missing/malformed recovery`);
      results.push(`${prefix}: source identity, short title, legacy fallback, destination/new tab, no overflow/errors, 200% text`);
      await context.close();
    }
  }
  writeFileSync(join(out, "results.json"), JSON.stringify({ scratch, results }, null, 2));
  console.log(`${results.length} matrix cases passed; artifacts ${out}; scratch ${scratch}`);
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
async function screenshot(page: Page, name: string) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${name}: horizontal overflow`);
  await page.screenshot({ path: join(out, `${name}.png`), fullPage: true });
}

async function routeChecks(page: Page, base: string, prefix: string) {
  const linkHash = new URL(page.url()).hash;
  assert.match(linkHash, /^#materials\/item\/l\.[a-f0-9]{16}$/);
  assert.equal(new URL(page.url()).search, "");
  await page.reload();
  await page.getByRole("heading", { name: "Black Mountain Rag", exact: true }).waitFor();
  await page.goto(`${base}/#materials`);
  await page.getByRole("searchbox").fill("lesson");
  await page.getByRole("button", { name: "Kind", exact: true }).click();
  await page.getByRole("radio", { name: "Link", exact: true }).click();
  const target = page.locator(".matitem").filter({ hasText: "Practice lesson 19" }).locator(".itemopen");
  await target.scrollIntoViewIfNeeded();
  // Let the debounced filter request settle before recording list position.
  await page.waitForTimeout(400);
  await target.click();
  await page.getByRole("heading", { name: "Practice lesson 19", exact: true }).waitFor();
  const top = await page.evaluate(() => history.state.materialList.scroll);
  assert.ok(top > 0);
  await page.reload();
  await page.getByRole("heading", { name: "Practice lesson 19", exact: true }).waitFor();
  await page.getByRole("button", { name: "Back to materials" }).click();
  await listRestored();
  await page.goForward();
  await page.getByRole("heading", { name: "Practice lesson 19", exact: true }).waitFor();
  await page.goBack();
  await listRestored();
  await screenshot(page, `${prefix}-restored-list`);
  await page.getByRole("searchbox").fill("");
  await page.getByRole("radio", { name: "All", exact: true }).click();
  await page.locator(".matitem").filter({ hasText: "Notes" }).locator(".itemopen").click();
  const textHash = new URL(page.url()).hash;
  await page.reload();
  await page.locator(".matviewer > h1").filter({ hasText: /^Notes$/ }).waitFor();
  await page.locator(".matbody .mdoc").getByText("Play the melody slowly.").waitFor();
  await page.goto(`${base}/#practice`);
  await page.locator('section[aria-label="Practice"].on').waitFor();
  // A pasted item URL uses the same authorized browser session.
  await page.goto(`${base}/${textHash}`);
  await page.locator(".matviewer > h1").filter({ hasText: /^Notes$/ }).waitFor();
  const textId = decodeURIComponent(textHash.split("/").at(-1)!);
  assert.ok((await page.request.delete(`${base}/api/materials/${encodeURIComponent(textId)}`, { headers: { "x-struna": "1" } })).ok());
  await page.reload();
  await page.getByRole("heading", { name: "Material unavailable", exact: true }).waitFor();
  await screenshot(page, `${prefix}-deleted-item`);
  writeFileSync(join(home, "materials/Notes.md"), "# Notes\n\nPlay the melody slowly.");
  for (const hash of ["#materials/item/l.0000000000000000", "#materials/item/%", "#materials/item/f.ZGVsZXRlZC5tZA"]) {
    await page.goto(`${base}/${hash}`);
    await page.getByRole("heading", { name: "Material unavailable", exact: true }).waitFor();
    await page.getByRole("button", { name: "Back to materials" }).click();
    await page.getByRole("heading", { name: "Materials", exact: true }).waitFor();
  }
  await screenshot(page, `${prefix}-route-recovery`);
  await page.goto(`${base}/${linkHash}`);
  await page.getByRole("heading", { name: "Black Mountain Rag", exact: true }).waitFor();
  async function listRestored() {
    await page.getByRole("heading", { name: "Materials", exact: true }).waitFor();
    assert.equal(await page.getByRole("searchbox").inputValue(), "lesson");
    assert.equal(await page.getByRole("radio", { name: "Link", exact: true }).getAttribute("aria-checked"), "true");
    await page.waitForFunction(expected => Math.abs(scrollY - expected) < 3, top);
  }
}
