import assert from "node:assert/strict";
import { test } from "node:test";

import { migrateSessionStorage, store } from "./api.ts";

function storage() {
  const data: Record<string, string> = {};
  return new Proxy(data, {
    get(target, key) {
      if (key === "getItem") return (name: string) => target[name] ?? null;
      if (key === "setItem") return (name: string, value: string) => { target[name] = value; };
      if (key === "removeItem") return (name: string) => { delete target[name]; };
      return target[key as string];
    },
  }) as unknown as Storage;
}

test("browser settings migrate on read and clearing a value cannot resurrect an old setting", () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const local = storage();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: local });
  try {
    local.setItem("guitar-room.theme", "dark");
    assert.equal(store.get("struna.theme"), "dark");
    assert.equal(local.getItem("struna.theme"), "dark");
    store.set("struna.theme", "light");
    assert.equal(local.getItem("guitar-room.theme"), null);
    assert.equal(store.get("struna.theme"), "light");
    local.setItem("guitar-room.theme", "dark");
    store.set("struna.theme", null);
    assert.equal(store.get("struna.theme"), null);
  } finally {
    if (saved) Object.defineProperty(globalThis, "localStorage", saved);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("an open tab keeps its session and review draft without replacing newer Struna state", () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const session = storage();
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: session });
  try {
    session.setItem("guitar-room.session", '{"stage":2}');
    session.setItem("guitar-room.review-draft", '{"notes":"clean at 92"}');
    session.setItem("guitar-room.material", "old");
    session.setItem("struna.material", "new");
    migrateSessionStorage();
    assert.equal(session.getItem("struna.session"), '{"stage":2}');
    assert.equal(session.getItem("struna.review-draft"), '{"notes":"clean at 92"}');
    assert.equal(session.getItem("struna.material"), "new");
    assert.equal(session.getItem("guitar-room.session"), null);
    session.removeItem("struna.session");
    migrateSessionStorage();
    assert.equal(session.getItem("struna.session"), null);
  } finally {
    if (saved) Object.defineProperty(globalThis, "sessionStorage", saved);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
  }
});
