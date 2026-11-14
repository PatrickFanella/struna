/**
 * Capture the same views every time, from a scratch copy of the fixture vault,
 * so screenshots are comparable with the round 10 mockup screenshots.
 *
 *   node scripts/capture.ts [output-dir] [view ...]
 *
 * Needs a production build (`pnpm build`) and Chromium at CHROMIUM (default /usr/bin/chromium).
 * Phone is 390×844 at 2x and iPad 820×1180 at 1x, in light and dark.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import { chromium, type Page } from "playwright-core";

const root = join(import.meta.dirname, "..");
const out = resolve(process.argv[2] ?? join(root, "captures"));
const only = new Set(process.argv.slice(3).filter((a) => !a.startsWith("size=")));
const sizes = new Set(process.argv.slice(3).filter((a) => a.startsWith("size=")).map((a) => a.slice(5)));
const env = join(out, "env");
const port = Number(process.env.CAPTURE_PORT ?? 5187);
const base = `http://localhost:${port}`;

rmSync(out, { recursive: true, force: true });
mkdirSync(env, { recursive: true });
// CAPTURE_VAULT: a vault to copy instead of the fixtures (copied, never written in place).
if (process.env.CAPTURE_VAULT) {
  const thread = "001 Projects/Threads/Guitar";
  cpSync(join(process.env.CAPTURE_VAULT, thread), join(env, "vault", thread), { recursive: true });
} else cpSync(join(root, "server/fixtures/vault"), join(env, "vault"), { recursive: true });
if (process.env.CAPTURE_MEDIA) cpSync(process.env.CAPTURE_MEDIA, join(env, "media"), { recursive: true });
else mkdirSync(join(env, "media"));

async function startServer(): Promise<ChildProcess> {
  const child = spawn("node", ["server/index.ts"], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      GUITAR_VAULT_ROOT: join(env, "vault"),
      GUITAR_MEDIA_ROOT: process.env.CAPTURE_MEDIA_LIVE ?? join(env, "media"),
      GUITAR_STATE_DIR: join(env, "state"),
      GUITAR_CACHE_DIR: join(env, "cache"),
      GUITAR_NO_SCAN: process.env.GUITAR_NO_SCAN ?? "",
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  for (let i = 0; i < 50; i++) {
    if (await fetch(`${base}/api/health`).then((r) => r.ok, () => false)) {
      // Wait for the startup library scan, so library views are populated.
      for (let j = 0; j < 300; j++) {
        const s = await fetch(`${base}/api/library`).then((r) => r.json(), () => null);
        if (s && !s.scanning) break;
        await new Promise((r) => setTimeout(r, 300));
      }
      return child;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill();
  throw new Error("server did not start");
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

/** Each view starts from a fresh page at the practice screen. */
export const VIEWS: Record<string, (page: Page) => Promise<void>> = {
  practice: async () => {},
  "practice-session": async (page) => {
    await page.getByRole("button", { name: /^Full session/ }).click();
    await page.getByRole("button", { name: /^Next stage/ }).click();
    await page.getByRole("button", { name: /^Next stage/ }).click();
    await page.getByRole("button", { name: /^Log clean pass/ }).click();
    await page.getByRole("button", { name: /^Log clean pass/ }).click();
  },
  "lesson-session": async (page) => {
    // A lesson from the library, its sheet music beside it, and the coach.
    await page.goto(`${base}/#library`);
    await page.getByRole("searchbox").fill(process.env.CAPTURE_LESSON ?? "Red River Valley");
    await page.waitForTimeout(800);
    await page.locator(".item").filter({ hasText: "Video" }).first().getByRole("button", { name: "Use in practice" }).click();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: /^Short session/ }).click();
    await page.waitForTimeout(2500);
  },
  "lesson-viewer": async (page) => {
    await page.goto(`${base}/#library`);
    await page.getByRole("searchbox").fill(process.env.CAPTURE_LESSON ?? "Red River Valley");
    await page.waitForTimeout(800);
    await page.locator(".item").filter({ hasText: "Video" }).first().locator(".itemopen").click();
    await page.waitForTimeout(2500);
  },
  "practice-review": async (page) => {
    await page.getByRole("button", { name: /^Short session/ }).click();
    for (let i = 0; i < 3; i++) await page.getByRole("button", { name: /^Next stage/ }).click();
    await page.getByRole("button", { name: /^Finish/ }).click();
  },
  tuner: async (page) => {
    await page.getByRole("button", { name: "Tuner", exact: true }).click();
    await page.waitForTimeout(2500);
  },
  metronome: async (page) => {
    await page.getByRole("button", { name: "Tuner", exact: true }).click();
    await page.getByRole("tab", { name: "Metronome" }).click();
  },
  chat: async (page) => {
    await page.getByRole("button", { name: "Coach", exact: true }).click();
  },
  library: async (page) => {
    await page.goto(`${base}/#library`);
  },
  tabs: async (page) => {
    await page.goto(`${base}/#tabs`);
  },
};

const SIZES = [
  { name: "desktop", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  { name: "phone", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: "ipad", viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
  { name: "ipadland", viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
];

const server = await startServer();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", ...(process.env.CAPTURE_AUDIO ? [`--use-file-for-fake-audio-capture=${process.env.CAPTURE_AUDIO}`] : [])] });
try {
  for (const size of SIZES.filter((s) => !sizes.size || sizes.has(s.name))) {
    for (const scheme of ["light", "dark"] as const) {
      const ctx = await browser.newContext({ ...size, colorScheme: scheme, permissions: ["microphone"] });
      for (const [name, go] of Object.entries(VIEWS)) {
        if (only.size && !only.has(name)) continue;
        const page = await ctx.newPage();
        try {
          await page.goto(`${base}/#practice`);
          await settle(page);
          await go(page);
          await settle(page);
          await page.screenshot({ path: join(out, `${size.name}-${name}-${scheme}.png`) });
          console.log(`captured ${size.name}-${name}-${scheme}`);
        } catch (e) {
          console.warn(`skipped ${size.name}-${name}-${scheme}: ${(e as Error).message.split("\n")[0]}`);
        }
        await page.close();
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  server.kill();
  rmSync(env, { recursive: true, force: true });
}
