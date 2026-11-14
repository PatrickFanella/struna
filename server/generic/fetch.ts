import { randomBytes } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { createWriteStream } from "node:fs";
import { link, mkdir, unlink } from "node:fs/promises";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { MaterialKind } from "./types.ts";

/** A refusal or failure with a message the player (and the coach) can read. */
export class SaveError extends Error {}

const KIND_EXTS: Record<Exclude<MaterialKind, "link" | "other">, string[]> = {
  pdf: ["pdf"],
  video: ["mp4", "m4v", "mov", "webm", "mkv"],
  audio: ["mp3", "m4a", "wav", "ogg", "flac", "opus"],
  image: ["png", "jpg", "jpeg", "webp", "gif"],
  tab: ["gp", "gp3", "gp4", "gp5", "gpx", "musicxml", "mxl"],
  text: ["md", "txt"],
  epub: ["epub"],
};
const EXT_KIND = new Map<string, MaterialKind>(Object.entries(KIND_EXTS).flatMap(([kind, exts]) => exts.map((e) => [e, kind as MaterialKind] as const)));

/** Extensions a file in `materials/` may have when the app puts it there. */
export const FILE_EXTS: ReadonlySet<string> = new Set(EXT_KIND.keys());
/** What a download may be: everything above but books. */
export const DOWNLOAD_EXTS: ReadonlySet<string> = new Set([...EXT_KIND.keys()].filter((e) => e !== "epub"));

/** The lower-case extension without its dot, or "". */
export function extOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(name);
  return m ? m[1]!.toLowerCase() : "";
}

export function kindOf(name: string): MaterialKind {
  return EXT_KIND.get(extOf(name)) ?? "other";
}

/**
 * A file name stem that is safe inside `materials/`: the last path segment only, no
 * control or reserved characters, no leading dot, at most 120 characters and 200 bytes.
 */
export function cleanStem(raw: string): string {
  let s = (raw.split(/[\\/]/).at(-1) ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, "")
    .replace(/[:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[. ]+/, "")
    .replace(/[. ]+$/, "");
  const chars = [...s].slice(0, 120);
  while (Buffer.byteLength(chars.join("")) > 200) chars.pop();
  s = chars.join("").trim().replace(/[. ]+$/, "");
  return s || "Untitled";
}

/** Split an uploaded or downloaded name into a safe stem and an allowed extension, or refuse. */
export function safeName(raw: string, allowed: ReadonlySet<string> = FILE_EXTS): { stem: string; ext: string } {
  const base = raw.split(/[\\/]/).at(-1) ?? "";
  const ext = extOf(base);
  if (!ext || !allowed.has(ext)) throw new SaveError(ext ? `.${ext} files cannot be added; use ${[...allowed].join(", ")}` : `the file needs an extension; use ${[...allowed].join(", ")}`);
  return { stem: cleanStem(base.slice(0, base.length - ext.length - 1)), ext };
}

/**
 * Give the finished temp file its name: `<stem>.<ext>`, or `<stem> (2).<ext>`… when that
 * exists. A hard link fails when the name is taken, so nothing is ever replaced.
 */
export async function placeFile(tmp: string, dir: string, stem: string, ext: string): Promise<string> {
  try {
    for (let n = 1; n < 1000; n++) {
      const name = n === 1 ? `${stem}.${ext}` : `${stem} (${n}).${ext}`;
      try {
        await link(tmp, join(dir, name));
        return name;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      }
    }
    throw new SaveError("too many files with that name");
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

export const tempName = (what: string) => `.${what}-${randomBytes(8).toString("hex")}.part`;

// Everything that is not the public internet. IPv4-mapped IPv6 addresses match the IPv4 rules.
const blocked = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], // "this network", unspecified
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT, and Tailscale
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, broadcast
] as const)
  blocked.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [
  ["::", 96], // unspecified, loopback, IPv4-compatible
  ["64:ff9b::", 96], // NAT64: an IPv4 address inside
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32], // Teredo
  ["2001:db8::", 32],
  ["2002::", 16], // 6to4: an IPv4 address inside
  ["fc00::", 7], // unique-local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local
  ["ff00::", 8], // multicast
] as const)
  blocked.addSubnet(net, bits, "ipv6");

