/**
 * End-to-end smoke test of the generic mode in a real browser, at phone and iPad size,
 * each against its own scratch studio folder. No real coach runs: a stand-in CLI answers
 * for both providers, sets the plan's next instruction and adds one link.
 *
 *   node scripts/smoke-generic.ts <scratch-dir> [screenshot-dir]
 *
 * The walk: setup form, starter plan, start screen, a session through every stage, the review,
 * the log, the start screen's new count; Materials (upload a PDF, an image, an MP3 and a
 * Markdown file, add a YouTube link and a plain link, paste text, open each, delete one);
 * prompt chips; the coach settings; the toasts.
 *
 * Needs `pnpm build`, Chromium at CHROMIUM (default /usr/bin/chromium) and, for the MP3,
 * ffmpeg (a WAV is used without it). SMOKE_PORT picks the port (default 5196).
 * Exits 1 when a check fails.
 */
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { join, resolve } from "node:path";
import { deflateSync } from "node:zlib";

import { chromium, type Page } from "playwright-core";

const root = join(import.meta.dirname, "..");
const dir = resolve(process.argv[2] ?? "smoke-generic");
const shots = process.argv[3] ? resolve(process.argv[3]) : null;
const port = Number(process.env.SMOKE_PORT ?? 5196);
const base = `http://localhost:${port}`;
const COACH_NEXT = "Play the first exercise slowly, twice, and listen for buzzing strings.";
/** Requests the browser tried to send outside the app (all answered with an empty page). */
const direct: string[] = [];
const COACH_LINK = "https://www.justinguitar.com/categories/beginner-guitar-lessons-grade-1";

rmSync(dir, { recursive: true, force: true });
mkdirSync(join(dir, "files"), { recursive: true });
if (shots) mkdirSync(shots, { recursive: true });

const failures: string[] = [];
let size = "";
function check(ok: unknown, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"} [${size}] ${what}`);
  if (!ok) failures.push(`[${size}] ${what}`);
}

// ---- The files to upload.

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function png(w: number, h: number, rgb: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0);
  head.writeUInt32BE(h, 4);
  head.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3).map((_, i) => rgb[i % 3]!)]);
  return Buffer.concat([Buffer.from("\x89PNG\r\n\x1a\n", "latin1"), chunk("IHDR", head), chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk("IEND", Buffer.alloc(0))]);
}
function pdf(text: string): Buffer {
  const stream = `BT /F1 28 Tf 60 700 Td (${text}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const at: number[] = [];
  objs.forEach((o, i) => {
    at.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${at.map((a) => `${String(a).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
function wav(seconds: number): Buffer {
  const rate = 8000;
  const n = rate * seconds;
  const out = Buffer.alloc(44 + n * 2);
  out.write("RIFF", 0);
  out.writeUInt32LE(36 + n * 2, 4);
  out.write("WAVEfmt ", 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36);
  out.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) out.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 220) * 8000), 44 + i * 2);
  return out;
}

const files = join(dir, "files");
writeFileSync(join(files, "Chord chart.pdf"), pdf("Chord chart: A D E"));
writeFileSync(join(files, "Hand position.png"), png(320, 200, [176, 92, 40]));
writeFileSync(join(files, "Strumming notes.md"), "# Strumming notes\n\nDown on the beat, **up** between beats.\n\n```\nD   DU  UD U\n1 & 2 & 3 & 4 &\n```\n");
writeFileSync(join(files, "tone.wav"), wav(2));
let audio = "Backing track.mp3";
try {
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", join(files, "tone.wav"), join(files, audio)]);
} catch {
  audio = "Backing track.wav";
  writeFileSync(join(files, audio), wav(2));
  console.log("ffmpeg is not installed: uploading a WAV instead of an MP3");
}

// ---- A stand-in for `claude` and `codex`: it answers, sets plan.next and adds one link.

