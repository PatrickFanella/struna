/** Issue #27: scratch-only Coach labels/actions with stand-in CLI; no real provider.
 * node scripts/smoke-coach-clarity.ts [artifact-directory] (directory must not exist)
 */
import assert from "node:assert/strict";
import { nextStage } from "./practice-steps.ts";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

import { normalizeProfile } from "../server/generic/studio.ts";
import { starterPlan } from "../server/generic/starter.ts";
import { writeFakeBin } from "./fake-coach-cli.ts";

const dir = resolve(process.argv[2] ?? join(tmpdir(), `struna-coach-${Date.now()}`));
assert.ok(!existsSync(dir), "use a fresh artifact directory; existing scratch data is never removed");
mkdirSync(join(dir, "home/plan"), { recursive: true });
mkdirSync(join(dir, "home/materials"), { recursive: true });
const profile = normalizeProfile({ level: "beginner" }, "2026-11-14");
writeFileSync(join(dir, "home/profile.json"), JSON.stringify(profile));
writeFileSync(join(dir, "home/materials/reader.md"), "# Six-string reader fixture\n\nE|--0--0--0--0--|\nB|--1--1--1--1--|\nG|--0--0--0--0--|\nD|--2--2--2--2--|\nA|--3--3--3--3--|\nE|-------------|\n\n".repeat(80));
const plan = starterPlan(profile, "2026-11-14");
plan.materials = [{ label: "Six-string reader fixture", file: "materials/reader.md" }];
plan.sessions[1]!.stages[0]!.material = { file: "materials/reader.md" };
writeFileSync(join(dir, "home/plan/plan.json"), JSON.stringify(plan));
const bin = writeFakeBin(join(dir, "fake"), "bin/codex");
writeFileSync(join(dir, "fake/slow"), "600");
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
  const sizes = process.env.COACH_PIN_ONLY === "1" ? [[1440, 900]] as const : [[320, 700], [390, 844], [1003, 814], [1440, 900], [502, 407]] as const;
  for (const [width, height] of sizes) for (const theme of (process.env.COACH_PIN_ONLY === "1" ? ["light"] : ["light", "dark", "device-light", "device-dark"]) as ("light" | "dark" | "device-light" | "device-dark")[]) {
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
    let sends = 0;
    page.on("request", (r) => { if (r.method() === "POST" && new URL(r.url()).pathname === "/api/chat") sends++; });
    await page.goto(`${base}/?token=${token}`);
    await page.waitForURL(`${base}/`);
    if (width === 502) assert.ok(await page.evaluate(() => innerWidth === 501 && devicePixelRatio === 2), "native desktop 200% zoom");
    await page.evaluate((theme) => {
      if (theme.startsWith("device")) document.documentElement.removeAttribute("data-theme");
      else document.documentElement.dataset.theme = theme;
    }, theme);
    const shot = async (name: string) => {
      await page.screenshot({ path: join(dir, `${label}-${name}.png`), fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label}/${name}: no page overflow`);
      const outside = await page.locator(".chatwrap.open .coachidentity, .chatwrap.open .chathd, .chatwrap.open .composer").evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().right > innerWidth + 1).length);
      assert.equal(outside, 0, `${label}/${name}: provider and composer fit`);
    };
    // The app action remains labeled and reachable even with the extra Metronome entry.
    await page.locator(".top").getByRole("button", { name: "Coach", exact: true }).click();
    const coach = page.getByRole("dialog", { name: "Coach", exact: true });
    await coach.locator(".coachidentity").getByText("Ready", { exact: true }).waitFor();
    assert.equal(await coach.locator(".coachpick option:checked").textContent(), "Claude plan");
    assert.match(await coach.locator(".coachidentity").innerText(), /Host login on/);
    const identity = coach.locator(".coachidentity");
    assert.ok(await identity.evaluate((el) => el.scrollWidth <= el.clientWidth));
    await shot("provider");
    await coach.locator(".coachpick").selectOption("codex");
    assert.equal(await coach.locator(".coachpick option:checked").textContent(), "ChatGPT host");
    await coach.locator(".coachpick").selectOption("claude");
    const initialBytes = readFileSync(join(dir, "home/plan/plan.json"), "utf8");
    const easier = coach.locator(".promptchips button").filter({ hasText: "Make today easier" });
    assert.match(await easier.innerText(), /Draft · Plan change/);
    await easier.click();
    const composer = coach.getByRole("textbox", { name: "Message", exact: true });
    await page.waitForFunction(() => document.querySelector<HTMLTextAreaElement>(".chat .composer textarea")?.value.includes("Today's session is too much"));
    assert.match(await composer.inputValue(), /Today's session is too much/);
    assert.equal(sends, 0, "Draft never submits");
    assert.equal(readFileSync(join(dir, "home/plan/plan.json"), "utf8"), initialBytes);
    await shot("draft-plan");
    await composer.fill("");
    await coach.getByRole("button", { name: "More", exact: true }).click();
    const sheet = coach.locator(".promptsheet");
    await sheet.waitFor();
    for (const text of ["Draft · Plan change", "Send · Session length", "Send · Advice", "Draft · Materials"]) assert.ok((await sheet.innerText()).includes(text), text);
    await shot("prompt-list");
    await sheet.locator("button").filter({ hasText: "Teach me a chord, scale" }).click();
    await page.waitForFunction(() => (document.querySelector<HTMLTextAreaElement>(".chat .composer textarea")?.value.length ?? 0) > 10);
    assert.ok((await composer.inputValue()).length > 10);
    assert.equal(sends, 0, "incomplete Draft does not submit");
    await composer.fill("");
    await coach.getByRole("button", { name: "More", exact: true }).click();
    await sheet.locator("button").filter({ hasText: "How should I practise?" }).click();
    await coach.locator(".thinking").waitFor();
    // Rapid repeated DOM activation cannot enqueue another prompt while busy.
    await coach.locator(".promptchips button").first().evaluate((el) => { (el as HTMLButtonElement).click(); (el as HTMLButtonElement).click(); });
    await shot("sending");
    await page.waitForFunction(() => !document.querySelector(".thinking"));
    assert.equal(sends, 1, "Send chip submits once");
    assert.equal(await coach.locator(".msg.user").count(), 1);
    // Typed Send also ignores a duplicate form submission during the request.
    await composer.fill("Explain a quiet warm-up.");
    await coach.locator("form.composer").evaluate((el) => { el.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); el.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await page.waitForFunction(() => !document.querySelector(".thinking"));
    assert.equal(sends, 2, "typed Send submits once");
    writeFileSync(join(dir, "fake/fail"), "429");
    await composer.fill("Show a recoverable error.");
    await coach.getByRole("button", { name: "Send", exact: true }).click();
    await coach.locator(".msg.error").last().waitFor();
    await page.waitForFunction(() => !document.querySelector(".thinking"));
    assert.equal(sends, 3);
    await shot("error");
    writeFileSync(join(dir, "fake/fail"), "");
    await coach.getByRole("button", { name: "Coach settings", exact: true }).click();
    await coach.locator(".chatsettings .provrow").first().waitFor();
    assert.match(await coach.locator(".chatsettings").innerText(), /Only Apply changes the active plan.*materials, notes and profile edits still take effect directly/s);
    await shot("settings");
    await coach.getByRole("button", { name: "Done", exact: true }).click();
    // The start-screen settings own the automatic-action explanation.
    await page.locator(".gstart").getByRole("button", { name: "Coach settings", exact: true }).click();
    await page.locator(".actionlist").waitFor();
    assert.match(await page.locator(".coachsettings").innerText(), /Auto sends the request immediately.*Ask first waits.*only Apply changes Today/s);
    await shot("automatic-actions");
    await page.locator(".gstart").getByRole("button", { name: "Coach settings", exact: true }).click();
    if (await page.getByRole("radio", { name: /Short session/ }).count()) {
      await page.getByRole("radio", { name: /Short session/ }).click();
      await page.getByRole("button", { name: /^Start \d+ min$/ }).click();
    } else await page.getByRole("button", { name: /^Short session/ }).click();
    await page.locator(".workspace").waitFor();
    assert.equal(await page.locator(".pane-coach").count(), 0, "a fresh practice session does not open Coach automatically");
    await shot("practice-default");
    if (width === 1440 && theme === "light") {
      const reader = page.locator(".pane .panescroll").first();
      await reader.evaluate((e) => { e.scrollTop = 80; e.dataset.coachPinMark = "kept"; });
      await page.locator(".top").getByRole("button", { name: "Coach", exact: true }).click();
      await coach.getByRole("button", { name: "Pin beside music", exact: true }).click();
      await coach.waitFor({ state: "hidden" });
      assert.equal(await page.locator(".pane-coach").count(), 1, "direct desktop pin keeps one Coach beside music");
      assert.equal(await reader.getAttribute("data-coach-pin-mark"), "kept", "direct pin keeps the music reader mounted");
      assert.equal(await reader.evaluate((e) => e.scrollTop), 80, "direct pin keeps the music reading position");
      await shot("practice-pinned");
      await page.locator(".top").getByRole("button", { name: "Coach", exact: true }).click();
      assert.equal(await page.getByRole("dialog", { name: "Coach", exact: true }).count(), 0, "header Coach focuses embedded owner after direct pin");
      const embedded = page.locator(".pane-coach");
      assert.equal(await embedded.getByRole("textbox", { name:"Message", exact:true }).evaluate(e=>e===document.activeElement),true);
      let continuityRequests=0;
      page.on("request",r=>{if(r.method()==="POST" && new URL(r.url()).pathname==="/api/chat") continuityRequests++;});
      writeFileSync(join(dir,"fake/slow"),"1600");
      await embedded.getByRole("textbox", {name:"Message",exact:true}).fill("Pin continuity stand-in request");
      await embedded.getByRole("button", {name:"Send",exact:true}).click();
      await embedded.getByRole("button", {name:"Stop",exact:true}).waitFor();
      await embedded.getByRole("button", {name:"Unpin Coach",exact:true}).click();
      await page.locator(".top").getByRole("button", {name:"Coach",exact:true}).click();
      await coach.getByRole("button", {name:"Stop",exact:true}).waitFor();
      await coach.getByRole("button", {name:"Stop",exact:true}).waitFor({state:"detached"});
      assert.equal(continuityRequests,1,"unpin/reopen retains one running request");
      assert.equal(await reader.getAttribute("data-coach-pin-mark"),"kept");
      await coach.getByRole("textbox", {name:"Message",exact:true}).fill("Draft retained through a stage change");
      await coach.getByRole("button", {name:"Done",exact:true}).click();
      await nextStage(page);
      await page.locator(".top").getByRole("button", {name:"Coach",exact:true}).click();
      assert.equal(await coach.getByRole("textbox", {name:"Message",exact:true}).inputValue(),"Draft retained through a stage change");
      await coach.getByRole("button", {name:"Done",exact:true}).click();
      writeFileSync(join(dir,"fake/slow"),"600");
    }
    await page.getByRole("button", { name: /^(Add|Open) pane$/ }).click();
    await page.getByRole("menuitem", { name: "Pin Coach beside music", exact: true }).click();
    const pinned = page.locator(".pane-coach");
    await pinned.waitFor();
    assert.equal(await pinned.count(), 1, "pinning Coach keeps one embedded conversation owner");
    assert.equal(await pinned.locator(".promptchips button:not(.morechip)").count(), 2, "pinned Coach leads with two shortcuts");
    if (width >= 1180) {
      await page.reload();
      await page.locator(".workspace .pane-coach").waitFor();
      assert.equal(await page.locator(".workspace .pane-coach").count(), 1, "a restored legacy Coach pane stays pinned beside music");
    }
    const paneComposer = pinned.getByRole("textbox", { name: "Message", exact: true });
    await paneComposer.fill("Keep this unsent draft");
    await pinned.getByRole("button", { name: "Unpin Coach", exact: true }).click();
    await pinned.waitFor({ state: "detached" });
    const headerCoach = page.locator(".top").getByRole("button", { name: "Coach", exact: true });
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLButtonElement>(".top button")].some((e) => e.textContent?.trim() === "Coach" && e === document.activeElement));
    assert.equal(await headerCoach.evaluate((e) => e === document.activeElement), true, "Unpin returns focus to the on-demand Coach entry");
    await headerCoach.click();
    await coach.waitFor();
    await shot("practice-coach-open");
    assert.equal(await coach.getByRole("textbox", { name: "Message", exact: true }).inputValue(), "Keep this unsent draft", "unsent draft survives unpin and reopening Coach");
    await coach.getByRole("button", { name: "Done", exact: true }).click();
    assert.deepEqual(errors, []);
    const result = `${label}: provider identity, plan/input Draft, advice/length labels, single Send, busy/error, Coach demand/pin and plan-approval and direct non-plan write disclosures passed`;
    results.push(result);
    console.log(result);
    await context.close();
  }
  console.log(`Artifacts: ${dir}`);
} finally {
  writeFileSync(join(dir, "checks.txt"), results.join("\n") + "\n");
  writeFileSync(join(dir, "server-stderr.log"), stderr);
  await browser.close();
  if (server.exitCode === null) { server.kill(); await new Promise((r) => server.once("exit", r)); }
}
