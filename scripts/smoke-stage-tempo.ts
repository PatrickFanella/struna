/** Scratch-only stage metadata regression. pnpm build; node scripts/smoke-stage-tempo.ts */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright-core";
import { nextStage } from "./practice-steps.ts";
import { parseGenericLog } from "../server/generic/logs.ts";
import { normalizeProfile } from "../server/generic/studio.ts";

const dir = await mkdtemp(join(tmpdir(), "struna-stage-tempo-"));
const home = join(dir, "home");
await mkdir(join(home, "plan"), { recursive: true });
await mkdir(join(home, "materials"), { recursive: true });
await mkdir(join(dir, "shots"));
await writeFile(join(home, "profile.json"), JSON.stringify(normalizeProfile({}, new Date().toISOString())));
await writeFile(join(home, "materials/roll.md"), "# Baseline roll\n\n```\ne|------0---|\nB|----0---0-|\nG|--0-------|\n```\n" + "\nReading position fixture.\n".repeat(100));
const plan = {
  version: 1, id: "wave-one", title: "Scratch practice", started: "2026-01-01", goal: "Play comfortably", next: "Tune, then play", extras: [],
  phases: [{ title: "Clean notes", summary: "Listen", sessions: 6, focus: {} }],
  materials: [{ label: "Baseline roll", file: "materials/roll.md" }, { label: "Workspace addition", url: "https://example.invalid/workspace" }],
  sessions: [{ id: "custom-quick", label: "Quick", stages: [
    { key: "tune", title: "Tuning", minutes: 2, task: "Tune up." },
    { key: "technique", title: "Technique", minutes: 6, task: "Play the roll.", material: { file: "materials/roll.md" }, targetBpm: 80 },
    { key: "log", title: "Logging", minutes: 2, task: "Leave the next instruction." },
  ] }],
};
plan.sessions.push({ id: "custom-full", label: "Full", stages: [...plan.sessions[0]!.stages, { key: "song", title: "Tune practice", minutes: 10, task: "Play a tune." }] });
plan.sessions.push({ id: "custom-short", label: "Short", stages: [plan.sessions[0]!.stages[1]!] });
await writeFile(join(home, "materials/tune.md"), "# Black Mountain Rag\n\nSkipped tune fixture.\n");
plan.materials.push({ label: "Black Mountain Rag", file: "materials/tune.md" });
Object.assign(plan.sessions[1]!.stages.at(-1)!, { material: { file: "materials/tune.md" } });
await writeFile(join(home, "plan/plan.json"), JSON.stringify(plan));
const socket = createServer();
await new Promise<void>((r) => socket.listen(0, "127.0.0.1", r));
const port = (socket.address() as { port: number }).port;
await new Promise<void>((r) => socket.close(() => r()));
const base = `http://localhost:${port}`;
const child = spawn(process.execPath, ["server/index.ts"], { cwd: join(import.meta.dirname, ".."), env: {
  ...process.env, NODE_ENV: "production", STRUNA_MODE: "studio", STRUNA_HOME: home, STRUNA_STATE_DIR: join(dir, "state"), STRUNA_CACHE_DIR: join(dir, "cache"),
  STRUNA_LIBRARY_DIRS: "", STRUNA_TABS_DIR: "", SOCKET_PATH: "", EDGE_SECRET_FILE: "", REQUIRE_USER: "", STRUNA_NO_SCAN: "1", STRUNA_COACH_HOST_LOGINS: "0", CLAUDE_BIN: "/bin/false", CODEX_BIN: "/bin/false", HOST: "127.0.0.1", PORT: String(port),
}, stdio: "ignore" });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
try {
  for (let i = 0; ; i++) {
    if (child.exitCode !== null) throw new Error("Scratch server exited");
    if (await fetch(`${base}/api/health`).then((r) => r.ok, () => false)) break;
    if (i > 100) throw new Error("Scratch server did not start");
    await new Promise((r) => setTimeout(r, 100));
  }
  const token = (await readFile(join(dir, "state/access-token"), "utf8")).trim();
  for (const [width, height] of [[320, 700], [390, 844], [1003, 814], [502, 407]]) for (const theme of ["light", "dark", "device"]) {
    const context = width === 502
      ? await chromium.launchPersistentContext(join(dir, `zoom-${theme}`), { executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"], viewport: { width: 1003, height: 814 }, permissions: ["microphone"], colorScheme: theme === "dark" ? "dark" : "light" })
      : await browser.newContext({ viewport: { width: width!, height: height! }, permissions: ["microphone"], colorScheme: theme === "dark" ? "dark" : "light" });
    if (width === 502) {
      const settings = await context.newPage(); await settings.goto("chrome://settings/appearance");
      await settings.evaluate(async () => {
        const { chrome } = globalThis as unknown as { chrome: { settingsPrivate: { setDefaultZoom: (factor: number) => Promise<void> } } };
        await chrome.settingsPrivate.setDefaultZoom(2);
      });
      await settings.close();
    }
    console.log(`Stage review case ${width} ${theme}`);
    const page = await context.newPage();
    page.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
    await page.addInitScript((choice) => { if (choice !== "device") localStorage.setItem("struna.theme", choice); }, theme);
    await page.goto(`${base}/?token=${token}#practice`);
    assert.match(await page.locator("#scope-custom-quick").innerText(), /Tuning · 2 min; Technique · 6 min; Logging · 2 min/);
    assert.doesNotMatch(await page.locator("#scope-custom-quick").innerText(), /Tune practice/);
    await page.locator('input[value="custom-full"]').check();
    assert.match(await page.locator("#scope-custom-full").innerText(), /Tune practice · 10 min/);
    await page.locator('input[value="custom-short"]').check();
    assert.equal(await page.locator("#scope-custom-short").innerText(), "Technique · 6 min");
    await page.locator('input[value="custom-quick"]').check();
    await page.getByRole("link", { name: "Open Baseline roll", exact: true }).first().click();
    await page.getByRole("heading", { name: "Baseline roll", exact: true, level: 1 }).waitFor();
    assert.equal(await page.evaluate(() => sessionStorage.getItem("struna.session")), null);
    await page.getByRole("button", { name: "Back to practice", exact: true }).click();
    await page.getByRole("button", { name: "Start 10 min practice", exact: true }).waitFor();
    await page.evaluate(() => sessionStorage.setItem("struna.material", JSON.stringify({ key: "extra:before", label: "Extra before start", kind: "link", src: null, url: "https://example.invalid/extra" })));
    await page.reload();
    await page.getByRole("button", { name: "Start 10 min practice", exact: true }).click();
    await page.getByRole("button", { name: "Add pane", exact: true }).click();
    await page.getByRole("menuitem", { name: "Pin Coach beside music", exact: true }).click();
    await nextStage(page);
    assert.equal(await page.locator(".clock.waiting").count(), 1, "Next retains the waiting timer");
    await page.locator(".pane-file:not([hidden])").first().waitFor();
    await page.getByText("Suggested 80 BPM", { exact: false }).waitFor();
    assert.match(await page.locator(".stage-tempo").innerText(), /Plan target/);
    await page.getByRole("button", { name: "Tuner", exact: true }).click();
    await page.getByRole("tab", { name: "Metronome", exact: true }).click();
    await page.getByLabel("BPM", { exact: true }).fill("91");
    await page.getByLabel("BPM", { exact: true }).press("Enter");
    assert.equal(await page.getByRole("button", { name: "Start", exact: true }).count(), 1, "entry does not start click");
    await page.getByLabel("BPM", { exact: true }).fill("301");
    await page.getByLabel("BPM", { exact: true }).press("Enter");
    await page.getByRole("status").filter({ hasText: "Enter a whole number" }).waitFor();
    await page.getByLabel("BPM", { exact: true }).press("Escape");
    assert.equal(await page.getByLabel("BPM", { exact: true }).inputValue(), "91");
    await page.getByRole("button", { name: "Use stage tempo", exact: true }).click();
    await page.getByRole("button", { name: "2 BPM faster" }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByText("Your tempo: 82 BPM", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await nextStage(page);
    await page.getByText("Your tempo: 82 BPM", { exact: false }).waitFor();
    await page.reload();
    await page.getByText("Your tempo: 82 BPM", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Use stage tempo", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector(".stage-tempo")?.textContent?.includes("Your tempo"));
    assert.equal(await page.locator(".nextb.primary").count(), 0);
    await page.getByRole("button", { name: "Start the stage timer", exact: true }).focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    const focus = await page.locator(".clock").evaluate((el) => getComputedStyle(el).outlineStyle);
    assert.notEqual(focus, "none", "clock has visible keyboard focus");
    await page.screenshot({ path: join(dir, "shots", `${width}-${theme}-session.png`), fullPage: true });
    if (width! < 720) {
      assert.equal(await page.getByRole("button", { name: /Log clean pass/ }).isVisible(), true, "playing keeps clean-pass controls visible");
      await page.getByRole("button", { name: "Tools", exact: true }).click();
    }
    assert.equal(await page.locator(".measurements").count(), 0, "editing the click records nothing");
    await page.getByRole("button", { name: /Log clean pass/ }).click();
    await page.locator(".measurement-details summary").click();
    await page.getByLabel("Confirmed material tempos").getByText("Baseline roll: 80 BPM", { exact: false }).waitFor();
    const checkpoint = await page.evaluate(() => JSON.parse(sessionStorage.getItem("struna.session")!).checkpoints[0]);
    assert.equal(checkpoint.bpm, 80);
    assert.equal(checkpoint.stageKey, "technique");
    assert.equal(checkpoint.context, "clean-pass");
    await page.getByLabel("Measure material", { exact: true }).selectOption("extra:before");
    assert.equal(await page.getByRole("img", { name: "0 of 3 clean passes", exact: true }).count(), 1);
    await page.getByRole("button", { name: /Log clean pass/ }).click();
    await page.getByLabel("Measure material", { exact: true }).selectOption(checkpoint.materialKey);
    assert.equal(await page.getByRole("img", { name: "1 of 3 clean passes", exact: true }).count(), 1);
    await page.getByRole("button", { name: "Record take", exact: true }).click();
    await page.getByRole("button", { name: /Stop take/ }).waitFor();
    const beforeExpand = await page.evaluate(() => sessionStorage.getItem("struna.session"));
    await page.locator(".panescroll").first().evaluate((el) => { el.dataset.mounted = "kept"; el.scrollTop = 40; });
    await page.getByRole("button", { name: "Expand reader", exact: true }).first().click();
    const reader = page.getByRole("dialog", { name: "Baseline roll", exact: true });
    await reader.waitFor();
    const rect = await reader.boundingBox();
    assert.ok(rect && rect.height > (width === 502 ? 407 : height!) * 0.9 && rect.width > width! * 0.9);
    await page.screenshot({ path: join(dir, "shots", `${width}-${theme}-reader.png`), fullPage: false });
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog", { name: "Baseline roll", exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Expand reader", exact: true }).first().evaluate((el) => el === document.activeElement), true);
    assert.equal(await page.locator(".panescroll").first().getAttribute("data-mounted"), "kept");
    assert.equal(await page.evaluate(() => sessionStorage.getItem("struna.session")), beforeExpand);
    assert.equal(await page.locator(".panescroll").first().evaluate((el) => el.scrollTop), 40);
    await page.getByRole("button", { name: /Stop take/ }).click();
    await page.locator(".takebox").getByRole("button", { name: "Discard", exact: true }).click();
    if (width! < 720) await page.getByRole("button", { name: "Tools", exact: true }).click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByRole("button", { name: "Add pane", exact: true }).click();
    await page.getByRole("menuitem", { name: /Workspace addition/ }).click();
    await page.clock.install();
    await page.getByRole("button", { name: "Start the stage timer", exact: true }).click();
    await page.clock.fastForward(65_000);
    await nextStage(page);
    assert.equal(await page.locator(".clock:not(.waiting)").count(), 1, "Next retains a running timer");
    await page.getByRole("button", { name: "Pause the stage timer", exact: true }).click();
    await page.locator(".session-details summary").click();
    assert.match(await page.locator(".session-time").innerText(), /Active practice 1:05/);
    const checklist = page.getByRole("group", { name: "Session checklist (optional)" });
    assert.equal(await checklist.getByRole("checkbox").count(), 5);
    assert.equal(await checklist.getByRole("checkbox", { name: "Extra before start", exact: true }).count(), 1);
    assert.equal(await checklist.getByRole("checkbox", { name: "Workspace addition", exact: true }).count(), 1);
    assert.doesNotMatch(await checklist.innerText(), /Tune practice/);
    await checklist.getByRole("checkbox", { name: "Technique", exact: true }).check();
    await page.reload();
    await page.locator(".session-details summary").click();
    assert.equal(await page.getByRole("checkbox", { name: "Technique", exact: true }).isChecked(), true);
    const beforeReview = await page.evaluate(() => sessionStorage.getItem("struna.session"));
    await page.getByRole("button", { name: /Finish/ }).press("Enter");
    assert.match(await page.locator(".greview").innerText(), /Technique — attempted/);
    assert.equal(await page.getByLabel("Minutes played", { exact: true }).inputValue(), "1");
    assert.doesNotMatch(await page.locator(".greview").innerText(), /Tune practice/);
    await page.screenshot({ path: join(dir, "shots", `${width}-${theme}.png`), fullPage: true });
    assert.equal(await page.getByLabel("Baseline roll clean BPM (optional)", { exact: true }).inputValue(), "80");
    assert.equal(await page.getByLabel("Black Mountain Rag clean BPM (optional)", { exact: true }).count(), 0, "omitted tune has no review field");
    await page.getByRole("button", { name: "Write the log", exact: true }).click();
    await page.getByRole("heading", { name: "Log written", exact: true }).waitFor();
    if (width === 390 && theme === "light") {
      await page.evaluate((raw) => {
        const s = JSON.parse(raw!);
        delete s.activeBefore; delete s.timingIncomplete; delete s.reviewing;
        s.stage = 1; s.elapsedBefore = 20_000; s.resumedAt = null;
        sessionStorage.setItem("struna.session", JSON.stringify(s));
      }, beforeReview);
      await page.reload();
      await page.locator(".session-details summary").click();
      await page.getByText(/Earlier stage times were not recorded/).waitFor();
      await page.getByRole("button", { name: "Resume the stage timer", exact: true }).click();
      await page.getByRole("button", { name: "Pause the stage timer", exact: true }).click();
      await page.reload();
      await page.locator(".session-details summary").click();
      await page.getByText(/Earlier stage times were not recorded/).waitFor();
      await nextStage(page);
      await page.getByRole("button", { name: /Finish/ }).press("Enter");
      await page.getByRole("status").filter({ hasText: "Minutes played includes only recovered timing" }).waitFor();
    }
    await page.evaluate((raw) => {
      sessionStorage.removeItem("struna.review-draft"); // This injects an independent timing fixture.
      const saved = JSON.parse(raw!); delete saved.reviewing;
      saved.stage = 0; saved.resumedAt = null; saved.elapsedBefore = 0; saved.activeBefore = 65000;
      sessionStorage.setItem("struna.session", JSON.stringify(saved));
    }, beforeReview);
    await page.reload();
    const beforeExit = await page.evaluate(() => JSON.parse(sessionStorage.getItem("struna.session")!));
    await page.getByRole("button", { name: "End session", exact: true }).click();
    await page.getByRole("dialog", { name: "End session?", exact: true }).waitFor();
    await page.getByRole("button", { name: "Resume session", exact: true }).click();
    const afterResume = await page.evaluate(() => JSON.parse(sessionStorage.getItem("struna.session")!));
    assert.deepEqual(afterResume.checkpoints, beforeExit.checkpoints);
    assert.deepEqual(afterResume.panes, beforeExit.panes);
    assert.equal(afterResume.activeBefore, beforeExit.activeBefore);
    await page.getByRole("button", { name: "End session", exact: true }).click();
    await page.getByRole("button", { name: "Discard session", exact: true }).click();
    await page.getByRole("dialog", { name: "Discard this unsaved session?", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Review partial session", exact: true }).click();
    assert.equal(await page.getByLabel("Minutes played", { exact: true }).inputValue(), "1");
    await page.reload();
    await page.getByRole("heading", { name: "Partial session review", exact: true }).waitFor();
    await page.screenshot({ path: join(dir, "shots", `${width}-${theme}-partial.png`), fullPage: true });
    await page.getByRole("button", { name: "Write the log", exact: true }).click();
    await page.getByRole("heading", { name: "Log written", exact: true }).waitFor();
    // A full session includes the tune, but skipping its work cannot inherit the roll's BPM.
    await page.getByRole("button", { name: "Back to today", exact: true }).click();
    await page.locator('input[value="custom-full"]').check();
    await page.getByRole("button", { name: "Start 20 min practice", exact: true }).click();
    await nextStage(page);
    if (width! < 720) await page.getByRole("button", { name: "Tools", exact: true }).click();
    await page.getByRole("button", { name: /Log clean pass/ }).click();
    await page.getByRole("button", { name: "End session", exact: true }).click();
    await page.getByRole("button", { name: "Review partial session", exact: true }).click();
    const roll = page.getByLabel("Baseline roll clean BPM (optional)", { exact: true });
    const tune = page.getByLabel("Black Mountain Rag clean BPM (optional)", { exact: true });
    assert.equal(await roll.inputValue(), "80");
    assert.match(await page.locator(".greview").innerText(), /Technique — attempted/);
    assert.equal(await tune.inputValue(), "");
    assert.equal(await page.getByLabel("What went well", { exact: true }).isVisible(), false);
    await page.getByText("Optional notes", { exact: true }).click();
    await page.getByLabel("What went well", { exact: true }).fill("Separate review draft retained");
    const bpm = width === 320 && theme === "light" ? "400" : "88";
    await roll.fill(bpm);
    await page.getByRole("button", { name: "Back to the session", exact: true }).click();
    await page.getByRole("button", { name: "End session", exact: true }).click();
    await page.getByRole("button", { name: "Review partial session", exact: true }).click();
    assert.equal(await roll.inputValue(), bpm);
    await page.getByRole("link", { name: "Materials", exact: true }).click();
    await page.getByRole("link", { name: "Today", exact: true }).click();
    assert.equal(await roll.inputValue(), bpm);
    await page.reload();
    assert.equal(await roll.inputValue(), bpm);
    assert.equal(await tune.inputValue(), "");
    await page.getByText("Optional notes", { exact: true }).click();
    assert.equal(await page.getByLabel("What went well", { exact: true }).inputValue(), "Separate review draft retained");
    await page.getByText("Optional notes", { exact: true }).click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (width === 502) assert.ok(await page.evaluate(() => innerWidth === 501 && devicePixelRatio === 2));
    await page.screenshot({ path: join(dir, "shots", `${width}-${theme}-material-review.png`), fullPage: true });
    await roll.fill("401");
    await page.getByRole("button", { name: "Write the log", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "enter a whole BPM from 20 to 400" }).waitFor();
    await roll.fill(bpm);
    const countBefore = (await readdir(join(home, "logs"))).length;
    await page.route("**/api/sessions", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Scratch save failure" }) }));
    await page.getByRole("button", { name: "Write the log", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "The save was not confirmed" }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "Log written", exact: true }).count(), 0);
    assert.equal((await readdir(join(home, "logs"))).length, countBefore);
    await page.reload();
    assert.equal(await roll.inputValue(), bpm);
    assert.equal(await tune.inputValue(), "");
    await page.unroute("**/api/sessions");
    await page.route("**/api/sessions", async (route) => {
      const saved = await route.fetch();
      assert.equal(saved.status(), 200);
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Scratch lost success response" }) });
    });
    await page.getByRole("button", { name: "Write the log", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "The save was not confirmed" }).waitFor();
    assert.equal((await readdir(join(home, "logs"))).filter((n) => n.endsWith(".md")).length, countBefore + 1);
    await page.unroute("**/api/sessions");
    const savedResponse = page.waitForResponse((r) => r.url().endsWith("/api/sessions") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Write the log", exact: true }).click();
    const { file } = await (await savedResponse).json();
    assert.equal((await readdir(join(home, "logs"))).filter((n) => n.endsWith(".md")).length, countBefore + 1, "lost-response retry creates exactly one log");
    await page.getByRole("heading", { name: "Log written", exact: true }).waitFor();
    await page.getByRole("status").filter({ hasText: "The original log was kept" }).waitFor();
    const headers = { "x-struna-token": token };
    const logs = await fetch(`${base}/api/logs?limit=200`, { headers }).then((r) => r.json()) as any[];
    const expected = [{ materialKey: "materials/roll.md", materialLabel: "Baseline roll", bpm: Number(bpm) }, { materialKey: "materials/tune.md", materialLabel: "Black Mountain Rag", bpm: null }];
    assert.deepEqual(logs.find((l) => l.file === file)?.measurements, expected);
    const saved = parseGenericLog(file, await readFile(join(home, "logs", file), "utf8"));
    assert.deepEqual(saved.measurements, expected);
    const tempos = await fetch(`${base}/api/tempos`, { headers }).then((r) => r.json()) as any[];
    assert.equal(tempos.find((t) => t.fragment === "material:materials/roll.md")?.bpm, bpm === "400" ? 80 : Number(bpm));
    assert.equal(tempos.some((t) => t.fragment === "material:materials/tune.md"), false);
    assert.equal(saved.wentWell, "Separate review draft retained");
    await page.getByRole("button", { name: "Back to today", exact: true }).click();
    await page.getByText(`Baseline roll: ${bpm} BPM`, { exact: false }).first().waitFor();
    // Exercise the actual Short path too: no checkpoint, no inherited clean BPM.
    await page.locator('input[value="custom-short"]').check();
    await page.getByRole("button", { name: "Start 6 min practice", exact: true }).click();
    await page.getByRole("heading", { name: /Technique$/, level: 1 }).waitFor();
    await page.getByRole("button", { name: /Finish/ }).click();
    assert.equal(await roll.inputValue(), "");
    assert.equal(await tune.count(), 0);
    const shortResponse = page.waitForResponse((r) => r.url().endsWith("/api/sessions") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Write the log", exact: true }).click();
    const shortFile = (await (await shortResponse).json()).file;
    await page.getByRole("heading", { name: "Log written", exact: true }).waitFor();
    const shortLog = parseGenericLog(shortFile, await readFile(join(home, "logs", shortFile), "utf8"));
    assert.equal(shortLog.partial, false);
    assert.deepEqual(shortLog.measurements, [{ materialKey: "materials/roll.md", materialLabel: "Baseline roll", bpm: null }]);
    await page.getByRole("button", { name: "Back to today", exact: true }).click();
    const beforeDiscard = (await readdir(join(home, "logs"))).sort();
    await page.getByRole("button", { name: "Start 10 min practice", exact: true }).click();
    await page.getByRole("button", { name: "End session", exact: true }).click();
    await page.getByRole("button", { name: "Discard session", exact: true }).click();
    await page.getByRole("dialog", { name: "Discard this unsaved session?", exact: true }).getByRole("button", { name: "Yes, discard session", exact: true }).click();
    await page.getByRole("button", { name: "Start 10 min practice", exact: true }).waitFor();
    assert.deepEqual((await readdir(join(home, "logs"))).sort(), beforeDiscard);
    assert.deepEqual(await page.evaluate(() => [sessionStorage.getItem("struna.session"), sessionStorage.getItem("struna.review-draft")]), [null, null]);
    await context.close();
  }
  for (const name of await readdir(join(home, "logs"))) {
    const log = await readFile(join(home, "logs", name), "utf8");
    if (log.includes("Separate review draft retained")) continue;
    if (/\*\*Session:\*\* custom-short/.test(log)) {
      assert.doesNotMatch(log, /Tune practice|Extra before start|Workspace addition/);
      continue;
    }
    assert.match(log, /Technique: attempted/);
    assert.match(log, /Extra before start: attempted/);
    assert.match(log, /Workspace addition: unmeasured/);
    assert.doesNotMatch(log, /Tune practice/);
  }
  console.log(`Stage tempo and Full/Short/Quick material review smoke passed: 12 width/theme/native-zoom cases; artifacts ${dir}`);
} finally {
  await browser.close();
  child.kill("SIGTERM");
  await new Promise<void>((r) => child.exitCode !== null ? r() : child.once("exit", () => r()));
}
