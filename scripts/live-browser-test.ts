/**
 * Drive the DEPLOYED service in a real Chromium, without opening a TCP port: every
 * browser request is answered from the service's Unix socket, with the edge secret
 * and Remote-User that Caddy would add after Authelia. Read-only by design: it never
 * writes a session log or saves a take, and it deletes the one chat it starts.
 *
 *   node scripts/live-browser-test.ts <screenshot-dir> [--chat]
 *
 * Needs Chromium, and to run as the service's own user on Kvant.
 */
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { request } from "node:http";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { chromium, type BrowserContext, type Page } from "playwright-core";
import { nextStage } from "./practice-steps.ts";

const out = resolve(process.argv[2] ?? "live-test");
const withChat = process.argv.includes("--chat");
mkdirSync(out, { recursive: true });
const sock = process.env.SOCKET_PATH ?? `${process.env.XDG_RUNTIME_DIR}/struna/http.sock`;
const secret = readFileSync(join(homedir(), ".config/struna/edge-secret"), "utf8").trim();
const ORIGIN = "https://struna.subcult.tv";
const CHUNK = 4 * 1024 * 1024;
const logsDir = join(homedir(), "Work/Vaults/Ars Malefica/001 Projects/Threads/Guitar/Practice/Logs");
const logsBefore = readdirSync(logsDir).sort().join("|");

function viaSocket(method: string, path: string, headers: Record<string, string>, body?: Buffer): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  return new Promise((ok, fail) => {
    const h: Record<string, string> = { ...headers, host: "struna.subcult.tv", "x-edge-secret": secret, "remote-user": "onnwee" };
    // Open-ended ranges on big media are answered in chunks, as a browser's follow-up requests would be.
    const r = /^bytes=(\d+)-$/.exec(h.range ?? "");
    if (r) h.range = `bytes=${r[1]}-${Number(r[1]) + CHUNK - 1}`;
    const req = request({ socketPath: sock, method, path, headers: h }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const hs: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) if (typeof v === "string" && k !== "transfer-encoding" && k !== "connection") hs[k] = v;
        ok({ status: res.statusCode ?? 0, headers: hs, body: Buffer.concat(chunks) });
      });
    });
    req.on("error", fail);
    req.end(body);
  });
}

