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
    if (process.env.SMOKE_WIDTH && width !== Number(process.env.SMOKE_WIDTH)) continue;
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
      if (issue === 21) {
        assert.equal(await row.getByRole("button", { name: "Black Mountain Rag", exact: true }).count(), 1);
        assert.equal(await row.getByRole("button", { name: "Use in practice", exact: true }).count(), 1);
        const managed = page.locator(".matitem").filter({ hasText: "First Waltz" });
        const manage = managed.getByRole("button", { name: "Manage First Waltz", exact: true });
        await manage.click();
        await page.getByRole("menuitem", { name: "Save a copy", exact: true }).waitFor();
        await page.keyboard.press("End");
        assert.equal(await page.getByRole("menuitem", { name: "Delete", exact: true }).evaluate(el => el === document.activeElement), true);
        await page.keyboard.press("Escape");
        assert.equal(await manage.evaluate(el => el === document.activeElement), true);
        await manage.click();
        await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
        await managed.getByRole("button", { name: "Keep it", exact: true }).click();
        assert.equal(await managed.getByRole("button", { name: "Yes, delete", exact: true }).count(), 0);
        const rect = await manage.boundingBox(); assert.ok(rect && rect.height >= 44);
      }
      await screenshot(page, `${prefix}-list`);
      await row.locator(".itemopen").click();
      await page.getByRole("heading", { name: "Black Mountain Rag", exact: true }).waitFor();
      const link = page.getByRole("link", { name: "Open lesson on Flatpicking Guitar Magazine (new tab)", exact: true });
      assert.equal(await link.getAttribute("href"), entries[0]!.url);
      assert.equal(await link.getAttribute("target"), "_blank");
      await screenshot(page, `${prefix}-details`);
      if (width === 1003) await zoomCheck(page, `${prefix}-details-zoom-200`);
      if (issue >= 14) await routeChecks(page, base, prefix);
      if (issue >= 22) await findChecks(page, base, prefix);
      // Text zoom equivalent, explicitly distinct from browser chrome zoom.
      await page.evaluate(() => document.documentElement.style.fontSize = "200%");
      await screenshot(page, `${prefix}-text-200`);
      assert.deepEqual(errors, []);
      if (issue >= 14) results.push(`${prefix}: item reload/paste, text/link routes, list search/kind/scroll, back/forward, missing/malformed recovery`);
      results.push(`${prefix}: source identity, short title, legacy fallback, destination/new tab, no overflow/errors, 200% text`);
      console.log(`${prefix}: passed`);
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
  await page.screenshot({ path: join(out, `${name}.png`), fullPage: !name.includes("-zoom-200"), scale: "device" });
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

