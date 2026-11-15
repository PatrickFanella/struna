/** Scratch two-identity UI walk for #88. Run after pnpm build. No real issuer or credentials. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { createHostedAuth } from "../server/auth/hosted.ts";
import { hostedPractice } from "../server/auth/practice.ts";
import { fail } from "../server/http.ts";

const scratch = mkdtempSync(join(tmpdir(), "struna-account-ui-"));
const origin = "https://practice.example";
const auth = createHostedAuth({ stateDir: scratch, origin, practice: hostedPractice(scratch, [], "UTC"), adapter: {
  issuer: "https://identity.example", async begin(state) { return `https://identity.example/?state=${state}`; },
  async finish(url) { return { subject: url.searchParams.get("code")! }; },
} });
const embedded = !process.argv.includes("--without-bootstrap");
const dist = resolve(import.meta.dirname, "../dist");
const server = createServer(async (req, res) => { try {
  const url = new URL(req.url!, origin);
  if (await auth.handle(req, res, url)) return;
  if (url.pathname === "/") {
    const source = readFileSync(join(dist, "index.html"), "utf8");
    const html = !embedded ? source : source.replace("</head>", `<script id="app-info" type="application/json">${JSON.stringify(await auth.info(req))}</script></head>`);
    res.setHeader("content-type", "text/html"); res.end(html); return;
  }
  const path = resolve(dist, "." + url.pathname);
  if (!path.startsWith(dist + "/")) throw new Error("Invalid fixture path");
  res.setHeader("content-type", ({ ".js": "application/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2" } as Record<string, string>)[extname(path)] ?? "application/octet-stream");
  res.end(readFileSync(path));
} catch (e) { fail(res, e); } });
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : chromium.executablePath()) });
try {
  const players = [];
  for (const name of ["Alice", "Bob"]) {
    const start = await fetch(base + "/auth/login", { method: "POST", headers: { origin, "x-struna": "1" } });
    const state = new URL((await start.json()).redirect).searchParams.get("state");
    const finish = await fetch(`${base}/auth/callback?state=${state}&code=${name}`, { redirect: "manual", headers: { cookie: start.headers.getSetCookie()[0]!.split(";")[0]! } });
    const token = finish.headers.getSetCookie().find((v) => v.startsWith("__Host-struna-session="))!.split(";")[0]!.split("=")[1]!;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addCookies([{ name: "__Host-struna-session", value: token, domain: "practice.example", path: "/", secure: true, httpOnly: true, sameSite: "Lax" }]);
    await context.route(origin + "/**", async (route) => {
      const request = route.request();
      const response = await fetch(base + new URL(request.url()).pathname + new URL(request.url()).search, { method: request.method(), headers: await request.allHeaders(), ...(request.postData() ? { body: request.postData()! } : {}) });
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    });
    const page = await context.newPage();
    await page.addInitScript(() => { sessionStorage.setItem("struna.session", '{"kind":"foreign-owner-session"}'); localStorage.setItem("struna.guest", "guest-kept"); });
    await page.goto(origin);
    await page.getByLabel("Your name").fill(name);
    await page.getByRole("button", { name: "Save and build my plan" }).click();
    await page.locator(".practice-choice > .btn").waitFor();
    await page.locator(".practice-choice > .btn").click();
    await page.locator(".session").waitFor();
    const keys = await page.evaluate(() => Object.keys(sessionStorage));
    assert.ok(keys.some((k) => k.startsWith("struna.account.") && k.endsWith("struna.session")));
    assert.equal(await page.evaluate(() => sessionStorage.getItem("struna.session")), '{"kind":"foreign-owner-session"}');
    await page.reload(); await page.locator(".session").waitFor();
    await page.getByRole("button", { name: "End session", exact: true }).click();
    await page.getByRole("button", { name: "Review partial session", exact: true }).click();
    await page.getByText("Optional notes", { exact: true }).click();
    await page.getByLabel("What went well", { exact: true }).fill(name + " private note");
    await page.reload();
    await page.getByText("Optional notes", { exact: true }).click();
    assert.equal(await page.getByLabel("What went well", { exact: true }).inputValue(), name + " private note");
    await page.getByRole("button", { name: "Write the log", exact: true }).click();
    await page.getByRole("heading", { name: "Log written", exact: true }).waitFor();
    const logs = await page.evaluate(async () => { const app = await (await fetch("/api/app")).json(); return (await fetch("/api/logs", { headers: { "x-struna-session": app.session } })).json(); });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].wentWell, name + " private note");
    players.push({ name, keys });
    await context.close();
  }
  console.log(JSON.stringify({ scratch, embedded, players, result: "two private UI sessions restore without owner-state import" }));
} finally { await browser.close(); await new Promise<void>((r) => server.close(() => r())); auth.close(); }