const fake = join(dir, "fake-cli.cjs");
writeFileSync(
  fake,
  `#!/usr/bin/env node
const fs = require("node:fs");
const argv = process.argv.slice(2);
if (argv[0] === "auth") { console.log(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", subscriptionType: "max" })); process.exit(0); }
if (argv[0] === "login") { console.log("Logged in using ChatGPT"); process.exit(0); }
let input = "";
process.stdin.on("data", (d) => (input += d)).on("end", () => {
  fs.appendFileSync(${JSON.stringify(join(dir, "calls.jsonl"))}, JSON.stringify({ cwd: process.cwd(), input }) + "\\n");
  const out = (o) => console.log(JSON.stringify(o));
  out({ type: "system", subtype: "init", session_id: "smoke-1", apiKeySource: "none" });
  try {
    const plan = JSON.parse(fs.readFileSync("plan/plan.json", "utf8"));
    plan.next = ${JSON.stringify(COACH_NEXT)};
    fs.writeFileSync("plan/plan.json", JSON.stringify(plan, null, 2));
  } catch {}
  const links = "materials/links.json";
  let list = [];
  try { list = JSON.parse(fs.readFileSync(links, "utf8")); } catch {}
  if (!list.some((l) => l.url === ${JSON.stringify(COACH_LINK)})) {
    list.push({ url: ${JSON.stringify(COACH_LINK)}, title: "JustinGuitar: beginner grade 1", note: "Free video course; suits a first-month player.", added: new Date().toISOString() });
    fs.writeFileSync(links, JSON.stringify(list, null, 2));
  }
  out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "I set your next instruction and added one lesson link.\\n\\n![C shape](https://pics.example/c-shape.png)" } } });
  out({ type: "result", is_error: false, result: "unused" });
});
`,
);
chmodSync(fake, 0o755);

/** Whether something already answers on the port: another server there would get our requests. */
const portTaken = () =>
  new Promise<boolean>((r) => {
    const sock = connect(port, "localhost");
    sock.once("connect", () => (sock.destroy(), r(true)));
    sock.once("error", () => r(false));
  });
const running = (c: ChildProcess) => c.exitCode === null && c.signalCode === null;

