import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { HttpError } from "./http.ts";
import { resolveThreadFile } from "./files.ts";

let root = "";
let thread = "";
before(async () => {
  root = await mkdtemp(join(tmpdir(), "guitar-files-"));
  thread = join(root, "thread");
  await mkdir(join(thread, "Materials"), { recursive: true });
  await writeFile(join(thread, "Materials", "a.pdf"), "%PDF");
  await writeFile(join(root, "secret.txt"), "secret");
  await symlink(join(root, "secret.txt"), join(thread, "Materials", "escape.pdf"));
});
after(() => rm(root, { recursive: true, force: true }));

const notFound = (e: unknown) => e instanceof HttpError && e.status === 404;

test("resolves a file inside the thread", async () => {
  assert.equal(await resolveThreadFile(thread, "Materials/a.pdf"), join(thread, "Materials", "a.pdf"));
});

test("refuses traversal, absolute paths, encoded traversal and symlinks out", async () => {
  for (const rel of ["../secret.txt", "../../etc/passwd", "%2e%2e/secret.txt", "/etc/passwd", join(root, "secret.txt"), "Materials/escape.pdf", "Materials", ""]) {
    await assert.rejects(resolveThreadFile(thread, rel), notFound, rel);
  }
});
