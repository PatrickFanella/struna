import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { type AddressInfo, connect } from "node:net";
import { after, test } from "node:test";

import { endpointProxy, proxyEnv, upstreamProxy } from "./egress.ts";

// Two servers on loopback: A is the endpoint, which redirects every request to B, another origin.
const hits: string[] = [];
const b = createServer((req, res) => {
  hits.push(`B ${req.method} ${req.url} api-key=${req.headers["api-key"] ? "yes" : "no"}`);
  res.end('{"AccessKeyId":"INTERNAL"}');
});
await new Promise<void>((r) => b.listen(0, "127.0.0.1", r));
const bPort = (b.address() as AddressInfo).port;
const a = createServer((req, res) => {
  hits.push(`A ${req.method} ${req.url}`);
  res.writeHead(302, { location: `http://127.0.0.1:${bPort}/latest/meta-data/` });
  res.end();
});
await new Promise<void>((r) => a.listen(0, "127.0.0.1", r));
const aPort = (a.address() as AddressInfo).port;
after(() => {
  a.close();
  b.close();
});

/** One request through the proxy, in the absolute form a client sends to an http proxy. */
const viaProxy = (proxy: string, url: string, headers: Record<string, string> = {}) =>
  new Promise<{ status: number; body: string; location?: string | undefined }>((resolve, reject) => {
    const p = new URL(proxy);
    const req = request({ host: p.hostname, port: p.port, method: "POST", path: url, headers: { host: new URL(url).host, ...headers } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body, location: res.headers.location }));
    });
    req.on("error", reject);
    req.end("{}");
  });
/** The proxy's answer to `CONNECT target`, and the socket when it let the tunnel through. */
const tunnel = (proxy: string, target: string) =>
  new Promise<{ line: string; sock: ReturnType<typeof connect> }>((resolve, reject) => {
    const p = new URL(proxy);
    const sock = connect(Number(p.port), p.hostname, () => sock.write(`CONNECT ${target} HTTP/1.1\r\nhost: ${target}\r\n\r\n`));
    let buf = "";
    sock.on("data", function on(c) {
      buf += c.toString();
      if (!buf.includes("\r\n\r\n")) return;
      sock.off("data", on);
      resolve({ line: buf.split("\r\n")[0]!, sock });
    });
    sock.on("error", reject);
  });

test("plain http: the endpoint's own origin passes, its redirect to another origin is refused before anything is sent", async () => {
  const proxy = await endpointProxy(`http://127.0.0.1:${aPort}/v1`, { allowPrivate: true });
  try {
    hits.length = 0;
    const first = await viaProxy(proxy.url, `http://127.0.0.1:${aPort}/v1/responses`, { "api-key": "sk-dummy-0000" });
    assert.equal(first.status, 302, "the endpoint's answer comes back as it was");
    const second = await viaProxy(proxy.url, first.location!, { "api-key": "sk-dummy-0000" });
    assert.equal(second.status, 403);
    assert.match(second.body, /may only reach http:\/\/127\.0\.0\.1:\d+\.$/);
    assert.deepEqual(hits, ["A POST /v1/responses"], "B got nothing, so neither the key nor its body travelled");
  } finally {
    proxy.close();
  }
});

test("https: CONNECT only to the endpoint's host and port; anything else gets 403", async () => {
  // A stands in for the TLS server: the tunnel is raw TCP, so plain HTTP inside it shows it reached A.
  const proxy = await endpointProxy(`https://127.0.0.1:${aPort}/v1`, { allowPrivate: true });
  try {
    hits.length = 0;
    const ok = await tunnel(proxy.url, `127.0.0.1:${aPort}`);
    assert.equal(ok.line, "HTTP/1.1 200 Connection Established");
    const inside = await new Promise<string>((r) => {
      let t = "";
      ok.sock.on("data", (c) => {
        t += c.toString();
        if (t.includes("\r\n\r\n")) r(t);
      });
      ok.sock.write(`GET /v1/models HTTP/1.1\r\nhost: 127.0.0.1\r\nconnection: close\r\n\r\n`);
    });
    assert.match(inside, /^HTTP\/1\.1 302/);
    ok.sock.destroy();
    for (const other of [`127.0.0.1:${bPort}`, "chatgpt.com:443", "api.github.com:443"]) {
      const r = await tunnel(proxy.url, other);
      assert.equal(r.line, "HTTP/1.1 403 Forbidden", other);
      r.sock.destroy();
    }
    // Plain http through an https endpoint's proxy is refused too: no downgrade.
    assert.equal((await viaProxy(proxy.url, `http://127.0.0.1:${aPort}/v1/responses`)).status, 403);
    assert.deepEqual(hits, ["A GET /v1/models"]);
  } finally {
    proxy.close();
  }
});

test("without allowPrivate the proxy resolves the name itself and refuses a private answer (DNS rebinding)", async () => {
  // The name was public when it was checked; by the time Codex connects it points at loopback.
  const proxy = await endpointProxy("https://rebind.example/v1", { allowPrivate: false, lookup: async () => ["127.0.0.1"] });
  try {
    const r = await tunnel(proxy.url, "rebind.example:443");
    assert.equal(r.line, "HTTP/1.1 403 Forbidden");
    r.sock.destroy();
  } finally {
    proxy.close();
  }
});

test("a name with several addresses: the first one that answers is used (localhost is ::1 first, a local server may listen on 127.0.0.1 only)", async () => {
  const lookup = async () => ["::1", "127.0.0.1"];
  const plain = await endpointProxy(`http://local.test:${aPort}/v1`, { allowPrivate: true, lookup });
  const tls = await endpointProxy(`https://local.test:${aPort}/v1`, { allowPrivate: true, lookup });
  try {
    hits.length = 0;
    assert.equal((await viaProxy(plain.url, `http://local.test:${aPort}/v1/responses`)).status, 302);
    const r = await tunnel(tls.url, `local.test:${aPort}`);
    assert.equal(r.line, "HTTP/1.1 200 Connection Established");
    r.sock.destroy();
    assert.deepEqual(hits, ["A POST /v1/responses"]);
  } finally {
    plain.close();
    tls.close();
  }
});

test("the run's proxy variables, and a proxy the server itself was given", () => {
  assert.deepEqual(Object.keys(proxyEnv("http://127.0.0.1:1")).sort(), ["HTTPS_PROXY", "HTTP_PROXY", "http_proxy", "https_proxy"]);
  assert.equal(upstreamProxy({ PATH: "/bin" }), null);
  assert.equal(upstreamProxy({ https_proxy: "http://corp:3128" }), "https_proxy");
  assert.equal(upstreamProxy({ NO_PROXY: "localhost" }), null, "a bypass list alone is not a proxy");
});