/** Whether `address` is an IP literal on the public internet. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (!family) return false; // Also refuses scoped addresses such as fe80::1%eth0.
  return !blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

/** Parse a URL the app may fetch: http or https, no credentials, the default port or 80/443. */
export function parseTarget(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new SaveError("not a valid web address");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new SaveError("only http and https addresses can be saved");
  if (u.username || u.password) throw new SaveError("addresses with a user name or password are not fetched");
  if (u.port && u.port !== "80" && u.port !== "443") throw new SaveError("only the standard web ports are fetched");
  if (!u.hostname) throw new SaveError("not a valid web address");
  return u;
}

/**
 * Test seams. Production callers leave this out: there is no way to reach it from
 * configuration or a request. `lookup` replaces DNS; `dial` changes where the TCP
 * connection goes after the address has passed the checks.
 */
export type Internals = {
  lookup?: (host: string) => Promise<string[]>;
  dial?: (address: string, port: number) => { host: string; port: number };
};

const hostOf = (u: URL) => u.hostname.replace(/^\[|\]$/g, "");

/** Resolve the host and return one address to connect to; refuse if any answer is not public. */
export async function vetHost(u: URL, t: Internals = {}): Promise<string> {
  const host = hostOf(u);
  let addresses: string[];
  if (isIP(host)) addresses = [host];
  else {
    try {
      addresses = t.lookup ? await t.lookup(host) : (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);
    } catch {
      throw new SaveError(`${host} was not found`);
    }
  }
  if (!addresses.length) throw new SaveError(`${host} was not found`);
  if (!addresses.every(isPublicAddress)) throw new SaveError("that address is on a private or local network; it is not fetched");
  return addresses.find((a) => isIP(a) === 4) ?? addresses[0]!;
}

const TYPE_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/opus": "opus",
  "audio/webm": "webm",
  "video/mp4": "mp4",
  "video/x-m4v": "m4v",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/x-markdown": "md",
  "application/vnd.recordare.musicxml+xml": "musicxml",
  "application/vnd.recordare.musicxml": "mxl",
};
// Types that say nothing: the name must then carry an allowed extension.
const VAGUE = new Set(["", "application/octet-stream", "binary/octet-stream", "application/x-download", "application/download", "application/force-download", "application/zip", "application/x-zip-compressed", "application/xml", "text/xml", "application/x-guitar-pro", "application/x-gtp"]);
const WEB_PAGE = "this is a web page, not a file; it stays a link";

/** The file name a `Content-Disposition` header gives, if any. */
export function dispositionName(header: string | undefined): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;\s]+)/.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1]!);
    } catch {
      /* fall through to the plain form */
    }
  }
  const plain = /filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;\s]+))/.exec(header);
  if (!plain) return null;
  return (plain[1] ?? plain[2] ?? "").replace(/\\(.)/g, "$1") || null;
}

/** Decide the saved file's stem and extension from the response, or refuse it. */
export function nameFor(u: URL, contentType: string | undefined, disposition: string | undefined): { stem: string; ext: string } {
  const type = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
  if (type === "text/html" || type === "application/xhtml+xml") throw new SaveError(WEB_PAGE);
  const typeExt = TYPE_EXT[type];
  if (!typeExt && !VAGUE.has(type)) throw new SaveError(`this is not a kind of file the app keeps (${type})`);
  let last = u.pathname.split("/").filter(Boolean).at(-1) ?? "";
  try {
    last = decodeURIComponent(last);
  } catch {
    /* keep the raw segment */
  }
  const raw = dispositionName(disposition) ?? last;
  const base = raw.split(/[\\/]/).at(-1) ?? "";
  const nameExt = extOf(base);
  if (DOWNLOAD_EXTS.has(nameExt)) return { stem: cleanStem(base.slice(0, base.length - nameExt.length - 1)), ext: nameExt };
  if (!typeExt) throw new SaveError("this is not a kind of file the app keeps (PDF, image, audio, video, Guitar Pro, MusicXML or text)");
  return { stem: cleanStem(base || hostOf(u)), ext: typeExt };
}

export type SaveOptions = {
  /** Largest file kept. Default 200 MB. */
  maxBytes?: number;
  /** Connect and idle timeout. Default 20 s. */
  timeoutMs?: number;
  /** Whole-download limit. Default 15 min. */
  totalMs?: number;
  maxRedirects?: number;
};
export type Saved = { name: string; path: string; size: number; type: string; url: string };

