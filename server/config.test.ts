import assert from "node:assert/strict";
import { test } from "node:test";

import { triState } from "./config.ts";

test("a policy switch is \"1\", \"0\" or unset; anything else stops the server instead of leaving it on", () => {
  assert.equal(triState("X", "1"), true);
  assert.equal(triState("X", "0"), false);
  assert.equal(triState("X", undefined), undefined);
  assert.equal(triState("X", ""), undefined, "an empty Environment= line means the default");
  for (const bad of ["false", "off", "no", " 0", "true"]) assert.throws(() => triState("GUITAR_COACH_HOST_LOGINS", bad), /GUITAR_COACH_HOST_LOGINS must be "1" or "0"/, bad);
});
