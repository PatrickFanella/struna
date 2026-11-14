import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const tmp = await mkdtemp(join(tmpdir(), "guitar-app-"));
await cp(join(import.meta.dirname, "fixtures/vault"), join(tmp, "vault"), { recursive: true });
delete process.env.GUITAR_MODE;
delete process.env.GUITAR_APP_NAME;
delete process.env.GUITAR_TIMEZONE;
process.env.GUITAR_VAULT_ROOT = join(tmp, "vault");
process.env.GUITAR_STATE_DIR = join(tmp, "state");
process.env.GUITAR_MEDIA_ROOT = join(tmp, "media");
process.env.GUITAR_HOME = join(tmp, "studio");
process.env.GUITAR_NO_SCAN = "1";

const { handle } = await import("./index.ts");
const { config } = await import("./config.ts");

let server: Server;
let base = "";
before(async () => {
  server = createServer(handle);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
});
after(async () => {
  server.close();
  await rm(tmp, { recursive: true, force: true });
});

test("personal is the default mode and its config is unchanged", () => {
  assert.equal(config.mode, "personal");
  assert.equal(config.timeZone, "America/Chicago");
  assert.equal(config.stateDir, join(tmp, "state"));
  assert.equal(config.practiceDir, join(tmp, "vault/001 Projects/Threads/Guitar/Practice"));
});

test("GET /api/app and /api/prompts in personal mode", async () => {
  assert.deepEqual(await (await fetch(`${base}/api/app`)).json(), { mode: "personal", name: "Guitar Room", sections: ["practice", "library", "tabs"], web: false, profile: true });
  assert.deepEqual(await (await fetch(`${base}/api/prompts`)).json(), { prompts: [], actions: [] });
});

test("the personal mode has no generic routes and never creates a studio folder", async () => {
  for (const path of ["/api/profile", "/api/logs", "/api/materials"]) assert.equal((await fetch(`${base}${path}`)).status, 404, path);
  const { stat } = await import("node:fs/promises");
  await assert.rejects(stat(join(tmp, "studio")));
  const t = await (await fetch(`${base}/api/today`)).json();
  assert.equal(t.block.id, "g-vocabulary-nine-pound-hammer-01");
  assert.equal(t.sessions, undefined);
});

test("index.html carries the app info, escaped, so the first paint needs no request", async () => {
  const { withAppInfo } = await import("./index.ts");
  const info = { mode: "personal" as const, name: "</script><b>x", sections: ["practice" as const], web: false, profile: true };
  const html = withAppInfo("<html><head><title>x</title></head><body></body></html>", info);
  const m = /<script id="app-info" type="application\/json">(.*?)<\/script>\n<\/head>/.exec(html);
  assert.ok(m, html);
  assert.ok(!m![1]!.includes("<"));
  assert.deepEqual(JSON.parse(m![1]!), info);
});
