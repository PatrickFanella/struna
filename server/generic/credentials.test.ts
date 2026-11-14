import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { checkBaseUrl, credentialStore, hint, placementProblem, setupChanged, STORE_FILE, validateInput } from "./credentials.ts";

const root = mkdtempSync(join(tmpdir(), "guitar-cred-"));
after(() => rmSync(root, { recursive: true, force: true }));
const KEY = "sk-ant-test-0123456789abcdef";
const mode = (p: string) => statSync(p).mode & 0o777;
const status = async (p: Promise<unknown>) => p.then(() => 0, (e) => (e as { status?: number }).status ?? -1);

test("the store is mode 600 in a folder with mode 700, and round-trips", () => {
  const state = join(root, "state-a");
  mkdirSync(state, { mode: 0o755 });
  const store = credentialStore(state);
  assert.equal(mode(state), 0o700);
  assert.deepEqual(store.read(), { version: 1 });
  store.put("anthropic", { key: KEY, model: null, saved: "2026-11-14T00:00:00.000Z" });
  store.put("endpoint", { preset: "ollama", baseUrl: "http://127.0.0.1:11434/v1", key: null, header: "bearer", model: "gpt-oss:20b", saved: "t" });
  assert.equal(mode(store.file), 0o600);
  assert.equal(store.get("anthropic")!.key, KEY);
  assert.deepEqual(store.secrets(), [KEY]);
  store.remove("anthropic");
  assert.equal(store.get("anthropic"), undefined);
  assert.equal(store.get("endpoint")!.model, "gpt-oss:20b");
  const d = store.dir("openai");
  assert.equal(d, join(state, "cli", "openai"));
  assert.equal(mode(d), 0o700);
  assert.equal(mode(join(state, "cli")), 0o700);
  // Group or other bits found on load are removed.
  chmodSync(store.file, 0o644);
  const warn = console.warn;
  const warned: string[] = [];
  console.warn = (m: string) => void warned.push(m);
  try {
    store.read();
  } finally {
    console.warn = warn;
  }
  assert.equal(mode(store.file), 0o600);
  assert.equal(warned.length, 1);
  assert.ok(!warned[0]!.includes("gpt-oss"), "the warning never shows the contents");
});

test("a corrupt store is refused, not overwritten, and its secrets are not guessed", () => {
  const state = join(root, "state-b");
  const store = credentialStore(state);
  writeFileSync(join(state, STORE_FILE), "{not json", { mode: 0o600 });
  assert.throws(() => store.read(), (e: any) => e.status === 409 && /not valid/.test(e.message));
  assert.throws(() => store.put("openai", { key: KEY, model: null, saved: "t" }), (e: any) => e.status === 409);
  assert.equal(readFileSync(join(state, STORE_FILE), "utf8"), "{not json");
  assert.deepEqual(store.secrets(), []);
});

test("a hint shows the last four characters, or only that a short key is saved", () => {
  assert.equal(hint("sk-ant-api03-abcdef3f9a"), "…3f9a");
  assert.equal(hint("short-key"), "saved");
});

test("keys, models and regions are checked, and messages never quote the input", async () => {
  const o = { allowPrivate: false };
  const v = (id: Parameters<typeof validateInput>[0], body: unknown, cur?: any): Promise<any> => validateInput(id, body, cur, o);
  assert.equal((await v("anthropic", { key: KEY })).model, null);
  for (const key of ["short", "has space in it", "line\nbreak-1234", "x".repeat(4097)]) {
    await assert.rejects(v("anthropic", { key }), (e: any) => e.status === 400 && !e.message.includes(key.slice(0, 5)));
  }
  assert.equal((await v("bedrock", { key: "x".repeat(2000), region: "us-east-1" })).key.length, 2000, "Bedrock keys are long");
  await assert.rejects(v("anthropic", {}), /Enter the key/);
  // A missing key keeps the saved one; a missing model keeps the saved one, an empty one clears it.
  const cur = { key: KEY, model: "opus", saved: "t" };
  assert.deepEqual([(await v("anthropic", { model: "sonnet" }, cur)).key, (await v("anthropic", {}, cur)).model, (await v("anthropic", { model: "" }, cur)).model], [KEY, "opus", null]);
  for (const model of ["-flag", "--dangerously-skip-permissions", "a b", "x".repeat(201), ""]) {
    if (model) await assert.rejects(v("openai", { key: KEY, model }), (e: any) => e.status === 400 && !e.message.includes(model));
  }
  for (const model of ["sonnet", "claude-opus-5-5", "openai/gpt-5", "us.anthropic.claude-sonnet-4-5-20250929-v1:0", "gpt-oss:20b"]) assert.equal((await v("openai", { key: KEY, model })).model, model);
  for (const region of ["useast1", "US-EAST-1", "us-east-1; rm"]) await assert.rejects(v("bedrock", { key: KEY, region }), /AWS region/);
  assert.equal((await v("bedrock", { key: KEY, region: "eu-central-1" })).region, "eu-central-1");
  assert.equal((await v("bedrock", { key: KEY, region: "us-gov-west-1" })).region, "us-gov-west-1");
});

