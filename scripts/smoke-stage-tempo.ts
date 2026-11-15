/** Scratch-only stage metadata regression. pnpm build; node scripts/smoke-stage-tempo.ts */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
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
  materials: [{ label: "Baseline roll", file: "materials/roll.md" }],
  sessions: [{ id: "custom-quick", label: "Quick", stages: [
    { key: "tune", title: "Tuning", minutes: 2, task: "Tune up." },
    { key: "technique", title: "Technique", minutes: 6, task: "Play the roll.", material: { file: "materials/roll.md" }, targetBpm: 80 },
    { key: "log", title: "Logging", minutes: 2, task: "Leave the next instruction." },
  ] }],
};
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
    await page.screenshot({ path: join(dir, "shots", `${width}-${theme}.png`), fullPage: true });
    await context.close();
  }
  console.log(`Stage tempo smoke passed: 9 width/theme cases; artifacts ${dir}`);
} finally {
  await browser.close();
  child.kill("SIGTERM");
  await new Promise<void>((r) => child.exitCode !== null ? r() : child.once("exit", () => r()));
}
