import assert from "node:assert/strict";
import { test } from "node:test";

import { MicDenied, openMic, stopMic } from "./mic.ts";

test("microphone errors distinguish denied, missing and unavailable input", async () => {
  const previous = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  try {
    for (const [name, reason] of [["NotAllowedError", "denied"], ["SecurityError", "denied"], ["NotFoundError", "missing"], ["NotReadableError", "unavailable"]]) {
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => { throw new DOMException("fixture", name); } } });
      await assert.rejects(openMic(), (e: unknown) => e instanceof MicDenied && e.reason === reason);
    }
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    await assert.rejects(openMic(), (e: unknown) => e instanceof MicDenied && e.reason === "unavailable");
    const calls: unknown[] = [];
    const stream = { getTracks: () => [] } as unknown as MediaStream;
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async (constraints: unknown) => { calls.push(constraints); return stream; } } });
    assert.equal(await openMic(), stream);
    assert.deepEqual(calls, [{ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false }]);
  } finally {
    if (previous) Object.defineProperty(navigator, "mediaDevices", previous);
    else Reflect.deleteProperty(navigator, "mediaDevices");
  }
});

test("stopping one lease leaves an independent recorder lease live", () => {
  let tunerStops = 0;
  let recorderStops = 0;
  const tuner = { getTracks: () => [{ stop: () => tunerStops++ }] } as unknown as MediaStream;
  const recorder = { getTracks: () => [{ stop: () => recorderStops++ }] } as unknown as MediaStream;
  stopMic(tuner);
  assert.equal(tunerStops, 1);
  assert.equal(recorderStops, 0);
  stopMic(recorder);
  assert.equal(recorderStops, 1);
  stopMic(null);
});
