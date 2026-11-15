/**
 * End-to-end smoke test of the studio mode in a real browser, at phone and iPad size,
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
 * Before the browser walk, an API pass with the shared stand-in (scripts/fake-coach-cli.ts) saves a
 * dummy Anthropic key and an Ollama endpoint, chats with each, runs the ChatGPT device sign-in, removes
 * the key, and then searches the server's output, the database, every response and the stand-in's log
 * for the dummy key: it may only be in coach-providers.json.
 *
 * Needs `pnpm build`, Chromium at CHROMIUM (default /usr/bin/chromium) and, for the MP3,
 * ffmpeg (a WAV is used without it). SMOKE_PORT picks the port (default 5196).
 * Exits 1 when a check fails.
 */
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { join, resolve } from "node:path";
import { deflateSync } from "node:zlib";

import { type Browser, chromium, type Page } from "playwright-core";
import { nextStage } from "./practice-steps.ts";

import { starterPlan } from "../server/generic/starter.ts";
import { normalizeProfile } from "../server/generic/studio.ts";
import { sha256, writeFakeBin } from "./fake-coach-cli.ts";

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
if (argv[0] === "--version") { console.log("offline-smoke"); process.exit(0); }
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
    const candidate = /This turn's plan candidate: ([^\\s]+)\\./.exec(argv.join(" "))?.[1];
    if (candidate) fs.writeFileSync(candidate, JSON.stringify(plan, null, 2));
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

/** `codexBin` defaults to `bin`; a stand-in named `.../bin/codex` is recognised as a Codex install, so the Codex coaches are on. */
async function startServer(env: string, o: { bin?: string; codexBin?: string; log?: string; env?: Record<string, string> } = {}): Promise<ChildProcess> {
  if (await portTaken()) throw new Error(`port ${port} is already in use; set SMOKE_PORT to a free one`);
  const out = o.log ? openSync(o.log, "a") : null;
  const child = spawn("node", ["server/index.ts"], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "production",
      STRUNA_MODE: "studio",
      PORT: String(port),
      STRUNA_HOME: join(env, "home"),
      STRUNA_STATE_DIR: join(env, "state"),
      STRUNA_CACHE_DIR: join(env, "cache"),
      STRUNA_LIBRARY_DIRS: "",
      STRUNA_TABS_DIR: "",
      CLAUDE_BIN: o.bin ?? fake,
      CODEX_BIN: o.codexBin ?? o.bin ?? fake,
      ...o.env,
    },
    stdio: out === null ? ["ignore", "ignore", "inherit"] : ["ignore", out, out],
  });
  if (out !== null) closeSync(out);
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

/** The studio mode on loopback TCP needs its access token; the server wrote it to the state folder. */
let token = "";
const json = <T>(path: string) => fetch(`${base}${path}`, { headers: { "x-struna-token": token } }).then((r) => r.json() as Promise<T>);

/** What sticks out past the right edge of the screen: nothing may. */
const tooWide = (page: Page) =>
  page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const hidden = (e: Element | null): boolean => !!e && (e.getAttribute("aria-hidden") === "true" || hidden(e.parentElement));
    const out = [...document.querySelectorAll("main *, .top *, .tabs *, .chatwrap.open *, .coachtoasts *")].filter((e) => !e.closest(".promptrow") && !hidden(e) && e.getClientRects().length && e.getBoundingClientRect().right > w + 1);
    return out.slice(0, 3).map((e) => `${e.tagName.toLowerCase()}.${e.className} +${Math.round(e.getBoundingClientRect().right - w)}px`);
  });

async function startPractice(page: Page) {
  const start = page.getByRole("button", { name: /^Start \d+ min$/ });
  if (await start.count()) await start.click();
  else await page.locator(".startacts .btn.primary").first().click();
}

