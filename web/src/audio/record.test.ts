import assert from "node:assert/strict";
import { test } from "node:test";

import { pickRecorderType } from "./record.ts";

test("prefers WebM Opus", () => {
  assert.deepEqual(pickRecorderType(() => true), { mime: "audio/webm;codecs=opus", ext: "webm" });
});

test("falls back to MP4 on Safari", () => {
  assert.deepEqual(pickRecorderType((t) => t === "audio/mp4"), { mime: "audio/mp4", ext: "m4a" });
});

test("returns the browser default when nothing is supported", () => {
  assert.deepEqual(pickRecorderType(() => false), { mime: "", ext: "webm" });
});
