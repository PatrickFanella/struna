import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { publishLog, submissionId } from "./session-log.ts";

test("a lost save response, concurrent retries and later retries publish one complete log", async () => {
  const dir = await mkdtemp(join(tmpdir(), "struna-log-retry-"));
  try {
    const id = randomUUID(), text = "---\ntitle: Practice\n---\n\nComplete observations\n";
    const name = (n: number) => `${n}.md`;
    const results = await Promise.all(Array.from({ length: 8 }, () => publishLog(dir, text, name, id)));
    assert(results.every((r) => r.file === "1.md"));
    assert.equal((await publishLog(dir, text + "edited draft", name, id)).file, "1.md", "a retry returns the original saved result");
    assert.equal(await readFile(join(dir, "1.md"), "utf8"), text.replace("---\n", `---\nsubmission_id: ${id}\n`));
    assert.deepEqual(await readdir(dir), ["1.md"]);
    assert.equal((await publishLog(dir, text, name, randomUUID())).file, "2.md");
    assert.throws(() => submissionId("../../escape"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