function get(u: URL, address: string, timeoutMs: number, t: Internals): Promise<IncomingMessage> {
  const secure = u.protocol === "https:";
  const port = u.port ? Number(u.port) : secure ? 443 : 80;
  const host = hostOf(u);
  // Connect to the address that passed the checks, not to the name: a second DNS answer cannot differ.
  const target = t.dial?.(address, port) ?? { host: address, port };
  return new Promise((resolve, reject) => {
    const req = (secure ? https : http).request({
      host: target.host,
      port: target.port,
      method: "GET",
      path: `${u.pathname}${u.search}`,
      agent: false,
      headers: { host: u.host, accept: "*/*", "accept-encoding": "identity", "user-agent": "GuitarRoom/1 (saves a file the player asked for)" },
      ...(secure && !isIP(host) ? { servername: host } : {}),
    });
    req.setTimeout(timeoutMs, () => req.destroy(new SaveError("the server took too long to answer")));
    req.on("error", (e) => reject(e instanceof SaveError ? e : new SaveError(`could not connect: ${e.message}`)));
    req.on("response", resolve);
    req.end();
  });
}

/**
 * Download `raw` into `destDir` and return the new file. This fetches an address that
 * came from a person or a model, so it only talks to public hosts on the web ports,
 * follows a few redirects with the same checks at each hop, and keeps only file types
 * the app can show. The file gets a name that does not replace anything.
 */
export async function saveUrl(raw: string, destDir: string, opts: SaveOptions = {}, t: Internals = {}): Promise<Saved> {
  const maxBytes = opts.maxBytes ?? 200 * 1024 * 1024;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const maxRedirects = opts.maxRedirects ?? 3;
  const deadline = Date.now() + (opts.totalMs ?? 15 * 60_000);
  let u = parseTarget(raw);
  for (let hop = 0; ; hop++) {
    const res = await get(u, await vetHost(u, t), timeoutMs, t);
    const status = res.statusCode ?? 0;
    if ([301, 302, 303, 307, 308].includes(status)) {
      res.destroy();
      const to = res.headers.location;
      if (!to) throw new SaveError("the server redirected without saying where");
      if (hop >= maxRedirects) throw new SaveError("too many redirects");
      let next: string;
      try {
        next = new URL(to, u).href;
      } catch {
        throw new SaveError("the server redirected to an address that is not valid");
      }
      u = parseTarget(next);
      continue;
    }
    try {
      if (status !== 200) throw new SaveError(`the server answered ${status}`);
      return await store(res, u, destDir, maxBytes, deadline);
    } finally {
      res.destroy();
    }
  }
}

async function store(res: IncomingMessage, u: URL, destDir: string, maxBytes: number, deadline: number): Promise<Saved> {
  const encoding = (res.headers["content-encoding"] ?? "identity").toLowerCase();
  if (encoding !== "identity") throw new SaveError("the server sent the file compressed; it was not saved");
  const { stem, ext } = nameFor(u, res.headers["content-type"], res.headers["content-disposition"]);
  const mb = Math.round(maxBytes / 1024 / 1024);
  const tooLarge = new SaveError(maxBytes >= 1024 * 1024 ? `the file is larger than ${mb} MB` : "the file is too large");
  if (Number(res.headers["content-length"]) > maxBytes) throw tooLarge;

  await mkdir(destDir, { recursive: true });
  const tmp = join(destDir, tempName("download"));
  let size = 0;
  const check = new Transform({
    transform(chunk: Buffer, _enc, done) {
      // Some servers label a page as a download; the first bytes give it away.
      if (size === 0 && /^\s*<(!doctype html|html[\s>])/i.test(chunk.subarray(0, 512).toString("latin1"))) return done(new SaveError(WEB_PAGE));
      size += chunk.length;
      done(size > maxBytes ? tooLarge : null, chunk);
    },
  });
  const timer = setTimeout(() => res.destroy(new SaveError("the download took too long")), Math.max(0, deadline - Date.now()));
  try {
    await pipeline(res, check, createWriteStream(tmp, { flags: "wx", mode: 0o664 }));
    if (!res.complete) throw new SaveError("the download was cut off");
    if (size === 0) throw new SaveError("the file is empty");
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e instanceof SaveError ? e : new SaveError(`the download failed: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
  const name = await placeFile(tmp, destDir, stem, ext);
  return { name, path: join(destDir, name), size, type: (res.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase(), url: u.href };
}
