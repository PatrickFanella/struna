/** Offline Studio fixture for current #110 checks (originally built for historical #29). Never opens an existing scratch directory.
 * pnpm build; PORT=5410 node scripts/qualification-studio.ts [new-scratch-directory]
 * Uses a public, fixed test token and offline Coach stand-ins. Do not add personal data or credentials.
 */
import { createServer } from "node:http";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { normalizeProfile } from "../server/generic/studio.ts";
import { writeFakeBin } from "./fake-coach-cli.ts";

const root = process.argv[2] ? resolve(process.argv[2]) : await mkdtemp(join(tmpdir(), "struna-manual-"));
if (process.argv[2]) await mkdir(root); // Refuse existing data; never reset a previous run.
const home = join(root, "home");
for (const path of ["home/plan", "home/materials", "state", "cache"]) await mkdir(join(root, path), { recursive: true });
const port = Number(process.env.PORT ?? 5410);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("PORT must be 1024–65535");
const profile = normalizeProfile({ name: "Qualification fixture", level: "intermediate" }, new Date().toISOString());
await writeFile(join(home, "profile.json"), JSON.stringify(profile, null, 2));
await writeFile(join(home, "materials/roll.md"), "# Baseline roll\n\n## Listen for even notes\n\n```text\ne|------0---|\nB|----0---0-|\nG|--0-------|\nD|----------|\nA|----------|\nE|----------|\n```\n" + "\nReading-position fixture.\n".repeat(60));
await writeFile(join(home, "materials/tune.md"), "# Two-note phrase\n\nSkip this tune in the partial-session check; its BPM must remain blank.\n");
const tune = { key: "tuning", title: "Tuning", minutes: 2, task: "Tune deliberately; microphone starts only when requested." };
const roll = { key: "technique", title: "Technique", minutes: 6, task: "Play the baseline roll with even notes.", material: { file: "materials/roll.md" }, targetBpm: 80 };
const song = { key: "song", title: "Tune practice", minutes: 10, task: "Play a short phrase.", material: { file: "materials/tune.md" }, targetBpm: 96 };
const log = { key: "logging", title: "Logging", minutes: 2, task: "Confirm only what you actually measured." };
const plan = {
  version: 1, id: "ux-qualification", title: "Offline qualification fixture", started: "2026-01-01", goal: "Keep roll and tune measurements separate", next: "Tune, then play the roll", extras: [],
  phases: [{ title: "Qualification", summary: "Scratch data only", sessions: 100, focus: {} }],
  materials: [{ label: "Baseline roll", file: "materials/roll.md" }, { label: "Two-note phrase", file: "materials/tune.md" }],
  sessions: [{ id: "full", label: "Full", stages: [tune, roll, song, log] }, { id: "short", label: "Short", stages: [roll, log] }, { id: "quick", label: "Quick", stages: [tune, roll, log] }],
};
await writeFile(join(home, "plan/plan.json"), JSON.stringify(plan, null, 2));
const fake = writeFakeBin(join(root, "fake"));
await writeFile(join(root, "fake/good-plan.json"), JSON.stringify(plan));
// This credential is deliberately public fixture data, never a real app credential.
const token = "0".repeat(64);
await writeFile(join(root, "state/access-token"), token + "\n", { mode: 0o600 });
Object.assign(process.env, {
  NODE_ENV: "production", HOST: "127.0.0.1", PORT: String(port), SOCKET_PATH: "", EDGE_SECRET_FILE: "", REQUIRE_USER: "", ALLOWED_HOSTS: "", STRUNA_MODE: "studio", STRUNA_HOME: home,
  STRUNA_STATE_DIR: join(root, "state"), STRUNA_CACHE_DIR: join(root, "cache"), STRUNA_TIMEZONE: "UTC", STRUNA_LIBRARY_DIRS: "", STRUNA_TABS_DIR: "", STRUNA_NO_SCAN: "1", STRUNA_COACH_HOST_LOGINS: "1", STRUNA_COACH_WEB: "0", CLAUDE_BIN: fake, CODEX_BIN: fake,
});
const { handle, db } = await import("../server/index.ts");
const server = createServer(handle);
server.listen(port, "127.0.0.1", () => {
  console.log(`Offline qualification fixture: ${root}`);
  console.log(`Public test access link: http://localhost:${port}/?token=${token}#practice`);
  console.log("Coach uses offline stand-ins. Microphone and speakers are real browser devices unless your browser supplies synthetic input.");
  console.log("Stop with Ctrl+C. Scratch logs and recordings remain in this directory.");
});
const stop = () => server.close(() => { db.close(); process.exit(0); });
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
