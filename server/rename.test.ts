import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { getSetting, openDb, setSetting } from "./db.ts";

const configUrl = new URL("./config.ts", import.meta.url).href;
function readConfig(home: string, env: Record<string, string> = {}) {
  const code = `import { config as c } from ${JSON.stringify(configUrl)}; console.log(JSON.stringify({ mode:c.mode, home:c.home, stateDir:c.stateDir, cacheDir:c.cacheDir, noScan:c.noScan, appName:c.appName, coachHostLogins:c.coachHostLogins }));`;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", code], {
    env: { PATH: process.env.PATH, HOME: home, XDG_STATE_HOME: join(home, "state"), XDG_CACHE_HOME: join(home, "cache"), ...env },
    encoding: "utf8",
  }));
}

test("new configuration wins over legacy variables, including explicit empty values", () => {
  const home = mkdtempSync(join(tmpdir(), "struna-rename-"));
  try {
    const old = readConfig(home, { GUITAR_MODE: "generic", GUITAR_HOME: join(home, "old-studio"), GUITAR_APP_NAME: "Previous", GUITAR_NO_SCAN: "1" });
    assert.equal(old.mode, "studio");
    assert.equal(old.home, join(home, "old-studio"));
    assert.equal(old.noScan, true);
    const current = readConfig(home, { GUITAR_MODE: "generic", STRUNA_MODE: "personal", GUITAR_APP_NAME: "Previous", STRUNA_APP_NAME: "", GUITAR_NO_SCAN: "1", STRUNA_NO_SCAN: "", GUITAR_COACH_HOST_LOGINS: "1", STRUNA_COACH_HOST_LOGINS: "0" });
    assert.equal(current.mode, "personal");
    assert.equal(current.appName, "Struna");
    assert.equal(current.noScan, false);
    assert.equal(current.coachHostLogins, false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("fresh paths use Struna; existing legacy folders are reused without moving them", () => {
  const home = mkdtempSync(join(tmpdir(), "struna-rename-"));
  try {
    const fresh = readConfig(home, { STRUNA_MODE: "studio" });
    assert.equal(fresh.stateDir, join(home, "state/struna-studio"));
    assert.equal(fresh.cacheDir, join(home, "cache/struna-studio"));
    assert.equal(fresh.home, join(home, "Struna"));
    for (const path of ["state/guitar-room-generic", "cache/guitar-room-generic", "Guitar Room"]) mkdirSync(join(home, path), { recursive: true });
    const old = readConfig(home, { STRUNA_MODE: "studio" });
    assert.equal(old.stateDir, join(home, "state/guitar-room-generic"));
    assert.equal(old.cacheDir, join(home, "cache/guitar-room-generic"));
    assert.equal(old.home, join(home, "Guitar Room"));
    mkdirSync(join(home, "state/struna-studio"));
    assert.equal(readConfig(home, { STRUNA_MODE: "studio" }).stateDir, fresh.stateDir);
    assert.equal(existsSync(old.stateDir), true);
    assert.equal(readConfig(home, { STRUNA_STATE_DIR: join(home, "chosen") }).stateDir, join(home, "chosen"));
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("an existing database keeps its settings and no replacement database is created", () => {
  const dir = mkdtempSync(join(tmpdir(), "struna-db-rename-"));
  try {
    const legacy = new DatabaseSync(join(dir, "guitar-room.sqlite"));
    legacy.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); INSERT INTO settings VALUES ('last-tempo', '92')");
    legacy.close();
    const db = openDb(dir);
    assert.equal(getSetting(db, "last-tempo"), "92");
    setSetting(db, "last-tempo", "95");
    db.close();
    assert.equal(existsSync(join(dir, "struna.sqlite")), false);
    const again = openDb(dir);
    assert.equal(getSetting(again, "last-tempo"), "95");
    again.close();
    const fresh = openDb(join(dir, "fresh"));
    fresh.close();
    assert.equal(existsSync(join(dir, "fresh/struna.sqlite")), true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
