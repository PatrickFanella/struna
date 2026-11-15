import { lookup as dnsLookup } from "node:dns/promises";
import { chmodSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";

import { HttpError } from "../http.ts";
import { isPublicAddress } from "./fetch.ts";

/**
 * The coaches' saved credentials (studio mode): `<state>/coach-providers.json`, mode 600 in a folder
 * with mode 700, written whole to a temp file and renamed. It is not encrypted: the key would have to sit
 * next to it. A secret leaves this file only in a coach CLI's environment, never in a response.
 */
export const STORE_FILE = "coach-providers.json";

export type KeyEntry = { key: string; model: string | null; saved: string };
export type BedrockEntry = KeyEntry & { region: string };
export type EndpointEntry = { preset: PresetId; baseUrl: string; key: string | null; header: "bearer" | "api-key"; model: string; saved: string };
export type ChatgptEntry = { model: string | null; saved: string };
export type Stored = { version: 1; anthropic?: KeyEntry; openai?: KeyEntry; bedrock?: BedrockEntry; endpoint?: EndpointEntry; chatgpt?: ChatgptEntry };
/** The ids that keep something in the file. */
export type StoredId = "anthropic" | "openai" | "bedrock" | "endpoint" | "chatgpt";
export type Entry = KeyEntry | BedrockEntry | EndpointEntry | ChatgptEntry;

export type PresetId = "openrouter" | "ollama" | "lmstudio" | "azure" | "xai" | "groq" | "other";
/** Endpoint presets: they fill in the form; the player can change the address and the header. */
export const PRESETS: { id: PresetId; label: string; baseUrl: string; header: "bearer" | "api-key"; key: "required" | "none" | "optional" }[] = [
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", header: "bearer", key: "required" },
  // A local Ollama takes no key; Ollama's cloud (https://ollama.com/v1) needs the account's.
  { id: "ollama", label: "Ollama", baseUrl: "http://127.0.0.1:11434/v1", header: "bearer", key: "optional" },
  { id: "lmstudio", label: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1", header: "bearer", key: "none" },
  { id: "azure", label: "Azure OpenAI", baseUrl: "https://RESOURCE.openai.azure.com/openai/v1", header: "api-key", key: "required" },
  { id: "xai", label: "xAI", baseUrl: "https://api.x.ai/v1", header: "bearer", key: "required" },
  { id: "groq", label: "Groq", baseUrl: "https://api.groq.com/openai/v1", header: "bearer", key: "required" },
  { id: "other", label: "Other", baseUrl: "", header: "bearer", key: "optional" },
];

const KEY_RE = /^[^\s\x00-\x1f\x7f]{8,4096}$/u;
const MODEL_RE = /^[A-Za-z0-9][\w.:/@-]{0,199}$/;
const REGION_RE = /^[a-z]{2}(-[a-z]+)+-\d$/;

/** What the browser may see of a secret: its last four characters, or only that one is saved when it is short. */
export function hint(secret: string): string {
  return secret.length < 12 ? "saved" : `…${secret.slice(-4)}`;
}

export function credentialStore(stateDir: string) {
  const file = join(stateDir, STORE_FILE);
  const cli = join(stateDir, "cli");
  const ensureDir = (d: string) => {
    mkdirSync(d, { recursive: true, mode: 0o700 });
    chmodSync(d, 0o700);
  };
  ensureDir(stateDir);
  ensureDir(cli);

  const read = (): Stored => {
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return { version: 1 };
      throw new HttpError(409, `${STORE_FILE} cannot be read (${(e as NodeJS.ErrnoException).code ?? "error"})`);
    }
    if (statSync(file).mode & 0o077) {
      chmodSync(file, 0o600);
      console.warn(`${file} could be read by other accounts; it is now mode 600.`);
    }
    let v: unknown;
    try {
      v = JSON.parse(raw);
    } catch {
      v = null;
    }
    if (!v || typeof v !== "object" || Array.isArray(v) || (v as Stored).version !== 1) throw new HttpError(409, `${STORE_FILE} in the state folder is not valid; fix it or delete it to start again`);
    return v as Stored;
  };

  const write = (data: Stored) => {
    ensureDir(stateDir);
    const tmp = join(stateDir, `.${STORE_FILE}-${randomBytes(6).toString("hex")}.tmp`);
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    renameSync(tmp, file);
    chmodSync(file, 0o600);
  };

  return {
    file,
    read,
    get<K extends StoredId>(id: K): Stored[K] {
      return read()[id];
    },
    put<K extends StoredId>(id: K, entry: NonNullable<Stored[K]>): void {
      write({ ...read(), [id]: entry });
    },
    remove(id: StoredId): void {
      const data = read();
      if (!(id in data)) return;
      delete data[id];
      write(data);
    },
    /** Every saved secret, for redacting error text. */
    secrets(): string[] {
      let data: Stored;
      try {
        data = read();
      } catch {
        return [];
      }
      return [data.anthropic?.key, data.openai?.key, data.bedrock?.key, data.endpoint?.key].filter((k): k is string => typeof k === "string" && k.length > 0);
    },
    /** A coach's own config folder (`CLAUDE_CONFIG_DIR` or `CODEX_HOME`), created with mode 700. */
    dir(id: string): string {
      const d = join(cli, id);
      ensureDir(d);
      return d;
    },
  };
}

export type CredentialStore = ReturnType<typeof credentialStore>;
export type Lookup = (host: string) => Promise<string[]>;

const bad = (message: string) => new HttpError(400, message);

function keyOf(raw: unknown, current: string | null | undefined, required: boolean): string | null {
  if (raw === undefined || raw === null || raw === "") {
    if (current) return current;
    if (required) throw bad("Enter the key.");
    return null;
  }
  if (typeof raw !== "string" || !KEY_RE.test(raw)) throw bad("A key is 8 to 4096 characters with no spaces or line breaks.");
  return raw;
}

function modelOf(raw: unknown, current: string | null | undefined): string | null {
  if (raw === undefined) return current ?? null;
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string" || !MODEL_RE.test(raw)) throw bad("A model name starts with a letter or digit and has only letters, digits and . _ : / @ -, up to 200 characters.");
  return raw;
}

/**
 * A provider's base URL, checked: http or https, no user name, password, query or `#` part, the trailing
 * slash dropped. An address on loopback, a private network, CGNAT, link-local or unique-local space, and
 * plain http, need `allowPrivate` (a locally hosted instance, or STRUNA_COACH_PRIVATE_ENDPOINTS=1). A key
 * is never sent over plain http to a public address. Checked on save and again before every turn.
 */
export async function checkBaseUrl(raw: unknown, o: { allowPrivate: boolean; key: boolean; lookup?: Lookup | undefined }): Promise<string> {
  if (typeof raw !== "string" || !raw.trim()) throw bad("Enter the provider's base URL.");
  const text = raw.trim();
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    throw bad("The base URL is not a valid web address.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw bad("The base URL must start with https:// (or http:// for a server on this computer or your network).");
  if (u.username || u.password) throw bad("Put the key in the key field, not in the base URL.");
  if (text.includes("?") || text.includes("#")) throw bad("The base URL may not have a query string or a # part.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : o.lookup ? await o.lookup(host) : (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);
  } catch {
    addresses = [];
  }
  if (!addresses.length) throw bad("The base URL's host name was not found.");
  const pub = addresses.every(isPublicAddress);
  if (!pub && !o.allowPrivate) throw bad("This instance only reaches providers on the public internet. An address on this computer or a private network needs STRUNA_COACH_PRIVATE_ENDPOINTS=1.");
  if (u.protocol === "http:" && !o.allowPrivate) throw bad("Use an https:// address.");
  if (u.protocol === "http:" && pub && o.key) throw bad("A key is never sent over plain http to a public address: use https://.");
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
}

/**
 * The entry a PUT asks for, checked against the rules for its id. Messages never quote the input.
 * A missing or empty key keeps the saved one; a missing model keeps the saved one, an empty one clears it.
 */
export async function validateInput(id: StoredId, body: any, current: Entry | undefined, o: { allowPrivate: boolean; lookup?: Lookup | undefined; now?: Date }): Promise<Entry> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw bad("Send the settings as a JSON object.");
  const saved = (o.now ?? new Date()).toISOString();
  const cur = current as Partial<KeyEntry & BedrockEntry & EndpointEntry> | undefined;
  if (id === "chatgpt") return { model: modelOf(body.model, cur?.model), saved };
  if (id === "anthropic" || id === "openai") return { key: keyOf(body.key, cur?.key, true)!, model: modelOf(body.model, cur?.model), saved };
  if (id === "bedrock") {
    const region = body.region === undefined && cur?.region ? cur.region : body.region;
    if (typeof region !== "string" || !REGION_RE.test(region)) throw bad("Enter an AWS region such as us-east-1.");
    return { key: keyOf(body.key, cur?.key, true)!, region, model: modelOf(body.model, cur?.model), saved };
  }
  // endpoint
  const preset = PRESETS.find((p) => p.id === (body.preset ?? cur?.preset ?? "other"));
  if (!preset) throw bad("Choose one of the listed providers, or Other.");
  const header = body.header ?? cur?.header ?? preset.header;
  if (header !== "bearer" && header !== "api-key") throw bad('The key header is "bearer" or "api-key".');
  const rawUrl = body.baseUrl ?? cur?.baseUrl;
  // A saved key is kept only for the same address: it must never go to another server, or to one that takes no key.
  const kept = preset.key !== "none" && cur?.baseUrl && sameOrigin(rawUrl, cur.baseUrl) ? cur.key : null;
  const key = preset.key === "none" ? null : keyOf(body.key, kept, preset.key === "required" || header === "api-key");
  const model = modelOf(body.model, cur?.model);
  if (!model) throw bad("Enter the model name the provider uses.");
  // The Azure preset's template address resolves (Azure answers for any name) but is nobody's resource.
  if (typeof rawUrl === "string" && /^https?:\/\/resource\.openai\.azure\.com(\/|$)/i.test(rawUrl.trim())) throw bad("Put your Azure resource's name in place of RESOURCE in the base URL.");
  const baseUrl = await checkBaseUrl(rawUrl, { allowPrivate: o.allowPrivate, key: Boolean(key), lookup: o.lookup });
  return { preset: preset.id, baseUrl, key, header, model, saved };
}

function sameOrigin(a: unknown, b: string): boolean {
  try {
    return new URL(String(a).trim()).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/** Whether a new entry changes more than its key: then the coach's earlier sessions belong to another setup. */
export function setupChanged(prev: Entry | undefined, next: Entry): boolean {
  if (!prev) return true;
  const strip = ({ key: _k, saved: _s, ...rest }: Record<string, unknown>) => JSON.stringify(Object.entries(rest).sort());
  return strip(prev as Record<string, unknown>) !== strip(next as Record<string, unknown>);
}

const isUnder = (p: string, root: string) => p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);
const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};

/**
 * Why the studio mode must not start with these folders, or null. The coach reads the studio and the
 * library folders (Claude's working directory and `--add-dir`; Codex's profile, which keeps /tmp open when
 * a library folder is under it), so the state folder, with the saved keys and the coaches' own logins,
 * must lie outside all of them. And none of those folders may hold the home folder or a login folder.
 */
export function placementProblem(o: { stateDir: string; studio: string; libraryDirs: string[]; home: string }): string | null {
  const state = real(o.stateDir);
  const readable = [{ name: "the studio folder", dir: real(o.studio) }, ...o.libraryDirs.map((d) => ({ name: "a library folder", dir: real(d) }))];
  for (const r of readable) {
    if (isUnder(state, r.dir)) return `STRUNA_STATE_DIR (${o.stateDir}) is inside ${r.name} (${r.dir}), which the coach can read. Move it out, so the coach cannot read the saved keys and logins.`;
  }
  const tmps = [...new Set(["/tmp", tmpdir()].map(real))];
  if (tmps.some((t) => isUnder(state, t)) && readable.some((r) => r.name !== "the studio folder" && tmps.some((t) => isUnder(r.dir, t)))) {
    return `STRUNA_STATE_DIR (${o.stateDir}) is under the temp folder, and a library folder there keeps it readable to the coach. Move the state folder out of the temp folder.`;
  }
  const home = real(o.home);
  const logins = [".claude", ".codex", ".ssh"].map((d) => real(join(home, d)));
  for (const r of readable) {
    for (const t of [home, ...logins]) {
      if (isUnder(t, r.dir)) return `${r.name} (${r.dir}) is or contains ${t}, so the coach could read logins and keys. Choose a folder inside it instead.`;
    }
    for (const t of logins) {
      if (isUnder(r.dir, t)) return `${r.name} (${r.dir}) is inside ${t}, so the coach could read logins and keys. Choose another folder.`;
    }
  }
  return null;
}
