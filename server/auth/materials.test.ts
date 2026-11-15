import assert from "node:assert/strict";
import { test } from "node:test";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { testHosted } from "./test-server.ts";
import { fileId } from "../generic/materials.ts";

test("hosted Materials isolate upload, search, detail, direct/range reads and delete", async () => {
  const h = await testHosted();
  try {
    const [a, b] = await Promise.all([h.signIn("A"), h.signIn("B")]);
    const upload = async (p: typeof a, name: string, data: string) => {
      const res = await h.call(`/api/materials/upload?name=${name}`, p, "POST", data);
      assert.equal(res.status, 201); return await res.json();
    };
    const [alice, bob] = await Promise.all([upload(a, "alice.txt", "Alice private notes"), upload(b, "bob.txt", "Bob private notes")]);
    for (const [p, own, other] of [[a, alice, bob], [b, bob, alice]] as const) {
      const list = await (await h.call("/api/materials", p)).json();
      assert.deepEqual(list.items.map((i: any) => i.title), [own.title]);
      assert.equal((await (await h.call("/api/materials?q=" + other.title, p)).json()).total, 0);
      assert.equal((await h.call(`/api/materials/item?id=${other.id}`, p)).status, 404);
      assert.equal((await h.call(other.src, p)).status, 404);
      assert.equal((await h.call(`/api/materials/${other.id}`, p, "DELETE", {})).status, 404);
      const native = await fetch(h.base + own.src + `&session=${p.session}`, { headers: { cookie: p.cookie, range: "bytes=0-2" } });
      assert.equal(native.status, 206); assert.equal(native.headers.get("cache-control"), "no-store");
      assert.equal((await native.text()).length, 3);
      assert.equal((await fetch(h.base + own.src, { headers: { cookie: p.cookie } })).status, 409);
      for (const id of [fileId("../profile.json"), fileId("/outside/private.txt"), "d0.Zm9yZWlnbi50eHQ"]) assert.equal((await h.call("/api/materials/file?id=" + id, p)).status, 404);
    }
    const concurrent = await Promise.all(Array.from({ length: 100 }, (_, n) => h.call(`/api/materials/upload?name=batch-${n}.txt`, a, "POST", "synthetic notes")));
    assert.ok(concurrent.every((r) => r.status === 201));
    assert.equal((await h.call(alice.src)).status, 401);
    const switched = await h.signIn("B", a);
    assert.equal((await fetch(h.base + alice.src + `&session=${a.session}`, { headers: { cookie: switched.cookie } })).status, 409);
    assert.equal((await h.call(`/api/materials/${bob.id}`, b, "DELETE", {})).status, 200);
    assert.equal((await h.call(bob.src, b)).status, 404);
    symlinkSync(join(h.root, "accounts", a.account, "workspace", "materials", "alice.txt"), join(h.root, "accounts", b.account, "workspace", "materials", "linked.txt"));
    const denied = await h.call("/api/materials", b);
    assert.equal(denied.status, 503); assert.ok(!(await denied.text()).includes("alice"));
  } finally { await h.close(); }
});
