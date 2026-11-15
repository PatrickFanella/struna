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
await writeFile(join(home, "materials/roll.md"), "# Baseline roll\n\n```\ne|------0---|\nB|----0---0-|\nG|--0-------|\n```\n");
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
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox"] });
try {
  for (let i = 0; ; i++) {
    if (child.exitCode !== null) throw new Error("Scratch server exited");
    if (await fetch(`${base}/api/health`).then((r) => r.ok, () => false)) break;
    if (i > 100) throw new Error("Scratch server did not start");
    await new Promise((r) => setTimeout(r, 100));
  }
  const token = (await readFile(join(dir, "state/access-token"), "utf8")).trim();
  for (const [width, height] of [[320, 700], [390, 844], [1003, 814]]) for (const theme of ["light", "dark", "device"]) {
    const context = await browser.newContext({ viewport: { width: width!, height: height! }, colorScheme: theme === "dark" ? "dark" : "light" });
    const page = await context.newPage();
    await page.addInitScript((choice) => { if (choice !== "device") localStorage.setItem("struna.theme", choice); }, theme);
    await page.goto(`${base}/?token=${token}#practice`);
    assert.match(await page.locator("#scope-custom-quick").innerText(), /Tuning · 2 min; Technique · 6 min; Logging · 2 min/);
    assert.doesNotMatch(await page.locator("#scope-custom-quick").innerText(), /Tune practice/);
    assert.match(await page.locator("#scope-custom-full").innerText(), /Tune practice · 10 min/);
    assert.equal(await page.locator("#scope-custom-short").innerText(), "Technique · 6 min");
    await page.evaluate(() => sessionStorage.setItem("struna.material", JSON.stringify({ key: "extra:before", label: "Extra before start", kind: "link", src: null, url: "https://example.invalid/extra" })));
    await page.reload();
    await page.getByRole("button", { name: /^Quick/ }).click();
    await page.getByRole("button", { name: "Add pane", exact: true }).click();
    await page.getByRole("menuitem", { name: "Coach", exact: true }).click();
    await page.getByRole("button", { name: /Next stage/ }).click();
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
    await page.getByRole("button", { name: "Add pane", exact: true }).click();
    await page.getByRole("menuitem", { name: /Workspace addition/ }).click();
    await page.getByRole("button", { name: /Next stage/ }).click();
    const checklist = page.getByRole("group", { name: "Session checklist (optional)" });
    assert.equal(await checklist.getByRole("checkbox").count(), 5);
    assert.equal(await checklist.getByRole("checkbox", { name: "Extra before start", exact: true }).count(), 1);
    assert.equal(await checklist.getByRole("checkbox", { name: "Workspace addition", exact: true }).count(), 1);
    assert.doesNotMatch(await checklist.innerText(), /Tune practice/);
    await checklist.getByRole("checkbox", { name: "Technique", exact: true }).check();
    await page.reload();
    assert.equal(await page.getByRole("checkbox", { name: "Technique", exact: true }).isChecked(), true);
    await page.getByRole("button", { name: /Finish/ }).click();
    assert.match(await page.locator(".greview").innerText(), /Technique — attempted/);
    assert.doesNotMatch(await page.locator(".greview").innerText(), /Tune practice/);
    await page.screenshot({ path: join(dir, "shots", `${width}-${theme}.png`), fullPage: true });
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