test("base URLs: public https anywhere; http and private addresses only when allowed; never a key over public http", async () => {
  const lookup = async (host: string) => ({ "openrouter.ai": ["104.18.2.115"], "lan.example": ["192.168.1.20"], "mixed.example": ["104.18.2.115", "10.0.0.5"], "plain.example": ["93.184.215.14"] })[host] ?? [];
  const ok = (raw: string, allowPrivate: boolean, key = true) => checkBaseUrl(raw, { allowPrivate, key, lookup });
  assert.equal(await ok("https://openrouter.ai/api/v1/", false), "https://openrouter.ai/api/v1");
  for (const raw of ["http://127.0.0.1:11434/v1", "https://lan.example/v1", "https://mixed.example/v1", "http://[::1]:1234/v1", "https://100.64.1.2/v1", "https://169.254.169.254/v1", "https://[fd00::1]/v1", "http://plain.example/v1"]) {
    assert.equal(await status(ok(raw, false)), 400, raw);
  }
  assert.equal(await ok("http://127.0.0.1:11434/v1", true, false), "http://127.0.0.1:11434/v1");
  assert.equal(await ok("https://lan.example/v1", true), "https://lan.example/v1");
  assert.equal(await status(ok("http://plain.example/v1", true, true)), 400, "a key never goes over plain http to a public host");
  assert.equal(await ok("http://plain.example/v1", true, false), "http://plain.example/v1");
  for (const raw of ["https://user:pw@openrouter.ai/v1", "https://openrouter.ai/v1?api-version=1", "https://openrouter.ai/v1#x", "ftp://openrouter.ai/v1", "not a url", "https://nowhere.example/v1"]) {
    assert.equal(await status(ok(raw, true)), 400, raw);
  }
});

test("an endpoint entry: presets, header, required model, and a key where the provider needs one", async () => {
  const o = { allowPrivate: true };
  const e = await validateInput("endpoint", { preset: "ollama", baseUrl: "http://127.0.0.1:11434/v1/", model: "gpt-oss:20b" }, undefined, o);
  assert.deepEqual({ ...e, saved: "" }, { preset: "ollama", baseUrl: "http://127.0.0.1:11434/v1", key: null, header: "bearer", model: "gpt-oss:20b", saved: "" });
  await assert.rejects(validateInput("endpoint", { preset: "ollama", baseUrl: "http://127.0.0.1:11434/v1" }, undefined, o), /model name/);
  await assert.rejects(validateInput("endpoint", { preset: "azure", baseUrl: "https://127.0.0.1/openai/v1", model: "gpt-5" }, undefined, o), /Enter the key/);
  await assert.rejects(validateInput("endpoint", { preset: "nope", baseUrl: "http://127.0.0.1/v1", model: "m" }, undefined, o), /listed providers/);
  await assert.rejects(validateInput("endpoint", { preset: "other", header: "cookie", baseUrl: "http://127.0.0.1/v1", model: "m" }, undefined, o), /header/);
});

test("an endpoint's saved key stays with its address: never sent to another server or to a preset without keys", async () => {
  const o = { allowPrivate: true, lookup: async () => ["104.18.2.115"] };
  const cur = { preset: "openrouter" as const, baseUrl: "https://openrouter.ai/api/v1", key: KEY, header: "bearer" as const, model: "openai/gpt-5", saved: "1" };
  // Same address, no key sent: the saved key is kept.
  assert.equal(((await validateInput("endpoint", { preset: "openrouter", baseUrl: "https://openrouter.ai/api/v1/", model: "x/y" }, cur, o)) as any).key, KEY);
  // Another address: the saved key is not carried over, so a preset that needs one asks for it.
  await assert.rejects(validateInput("endpoint", { preset: "xai", baseUrl: "https://api.x.ai/v1", model: "grok-4" }, cur, o), /Enter the key/);
  assert.equal(((await validateInput("endpoint", { preset: "other", baseUrl: "https://example.org/v1", model: "m" }, cur, o)) as any).key, null);
  // A preset that takes no key (LM Studio) drops it.
  assert.equal(((await validateInput("endpoint", { preset: "lmstudio", baseUrl: "http://127.0.0.1:1234/v1", model: "m" }, cur, o)) as any).key, null);
  assert.equal(((await validateInput("endpoint", { preset: "lmstudio", baseUrl: "http://127.0.0.1:1234/v1", model: "m", key: KEY }, undefined, o)) as any).key, null);
});

