import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHostedAuth } from "./hosted.ts";
import { hostedPractice } from "./practice.ts";
import { fail } from "../http.ts";
export type Player = { cookie: string; account: string; session: string; csrf: string };
export async function testHosted(options: Parameters<typeof hostedPractice>[3] & { now?: () => number } = {}) {
  const root = mkdtempSync(join(tmpdir(), "struna-wave4-")), origin = "https://practice.example";
  const practice = hostedPractice(root, [], "UTC", options);
  const openAuth = () => createHostedAuth({ stateDir: root, origin, practice, ...(options.now ? { now: options.now } : {}), adapter: {
    issuer: "https://identity.example", async begin(state) { return `https://identity.example/?state=${state}`; },
    async finish(url) { return { subject: url.searchParams.get("code")! }; },
  } });
  let auth = openAuth();
  const server = createServer(async (req, res) => { try { if (!await auth.handle(req, res, new URL(req.url!, origin))) res.end(); } catch (e) { fail(res, e); } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = (path: string, player?: Player, method = "GET", body?: unknown, headers = {}) => fetch(base + path, {
    method, headers: { origin, "x-struna": "1", ...(player ? { cookie: player.cookie, "x-struna-session": player.session, "x-csrf-token": player.csrf } : {}), ...headers },
    ...(body === undefined ? {} : { body: typeof body === "string" || body instanceof Uint8Array ? body as BodyInit : JSON.stringify(body) }),
  });
  const signIn = async (subject: string, old?: Player): Promise<Player> => {
    const start = await call("/auth/login", undefined, "POST", {});
    const flow = start.headers.getSetCookie()[0]!.split(";")[0]!;
    const state = new URL((await start.json()).redirect).searchParams.get("state");
    const finish = await fetch(`${base}/auth/callback?state=${state}&code=${subject}`, { headers: { cookie: `${flow}; ${old?.cookie ?? ""}` }, redirect: "manual" });
    const cookie = finish.headers.getSetCookie().find((x) => x.startsWith("__Host-struna-session="))!.split(";")[0]!;
    return { cookie, ...await (await fetch(base + "/api/account", { headers: { cookie } })).json() };
  };
  return { root, base, origin, call, signIn, practice, restartAuth() { auth.close(); auth = openAuth(); }, async close() { await new Promise<void>((r) => server.close(() => r())); auth.close(); rmSync(root, { recursive: true, force: true }); } };
}
