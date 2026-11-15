import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Studio } from "../generic/studio.ts";
import { validateInput, type KeyEntry } from "../generic/credentials.ts";
import { HttpError, readJson, send, type route } from "../http.ts";
import type { PracticeIdentity } from "./practice.ts";

/** The master key never enters a model-readable workspace or an account response. */
export function accountCredentials(root: string, invalidate: (account: string) => void) {
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
  return { register(s: Studio, identity: PracticeIdentity, register: typeof route) {
    const file = join(root, "accounts", identity.account, "private", "openai.enc");
    const aad = Buffer.from(`struna:account-credential:v1:${identity.account}:openai`);
    const read = (): KeyEntry | null => {
      if (!existsSync(file)) return null;
      try {
        const bytes = readFileSync(file), decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
        decipher.setAAD(aad); decipher.setAuthTag(bytes.subarray(12, 28));
        const entry = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
        return entry;
      } catch { throw new HttpError(503, "AI connection unavailable. Disconnect and reconnect it."); }
    };
    const write = (entry: KeyEntry | null) => {
      const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(aad);
      const encrypted = Buffer.concat([cipher.update(JSON.stringify(entry)), cipher.final()]);
      const tmp = file + "." + randomUUID();
      writeFileSync(tmp, Buffer.concat([nonce, cipher.getAuthTag(), encrypted]), { flag: "wx", mode: 0o600 });
      renameSync(tmp, file);
      invalidate(identity.account);
      // Invalidate resume/proposal authority on every replacement, even the same key/model.
      if (s.db.prepare("SELECT 1 FROM sqlite_master WHERE name='conversations'").get()) s.db.exec("UPDATE conversations SET thread_id=NULL");
      if (s.db.prepare("SELECT 1 FROM sqlite_master WHERE name='plan_proposals'").get()) s.db.exec("UPDATE plan_proposals SET state='dismissed', candidate='', base=NULL WHERE state='pending'");
    };
    const status = () => { const entry = read(); return { id: "openai", connected: Boolean(entry), model: entry?.model ?? null, saved: entry?.saved ?? null, executionEnabled: false }; };
    const provider = (id: string) => { if (id !== "openai") throw new HttpError(400, "Only a player-owned OpenAI API connection is supported in hosted mode"); };
    register("GET", "/api/providers", (_req, res) => send(res, 200, { last: "openai", host: "your private account", claude: { ok: false, detail: "Host logins are unavailable" }, codex: { ok: false, detail: "Host logins are unavailable" }, deviceSignIn: false, list: [{ ...status(), label: "OpenAI API key", ok: false, detail: "Connect your AI is not enabled yet", web: false }] }));
    register("GET", "/api/providers/:id", (_req, res, { params }) => { provider(params.id!); send(res, 200, status()); });
    register("PUT", "/api/providers/:id", async (req, res, { params }) => {
      provider(params.id!); const body = await readJson(req);
      if (!body || typeof body !== "object" || Object.keys(body).some((k) => !["key", "model"].includes(k))) throw new HttpError(400, "Only an API key and model are accepted; hosted endpoints cannot be changed");
      const entry = await validateInput("openai", body, read() ?? undefined, { allowPrivate: false }) as KeyEntry;
      identity.assertActive?.(); write(entry); send(res, 200, status());
    });
    register("DELETE", "/api/providers/:id", (_req, res, { params }) => { provider(params.id!); write(null); send(res, 200, { id: "openai", connected: false, executionEnabled: false }); });
  } };
}
