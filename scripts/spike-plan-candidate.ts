/** Issue #8 experiment only: copied scratch cwd is not the proposed production boundary. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { normalizeProfile, validatePlan } from "../server/generic/studio.ts";
import { starterPlan } from "../server/generic/starter.ts";
import { sha256, writeFakeBin } from "./fake-coach-cli.ts";

const root = mkdtempSync(join(tmpdir(), "struna-8-"));
const plan = starterPlan(normalizeProfile({ level: "beginner" }, "2026-11-14"), "2026-11-14");
const base = JSON.stringify(plan, null, 2);
for (const family of ["claude", "codex"]) {
  const live = join(root, family, "live");
  const stage = join(root, family, "stage");
  mkdirSync(join(live, "plan/archive"), { recursive: true });
  mkdirSync(join(stage, "plan"), { recursive: true });
  const active = join(live, "plan/plan.json");
  const candidate = join(stage, "plan/plan.json");
  const archive = join(live, "plan/archive/previous.json");
  writeFileSync(active, base);
  writeFileSync(archive, "archive sentinel");
  writeFileSync(candidate, base);
  const changed = JSON.stringify({ ...plan, next: "Play two slow bars." }, null, 2);
  writeFileSync(join(stage, "good-plan.json"), changed);
  const fake = writeFakeBin(stage);
  const argv = family === "claude" ? ["-p"] : ["exec"];
  const run = (input: string) => execFileSync(fake, argv, { cwd: stage, input, stdio: ["pipe", "pipe", "pipe"] });
  run("BREAK THE PLAN");
  assert.ok(validatePlan(JSON.parse(readFileSync(candidate, "utf8"))).errors.length);
  run("Fix the file");
  const proposed = readFileSync(candidate, "utf8");
  assert.equal(validatePlan(JSON.parse(proposed)).errors.length, 0);
  assert.equal(proposed, changed); // The preview must use these exact bytes.
  assert.equal(readFileSync(active, "utf8"), base);
  assert.equal(readFileSync(archive, "utf8"), "archive sentinel");
  const fingerprint = sha256(base);
  writeFileSync(active, base + "\n");
  assert.notEqual(sha256(readFileSync(active, "utf8")), fingerprint); // refuse stale Apply
  assert.equal(readFileSync(archive, "utf8"), "archive sentinel");
  writeFileSync(active, base);
  // Discarded output has no path to activation. Only this explicit scratch step activates it.
  assert.equal(readFileSync(active, "utf8"), base);
  assert.equal(sha256(readFileSync(active, "utf8")), fingerprint);
  writeFileSync(active, proposed);
  assert.equal(readFileSync(active, "utf8"), changed);
  console.log(`${family}: invalid/repair, unchanged live bytes, preview, conflict, discard and explicit scratch activation passed`);
}
console.log(`Retained scratch evidence: ${root}`);
