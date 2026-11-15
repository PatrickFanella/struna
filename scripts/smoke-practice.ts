/**
 * End-to-end smoke test of a short session in a real browser, against a scratch
 * copy of the fixture vault and a scratch media folder:
 * start, step through the stages, record a take from a fake microphone, write the log.
 *
 *   node scripts/smoke-practice.ts <scratch-dir> [tone.wav]
 *
 * Needs `pnpm build` and Chromium. Prints the log file and the recording path. SMOKE_PORT picks the port (default 5188).
 */
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import { chromium } from "playwright-core";

const root = join(import.meta.dirname, "..");
const dir = resolve(process.argv[2] ?? "smoke");
const tone = process.argv[3];
rmSync(dir, { recursive: true, force: true });
mkdirSync(join(dir, "media"), { recursive: true });
cpSync(join(root, "server/fixtures/vault"), join(dir, "vault"), { recursive: true });
const port = Number(process.env.SMOKE_PORT ?? 5188);
const srv = spawn("node", ["server/index.ts"], {
  cwd: root,
  env: { ...process.env, STRUNA_MODE: "personal", HOST: "127.0.0.1", SOCKET_PATH: "", EDGE_SECRET_FILE: "", REQUIRE_USER: "", STRUNA_THREAD: "001 Projects/Threads/Guitar", CLAUDE_BIN: "/bin/false", CODEX_BIN: "/bin/false", STRUNA_CACHE_DIR: join(dir, "cache"), NODE_ENV: "production", PORT: String(port), STRUNA_VAULT_ROOT: join(dir, "vault"), STRUNA_MEDIA_ROOT: join(dir, "media"), STRUNA_STATE_DIR: join(dir, "state"), STRUNA_NO_SCAN: "1" },
  stdio: ["ignore", "ignore", "inherit"],
});
for (let i = 0; i < 50 && !(await fetch(`http://localhost:${port}/api/health`).then((r) => r.ok, () => false)); i++) await new Promise((r) => setTimeout(r, 200));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium",
  args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", ...(tone ? [`--use-file-for-fake-audio-capture=${tone}`] : [])],
});
try {
  const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, permissions: ["microphone"] });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error("page error:", e.message));
  const today = await fetch(`http://localhost:${port}/api/today`).then((r) => r.json());
  const lead = today.block.materials.find((m: { kind: string; exists: boolean }) => m.kind === "pdf" && m.exists);
  if (!lead) throw new Error("The personal fixture needs a PDF material");
  const saved = await fetch(`http://localhost:${port}/api/tempos`, { method: "PUT", headers: { "x-struna": "1", "content-type": "application/json" }, body: JSON.stringify({ fragment: lead.label, bpm: 84 }) });
  if (!saved.ok) throw new Error("Could not seed the scratch clean-tempo record");
  await page.addInitScript(() => localStorage.setItem("struna.guide", "off"));
  await page.goto(`http://localhost:${port}/#practice`);
  await page.getByRole("button", { name: /^Short session/ }).click();
  await page.getByRole("button", { name: /^Log clean pass/ }).click();
  await page.getByRole("button", { name: /^Log clean pass/ }).click();
  await page.getByRole("button", { name: /^Log clean pass/ }).click();
  await page.getByText("Three clean passes.").waitFor();
  await page.getByRole("button", { name: /^Set 87 BPM/ }).click();
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: /^Next stage/ }).click();
  if (!(await page.locator(".tempocol").getAttribute("aria-label"))?.startsWith("87 BPM")) throw new Error("Personal tempo was lost on stage progression");
  await page.getByRole("button", { name: /^Record take/ }).click();
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: /^Stop take/ }).click();
  await page.getByRole("radio", { name: "Baseline" }).click();
  await page.getByLabel("Purpose").fill("first baseline from the smoke test");
  await page.getByRole("button", { name: "Save take" }).click();
  await page.getByText(/^Saved take:/).waitFor();
  await page.getByRole("button", { name: /^Finish/ }).click();
  await page.getByLabel("Target").fill("pattern 1 even at 87");
  await page.getByLabel("One improvement").fill("relaxed picking hand");
  await page.getByLabel("One limiting failure").fill("flat 5th slide rushes");
  await page.getByRole("radio", { name: "Memory" }).click();
  await page.getByRole("button", { name: "Write the log" }).click();
  await page.getByRole("heading", { name: "Log written" }).waitFor();
  const logs = readdirSync(join(dir, "vault/001 Projects/Threads/Guitar/Practice/Logs")).filter((f) => f !== "Practice Log - 2026-08-26.md");
  console.log("logs:", logs);
  console.log(readFileSync(join(dir, "vault/001 Projects/Threads/Guitar/Practice/Logs", logs[0]!), "utf8"));
  const recDir = join(dir, "media/Recordings/g-vocabulary-nine-pound-hammer-01");
  console.log("recordings:", readdirSync(recDir).map((f) => `${f} ${readFileSync(join(recDir, f)).length} bytes`));
  await page.getByRole("button", { name: "Back to today" }).click();
  await page.getByText("session 2: decode").waitFor();
  console.log("start screen after the session:", await page.locator(".meta dd").nth(1).textContent(), "|", await page.locator(".counts").textContent());
} finally {
  await browser.close();
  srv.kill();
}
