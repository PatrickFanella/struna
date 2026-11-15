import { lookup as dnsLookup } from "node:dns/promises";
import { createServer, type IncomingMessage, request as httpRequest } from "node:http";
import { type AddressInfo, connect, isIP, type Socket } from "node:net";

import { isPublicAddress } from "./fetch.ts";

export type Egress = { url: string; close: () => void };

/** The variables a proxy can come in through; an endpoint run gets its own and none of the server's. */
export const PROXY_VARS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy"];

/** A proxy the server itself was started with: the endpoint run cannot pass through it as well. */
export const upstreamProxy = (env: NodeJS.ProcessEnv = process.env): string | null => PROXY_VARS.slice(0, 6).find((k) => env[k]) ?? null;

/**
 * A forward proxy for one endpoint run, on a loopback port only that run is told about. Codex sends all its
 * traffic through HTTPS_PROXY and HTTP_PROXY, and the proxy lets through only the endpoint's own origin:
 * `CONNECT host:port` for https (TLS stays end to end), an absolute-form request to that origin for http.
 * A redirect to anywhere else is a new request the proxy refuses, so the address rules cannot be skipped
 * by a redirect, and a key in an `api-key` header never reaches another server. The proxy resolves the
 * name itself and connects to the address it checked, so a DNS answer that changes after the check does
 * not count either. Without `allowPrivate`, every address must be public.
 */
export async function endpointProxy(baseUrl: string, o: { allowPrivate: boolean; lookup?: ((host: string) => Promise<string[]>) | undefined }): Promise<Egress> {
  const target = new URL(baseUrl);
  const host = target.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const port = Number(target.port || (target.protocol === "https:" ? 443 : 80));
  const https = target.protocol === "https:";
  const sockets = new Set<Socket>();

  /** The addresses to connect to, all checked; null when the rules refuse them. */
  const resolve = async (): Promise<string[] | null> => {
    let addresses: string[];
    try {
      addresses = isIP(host) ? [host] : o.lookup ? await o.lookup(host) : (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);
    } catch {
      return null;
    }
    if (!addresses.length) return null;
    if (!o.allowPrivate && !addresses.every(isPublicAddress)) return null;
    return addresses;
  };
  const refuse = (what: string) => `Struna refused ${what}: this coach may only reach ${target.origin}.`;

  const server = createServer(async (req: IncomingMessage, res) => {
    let u: URL | null = null;
    try {
      u = new URL(req.url ?? "");
    } catch {}
    // Plain http only, and only to the endpoint's own origin.
    if (https || !u || u.origin !== target.origin) {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end(refuse(u ? `a request to ${u.origin}` : "a request"));
      return;
    }
    const ips = await resolve();
    if (!ips) {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end(refuse(`${host}, which is not a public address`));
      return;
    }
    const headers = { ...req.headers };
    for (const h of ["proxy-connection", "proxy-authorization"]) delete headers[h];
    let sock: Socket;
    try {
      sock = await connectFirst(ips, port);
    } catch {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end(`Struna could not connect to ${target.origin}.`);
      return;
    }
    sockets.add(sock);
    sock.on("close", () => sockets.delete(sock));
    const up = httpRequest({ createConnection: () => sock, method: req.method, path: `${u.pathname}${u.search}`, headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
      res.end();
    });
    req.pipe(up);
  });

  server.on("connect", async (req: IncomingMessage, client: Socket, head: Buffer) => {
    sockets.add(client);
    client.on("close", () => sockets.delete(client));
    client.on("error", () => client.destroy());
    const m = /^\[?([^\]]+?)\]?:(\d+)$/.exec(req.url ?? "");
    if (!https || !m || m[1]!.toLowerCase() !== host || Number(m[2]) !== port) {
      client.end(`HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain\r\n\r\n${refuse(`a connection to ${req.url ?? "?"}`)}`);
      return;
    }
    const ips = await resolve();
    if (!ips) {
      client.end(`HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain\r\n\r\n${refuse(`${host}, which is not a public address`)}`);
      return;
    }
    let up: Socket;
    try {
      up = await connectFirst(ips, port);
    } catch {
      client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      return;
    }
    if (client.destroyed) return void up.destroy();
    sockets.add(up);
    up.on("close", () => sockets.delete(up));
    up.on("error", () => client.destroy());
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length) up.write(head);
    up.pipe(client);
    client.pipe(up);
  });
  server.on("connection", (s: Socket) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });

  await new Promise<void>((r, j) => server.once("error", j).listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => {
      server.close();
      for (const s of sockets) s.destroy();
    },
  };
}

/**
 * A socket to the first of the checked addresses that answers, in order: `localhost` resolves to ::1
 * first, and a local server that listens only on 127.0.0.1 must still be reached.
 */
function connectFirst(addresses: string[], port: number, timeoutMs = 10_000): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const next = (i: number) => {
      if (i >= addresses.length) return reject(new Error("unreachable"));
      const s = connect(port, addresses[i]!);
      const timer = setTimeout(() => s.destroy(new Error("timeout")), timeoutMs);
      s.once("connect", () => {
        clearTimeout(timer);
        s.removeAllListeners("error");
        resolve(s);
      });
      s.once("error", () => {
        clearTimeout(timer);
        s.destroy();
        next(i + 1);
      });
    };
    next(0);
  });
}

/** The proxy variables for an endpoint run's environment: its own proxy for both schemes, and no bypass list. */
export function proxyEnv(url: string): Record<string, string> {
  return { HTTPS_PROXY: url, https_proxy: url, HTTP_PROXY: url, http_proxy: url };
}