const problems: string[] = [];
const results: [string, boolean, string][] = [];
const check = (name: string, pass: boolean, detail = "") => {
  results.push([name, pass, detail]);
  console.log(`${pass ? "OK  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
};

async function wire(ctx: BrowserContext) {
  await ctx.route(`${ORIGIN}/**`, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    try {
      const headers = await req.allHeaders();
      const range = req.method() === "GET" && /\/api\/media\/[^/]+$/.test(u.pathname) && !headers.range ? { ...headers, range: "bytes=0-" } : headers;
      const res = await viaSocket(req.method(), u.pathname + u.search, range, req.postDataBuffer() ?? undefined);
      if (res.status >= 400) problems.push(`${res.status} ${req.method()} ${u.pathname}`);
      await route.fulfill({ status: res.status, headers: res.headers, body: res.body });
    } catch (e) {
      problems.push(`socket ${u.pathname}: ${(e as Error).message}`);
      await route.abort();
    }
  });
}

async function page(ctx: BrowserContext): Promise<Page> {
  const p = await ctx.newPage();
  p.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  p.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) problems.push(`console: ${m.text().slice(0, 200)}`);
  });
  return p;
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium",
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});
try {
  // ---- Desktop, 1440x900, mouse ----
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", permissions: ["microphone"] });
  await wire(desk);
  const p = await page(desk);
  await p.goto(`${ORIGIN}/#practice`);
  await p.getByRole("radio", { name: /Full session/ }).waitFor({ timeout: 15000 });
  check("start screen loads from the live vault", (await p.locator(".meta dd").first().textContent())?.includes("Nine Pound Hammer") ?? false, (await p.locator(".meta dd").nth(1).textContent()) ?? "");
  check("desktop has section links in the header and no bottom bar", (await p.locator(".topnav a").count()) === 3 && !(await p.locator("nav.tabs").isVisible()));
  await p.screenshot({ path: join(out, "1-start.png") });

  // Library
  await p.locator(".topnav a", { hasText: "Library" }).click();
  await p.getByRole("searchbox").fill("Red River Valley");
  await p.waitForTimeout(900);
  const row = p.locator(".item").filter({ hasText: "Video" }).first();
  await row.waitFor();
  check("library search finds the lesson with its sheet-music tag", /sheet/.test((await row.textContent()) ?? ""), ((await row.locator(".itemfacts").textContent()) ?? "").trim());
  await p.screenshot({ path: join(out, "2-library.png") });
  // Thumbnails: lessons with a lesson-folder copy have one.
  await p.getByRole("searchbox").fill("12 Bar Bluegrass in G");
  await p.waitForTimeout(900);
  const img = p.locator(".item img.thumb").first();
  await img.waitFor({ timeout: 5000 }).catch(() => {});
  const thumbOk = await img.evaluate(async (i: HTMLImageElement) => {
    for (let n = 0; n < 20 && !i.complete; n++) await new Promise((r) => setTimeout(r, 100));
    return i.complete && i.naturalWidth > 0;
  }).catch(() => false);
  check("library thumbnail loads", thumbOk);
  await p.getByRole("searchbox").fill("Red River Valley");
  await p.waitForTimeout(900);
  await p.screenshot({ path: join(out, "2-library.png") });

  // Lesson viewer: video with its sheet beside it
  await row.locator(".itemopen").click();
  await p.locator(".pane video").waitFor({ timeout: 20000 });
  await p.locator(".pane .pdf canvas").waitFor({ timeout: 20000 });
  const vid = await p.evaluate(async () => {
    const v = document.querySelector(".pane video") as HTMLVideoElement;
    for (let i = 0; i < 80 && v.readyState < 2; i++) await new Promise((r) => setTimeout(r, 250));
    if (v.readyState < 2) return { ok: false, err: v.error?.message ?? "not ready" };
    v.muted = true;
    await v.play();
    const t0 = v.currentTime;
    await new Promise((r) => setTimeout(r, 2500));
    return { ok: v.currentTime > t0 + 1, d: Math.round(v.duration), w: v.videoWidth, poster: Boolean(v.poster) };
  });
  check("lesson video plays through the live service", vid.ok, JSON.stringify(vid));
  await p.getByRole("button", { name: "70%", exact: true }).click();
  await p.getByRole("button", { name: "5 percent slower" }).click();
  const rate = await p.evaluate(() => (document.querySelector(".pane video") as HTMLVideoElement).playbackRate);
  check("speed steps by 5% (70% then one step slower)", Math.abs(rate - 0.65) < 0.001, `playbackRate ${rate}`);
  await p.getByRole("button", { name: "Set loop start" }).click();
  await p.waitForTimeout(1600);
  await p.getByRole("button", { name: "Set loop end" }).click();
  await p.waitForTimeout(2500);
  const loop = await p.evaluate(() => {
    const v = document.querySelector(".pane video") as HTMLVideoElement;
    return { t: v.currentTime, paused: v.paused };
  });
  const loopLabel = ((await p.getByRole("button", { name: "Set loop end" }).textContent()) ?? "").trim();
  check("A-B loop holds playback inside the loop", !loop.paused && /Loop B \d/.test(loopLabel), `${loopLabel}, now ${loop.t.toFixed(1)} s`);
  await p.evaluate(() => (document.querySelector(".pane video") as HTMLVideoElement).pause());
  const pdf = await p.evaluate(() => {
    const c = document.querySelector(".pane .pdf canvas") as HTMLCanvasElement;
    const box = c.closest(".pdfpage") as HTMLElement;
    return { cssWidth: c.clientWidth, paneWidth: box.clientWidth, filter: getComputedStyle(c).filter };
  });
  check("sheet music opens beside the video, fitted to the pane width, in its own colours", pdf.cssWidth > pdf.paneWidth * 0.85 && pdf.filter === "none", JSON.stringify(pdf));
  check("PDF page controls are on screen", await p.getByRole("button", { name: "Next page" }).isVisible());
  await p.screenshot({ path: join(out, "3-lesson-viewer.png") });

  // Into a session: video, sheet and coach side by side
  await p.getByRole("button", { name: "Use in practice" }).click();
  await p.getByRole("radio", { name: /Short session/ }).click();
    await p.getByRole("button", { name: /^Start \d+ min$/ }).click();
  await p.locator(".session .pane").first().waitFor();
  await p.waitForTimeout(2500);
  const titles = await p.locator(".session .pane:not([hidden]) .panetitle").allTextContents();
  check("session shows video, sheet music and coach side by side", titles.length === 3 && titles.includes("Coach"), titles.join(" | "));
  const fits = await p.evaluate(() => {
    const bar = document.querySelector(".sessionbar")!.getBoundingClientRect();
    const panes = document.querySelector(".panes")!.getBoundingClientRect();
    return { noPageScroll: document.documentElement.scrollHeight <= window.innerHeight + 1, barBottom: Math.round(bar.bottom), panesHeight: Math.round(panes.height), vh: window.innerHeight };
  });
  check("the whole session fits the screen, with the panes taking most of it", fits.noPageScroll && fits.barBottom <= fits.vh && fits.panesHeight > fits.vh * 0.55, JSON.stringify(fits));
  // The timer waits to be started, the coach guides the stage, and Back returns to the earlier stage.
  const clock = p.locator(".session button.clock");
  const t0 = await clock.locator(".t").textContent();
  await p.waitForTimeout(1500);
  check("the stage timer waits until it is started", (await clock.locator(".t").textContent()) === t0 && /tap to start/.test((await clock.locator(".s").textContent()) ?? ""), `${t0}`);
  const guided = await p.locator(".coachline span:not(.coachtag):not(.coachmuted)").first().waitFor({ timeout: 120000 }).then(() => true, () => false);
  const guideText = guided ? ((await p.locator(".coachline span:not(.coachtag):not(.coachmuted)").first().textContent()) ?? "") : ((await p.locator(".coachline").textContent()) ?? "");
  check("the coach gives a note for the stage", guided && guideText.length > 30, guideText.slice(0, 170));
  await clock.click();
  await p.waitForTimeout(1300);
  check("tapping the timer starts it", (await clock.locator(".t").textContent()) !== t0);
  await p.evaluate(() => localStorage.setItem("struna.guide", "off")); // one real coach note is enough for the test
  await p.getByRole("button", { name: "Turn off" }).click();
  await nextStage(p);
  const title2 = await p.locator(".stagetext h1").textContent();
  await p.getByRole("button", { name: "Back", exact: true }).click();
  const title1 = await p.locator(".stagetext h1").textContent();
  check("Back returns to the earlier stage with its timer waiting", title1 !== title2 && /^1\//.test(title1 ?? "") && /tap to start/.test((await clock.locator(".s").textContent()) ?? ""), `${title2} -> ${title1}`);
  await p.screenshot({ path: join(out, "4-session-three-panes.png") });

  // "Use in practice" during the lesson asks before changing it.
  await p.locator(".topnav a", { hasText: "Library" }).click();
  await p.getByRole("button", { name: "Back to the library" }).click().catch(() => {});
  await p.getByRole("searchbox").fill("12 Bar Bluegrass in G");
  await p.waitForTimeout(900);
  await p.locator(".item").filter({ hasText: "Video" }).first().getByRole("button", { name: "Use in practice" }).click();
  const asked = await p.getByRole("dialog", { name: "Use in this lesson" }).waitFor({ timeout: 5000 }).then(() => true, () => false);
  if (asked) await p.getByRole("button", { name: "Replace the lesson material" }).click();
  await p.waitForTimeout(2000);
  const replaced = await p.locator(".session .pane:not([hidden]) .panetitle").allTextContents();
  check("Use in practice asks, then replaces the lesson material and keeps the coach", asked && replaced.some((t) => /12 Bar Bluegrass/i.test(t)) && replaced.includes("Coach") && !replaced.some((t) => /red river/i.test(t)), replaced.join(" | "));
  await p.screenshot({ path: join(out, "4b-replaced.png") });

  // A loop on the session's video, to check later that hiding the view does not reset it.
  await p.evaluate(() => {
    const v = document.querySelector(".session .pane video") as HTMLVideoElement;
    v.muted = true;
    v.currentTime = 5;
  });
  await p.locator(".session").getByRole("button", { name: "Set loop start" }).click();
  await p.evaluate(() => ((document.querySelector(".session .pane video") as HTMLVideoElement).currentTime = 9));
  await p.locator(".session").getByRole("button", { name: "Set loop end" }).click();

  // A Guitar Pro tab in a fourth pane
  await p.getByRole("button", { name: "Add pane" }).click();
  await p.getByRole("menuitem", { name: /Guitar Pro tab/ }).click();
  await p.getByRole("searchbox", { name: "Search" }).fill("nine pound hammer");
  await p.waitForTimeout(900);
  let tabRows = await p.locator(".finderlist button").count();
  if (!tabRows) {
    await p.getByRole("searchbox", { name: "Search" }).fill("wildwood flower");
    await p.waitForTimeout(900);
    tabRows = await p.locator(".finderlist button").count();
  }
  if (!tabRows) {
    await p.getByRole("searchbox", { name: "Search" }).fill("blackbird");
    await p.waitForTimeout(900);
  }
  const tabName = ((await p.locator(".finderlist button .itemtitle").first().textContent()) ?? "").trim();
  await p.locator(".finderlist button").first().click();
  const tabOk = await p.waitForFunction(() => document.querySelectorAll(".pane .tabscroll svg, .pane .tabscroll canvas").length > 0, null, { timeout: 30000 }).then(() => true, () => false);
  const ready = await p.locator(".pane .tabplayer").getByRole("button", { name: "Play" }).waitFor({ timeout: 60000 }).then(() => true, () => false);
  check("a Guitar Pro tab opens in a pane and its player is ready", tabOk && ready, tabName);
  await p.screenshot({ path: join(out, "5-session-with-tab.png") });

  // Tempo row and the metronome
  await p.getByRole("button", { name: /^Log clean pass/ }).click();
  check("clean pass logs", (await p.locator(".passes .dots i.ok").count()) === 1);
  await p.locator(".tempocol").click();
  await p.waitForTimeout(2600);
  const beat = await p.locator(".sessionbar .click").getAttribute("aria-label");
  await p.locator(".tempocol").click();
  check("metronome runs from the tempo row", /Beat \d of 4/.test(beat ?? ""), beat ?? "");

  // Tools sheet over a running session. The tuner's audio worklet is fetched outside Playwright's
  // request routing, so pitch detection itself is checked by scripts/capture.ts against a local server.
  await p.getByRole("button", { name: "Tuner", exact: true }).click();
  await p.getByRole("tab", { name: "Tuner" }).waitFor();
  check("tools sheet opens over the session", (await p.locator(".strings button").count()) === 6);
  await p.screenshot({ path: join(out, "6-tuner.png") });
  await p.getByRole("button", { name: "Done" }).click();
  await p.waitForTimeout(400);
  const after = await p.evaluate(() => ({ panes: document.querySelectorAll(".session .pane").length, loopKept: /Loop B \d/.test(document.querySelector(".session [aria-label='Set loop end']")?.textContent ?? "") }));
  check("the panes and the video's loop survive opening the tuner", after.panes >= 3 && after.loopKept, JSON.stringify(after));

  // Coach: providers signed in; optionally one real message
  const coach = p.locator(".pane-coach");
  if (await coach.count()) {
    const note = await coach.locator(".notice").count();
    check("coach pane shows no sign-in warning", note === 0, note ? ((await coach.locator(".notice").textContent()) ?? "") : "");
    if (withChat) {
      await coach.getByLabel("Message").fill("In one short sentence: what is my next instruction?");
      await coach.getByRole("button", { name: "Send" }).click();
      await coach.locator(".msg.assistant").waitFor({ timeout: 240000 }).catch(() => {});
      await coach.getByRole("button", { name: "Send" }).waitFor({ timeout: 240000 }).catch(() => {});
      const reply = ((await coach.locator(".msg.assistant").last().textContent().catch(() => "")) ?? "").trim();
      const err = await coach.locator(".msg.error").count();
      check("coach answers through the live service", reply.length > 20 && err === 0, reply.slice(0, 160));
      await p.screenshot({ path: join(out, "7-coach-reply.png") });
      // Remove the test conversation from the owner's history.
      const list = JSON.parse((await viaSocket("GET", "/api/conversations", {})).body.toString()) as { id: string; title: string }[];
      for (const c of list.filter((x) => x.title.startsWith("In one short sentence: what is my next"))) await viaSocket("DELETE", `/api/conversations/${c.id}`, { "x-struna": "1" });
    }
  }

  // Leave without writing anything: finish, then discard.
  for (let i = 0; i < 3; i++) await nextStage(p);
  await p.getByRole("button", { name: /^Finish/ }).click();
  await p.getByRole("heading", { name: "Session review" }).waitFor();
  if (withChat) {
    await p.getByRole("button", { name: "Ask the coach to fill this in" }).click();
    await p.getByRole("button", { name: "Ask the coach to fill this in" }).waitFor({ timeout: 180000 });
    const drafted = { target: await p.getByLabel("Target", { exact: true }).inputValue(), next: await p.locator(".review textarea").first().inputValue(), err: await p.locator(".review .notice").count() };
    check("the coach drafts the review sheet", drafted.err === 0 && drafted.target.length > 10 && /Start at \d+ BPM/.test(drafted.next), `${drafted.target.slice(0, 80)} | ${drafted.next.slice(0, 90)}`);
    await p.screenshot({ path: join(out, "8a-review-drafted.png") });
  }
  const reviewScroll = await p.evaluate(() => {
    const before = window.scrollY;
    window.scrollTo(0, 99999);
    const moved = window.scrollY > before || document.documentElement.scrollHeight <= window.innerHeight + 1;
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent === "Discard session")!;
    const r = btn.getBoundingClientRect();
    return { reachable: moved && r.bottom <= window.innerHeight + 1 && r.top >= 0 };
  });
  check("the review form can be scrolled to its last button", reviewScroll.reachable);
  await p.screenshot({ path: join(out, "8-review.png") });
  p.once("dialog", (d) => void d.accept());
  await p.getByRole("button", { name: "Discard session" }).click();
  await p.getByRole("radio", { name: /Full session/ }).waitFor();

  // Tabs screen
  await p.locator(".topnav a", { hasText: "Tabs" }).click();
  const tabsView = p.locator('section[aria-label="Tabs"]');
  await tabsView.getByRole("searchbox").fill("amber");
  await p.waitForTimeout(900);
  await tabsView.locator(".itemopen").first().click();
  const tabsOk = await p.waitForFunction(() => document.querySelectorAll('section[aria-label="Tabs"] .tabscroll svg, section[aria-label="Tabs"] .tabscroll canvas').length > 0, null, { timeout: 30000 }).then(() => true, () => false);
  check("Tabs screen renders a tab", tabsOk);
  await p.screenshot({ path: join(out, "9-tabs.png") });
  await desk.close();

  // ---- iPad landscape and phone, touch ----
  for (const [name, vp] of [["ipad-landscape", { width: 1180, height: 820 }], ["phone", { width: 390, height: 844 }]] as const) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "light" });
    await wire(ctx);
    await ctx.addInitScript(() => localStorage.setItem("struna.guide", "off"));
    const q = await page(ctx);
    await q.goto(`${ORIGIN}/#library`);
    await q.getByRole("searchbox").fill("Red River Valley");
    await q.waitForTimeout(900);
    await q.locator(".item").filter({ hasText: "Video" }).first().getByRole("button", { name: "Use in practice" }).tap();
    await q.getByRole("radio", { name: /Short session/ }).tap();
    await q.getByRole("button", { name: /^Start \d+ min$/ }).tap();
    await q.locator(".session .pane").first().waitFor();
    await q.waitForTimeout(2500);
    const m = await q.evaluate(() => {
      const vw = window.innerWidth;
      const over = [...document.querySelectorAll(".session *")].filter((e) => {
        const r = (e as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.right > vw + 1 && getComputedStyle(e).position !== "fixed";
      }).map((e) => (e as HTMLElement).className || e.tagName).slice(0, 5);
      const boxes = [...document.querySelectorAll(".passes .dots i")].map((i) => i.getBoundingClientRect());
      return { over, boxesVisible: boxes.length === 3 && boxes.every((b) => b.right <= vw && b.width > 10), panes: document.querySelectorAll(".session .pane:not([hidden])").length, tabs: [...document.querySelectorAll(".panetabs button")].map((b) => b.textContent) };
    });
    check(`${name}: nothing in the session runs off the right edge`, m.over.length === 0, m.over.join(", "));
    check(`${name}: the three clean-pass boxes are visible`, m.boxesVisible);
    check(`${name}: panes`, name === "phone" ? m.panes === 1 && m.tabs.includes("Sheet music") : m.panes >= 2, `${m.panes} shown; switcher: ${m.tabs.join(", ") || "none"}`);
    await q.screenshot({ path: join(out, `10-${name}-session.png`) });
    if (name === "phone") {
      await q.getByRole("tab", { name: "Sheet music" }).tap();
      await q.locator(".pane .pdf canvas").waitFor({ timeout: 20000 });
      await q.waitForTimeout(1500);
      const drawn = await q.evaluate(() => {
        const c = document.querySelector(".pane:not([hidden]) .pdf canvas") as HTMLCanvasElement | null;
        if (!c || c.width < 100) return false;
        const d = c.getContext("2d")!.getImageData(0, 0, c.width, Math.min(c.height, 400)).data;
        for (let i = 0; i < d.length; i += 4) if (d[i]! < 128 && d[i + 3]! > 0) return true; // some ink
        return false;
      });
      check("phone: the sheet opens from the switcher, drawn, with its page turner in view", drawn && (await q.getByRole("button", { name: "Next page" }).isVisible()));
      await q.screenshot({ path: join(out, "11-phone-sheet.png") });
    }
    // Discard, never log.
    await q.evaluate(() => sessionStorage.clear());
    await ctx.close();
  }
} finally {
  await browser.close();
}

check("no new log was written to the vault", readdirSync(logsDir).sort().join("|") === logsBefore);
const fails = results.filter((r) => !r[1]);
console.log(`\n${results.length - fails.length}/${results.length} checks passed`);
if (problems.length) console.log(`problems seen in the browser:\n- ${[...new Set(problems)].slice(0, 20).join("\n- ")}`);
process.exit(fails.length ? 1 : 0);
