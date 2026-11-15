/** Scratch-only stage metadata regression. pnpm build; node scripts/smoke-stage-tempo.ts */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright-core";
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
await writeFile(join(home, "plan/plan.json"), JSON.stringify(plan));
const socket = createServer();
await new Promise<void>((r) => socket.listen(0, "127.0.0.1", r));
const port = (socket.address() as { port: number }).port;
await new Promise<void>((r) => socket.close(() => r()));
const base = `http://localhost:${port}`;
const child = spawn(process.execPath, ["server/index.ts"], { cwd: join(import.meta.dirname, ".."), env: {
  ...process.env, NODE_ENV: "production", STRUNA_MODE: "studio", STRUNA_HOME: home, STRUNA_STATE_DIR: join(dir, "state"), STRUNA_CACHE_DIR: join(dir, "cache"),
  STRUNA_NO_SCAN: "1", STRUNA_COACH_HOST_LOGINS: "0", CLAUDE_BIN: "/bin/false", CODEX_BIN: "/bin/false", HOST: "127.0.0.1", PORT: String(port),
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
  for (const [width, height] of [[320, 700], [390, 844], [1003, 814]]) for (const theme of ["light", "dark", "device"]) {
    const context = await browser.newContext({ viewport: { width: width!, height: height! }, permissions: ["microphone"], colorScheme: theme === "dark" ? "dark" : "light" });
    const page = await context.newPage();
    await page.addInitScript((choice) => { if (choice !== "device") localStorage.setItem("struna.theme", choice); }, theme);
    await page.goto(`${base}/?token=${token}#practice`);
    assert.match(await page.locator("#scope-custom-quick").innerText(), /Tuning · 2 min; Technique · 6 min; Logging · 2 min/);
    assert.doesNotMatch(await page.locator("#scope-custom-quick").innerText(), /Tune practice/);
    assert.match(await page.locator("#scope-custom-full").innerText(), /Tune practice · 10 min/);
    assert.equal(await page.locator("#scope-custom-short").innerText(), "Technique · 6 min");
    await page.getByRole("link", { name: "Open Baseline roll", exact: true }).first().click();
    await page.getByRole("heading", { name: "Baseline roll", exact: true, level: 1 }).waitFor();
    assert.equal(await page.evaluate(() => sessionStorage.getItem("struna.session")), null);
    await page.getByRole("button", { name: "Back to practice", exact: true }).click();
    await page.getByRole("button", { name: /^Quick/ }).waitFor();
    await page.evaluate(() => sessionStorage.setItem("struna.material", JSON.stringify({ key: "extra:before", label: "Extra before start", kind: "link", src: null, url: "https://example.invalid/extra" })));
    await page.reload();
    await page.getByRole("button", { name: /^Quick/ }).click();
    await page.getByRole("button", { name: "Add pane", exact: true }).click();
    await page.getByRole("menuitem", { name: "Coach", exact: true }).click();
    await page.getByRole("button", { name: /Next stage/ }).click();
    assert.equal(await page.locator(".clock.waiting").count(), 1, "Next retains the waiting timer");
    await page.locator(".pane-file:not([hidden])").first().waitFor();
    await page.getByText("Suggested 80 BPM", { exact: false }).waitFor();
    assert.match(await page.locator(".stage-tempo").innerText(), /Plan target/);
    await page.getByRole("button", { name: "Tuner", exact: true }).click();
    await page.getByRole("tab", { name: "Metronome", exact: true }).click();
    await page.getByRole("button", { name: "2 BPM faster" }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByText("Your tempo: 82 BPM", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.getByRole("button", { name: /Next stage/ }).click();
    await page.getByText("Your tempo: 82 BPM", { exact: false }).waitFor();
    await page.reload();
    await page.getByText("Your tempo: 82 BPM", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Use suggestion", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector(".stage-tempo")?.textContent?.includes("Your tempo"));
    assert.equal(await page.locator(".nextb.primary").count(), 0);
    await page.getByRole("button", { name: "Start the stage timer", exact: true }).focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    const focus = await page.locator(".clock").evaluate((el) => getComputedStyle(el).outlineStyle);
    assert.notEqual(focus, "none", "clock has visible keyboard focus");
    await page.screenshot({ path: join(dir, "shots", `${width}-${theme}-session.png`), fullPage: true });
    if (width! < 720) {
      assert.equal(await page.getByRole("button", { name: /Log clean pass/ }).count(), 0);
      await page.getByRole("button", { name: "Tools", exact: true }).click();
    }
    assert.equal(await page.locator(".measurements").count(), 0, "editing the click records nothing");
    await page.getByRole("button", { name: /Log clean pass/ }).click();
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
    assert.ok(rect && rect.height > height! * 0.9 && rect.width > width! * 0.9);
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
    await page.getByRole("button", { name: /Next stage/ }).click();
    assert.equal(await page.locator(".clock:not(.waiting)").count(), 1, "Next retains a running timer");
    await page.getByRole("button", { name: "Pause the stage timer", exact: true }).click();
    assert.match(await page.locator(".session-time").innerText(), /Active practice 1:05/);
    const checklist = page.getByRole("group", { name: "Session checklist (optional)" });
    assert.equal(await checklist.getByRole("checkbox").count(), 5);
    assert.equal(await checklist.getByRole("checkbox", { name: "Extra before start", exact: true }).count(), 1);
    assert.equal(await checklist.getByRole("checkbox", { name: "Workspace addition", exact: true }).count(), 1);
    assert.doesNotMatch(await checklist.innerText(), /Tune practice/);
    await checklist.getByRole("checkbox", { name: "Technique", exact: true }).check();
    await page.reload();
    assert.equal(await page.getByRole("checkbox", { name: "Technique", exact: true }).isChecked(), true);
    const beforeReview = await page.evaluate(() => sessionStorage.getItem("struna.session"));
    await page.getByRole("button", { name: /Finish/ }).press("Enter");
    assert.match(await page.locator(".greview").innerText(), /Technique — attempted/);
    assert.equal(await page.getByLabel("Minutes played", { exact: true }).inputValue(), "1");
    assert.doesNotMatch(await page.locator(".greview").innerText(), /Tune practice/);
    await page.screenshot({ path: join(dir, "shots", `${width}-${theme}.png`), fullPage: true });
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
      await page.getByText(/Earlier stage times were not recorded/).waitFor();
      await page.getByRole("button", { name: "Resume the stage timer", exact: true }).click();
      await page.getByRole("button", { name: "Pause the stage timer", exact: true }).click();
      await page.reload();
      await page.getByText(/Earlier stage times were not recorded/).waitFor();
      await page.getByRole("button", { name: /Next stage/ }).click();
      await page.getByRole("button", { name: /Finish/ }).press("Enter");
      await page.getByRole("status").filter({ hasText: "Minutes played includes only recovered timing" }).waitFor();
    }
    await page.evaluate((raw) => {
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
    await context.close();
  }
  for (const name of await readdir(join(home, "logs"))) {
    const log = await readFile(join(home, "logs", name), "utf8");
    assert.match(log, /Technique: attempted/);
    assert.match(log, /Extra before start: unmeasured/);
    assert.match(log, /Workspace addition: unmeasured/);
    assert.doesNotMatch(log, /Tune practice/);
  }
  console.log(`Stage tempo smoke passed: 9 width/theme cases; artifacts ${dir}`);
} finally {
  await browser.close();
  child.kill("SIGTERM");
  await new Promise<void>((r) => child.exitCode !== null ? r() : child.once("exit", () => r()));
}