test("Ollama: no key on this computer, the account's key for Ollama's cloud", async () => {
  const o = { allowPrivate: false, lookup: async () => ["34.36.133.15"] };
  const cloud = await validateInput("endpoint", { preset: "ollama", baseUrl: "https://ollama.com/v1", model: "gpt-oss:120b", key: KEY }, undefined, o);
  assert.equal((cloud as any).key, KEY);
  const local = await validateInput("endpoint", { preset: "ollama", baseUrl: "http://127.0.0.1:11434/v1", model: "gpt-oss:20b" }, undefined, { allowPrivate: true });
  assert.equal((local as any).key, null);
});

test("the Azure preset's template address is refused until RESOURCE is replaced, under any preset", async () => {
  const o = { allowPrivate: false, lookup: async () => ["20.232.91.180"] };
  for (const preset of ["azure", "other"]) {
    await assert.rejects(validateInput("endpoint", { preset, baseUrl: "https://RESOURCE.openai.azure.com/openai/v1", model: "gpt-5", key: KEY }, undefined, o), /in place of RESOURCE/, preset);
  }
  const mine = await validateInput("endpoint", { preset: "azure", baseUrl: "https://my-guitar.openai.azure.com/openai/v1", model: "gpt-5", key: KEY }, undefined, o);
  assert.equal((mine as any).baseUrl, "https://my-guitar.openai.azure.com/openai/v1");
});

test("only a change beyond the key itself counts as a new setup", () => {
  const a = { key: KEY, model: "sonnet", saved: "1" };
  assert.equal(setupChanged(undefined, a), true);
  assert.equal(setupChanged(a, { ...a, key: `${KEY}-new`, saved: "2" }), false);
  assert.equal(setupChanged(a, { ...a, model: "opus" }), true);
  const ep = { preset: "ollama" as const, baseUrl: "http://127.0.0.1:11434/v1", key: null, header: "bearer" as const, model: "m", saved: "1" };
  assert.equal(setupChanged(ep, { ...ep, baseUrl: "https://openrouter.ai/api/v1" }), true);
});

test("placement: the state folder outside everything the coach reads, and no folder that holds a login", () => {
  const home = join(root, "home");
  mkdirSync(join(home, ".claude"), { recursive: true });
  mkdirSync(join(home, ".codex"), { recursive: true });
  const studio = join(home, "Guitar Room");
  mkdirSync(studio, { recursive: true });
  const state = join(home, ".local/state/guitar-room-generic");
  assert.equal(placementProblem({ stateDir: state, studio, libraryDirs: [], home }), null);
  assert.match(placementProblem({ stateDir: join(studio, "state"), studio, libraryDirs: [], home })!, /inside the studio folder/);
  assert.match(placementProblem({ stateDir: join(home, "lib/state"), studio, libraryDirs: [join(home, "lib")], home })!, /inside a library folder/);
  assert.match(placementProblem({ stateDir: join(root, "elsewhere"), studio: home, libraryDirs: [], home })!, /the studio folder .* is or contains/);
  // (The test folders are under /tmp, so the temp-folder rule may answer first here.)
  assert.match(placementProblem({ stateDir: join(root, "elsewhere"), studio, libraryDirs: [home], home })!, /a library folder .* is or contains|temp folder/);
  assert.match(placementProblem({ stateDir: state, studio: join(home, ".codex"), libraryDirs: [], home })!, /is or contains/);
  assert.match(placementProblem({ stateDir: state, studio: join(home, ".claude/projects"), libraryDirs: [], home })!, /is inside/);
  // Under /tmp only matters when a library folder there keeps /tmp readable to Codex.
  const tmpState = join(tmpdir(), "gr-state-x");
  assert.equal(placementProblem({ stateDir: tmpState, studio, libraryDirs: [], home }), null);
  assert.match(placementProblem({ stateDir: tmpState, studio, libraryDirs: [join(tmpdir(), "lessons")], home })!, /temp folder/);
});
