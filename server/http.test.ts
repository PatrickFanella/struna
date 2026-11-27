import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { test } from "node:test";

import { guard, HttpError, send } from "./http.ts";

const req = (headers: Record<string, string>) => ({ headers }) as unknown as IncomingMessage;
const hosts = { allowedHosts: new Set(["localhost", "127.0.0.1", "[::1]"]) };

function status(fn: () => void): number | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e instanceof HttpError ? e.status : -1;
  }
}

test("guard accepts a loopback host with a port", () => {
  assert.equal(status(() => guard(req({ host: "localhost:5182" }), hosts)), undefined);
});

test("guard rejects an unknown host with 403", () => {
  assert.equal(status(() => guard(req({ host: "evil.example" }), hosts)), 403);
});

test("guard checks Remote-User on the public host when requireUser is set", () => {
  const opts = { allowedHosts: new Set([...hosts.allowedHosts, "guitar.subcult.tv"]), requireUser: "onnwee" };
  assert.equal(status(() => guard(req({ host: "guitar.subcult.tv", "remote-user": "mallory" }), opts)), 403);
  assert.equal(status(() => guard(req({ host: "guitar.subcult.tv" }), opts)), 403);
  assert.equal(status(() => guard(req({ host: "guitar.subcult.tv", "remote-user": "onnwee" }), opts)), undefined);
  // Loopback names are only reachable from Kvant itself, never through the Almaz route.
  assert.equal(status(() => guard(req({ host: "localhost:5182" }), opts)), undefined);
});

test("guard accepts any user in a comma-separated requireUser", () => {
  const opts = { allowedHosts: new Set([...hosts.allowedHosts, "guitar.subcult.tv"]), requireUser: "onnwee, patrick" };
  assert.equal(status(() => guard(req({ host: "guitar.subcult.tv", "remote-user": "onnwee" }), opts)), undefined);
  assert.equal(status(() => guard(req({ host: "guitar.subcult.tv", "remote-user": "patrick" }), opts)), undefined);
  assert.equal(status(() => guard(req({ host: "guitar.subcult.tv", "remote-user": "mallory" }), opts)), 403);
  assert.equal(status(() => guard(req({ host: "guitar.subcult.tv", "remote-user": "" }), opts)), 403);
});

test("send sets the noindex header", () => {
  const headers: Record<string, unknown> = {};
  const res = {
    setHeader(k: string, v: unknown) {
      headers[k.toLowerCase()] = v;
    },
    writeHead(_s: number, h: Record<string, unknown>) {
      for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = v;
      return this;
    },
    end() {},
  } as unknown as ServerResponse;
  send(res, 200, { ok: true });
  assert.equal(headers["x-robots-tag"], "noindex, nofollow");
});

test("with an edge secret, the public host also needs the secret header Caddy adds", () => {
  const opts = { allowedHosts: new Set([...hosts.allowedHosts, "guitar.subcult.tv"]), requireUser: "onnwee", edgeSecret: "s3cret" };
  assert.equal(status(() => guard(req({ host: "guitar.subcult.tv", "remote-user": "onnwee" }), opts)), 403);
  assert.equal(status(() => guard(req({ host: "guitar.subcult.tv", "remote-user": "onnwee", "x-edge-secret": "wrong" }), opts)), 403);
  assert.equal(status(() => guard(req({ host: "guitar.subcult.tv", "remote-user": "onnwee", "x-edge-secret": "s3cret" }), opts)), undefined);
  // Through the tunnel a client can send any Host, so with a secret configured loopback names are not trusted either.
  assert.equal(status(() => guard(req({ host: "localhost" }), opts)), 403);
  assert.equal(status(() => guard(req({ host: "localhost", "remote-user": "onnwee", "x-edge-secret": "s3cret" }), opts)), undefined);
});