async function startServer(env: string): Promise<ChildProcess> {
  if (await portTaken()) throw new Error(`port ${port} is already in use; set SMOKE_PORT to a free one`);
  const child = spawn("node", ["server/index.ts"], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "production",
      GUITAR_MODE: "generic",
      PORT: String(port),
      GUITAR_HOME: join(env, "home"),
      GUITAR_STATE_DIR: join(env, "state"),
      GUITAR_CACHE_DIR: join(env, "cache"),
      GUITAR_LIBRARY_DIRS: "",
      GUITAR_TABS_DIR: "",
      CLAUDE_BIN: fake,
      CODEX_BIN: fake,
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  for (let i = 0; i < 50; i++) {
    // Our server exited (a port taken meanwhile, a crash): whatever answers now is not ours.
    if (!running(child)) throw new Error("the server exited before it was ready (port in use?)");
    if (await fetch(`${base}/api/health`).then((r) => r.ok, () => false)) {
      if (running(child)) return child;
      break;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (running(child)) child.kill();
  throw new Error("the server did not start");
}

/** The generic mode on loopback TCP needs its access token; the server wrote it to the state folder. */
let token = "";
const json = <T>(path: string) => fetch(`${base}${path}`, { headers: { "x-guitar-room-token": token } }).then((r) => r.json() as Promise<T>);

async function walk(page: Page, env: string) {
  const home = join(env, "home");
  let n = 0;
  const shot = async (name: string, full = false) => {
    // Nothing may stick out past the right edge of the screen.
    const wide = await page.evaluate(() => {
      const w = document.documentElement.clientWidth;
      const hidden = (e: Element | null): boolean => !!e && (e.getAttribute("aria-hidden") === "true" || hidden(e.parentElement));
      const out = [...document.querySelectorAll("main *, .top *, .tabs *, .chatwrap.open *, .coachtoasts *")].filter((e) => !e.closest(".promptrow") && !hidden(e) && e.getClientRects().length && e.getBoundingClientRect().right > w + 1);
      return out.slice(0, 3).map((e) => `${e.tagName.toLowerCase()}.${e.className} +${Math.round(e.getBoundingClientRect().right - w)}px`);
    });
    check(wide.length === 0, `${name}: nothing is wider than the screen${wide.length ? ` (${wide.join("; ")})` : ""}`);
    if (shots) await page.screenshot({ path: join(shots, `${size}-${String(++n).padStart(2, "0")}-${name}.png`), fullPage: full });
  };
  const toast = (re: RegExp) => page.locator(".coachtoast").filter({ hasText: re });
  const chatIdle = () => page.waitForFunction(() => !document.querySelector(".thinking"), null, { timeout: 20_000 });

  // ---- Setup form, starter plan, the onboarding action.
  await page.goto(`${base}/#practice`);
  await page.getByRole("heading", { name: "Welcome to Guitar Room" }).waitFor();
  check((await page.locator(".tabs a").allTextContents()).join(",") === "Practice,Materials", "sections are Practice and Materials");
  await page.getByRole("radio", { name: /^Beginner/ }).click();
  await page.getByRole("radiogroup", { name: "Minutes in a usual session" }).getByRole("radio", { name: "15", exact: true }).click();
  await page.getByRole("button", { name: "Rock", exact: true }).click();
  await page.getByLabel("Songs or artists you want to play").fill("Creedence Clearwater Revival");
  await shot("setup", true);
  await page.getByRole("button", { name: "Save and build my plan" }).click();
  await page.locator(".gstart").waitFor();
  await toast(/coach/i).first().waitFor();
  check(true, "the onboarding toast appeared after the profile was saved");
  check(existsSync(join(home, "profile.json")) && existsSync(join(home, "plan/plan.json")), "profile.json and a starter plan/plan.json were written");
  // The stand-in coach changes plan.next; the `changed` event reloads the start screen.
  await page.getByText(COACH_NEXT).waitFor({ timeout: 20_000 });
  check(true, "the start screen reloaded with the coach's next instruction (SSE changed)");
  check(await page.locator(".top .unread").count(), "the Coach button shows an unread dot");
  await shot("start", true);
  const calls = () => readFileSync(join(dir, "calls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { cwd: string; input: string }).filter((c) => c.cwd === home);
  check(calls().length === 1 && /profile/i.test(calls()[0]!.input), "one coach turn ran, in the studio folder, with the onboarding text");
  await toast(/coach/i).first().getByRole("button", { name: "Dismiss" }).click();
  check((await page.locator(".coachtoast").count()) === 0, "the toast can be dismissed");

  // ---- Prompt chips: one sends, one fills the message box.
  const chips = page.locator(".gstart .promptchips button:not(.morechip)");
  check((await chips.count()) >= 3, `the start screen offers prompt chips (${await chips.count()})`);
  const label = (await chips.first().textContent()) ?? "";
  await chips.first().click();
  await page.getByRole("dialog", { name: "Coach" }).locator(".msg.user").last().waitFor();
  await chatIdle();
  await page.waitForTimeout(400); // the panel slides in
  check(calls().length === 2, `the chip "${label}" sent a message to the coach`);
  // A picture in a reply goes through the server, never straight from the browser to the site.
  const pic = page.getByRole("dialog", { name: "Coach" }).locator(".msg.assistant .replyimg").last();
  await pic.filter({ hasText: /pics\.example/ }).waitFor({ timeout: 10_000 });
  check(/could not be loaded \(pics\.example\)|Picture from pics\.example/.test((await pic.textContent()) ?? ""), "a reply's picture names its site");
  check(!direct.some((u) => u.includes("pics.example")), "the browser never asked the picture's site itself");
  await shot("coach-panel");
  await page.getByRole("dialog", { name: "Coach" }).locator(".morechip").click();
  await page.locator(".promptsheet").waitFor();
  await shot("coach-prompts");
  const fills = page.locator(".promptsheet .promptchips button").filter({ hasText: /…$/ });
  check((await fills.count()) > 0, "the prompt list has prompts for the player to finish");
  await fills.first().click();
  const box = page.getByRole("dialog", { name: "Coach" }).locator(".composer textarea, .composer input").first();
  const filled = await page.waitForFunction(() => (document.querySelector<HTMLTextAreaElement>(".chat .composer textarea")?.value.length ?? 0) > 10, null, { timeout: 5000 }).then(() => true, () => false);
  check(filled, "a prompt ending in … is put in the message box");
  check(calls().length === 2, "and it is not sent");
  await box.fill("");
  await page.getByRole("dialog", { name: "Coach" }).getByRole("button", { name: "Done" }).click();

  // ---- Coach settings: turn one automatic action to "Ask first".
  await page.getByRole("button", { name: "Coach settings" }).click();
  const logged = page.locator(".actionlist li").filter({ hasText: /log/i }).first();
  await logged.getByRole("radio", { name: "Ask first" }).click();
  await page.waitForFunction(async () => {
    const r = await fetch("/api/prompts").then((x) => x.json());
    return r.actions.find((a: { id: string }) => a.id === "session-logged")?.mode === "ask";
  });
  check(true, "coach settings changed session-logged to Ask first");
  await shot("coach-settings", true);
  await page.getByRole("button", { name: "Coach settings" }).click();

  // ---- A session through every stage, the review, the log.
  const today = await json<{ sessions: { id: string; label: string; stages: unknown[] }[] }>("/api/today");
  const kind = today.sessions[0]!;
  await page.locator(".startacts .btn.primary").first().click();
  await page.locator(".stagebar, .stages").first().waitFor();
  await shot("session-stage-1", true);
  for (let i = 1; i < kind.stages.length; i++) {
    await page.getByRole("button", { name: /^Next stage/ }).click();
    if (i === 1) await shot("session-stage-2", true);
  }
  await shot("session-last-stage", true);
  await page.getByRole("button", { name: /^Finish/ }).click();
  await page.getByRole("heading", { name: "How did it go?" }).waitFor();
  await page.getByLabel("What you worked on").fill("A and D chord changes");
  await page.getByRole("radio", { name: "Too easy" }).click();
  await page.getByLabel("What went well").fill("clean A chord");
  await page.getByLabel("What was hard").fill("the change to D");
  await shot("review", true);
  await page.getByRole("button", { name: "Write the log" }).click();
  await page.getByRole("heading", { name: "Log written" }).waitFor();
  const logs = readdirSync(join(home, "logs"));
  check(logs.length === 1 && /^\d{4}-\d\d-\d\d\.md$/.test(logs[0]!), `one log was written (${logs.join(", ")})`);
  const log = readFileSync(join(home, "logs", logs[0]!), "utf8");
  check(log.includes("A and D chord changes") && /too easy/i.test(log) && log.includes("## Next instruction"), "the log holds the review's answers");
  await toast(/./).getByRole("button").first().waitFor();
  check((await toast(/./).count()) === 1, "the session-logged action asks first, as set");
  await shot("log-written", true);
  check(/logged/i.test((await toast(/./).first().textContent()) ?? ""), "and the toast offers the review instead of sending it");
  check(calls().length === 2, "nothing was sent before the tap");
  await toast(/./).locator(".btn").click();
  await page.waitForFunction((n) => document.querySelectorAll(".msg.user").length >= n, 3);
  await chatIdle();
  check(calls().length === 3 && calls()[2]!.input.includes(logs[0]!), "accepting the toast sent the log's name to the coach");
  await page.getByRole("button", { name: "Back to today" }).click();
  await page.locator(".gstart .statline").waitFor();
  const stats = (await page.locator(".gstart .statline").textContent()) ?? "";
  check(/\b1\b/.test(stats), `the start screen counts the session (${stats})`);
  check((await page.locator(".gstart .recent li").count()) === 1, "and lists it under recent sessions");
  await shot("start-after-session", true);

  // ---- Materials.
  await page.goto(`${base}/#materials`);
  const mat = page.getByRole("region", { name: "Materials" });
  // The stand-in coach added one link during onboarding.
  await mat.locator(".matitem").first().waitFor();
  check((await mat.locator(".matitem").count()) === 1, "the link the coach added is listed");
  await shot("materials-one-link", true);
  const items = () => json<{ items: { title: string; kind: string }[] }>("/api/materials").then((r) => r.items);
  const waitItems = async (count: number) => {
    for (let i = 0; i < 50 && (await mat.locator(".matitem").count()) !== count; i++) await page.waitForTimeout(200);
    check((await mat.locator(".matitem").count()) === count, `the list shows ${count} items`);
  };
  const callsBefore = calls().length;
  await mat.getByRole("button", { name: /^Add/ }).first().click();
  await mat.getByRole("radio", { name: "Upload files" }).click();
  await shot("materials-add-upload", true);
  await mat.locator('input[type="file"]').setInputFiles(["Chord chart.pdf", "Hand position.png", audio, "Strumming notes.md"].map((f) => join(files, f)));
  await waitItems(5);
  await toast(/./).first().waitFor();
  await chatIdle();
  check(calls().length === callsBefore + 1 && calls().at(-1)!.input.includes("Chord chart"), "one material-added action went to the coach for the four uploads");
  await shot("materials-uploaded", true);
  for (const t of await page.locator(".coachtoast .toastx").all()) await t.click().catch(() => {});

  await mat.getByRole("radio", { name: "Add a link" }).click();
  await mat.getByLabel("Web address").fill("https://www.youtube.com/watch?v=BBz-Jyr23M4");
  await mat.getByLabel(/^Title/).fill("First chords lesson");
  await shot("materials-add-link", true);
  await mat.locator(".addform").getByRole("button", { name: /^Add/ }).click();
  await waitItems(6);
  await mat.getByLabel("Web address").fill("https://example.org/lessons/open-chords");
  await mat.getByLabel(/^Title/).fill("Open chords article");
  await mat.locator(".addform").getByRole("button", { name: /^Add/ }).click();
  await waitItems(7);
  await mat.getByRole("radio", { name: "Paste text" }).click();
  await mat.getByLabel("Title").fill("Bad Moon Rising chords");
  await mat.locator(".pastebox").fill("D  A  G  D\nI see the bad moon arising");
  await shot("materials-add-text", true);
  await mat.locator(".addform").getByRole("button", { name: /^(Add|Save)/ }).click();
  await waitItems(8);
  await mat.locator(".addpanel .sheetdone").click();
  await chatIdle();
  for (const t of await page.locator(".coachtoast .toastx").all()) await t.click().catch(() => {});
  await shot("materials-list", true);
  const kinds = (await items()).map((i) => i.kind).sort().join(",");
  check(kinds === "audio,image,link,link,link,pdf,text,text", `the server lists every kind (${kinds})`);

  // Open each in the viewer.
  const open = async (title: string, proof: string, name: string) => {
    await mat.locator(".matitem").filter({ hasText: title }).locator(".itemopen").click();
    const ok = await mat.locator(`.matviewer ${proof}`).first().waitFor({ timeout: 15_000 }).then(() => true, () => false);
    check(ok, `"${title}" opens in the viewer (${proof})`);
    await page.waitForTimeout(400);
    await shot(`view-${name}`);
    await mat.getByRole("button", { name: "Back to materials" }).click();
  };
  await open("Chord chart", "canvas", "pdf");
  await open("Hand position", "img", "image");
  await open("Backing track", "audio", "audio");
  await open("Strumming notes", "pre", "markdown");
  await open("Bad Moon Rising chords", "pre", "text");
  await open("First chords lesson", 'iframe[src^="https://www.youtube-nocookie.com/embed/BBz-Jyr23M4"]', "youtube");
  await open("Open chords article", 'a[href="https://example.org/lessons/open-chords"][rel~="noopener"]', "link");

  // Search and the kind filter.
  await mat.getByLabel("Search your materials").fill("chord");
  await page.waitForTimeout(600);
  check((await mat.locator(".matitem").count()) >= 3 && (await mat.locator(".matitem").count()) < 8, "search narrows the list");
  await mat.getByLabel("Search your materials").fill("");
  await waitItems(8);

  // Delete one: asked inline, then moved to the trash folder.
  const row = mat.locator(".matitem").filter({ hasText: "Hand position" });
  await row.getByRole("button", { name: "Delete" }).click();
  await shot("materials-delete-ask", true);
  await row.getByRole("button", { name: "Yes, delete" }).click();
  await waitItems(7);
  check(readdirSync(join(home, "materials/.trash")).some((f) => f.endsWith("Hand position.png")), "the deleted file is in materials/.trash");

  // Into a practice pane.
  await mat.locator(".matitem").filter({ hasText: "Strumming notes" }).getByRole("button", { name: "Use in practice" }).click();
  await page.locator(".gstart, .session, .stages").first().waitFor();
  await page.locator(".startacts .btn.primary").first().click().catch(() => {});
  const inPane = await page.getByRole("region", { name: "Practice" }).locator("pre").first().waitFor({ timeout: 10_000 }).then(() => true, () => false);
  check(inPane, "a material used in practice shows in a session pane");
  await shot("session-with-material", true);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox"] });
try {
  for (const [name, viewport, scale] of [["phone", { width: 390, height: 844 }, 2], ["ipad", { width: 820, height: 1180 }, 1]] as const) {
    size = name;
    const env = join(dir, name);
    const srv = await startServer(env);
    token = readFileSync(join(env, "state", "access-token"), "utf8").trim();
    try {
      const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, hasTouch: true, isMobile: name === "phone" });
      const page = await ctx.newPage();
      // No outside requests: the YouTube player is replaced by an empty page.
      await page.route(/^https?:\/\/(?!localhost)/, (r) => (direct.push(r.request().url()), r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>blocked in the smoke test</title>" })));
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      // The stand-in's picture is on a name that does not resolve, so the server refuses it (422).
      page.on("console", (m) => m.type() === "error" && !/favicon|\/api\/chat\/image/.test(m.location().url) && errors.push(`${m.text()} ${m.location().url}`));
      // Without the token the server answers nothing; the printed link stores it in a cookie.
      check((await fetch(`${base}/api/app`)).status === 403, "the API refuses a request without the access token");
      await page.goto(`${base}/?token=${token}`);
      await page.waitForURL(`${base}/`);
      check(!page.url().includes("token"), "the access link opens the app and leaves the token out of the address");
      await walk(page, env).catch((e) => check(false, `the walk stopped: ${String((e as Error).message ?? e).split("\n")[0]}`));
      check(errors.length === 0, `no page or console errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
      await ctx.close();
    } finally {
      if (running(srv)) {
        srv.kill();
        await new Promise((r) => srv.once("exit", r));
      }
    }
  }
} finally {
  await browser.close();
}
if (failures.length) {
  console.error(`\n${failures.length} failed:\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("\nall checks passed");