async function walk(page: Page, env: string) {
  const home = join(env, "home");
  let n = 0;
  const shot = async (name: string, full = false) => {
    const wide = await tooWide(page);
    check(wide.length === 0, `${name}: nothing is wider than the screen${wide.length ? ` (${wide.join("; ")})` : ""}`);
    if (shots) await page.screenshot({ path: join(shots, `${size}-${String(++n).padStart(2, "0")}-${name}.png`), fullPage: full });
  };
  const toast = (re: RegExp) => page.locator(".coachtoast").filter({ hasText: re });
  const chatIdle = () => page.waitForFunction(() => !document.querySelector(".thinking"), null, { timeout: 20_000 });

  // ---- Setup form, starter plan, the onboarding action.
  await page.goto(`${base}/#practice`);
  await page.getByRole("heading", { name: "Welcome to Struna" }).waitFor();
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
  // The stand-in proposes plan.next; Today changes only after explicit Apply.
  await chatIdle();
  check(!JSON.parse(readFileSync(join(home, "plan/plan.json"), "utf8")).next.includes(COACH_NEXT), "the active plan is unchanged before Apply");
  await page.locator(".top").getByRole("button", { name: /^Coach/ }).click();
  await page.getByRole("button", { name: "Apply plan change", exact: true }).click();
  await page.getByRole("dialog", { name: "Coach" }).getByRole("button", { name: "Done", exact: true }).click();
  await page.locator(".gstart .instr").getByText(COACH_NEXT, { exact: true }).waitFor({ timeout: 20_000 });
  check(true, "Today reloaded only after explicit Apply");
  check((await page.locator(".top .unread").count()) === 0, "opening Coach clears the unread dot");
  await shot("start", true);
  const calls = () => readFileSync(join(dir, "calls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { cwd: string; input: string }).filter((c) => c.cwd === home);
  check(calls().length === 1 && /profile/i.test(calls()[0]!.input), "one coach turn ran, in the studio folder, with the onboarding text");
  await toast(/coach/i).first().getByRole("button", { name: "Dismiss" }).click();
  check((await page.locator(".coachtoast").count()) === 0, "the toast can be dismissed");

  // ---- Coach opens deliberately; its drawer leads with two stage-relevant prompts.
  await page.locator(".top").getByRole("button", { name: /^Coach/ }).click();
  const coach = page.getByRole("dialog", { name: "Coach" });
  const chips = coach.locator(".promptchips button:not(.morechip)");
  check((await chips.count()) === 2, `the Coach drawer offers two relevant prompt shortcuts (${await chips.count()})`);
  const label = (await chips.first().textContent()) ?? "";
  await chips.first().click();
  await coach.locator(".msg.user").last().waitFor();
  await chatIdle();
  await page.waitForTimeout(400); // the panel slides in
  check(calls().length === 2, `the chip "${label}" sent a message to the coach`);
  // A picture in a reply goes through the server, never straight from the browser to the site.
  const pic = coach.locator(".msg.assistant .replyimg").last();
  await pic.filter({ hasText: /pics\.example/ }).waitFor({ timeout: 10_000 });
  check(/could not be loaded \(pics\.example\)|Picture from pics\.example/.test((await pic.textContent()) ?? ""), "a reply's picture names its site");
  check(!direct.some((u) => u.includes("pics.example")), "the browser never asked the picture's site itself");
  await shot("coach-panel");
  await coach.locator(".morechip").click();
  await page.locator(".promptsheet").waitFor();
  await shot("coach-prompts");
  const fills = coach.locator(".promptsheet .promptchips button").filter({ hasText: /…$/ });
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
  await startPractice(page);
  await page.locator(".session").waitFor();
  await shot("session-stage-1", true);
  for (let i = 1; i < kind.stages.length; i++) {
    await nextStage(page);
    if (i === 1) await shot("session-stage-2", true);
  }
  await shot("session-last-stage", true);
  await page.getByRole("button", { name: /^Finish/ }).click();
  await page.getByRole("heading", { name: "How did it go?" }).waitFor();
  await page.getByLabel("What you worked on").fill("A and D chord changes");
  await page.getByRole("radio", { name: "Too easy" }).click();
  await page.getByText("Optional notes", { exact: true }).click();
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
  await row.getByRole("button", { name: /^Manage/ }).click();
  await row.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await shot("materials-delete-ask", true);
  await row.getByRole("button", { name: "Yes, delete" }).click();
  await waitItems(7);
  check(readdirSync(join(home, "materials/.trash")).some((f) => f.endsWith("Hand position.png")), "the deleted file is in materials/.trash");

  // Into a practice pane.
  await mat.locator(".matitem").filter({ hasText: "Strumming notes" }).getByRole("button", { name: "Use in practice" }).click();
  await page.locator(".gstart, .session, .stages").first().waitFor();
  await startPractice(page).catch(() => {});
  const inPane = await page.getByRole("region", { name: "Practice" }).locator("pre").first().waitFor({ timeout: 10_000 }).then(() => true, () => false);
  check(inPane, "a material used in practice shows in a session pane");
  await shot("session-with-material", true);
}

/** The coach list over the API, with the shared stand-in: keys, an endpoint, the device sign-in, and no leaked key. */
async function apiPass() {
  size = "api";
  const env = join(dir, "api");
  const fakeDir = join(env, "fake");
  mkdirSync(fakeDir, { recursive: true });
  const bin = writeFakeBin(fakeDir);
  const codexBin = writeFakeBin(fakeDir, "codex-install/bin/codex");
  writeFileSync(join(fakeDir, "good-plan.json"), JSON.stringify(starterPlan(normalizeProfile({ level: "beginner" }, new Date().toISOString()), new Date().toISOString().slice(0, 10))));
  const KEY = "sk-ant-api03-SMOKE-DUMMY-0000-1111-2222-zzzz";
  const serverLog = join(env, "server.log");
  const transcripts: string[] = [];
  const srv = await startServer(env, { bin, codexBin, log: serverLog });
  try {
    token = readFileSync(join(env, "state", "access-token"), "utf8").trim();
    const api = async (method: string, path: string, body?: unknown) => {
      const res = await fetch(`${base}${path}`, { method, headers: { "x-struna-token": token, "x-struna": "1", "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const text = await res.text();
      transcripts.push(text);
      return { status: res.status, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
    };
    const events = (text: string) => [...text.matchAll(/^event: (.+)$/gm)].map((m) => m[1]!);
    const log = () => readFileSync(join(fakeDir, "calls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { argv: string[]; CLAUDE_CONFIG_DIR: string | null; CODEX_HOME: string | null; sha256: Record<string, string>; envNames: string[] });
    const state = join(env, "state");

    const list = (await api("GET", "/api/providers")).json;
    check(list?.list?.map((r: { id: string }) => r.id).join(",") === "claude,codex,chatgpt,anthropic,openai,bedrock,endpoint", "a locally hosted instance offers every coach");
    const put = await api("PUT", "/api/coach/providers/anthropic", { key: KEY });
    check(put.status === 200 && put.json.ok && put.json.hint === "…zzzz", "an Anthropic key is saved and shown only as its last four characters");
    const ep = await api("PUT", "/api/coach/providers/endpoint", { preset: "ollama", baseUrl: "http://127.0.0.1:11434/v1", model: "gpt-oss:20b" });
    check(ep.status === 200 && ep.json.ok, "an Ollama endpoint is saved");

    const a = await api("POST", "/api/chat", { provider: "anthropic", message: "Hello. BREAK THE PLAN", screen: { view: "start" } });
    check(events(a.text).join(",") === "conversation,thread,delta,delta,thread,delta,notice,done", `the Anthropic coach answers, with the plan repair turn (${events(a.text).join(",")})`);
    const claudeCalls = log().filter((c) => c.argv[0] === "-p");
    check(claudeCalls.length === 2 && claudeCalls.every((c) => c.CLAUDE_CONFIG_DIR === join(state, "cli", "anthropic") && c.sha256.ANTHROPIC_API_KEY === sha256(KEY) && !c.envNames.includes("CLAUDE_CODE_OAUTH_TOKEN")), "it ran in its own config folder with the key in its environment only");
    const e = await api("POST", "/api/chat", { provider: "endpoint", message: "Hello", screen: { view: "start" } });
    check(events(e.text).join(",").startsWith("conversation,thread,delta") && !events(e.text).includes("error"), "the endpoint coach answers");
    const codexCall = log().find((c) => c.argv[0] === "exec")!;
    check(codexCall.CODEX_HOME === join(state, "cli", "endpoint") && codexCall.argv.includes('model_providers.struna.base_url="http://127.0.0.1:11434/v1"') && codexCall.argv.includes('web_search="disabled"'), "it ran as a custom provider with web search off");

    const login = await api("POST", "/api/coach/providers/chatgpt/login");
    check(login.status === 200 && login.json.state === "waiting" && login.json.url === "https://auth.openai.com/codex/device" && /^[A-Z0-9]{4}-[A-Z0-9]{4,6}$/.test(login.json.code), "the ChatGPT sign-in shows the link and the code");
    writeFileSync(join(fakeDir, "device-ok"), "ok");
    let done = false;
    for (let i = 0; i < 50 && !done; i++) {
      done = (await api("GET", "/api/coach/providers/chatgpt/login")).json?.state === "done";
      if (!done) await new Promise((r) => setTimeout(r, 100));
    }
    check(done, "the sign-in finishes when Codex does");
    const c = await api("POST", "/api/chat", { provider: "chatgpt", message: "Hello", screen: { view: "start" } });
    check(!events(c.text).includes("error"), "the ChatGPT coach signed in here answers");

    const del = await api("DELETE", "/api/coach/providers/anthropic");
    check(del.status === 200 && del.json.ok === false, "removing the key leaves the row not ready");
  } finally {
    if (running(srv)) {
      srv.kill();
      await new Promise((r) => srv.once("exit", r));
    }
  }
  const places: [string, string][] = [
    ["the server's output", readFileSync(serverLog, "utf8")],
    ["the database", readFileSync(join(env, "state", "struna.sqlite")).toString("latin1")],
    ["the responses", transcripts.join("\n")],
    ["the stand-in's log", readFileSync(join(fakeDir, "calls.jsonl"), "utf8")],
  ];
  for (const [where, text] of places) check(!text.includes(KEY), `the dummy key is not in ${where}`);
}

await apiPass().catch((e) => check(false, `the API pass stopped: ${String((e as Error).message ?? e).split("\n")[0]}`));

/**
 * Coach settings in the browser, with the shared stand-in: every row, a key, an Ollama endpoint, the ChatGPT
 * sign-in with its code, the coach picker, removing it all; then with host logins turned off, "No coach is
 * set up" and an old conversation that can only be replaced. Shots at 390 px and on a desktop, light and dark.
 */
async function coachWalk(browser: Browser) {
  const env = join(dir, "coach");
  const fakeDir = join(env, "fake");
  mkdirSync(fakeDir, { recursive: true });
  const bin = writeFakeBin(fakeDir);
  const codexBin = writeFakeBin(fakeDir, "codex-install/bin/codex");
  const KEY = "sk-ant-api03-WALK-DUMMY-3333-4444-5555-yyyy";
  const serverLog = join(env, "server.log");
  const bodies: string[] = [];
  const doms: string[] = [];
  let srv = await startServer(env, { bin, codexBin, log: serverLog });
  const stop = async () => {
    if (running(srv)) {
      srv.kill();
      await new Promise((r) => srv.once("exit", r));
    }
  };
  type Ctx = { page: Page; close: () => Promise<void>; errors: string[]; label: string; n: number };
  const contexts: Ctx[] = [];
  try {
    token = readFileSync(join(env, "state", "access-token"), "utf8").trim();
    const headers = { "x-struna-token": token, "x-struna": "1", "content-type": "application/json" };
    await fetch(`${base}/api/profile`, { method: "PUT", headers, body: JSON.stringify({ level: "beginner" }) });

    const open = async (label: string, width: number, height: number, scheme: "light" | "dark"): Promise<Ctx> => {
      size = `coach-${label}`;
      const phone = width < 500;
      const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: phone ? 2 : 1, hasTouch: phone, isMobile: phone, colorScheme: scheme, permissions: ["clipboard-read", "clipboard-write"] });
      const page = await ctx.newPage();
      await page.route(/^https?:\/\/(?!localhost)/, (r) => (direct.push(r.request().url()), r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>blocked in the smoke test</title>" })));
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => m.type() === "error" && !/favicon/.test(m.location().url) && !/the server responded with a status of 4\d\d/.test(m.text()) && errors.push(`${m.text()} ${m.location().url}`));
      page.on("response", (r) => void (r.url().includes("/api/") && r.text().then((t) => bodies.push(t), () => {})));
      await page.goto(`${base}/?token=${token}`);
      await page.waitForURL(`${base}/`);
      const c: Ctx = { page, close: () => ctx.close(), errors, label, n: 0 };
      contexts.push(c);
      return c;
    };
    const shot = async (c: Ctx, name: string, el?: string) => {
      size = `coach-${c.label}`;
      const wide = await tooWide(c.page);
      check(wide.length === 0, `${name}: nothing is wider than the screen${wide.length ? ` (${wide.join("; ")})` : ""}`);
      doms.push(await c.page.content());
      if (!shots) return;
      const path = join(shots, `coach-${c.label}-${String(++c.n).padStart(2, "0")}-${name}.png`);
      if (el) await c.page.locator(el).first().screenshot({ path });
      else await c.page.screenshot({ path });
    };
    const settings = async (c: Ctx) => {
      await c.page.getByRole("button", { name: "Coach settings" }).click();
      await c.page.locator(".coachprov .provrow").first().waitFor();
    };
    const rowOf = (c: Ctx, label: string) => c.page.locator(".provrow").filter({ has: c.page.locator(".provname", { hasText: new RegExp(`^${label.replace(/[()]/g, "\\$&")}$`) }) });
    const stateOf = async (c: Ctx, label: string, re: RegExp) => {
      const ok = await rowOf(c, label).locator(".provstate").filter({ hasText: re }).waitFor({ timeout: 15_000 }).then(() => true, () => false);
      check(ok, `${label} reads ${re} (${await rowOf(c, label).locator(".provstate").textContent().catch(() => "?")})`);
    };
    const openChat = async (c: Ctx) => {
      await c.page.locator(".top").getByRole("button", { name: /^Coach/ }).click();
      await c.page.getByRole("dialog", { name: "Coach" }).waitFor();
      await c.page.waitForTimeout(400); // the panel slides in
    };
    const deviceCode = async (c: Ctx) => {
      const row = rowOf(c, "ChatGPT plan (signed in here)");
      await row.getByRole("button", { name: "Sign in with a code" }).click();
      const box = row.locator(".devicebox");
      await box.waitFor();
      const link = box.getByRole("link");
      check((await link.getAttribute("href")) === "https://auth.openai.com/codex/device" && (await link.getAttribute("target")) === "_blank" && /noopener/.test((await link.getAttribute("rel")) ?? ""), "the sign-in link opens OpenAI's page in a new tab");
      check((await box.locator(".devcode code").textContent()) === "FAKE-1A2B3", "the one-time code is shown");
      check(/expires in 1[45]:\d\d/.test((await box.textContent()) ?? ""), `a countdown shows (${(await box.locator(".srcnote").last().textContent()) ?? ""})`);
      check(/Settings → Security/.test((await row.textContent()) ?? ""), "the row says to turn on device code sign-in first");
      await box.getByRole("button", { name: "Copy" }).click();
      const copied = await box.getByRole("button", { name: "Copied" }).waitFor({ timeout: 3000 }).then(() => true, () => false);
      const selected = !copied && /code is selected/.test((await box.textContent()) ?? "");
      check(copied || selected, `Copy puts the code on the clipboard, or selects it (${copied ? "copied" : "selected"})`);
      if (copied) check((await c.page.evaluate(() => navigator.clipboard.readText())) === "FAKE-1A2B3", "the clipboard holds the code");
      await shot(c, "device-code", ".coachprov");
      return { row, box };
    };

    // ---- Phone, light: every row, then a key and an endpoint saved through the form.
    const p1 = await open("phone-light", 390, 844, "light");
    await settings(p1);
    const names = (await p1.page.locator(".provname").allTextContents()).join(",");
    check(names === "Claude plan (this computer),ChatGPT plan (this computer),ChatGPT plan (signed in here),Anthropic API key,OpenAI API key,Amazon Bedrock (Claude),Other provider (Responses API)", `Coach settings lists every coach this instance offers (${names})`);
    const text = (await p1.page.locator(".coachprov").textContent()) ?? "";
    check(/Anthropic does not let apps sign you in to a Claude plan\. Run claude auth login yourself on \S+, or add an Anthropic API key\./.test(text), "the Claude plan row says Anthropic does not let apps sign in, with the host");
    check(text.includes("If your Claude plan includes API credits, create the key in the Console organisation linked to that plan."), "the Anthropic key row has the Console note");
    check((await rowOf(p1, "Other provider (Responses API)").locator(".provtag").textContent()) === "Experimental", "the endpoint row is marked experimental");
    check(/Responses API\. DeepSeek \(https:\/\/api\.deepseek\.com\) and Together \(https:\/\/api\.together\.ai\/v1\) work under Other\. Gemini, Mistral and others: use OpenRouter\./.test((await rowOf(p1, "Other provider (Responses API)").textContent()) ?? ""), "and says which providers it needs");
    check((await rowOf(p1, "Claude plan (this computer)").locator("code").first().textContent()) === "claude auth logout", "a signed-in host row says how to sign out in a terminal");
    await rowOf(p1, "Claude plan (this computer)").getByRole("button", { name: "Check again" }).click();
    await stateOf(p1, "Claude plan (this computer)", /^Ready: Signed in on .+ \(claude\.ai max\)$/);
    await shot(p1, "rows-empty", ".coachprov");

    const anth = rowOf(p1, "Anthropic API key");
    /** What has keyboard focus: a button's or field's name, or "BODY" when it fell out of the settings. */
    const focused = () => p1.page.evaluate(() => {
      const e = document.activeElement as HTMLElement | null;
      return !e || e === document.body ? "BODY" : `${e.tagName.toLowerCase()}:${e.getAttribute("name") ?? e.textContent?.trim() ?? ""}`;
    });
    await anth.getByRole("button", { name: "Add a key" }).focus();
    await p1.page.keyboard.press("Enter");
    check((await focused()) === "input:key-anthropic", `Add a key puts focus in the key field (${await focused()})`);
    await anth.getByRole("button", { name: "Cancel" }).focus();
    await p1.page.keyboard.press("Enter");
    check((await focused()) === "button:Add a key", `Cancel puts focus back on Add a key (${await focused()})`);
    await anth.getByRole("button", { name: "Add a key" }).click();
    await anth.locator('input[type="password"]').fill(KEY);
    check((await anth.locator('input[type="password"]').getAttribute("autocomplete")) === "off", "the key field is a password field with autocomplete off");
    await shot(p1, "anthropic-form", ".coachprov");
    await anth.getByRole("button", { name: "Save" }).click();
    await stateOf(p1, "Anthropic API key", /Key ending …yyyy · sonnet/);
    check((await focused()) === "button:Change", `after Save, focus is on the row's Change button (${await focused()})`);
    check((await anth.locator('input[type="password"]').count()) === 0 && !(await p1.page.content()).includes(KEY), "after saving, the page holds only the key's last four characters");

    const oai = rowOf(p1, "OpenAI API key");
    await oai.getByRole("button", { name: "Add a key" }).click();
    await oai.locator('input[type="password"]').fill("short");
    await oai.getByRole("button", { name: "Save" }).click();
    const refused = await oai.getByRole("alert").filter({ hasText: /8 to 4096 characters/ }).waitFor({ timeout: 5000 }).then(() => true, () => false);
    check(refused, "a key that is too short is refused with the server's reason");
    await shot(p1, "openai-refused", ".coachprov");
    await oai.getByRole("button", { name: "Cancel" }).click();
    check((await oai.getByRole("alert").count()) === 0, "Cancel clears the refusal");

    const ep = rowOf(p1, "Other provider (Responses API)");
    await ep.getByRole("button", { name: "Set up a provider" }).click();
    check((await ep.locator('select[name="preset"] option').allTextContents()).length === 7, "the endpoint offers seven presets");
    await ep.locator('select[name="preset"]').selectOption("azure");
    check((await ep.locator('input[name="baseUrl"]').inputValue()) === "https://RESOURCE.openai.azure.com/openai/v1" && (await ep.locator('input[type="password"]').count()) === 1, "the Azure preset fills its address and asks for a key");
    await ep.locator('select[name="preset"]').selectOption("ollama");
    check((await ep.locator('input[name="baseUrl"]').inputValue()) === "http://127.0.0.1:11434/v1" && /^API key \(optional\)/.test((await ep.locator(".field").filter({ has: p1.page.locator('input[type="password"]') }).textContent()) ?? ""), "the Ollama preset fills its address and makes the key optional (for Ollama's cloud)");
    await ep.locator('input[name="model-endpoint"]').fill("gpt-oss:20b");
    await shot(p1, "endpoint-form", ".coachprov");
    await ep.getByRole("button", { name: "Save" }).click();
    await stateOf(p1, "Other provider (Responses API)", /Ollama · 127\.0\.0\.1:11434 · gpt-oss:20b · no key/);

    // The device sign-in: start, show the code, cancel.
    const { box } = await deviceCode(p1);
    await box.getByRole("button", { name: "Cancel" }).click();
    await box.waitFor({ state: "detached" });
    const idle = await fetch(`${base}/api/coach/providers/chatgpt/login`, { headers }).then((r) => r.json());
    check(idle.state === "idle", "Cancel stops the sign-in");
    await shot(p1, "rows-set-up", ".coachprov");

    // ---- The same rows, and the sign-in panel, in dark and on a desktop.
    for (const [label, w, h, scheme] of [["phone-dark", 390, 844, "dark"], ["desktop-light", 1280, 900, "light"], ["desktop-dark", 1280, 900, "dark"]] as const) {
      const c = await open(label, w, h, scheme);
      await settings(c);
      await shot(c, "rows-set-up", ".coachprov");
      const d = await deviceCode(c);
      await d.box.getByRole("button", { name: "Cancel" }).click();
      await d.box.waitFor({ state: "detached" });
      await openChat(c);
      await shot(c, "chat-picker");
      await c.page.getByRole("dialog", { name: "Coach" }).getByRole("button", { name: "Coach settings" }).click();
      await c.page.locator(".chatsettings .provrow").first().waitFor();
      await shot(c, "chat-settings");
    }

    // ---- Back on the phone: finish the sign-in, then chat through the picker.
    size = "coach-phone-light";
    const again = rowOf(p1, "ChatGPT plan (signed in here)");
    await again.getByRole("button", { name: "Sign in with a code" }).click();
    await again.locator(".devicebox").waitFor();
    writeFileSync(join(fakeDir, "device-ok"), "ok");
    await stateOf(p1, "ChatGPT plan (signed in here)", /^Ready: Signed in here$/);
    check((await again.locator(".devicebox").count()) === 0 && (await again.getByRole("button", { name: "Sign out" }).count()) === 1, "the panel closes and the row offers Sign out");
    await shot(p1, "chatgpt-signed-in", ".coachprov");

    await openChat(p1);
    const dlg = p1.page.getByRole("dialog", { name: "Coach" });
    const picker = dlg.locator("select.coachpick");
    const options = (await picker.locator("option").allTextContents()).join(",");
    check(options === "Claude plan,ChatGPT host,ChatGPT sign-in,Anthropic API,Other provider", `the coach picker lists the ready coaches (${options})`);
    await shot(p1, "chat-picker");
    const say = async (provider: string, message: string) => {
      await picker.selectOption(provider);
      await dlg.locator(".composer textarea").fill(message);
      await dlg.getByRole("button", { name: "Send", exact: true }).click();
      await p1.page.waitForFunction(() => !document.querySelector(".thinking") && document.querySelectorAll(".chat .msg.assistant").length > 0, null, { timeout: 20_000 });
      const calls = readFileSync(join(fakeDir, "calls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { argv: string[]; input?: string; CLAUDE_CONFIG_DIR: string | null });
      return { errors: await dlg.locator(".msg.error").count(), last: calls.filter((x) => x.input?.includes(message)).at(-1) };
    };
    const a = await say("anthropic", "Hello from the Anthropic coach");
    check(a.errors === 0 && a.last?.CLAUDE_CONFIG_DIR === join(env, "state", "cli", "anthropic"), "a chat on the Anthropic key answers, in its own config folder");
    await shot(p1, "chat-anthropic");
    const h = await say("claude", "Hello from the host login");
    check(h.errors === 0 && h.last?.CLAUDE_CONFIG_DIR === null, "a chat on this computer's Claude login answers");
    await dlg.getByRole("button", { name: "Done" }).click();

    // ---- Remove everything: the key, the endpoint, the ChatGPT sign-in.
    for (const [label, button, after] of [["Anthropic API key", "Remove", /^Not ready: No key saved$/], ["Other provider (Responses API)", "Remove", /^Not ready: Not set up$/], ["ChatGPT plan (signed in here)", "Sign out", /^Not ready: Not signed in$/]] as const) {
      p1.page.once("dialog", (d) => void d.accept());
      await rowOf(p1, label).getByRole("button", { name: button }).click();
      await stateOf(p1, label, after);
    }
    check(!existsSync(join(env, "state", "cli", "chatgpt", "auth.json")), "signing out removes Codex's auth.json");
    await shot(p1, "rows-removed", ".coachprov");
    for (const c of contexts.splice(0)) {
      size = `coach-${c.label}`;
      check(c.errors.length === 0, `no page or console errors${c.errors.length ? `: ${c.errors.join(" | ")}` : ""}`);
      await c.close();
    }

    // ---- Host logins turned off: no coach is set up, and the old host-login conversation can only be replaced.
    await stop();
    srv = await startServer(env, { bin, codexBin, log: serverLog, env: { STRUNA_COACH_HOST_LOGINS: "0" } });
    const refusedChat = await fetch(`${base}/api/chat`, { method: "POST", headers, body: JSON.stringify({ provider: "claude", message: "Hi" }) });
    size = "coach-off";
    check(refusedChat.status === 400, "with host logins off, a chat on the host login is refused");
    for (const [label, w, h2, scheme] of [["off-phone-light", 390, 844, "light"], ["off-desktop-dark", 1280, 900, "dark"]] as const) {
      const c = await open(label, w, h2, scheme);
      await openChat(c);
      const d = c.page.getByRole("dialog", { name: "Coach" });
      const none = await d.locator(".notice").filter({ hasText: "No coach is set up." }).waitFor({ timeout: 10_000 }).then(() => true, () => false);
      check(none, "the empty conversation says no coach is set up");
      check((await d.locator("select.coachpick").count()) === 0, "and offers no coach to pick");
      await shot(c, "no-coach");
      await d.locator(".notice").getByRole("button", { name: "Coach settings" }).click();
      await d.locator(".chatsettings .provrow").first().waitFor();
      const offeredNow = (await d.locator(".chatsettings .provname").allTextContents()).join(",");
      check(offeredNow === "ChatGPT plan (signed in here),Anthropic API key,OpenAI API key,Amazon Bedrock (Claude),Other provider (Responses API)", `the panel's settings leave out the host logins (${offeredNow})`);
      await shot(c, "no-coach-settings");
      await d.getByRole("button", { name: "Back to the conversation" }).click();
      await d.getByRole("button", { name: "Conversations" }).click();
      await d.locator(".convopen").filter({ hasText: "Hello from the host login" }).click();
      const off = await d.locator(".notice").filter({ hasText: "which is turned off here. Start a new conversation with another coach." }).waitFor({ timeout: 10_000 }).then(() => true, () => false);
      check(off && (await d.locator(".composer textarea").count()) === 0 && (await d.locator(".promptrow").count()) === 0, "an old host-login conversation asks for a new conversation instead of offering Send or prompts");
      await shot(c, "old-conversation");
      await d.getByRole("button", { name: "New conversation" }).click();
      const noneNow = await d.locator(".composer.nocoach .notice").filter({ hasText: "No coach is set up." }).waitFor({ timeout: 5000 }).then(() => true, () => false);
      check(noneNow && (await d.locator(".composer textarea").count()) === 0, "with no coach set up, New conversation offers Coach settings instead of a Send that would fail");
      size = `coach-${label}`;
      check(c.errors.length === 0, `no page or console errors${c.errors.length ? `: ${c.errors.join(" | ")}` : ""}`);
      await c.close();
    }
  } finally {
    for (const c of contexts) await c.close().catch(() => {});
    await stop();
  }
  size = "coach";
  const places: [string, string][] = [
    ["the server's output", readFileSync(serverLog, "utf8")],
    ["the database", readFileSync(join(env, "state", "struna.sqlite")).toString("latin1")],
    ["the responses the pages got", bodies.join("\n")],
    ["the pages", doms.join("\n")],
    ["the stand-in's log", readFileSync(join(fakeDir, "calls.jsonl"), "utf8")],
  ];
  for (const [where, t] of places) check(!t.includes(KEY), `the dummy key is not in ${where}`);
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
  await coachWalk(browser).catch((e) => check(false, `the coach walk stopped: ${String((e as Error).message ?? e).split("\n")[0]}`));
} finally {
  await browser.close();
}
if (failures.length) {
  console.error(`\n${failures.length} failed:\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("\nall checks passed");
