import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const get = (socketPath: string, path: string, headers: Record<string, string>) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    const r = request({ socketPath, path, headers }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    r.on("error", reject);
    r.end();
  });

test("with SOCKET_PATH the server listens only on an owner-only Unix socket", async () => {
  const dir = await mkdtemp(join(tmpdir(), "guitar-sock-"));
  const sock = join(dir, "http.sock");
  const child = spawn(process.execPath, [join(import.meta.dirname, "index.ts")], {
    env: { ...process.env, SOCKET_PATH: sock, PORT: "1", GUITAR_STATE_DIR: join(dir, "state"), GUITAR_NO_SCAN: "1", GUITAR_VAULT_ROOT: join(import.meta.dirname, "fixtures/vault") },
    stdio: "ignore",
  });
  try {
    for (let i = 0; i < 50 && !(await stat(sock).catch(() => null)); i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal((await stat(sock)).mode & 0o777, 0o600);
    const r = await get(sock, "/api/health", { host: "localhost" });
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.body), { ok: true });
  } finally {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});
