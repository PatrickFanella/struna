import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Studio } from "../generic/studio.ts";
import { validateInput, type KeyEntry } from "../generic/credentials.ts";
import { HttpError, readJson, send, type route } from "../http.ts";
import { responses } from "./responses.ts";
import type { Connection } from "./responses.ts";
import type { PracticeIdentity } from "./practice.ts";

/** The master key never enters a model-readable workspace or an account response. */
export function accountCredentials(root: string, invalidate: (account: string) => void, transport?: typeof fetch, isBusy: (account: string) => boolean = () => false) {
  const infer = responses(transport);
  const tests = new Map<string, { session: string; abort: AbortController }>();
  const revoke = (session: string) => { for (const t of tests.values()) if(t.session === session) t.abort.abort(); };
  const keyDir = join(root, "secrets"), keyFile = join(keyDir, "credentials.key");
  mkdirSync(keyDir, { recursive: true, mode: 0o700 });
  if (lstatSync(keyDir).isSymbolicLink()) throw new Error("Credential encryption unavailable");
  chmodSync(keyDir, 0o700);
  if (!existsSync(keyFile)) {
    // Never silently replace a lost encryption key for an existing deployment.
    if (existsSync(join(root, "credentials-initialized"))) throw new Error("Credential encryption key is missing");
    try { writeFileSync(keyFile, randomBytes(32), { flag: "wx", mode: 0o600 }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
  }
  const keyStat = lstatSync(keyFile);
  if (!keyStat.isFile() || keyStat.isSymbolicLink() || keyStat.nlink !== 1) throw new Error("Credential encryption unavailable");
  chmodSync(keyFile, 0o600);
  const key = readFileSync(keyFile);
  if (key.length !== 32) throw new Error("Credential encryption unavailable");
  writeFileSync(join(root, "credentials-initialized"), "1", { mode: 0o600 });
  return { revoke, register(s: Studio, identity: PracticeIdentity, register: typeof route) {
    const file = join(root, "accounts", identity.account, "private", "openai.enc");
    const aad = Buffer.from(`struna:account-credential:v1:${identity.account}:openai`);
    const read = (): (KeyEntry & { tested?: string; revision?: string }) | null => {
      if (!existsSync(file)) return null;
      try {
        const bytes = readFileSync(file), decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
        decipher.setAAD(aad); decipher.setAuthTag(bytes.subarray(12, 28));
        const entry = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
        return entry;
      } catch { throw new HttpError(503, "AI connection unavailable. Disconnect and reconnect it."); }
    };
    const write = (entry: (KeyEntry & { tested?: string; revision?: string }) | null, changed = true) => {
      const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(aad);
      const encrypted = Buffer.concat([cipher.update(JSON.stringify(entry)), cipher.final()]);
      const tmp = file + "." + randomUUID();
      writeFileSync(tmp, Buffer.concat([nonce, cipher.getAuthTag(), encrypted]), { flag: "wx", mode: 0o600 });
      renameSync(tmp, file);
      if (!changed) return;
      tests.get(identity.account)?.abort.abort();
      invalidate(identity.account);
      // Invalidate resume/proposal authority on every replacement, even the same key/model.
      if (s.db.prepare("SELECT 1 FROM sqlite_master WHERE name='conversations'").get()) s.db.exec("UPDATE conversations SET thread_id=NULL");
      if (s.db.prepare("SELECT 1 FROM sqlite_master WHERE name='plan_proposals'").get()) s.db.exec("UPDATE plan_proposals SET state='dismissed', candidate='', base=NULL WHERE state='pending'");
    };
    const status = () => { const entry = read(); return {
      id: "openai", connected: Boolean(entry), model: entry?.model ?? null, saved: entry?.saved ?? null, tested: entry?.tested ?? null,
      executionEnabled: Boolean(entry?.model && entry.tested), label: "OpenAI API key", via: "OpenAI Responses API", setup: "key",
      ok: Boolean(entry?.model && entry.tested), detail: entry?.tested ? "Tested successfully" : entry ? "Saved; not tested" : "Connect your OpenAI API key",
      web: false, notes: [],
    }; };
    const connection = (testing = false): Connection => {
      const entry = read();
      if (!entry?.model) throw new HttpError(409, "Connect your AI and choose a model first. Practice tools remain available.");
      if (!testing && (!entry.tested || tests.has(identity.account))) throw new HttpError(409, "Test your saved AI connection before sending. Wait for any running test to finish.");
      return { key: entry.key, model: entry.model };
    };
    const provider = (id: string) => { if (id !== "openai") throw new HttpError(400, "Only a player-owned OpenAI API connection is supported in hosted mode"); };
    register("GET", "/api/providers", (_req, res) => send(res, 200, { last: "openai", host: "your private account", claude: { ok: false, detail: "Host logins are unavailable" }, codex: { ok: false, detail: "Host logins are unavailable" }, deviceSignIn: false, list: [status()] }));
    register("GET", "/api/providers/:id", (_req, res, { params }) => { provider(params.id!); send(res, 200, status()); });
    register("PUT", "/api/providers/:id", async (req, res, { params }) => {
      provider(params.id!); const body = await readJson(req);
      if (!body || typeof body !== "object" || Object.keys(body).some((k) => !["key", "model"].includes(k))) throw new HttpError(400, "Only an API key and model are accepted; hosted endpoints cannot be changed");
      const entry = await validateInput("openai", body, read() ?? undefined, { allowPrivate: false }) as KeyEntry;
      if (!entry.model) throw new HttpError(400, "Choose a Responses API model available to your OpenAI project");
      identity.assertActive?.(); write({ ...entry, revision: randomUUID() }); send(res, 200, status());
    });
    register("DELETE", "/api/providers/:id", (_req, res, { params }) => { provider(params.id!); write(null); send(res, 200, status()); });
    register("POST", "/api/providers/:id/test", async (req, res, { params }) => {
      provider(params.id!);
      const body = await readJson(req);
      if (body.confirm !== true) throw new HttpError(400, "Confirm the provider-paid test request");
      if (tests.has(identity.account) || isBusy(identity.account)) throw new HttpError(409, "An AI request is already running. Wait or stop it before testing.");
      const entry = read(), input = connection(true), abort = new AbortController();
      tests.set(identity.account, { session: identity.session, abort });
      const stop = () => abort.abort(); res.on("close", stop);
      const validity = setInterval(() => { try { identity.assertActive?.(); } catch { stop(); } }, 250);
      try {
        for await (const _ of infer({ ...input, message: "Reply with OK to test this connection.", signal: abort.signal })) {
          identity.assertActive?.();
          if (abort.signal.aborted) throw new HttpError(409, "Connection changed. Test again.");
        }
        identity.assertActive?.();
        if (abort.signal.aborted || read()?.revision !== entry?.revision) throw new HttpError(409, "Connection changed. Test again.");
        write({ ...entry!, tested: new Date().toISOString() }, false); send(res, 200, status());
      } catch (e) {
        if (!abort.signal.aborted && read()?.revision === entry?.revision) {
          const { tested: _, ...untested } = entry!; write(untested, false);
        }
        throw e;
      } finally { clearInterval(validity); tests.delete(identity.account); res.off("close", stop); abort.abort(); }
    });
    return { connection };
  } };
}