async function findChecks(page: Page, base: string, prefix: string) {
  let ready = true;
  let web = true;
  let mode: "add" | "empty" | "error" | "partial" | "unknown" | "queue" = "add";
  let calls = 0;
  let release: (() => void) | undefined;
  let gate: Promise<void> = Promise.resolve();
  await page.route("**/api/providers", route => route.fulfill({ json: {
    claude: { ok: ready, detail: "stand-in" }, codex: { ok: false, detail: "stand-in" }, last: "claude",
    list: [{ id: "claude", label: "Stand-in Coach", ok: ready, web, detail: ready ? "ready" : "no provider configured", notes: [], via: "Claude Code", setup: "host", model: null }],
  } }));
  const event = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
  await page.route("**/api/chat", async route => {
    calls++;
    const message = route.request().postDataJSON().message as string;
    await gate;
    if (mode === "error") return void await route.fulfill({ status: 503, json: { error: "stand-in provider unavailable" } });
    if (message === "Earlier turn" || mode === "add" || mode === "partial") {
      const title = message === "Earlier turn" ? `Earlier addition ${prefix}` : `Found ${mode === "partial" ? "partial rag" : "rag"} ${prefix}`;
      const response = await page.request.post(`${base}/api/materials/link`, { headers: { "x-struna": "1" }, data: { url: `https://standin.example/${encodeURIComponent(title)}`, title } });
      assert.ok(response.ok(), "stand-in persisted a material through the scratch API");
    }
    let body = event("delta", { text: "I added three lessons (this claim alone is deliberately untrusted)." });
    body += event("changed", { materials: true });
    if (mode === "partial") body += event("error", { message: "stand-in stopped after adding one" });
    if (mode !== "unknown") body += event("done", { aborted: false });
    await route.fulfill({ contentType: "text/event-stream", body });
  });
  await page.goto(`${base}/#materials`);
  await page.getByRole("button", { name: "Find online", exact: true }).click();
  const form = page.getByRole("form", { name: "Find materials online" });
  const input = form.getByRole("textbox");
  const submit = form.getByRole("button", { name: "Find and add materials", exact: true });
  assert.ok(await submit.isDisabled());
  assert.match(await form.textContent() ?? "", /may add results directly to Materials/);
  await input.fill("A rag for this week");
  gate = new Promise(r => release = r);
  await submit.click();
  await form.getByRole("status").filter({ hasText: "Searching" }).waitFor();
  assert.ok(await submit.isDisabled());
  // A programmatic second form submit must also be refused while this request runs.
  await form.evaluate(f => f.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await screenshot(page, `${prefix}-find-searching`);
  release!();
  gate = Promise.resolve();
  await form.getByRole("status").filter({ hasText: /^Added 1 material:/ }).waitFor();
  assert.equal(calls, 1);
  await page.locator(".matitem").filter({ hasText: `Found rag ${prefix}` }).getByText("Added during this search").waitFor();
  await screenshot(page, `${prefix}-find-added`);

  mode = "empty";
  await input.fill("No matching lesson");
  await submit.click();
  await form.getByRole("status").filter({ hasText: "Search completed with no materials added" }).waitFor();
  await screenshot(page, `${prefix}-find-empty`);

  mode = "error";
  await input.fill("Keep this query");
  await submit.click();
  await form.getByRole("status").filter({ hasText: "Search failed" }).waitFor();
  assert.equal(await input.inputValue(), "Keep this query");
  const beforeRetry = calls;
  await form.getByRole("button", { name: "Retry", exact: true }).click();
  await form.getByRole("status").filter({ hasText: "Search failed" }).waitFor();
  assert.equal(calls, beforeRetry + 1);
  await screenshot(page, `${prefix}-find-error`);

  ready = false;
  const beforeUnavailable = calls;
  await submit.click();
  await form.getByRole("status").filter({ hasText: "Search unavailable" }).waitFor();
  assert.equal(calls, beforeUnavailable);
  assert.equal(await input.inputValue(), "Keep this query");
  await screenshot(page, `${prefix}-find-no-provider`);
  ready = true;
  web = false;
  await submit.click();
  await form.getByRole("status").filter({ hasText: "this coach has no web access" }).waitFor();
  assert.equal(calls, beforeUnavailable);
  web = true;

  // An earlier queued turn adds a material. The find request must not count it as its own result.
  mode = "queue";
  gate = new Promise(r => release = r);
  await page.locator(".top").getByRole("button", { name: /^Coach/ }).click();
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("Earlier turn");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.waitForFunction(() => !!document.querySelector(".thinking"));
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await input.fill("Queued search");
  await submit.click();
  await form.getByRole("status").filter({ hasText: "Searching" }).waitFor();
  const duringEarlier = calls;
  release!();
  gate = Promise.resolve();
  await form.getByRole("status").filter({ hasText: "Search completed with no materials added" }).waitFor();
  assert.equal(calls, duringEarlier + 1);

  mode = "partial";
  await input.fill("Partial result");
  await submit.click();
  await form.getByRole("status").filter({ hasText: "added before it stopped" }).waitFor();
  assert.equal(await input.inputValue(), "Partial result");
  mode = "unknown";
  await input.fill("Interrupted search");
  await submit.click();
  await form.getByRole("status").filter({ hasText: "completion could not be confirmed" }).waitFor();
  assert.ok(await submit.isDisabled());
  const beforeUnknown = calls;
  await form.evaluate(f => f.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  assert.equal(calls, beforeUnknown);
  await screenshot(page, `${prefix}-find-unknown`);

  await page.evaluate(() => document.documentElement.style.fontSize = "200%");
  await screenshot(page, `${prefix}-find-text-200`);
  await page.evaluate(() => document.documentElement.style.fontSize = "");

  if (prefix.startsWith("1003x814")) await zoomCheck(page, `${prefix}-find-zoom-200`);

  // Simulate the instance's web-disabled app-info response; no host config is changed.
  await page.route(`${base}/`, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace(/"web":true/g, '"web":false') });
  });
  await page.reload();
  await page.getByRole("button", { name: "Find online", exact: true }).click();
  await form.getByText(/Online search is turned off/).waitFor();
  assert.ok(await submit.isDisabled());
  await form.getByRole("button", { name: "Add a link yourself" }).click();
  await page.getByRole("region", { name: "Add material" }).waitFor();
  await screenshot(page, `${prefix}-find-web-disabled-recovery`);
  results.push(`${prefix}: find consent, blank disabled, searching/duplicate guard, persisted additions, no additions despite streamed claim, terminal failure/retry, no provider, provider web disabled, queue correlation, partial failure, interrupted stream/no retry, instance web disabled/manual recovery`);
}

/** Browser zoom equivalent: halve the CSS viewport and double raster scale. */
async function zoomCheck(page: Page, name: string) {
  const viewport = page.viewportSize()!;
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Emulation.setDeviceMetricsOverride", { width: Math.floor(viewport.width / 2), height: Math.floor(viewport.height / 2), deviceScaleFactor: 2, mobile: false });
    assert.equal(await page.evaluate(() => innerWidth), Math.floor(viewport.width / 2));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${name}: zoom reflow overflow`);
    // Playwright restores its configured viewport before screenshots; capture through this CDP
    // session so the emulated zoom metrics remain in effect in the retained artifact.
    const shot = await session.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    writeFileSync(join(out, `${name}.png`), Buffer.from(shot.data, "base64"));
  } finally {
    await session.send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false });
    await session.detach();
  }
}
