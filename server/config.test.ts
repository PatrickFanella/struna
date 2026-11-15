import assert from "node:assert/strict";
import { test } from "node:test";

import { triState } from "./config.ts";

test("a policy switch is \"1\", \"0\" or unset; anything else stops the server instead of leaving it on", () => {
  assert.equal(triState("X", "1"), true);
  assert.equal(triState("X", "0"), false);
  assert.equal(triState("X", undefined), undefined);
  assert.equal(triState("X", ""), undefined, "an empty Environment= line means the default");
  for (const bad of ["false", "off", "no", " 0", "true"]) assert.throws(() => triState("STRUNA_COACH_HOST_LOGINS", bad), /STRUNA_COACH_HOST_LOGINS must be "1" or "0"/, bad);
});

test("hosted defaults never migrate an owner's legacy state or cache", async () => {
  const { mkdtemp, mkdir, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFileSync } = await import("node:child_process");
  const scratch = await mkdtemp(join(tmpdir(), "struna-hosted-config-"));
  try {
    await mkdir(join(scratch, "state/guitar-room"), { recursive: true });
    await mkdir(join(scratch, "cache/guitar-room"), { recursive: true });
    const env: NodeJS.ProcessEnv = { ...process.env, STRUNA_MODE: "hosted", XDG_STATE_HOME: join(scratch, "state"), XDG_CACHE_HOME: join(scratch, "cache") };
    delete env.STRUNA_STATE_DIR; delete env.STRUNA_CACHE_DIR; delete env.GUITAR_STATE_DIR; delete env.GUITAR_CACHE_DIR;
    const paths = execFileSync(process.execPath, ["--input-type=module", "-e", "const {config}=await import('./server/config.ts');console.log(JSON.stringify([config.stateDir,config.cacheDir]))"], { env, encoding: "utf8" });
    assert.deepEqual(JSON.parse(paths), [join(scratch, "state/struna-hosted"), join(scratch, "cache/struna-hosted")]);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});
