/** Scratch-only visual foundation checks for #89. Run after pnpm build.
 * node scripts/verify-visual-system.ts [evidence-directory]
 * Owns a temporary Studio, a free loopback port and one browser; no model or owner data.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { normalizeProfile } from "../server/generic/studio.ts";
import { starterPlan } from "../server/generic/starter.ts";

const root = resolve(import.meta.dirname, "..");
const scratch = mkdtempSync(join(tmpdir(), "struna-visual-"));
const evidence = resolve(process.argv[2] ?? join(scratch, "evidence"));
const home = join(scratch, "studio");
mkdirSync(join(home, "materials"), { recursive: true });
mkdirSync(join(home, "plan"));
mkdirSync(evidence, { recursive: true });
const profile = normalizeProfile({}, new Date().toISOString());
const plan = starterPlan(profile, "2026-11-15");
writeFileSync(join(home, "profile.json"), JSON.stringify(profile));
writeFileSync(join(home, "materials", "open-strings.md"), "# Open strings\n\nPlay one open string slowly. Let each note ring.\n\n```text\ne|--0---0---0---0--|\nB|----------------|\nG|----------------|\nD|----------------|\nA|----------------|\nE|----------------|\n```\n");
for (const kind of plan.sessions) for (const stage of kind.stages) stage.material = { file: "materials/open-strings.md" };
plan.materials = [{ label: "Open strings", file: "materials/open-strings.md" }];
writeFileSync(join(home, "plan", "plan.json"), JSON.stringify(plan));

const socket = createServer();
socket.listen(0, "127.0.0.1");
await once(socket, "listening");
const port = (socket.address() as { port: number }).port;
await new Promise<void>((resolve) => socket.close(() => resolve()));
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["server/index.ts"], {
  cwd: root,
  env: { ...process.env, NODE_ENV: "production", HOST: "127.0.0.1", PORT: String(port),
    STRUNA_MODE: "studio", STRUNA_HOME: home, STRUNA_STATE_DIR: join(scratch, "state"),
    STRUNA_CACHE_DIR: join(scratch, "cache"), STRUNA_LIBRARY_DIRS: "", STRUNA_TABS_DIR: "",
    STRUNA_COACH_HOST_LOGINS: "0", STRUNA_COACH_DEVICE_SIGNIN: "0", STRUNA_COACH_WEB: "0",
    STRUNA_VAULT_ROOT: join(scratch, "vault"), STRUNA_MEDIA_ROOT: join(scratch, "media"),
    CLAUDE_BIN: "/bin/false", CODEX_BIN: "/bin/false", EDGE_SECRET_FILE: "", SOCKET_PATH: "", REQUIRE_USER: "", ALLOWED_HOSTS: "" },
  stdio: "ignore",
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const errors: string[] = [];
const results: object[] = [];
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error("scratch server exited");
    if (await fetch(`${base}/api/health`).then((r) => r.ok, () => false)) { ready = true; break; }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(ready, "scratch server must answer");
  const token = readFileSync(join(scratch, "state", "access-token"), "utf8").trim();
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : chromium.executablePath()), headless: true });
  for (const [width, height] of [[320, 700], [390, 844], [844, 390], [820, 1180], [1153, 814], [1440, 900]]) {
    for (const choice of ["light", "dark", "device-light", "device-dark"]) {
      const dark = choice.endsWith("dark");
      const context = await browser.newContext({ viewport: { width: width!, height: height! }, colorScheme: dark ? "dark" : "light", reducedMotion: "reduce", extraHTTPHeaders: { "x-struna-token": token } });
      const page = await context.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      await context.route("**/*", (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
      await page.addInitScript((choice) => {
        if (!choice.startsWith("device")) localStorage.setItem("struna.theme", choice);
      }, choice);
      await page.goto(base);
      await page.locator(".gstart").waitFor();
      await page.evaluate(() => document.fonts.ready);
      const metrics = await page.evaluate(async () => {
        await Promise.all([document.fonts.load('16px "Jost"'), document.fonts.load('16px "Atkinson Hyperlegible Next"'), document.fonts.load('700 16px "Atkinson Hyperlegible Next"')]);
        const css = getComputedStyle(document.documentElement);
        const color = (key: string) => {
          const el = document.createElement("span"); el.style.color = `var(--${key})`; document.body.append(el);
          const rgb = getComputedStyle(el).color; el.remove(); return rgb;
        };
        const ratios: Record<string, number> = {};
        const luminance = (rgb: string) => {
          const parts = rgb.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((n) => { const x = n / 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; });
          return parts[0]! * .2126 + parts[1]! * .7152 + parts[2]! * .0722;
        };
        for (const [fg, bg] of [["ink", "page"], ["ink", "panel"], ["muted", "page"], ["muted", "panel"], ["on-primary", "primary"], ["on-ring", "ring"], ["err", "panel"], ["ring-ink", "page"], ["ink", "accent-peach"], ["ink", "accent-butter"], ["ink", "accent-green"], ["ink", "accent-pink"], ["focus", "page"], ["focus", "panel"], ["edge", "panel"], ["edge", "page"]]) {
          const a = luminance(color(fg!)), b = luminance(color(bg!)); ratios[`${fg}/${bg}`] = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
        }
        return { page: color("page"), ink: color("ink"), scheme: css.colorScheme, ratios,
          fonts: [...document.fonts].filter((f) => f.status === "loaded").map((f) => `${f.family}:${f.weight}`),
          overflow: document.documentElement.scrollWidth > innerWidth,
          mark: getComputedStyle(document.querySelector(".brandmark")!, "::before").maskImage,
          primaryRadius: getComputedStyle(document.querySelector(".gstart .btn.primary")!).borderRadius };
      });
      assert.equal(metrics.scheme, dark ? "dark" : "light", `${width} ${choice}: theme`);
      assert.equal(metrics.overflow, false, `${width} ${choice}: overflow`);
      assert.equal(metrics.primaryRadius, "14px");
      assert(metrics.fonts.some((f) => f.includes("Jost")) && metrics.fonts.some((f) => f.includes("Atkinson Hyperlegible Next")), "local faces loaded");
      assert(metrics.mark.includes("app-mark.svg"));
      for (const [pair, ratio] of Object.entries(metrics.ratios)) assert(ratio >= (/^(focus|edge)\//.test(pair) ? 3 : 4.5), `${choice}: ${pair} contrast ${ratio}`);
      await page.keyboard.press("Tab");
      const focus = await page.evaluate(() => { const s = getComputedStyle(document.activeElement!); return { style: s.outlineStyle, width: s.outlineWidth }; });
      assert.equal(focus.style, "solid"); assert.equal(focus.width, "3px");
      const mark = await context.request.get(`${base}/brand/app-mark.svg`);
      assert((await mark.text()).includes('transform="translate(28 0) scale(-1 1)"'));
      if ([320, 1440].includes(width!) && !choice.startsWith("device")) await page.screenshot({ path: join(evidence, `${width}-${choice}-today.png`), fullPage: true });
      // Explicit selection persists even when the device changes to the opposite scheme.
      if (!choice.startsWith("device")) {
        await page.emulateMedia({ colorScheme: dark ? "light" : "dark" });
        await page.reload();
        assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), dark ? "dark" : "light");
      }
      results.push({ width, height, choice, ...metrics, focus });
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
  writeFileSync(join(evidence, "visual-system.json"), JSON.stringify({ scratch: true, cases: results, pageErrors: errors, limits: "Local Chromium only; no native zoom, Safari, screen-reader speech or hardware audio qualification." }, null, 2));
  console.log(`PASS: ${results.length} viewport/theme cases, local fonts, mark, text/control contrast, focus, persistence and overflow. Evidence: ${evidence}`);
} finally {
  await browser?.close();
  if (child.exitCode === null && child.signalCode === null) {
    const stopped = once(child, "exit");
    child.kill("SIGTERM");
    await stopped;
  }
}
