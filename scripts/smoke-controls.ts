/** Scratch-only control regressions for roadmap #2. Never deletes an existing fixture.
 * pnpm build && node scripts/smoke-controls.ts <new-scratch-dir> [issue=28]
 * All providers are stand-ins. Screenshots and checks stay in the scratch directory.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { chromium, type Page } from "playwright-core";
import { nextStage } from "./practice-steps.ts";
import { starterPlan } from "../server/generic/starter.ts";
import { normalizeProfile } from "../server/generic/studio.ts";
import { writeFakeBin } from "./fake-coach-cli.ts";

const dir = resolve(process.argv[2]!);
const issue = process.argv[3] ?? "28";
mkdirSync(dir); // Refuse to overwrite another run.
const home = join(dir, "home");
mkdirSync(join(home, "plan"), { recursive: true });
const date = new Date().toISOString();
const profile = normalizeProfile({ level: "beginner" }, date);
writeFileSync(join(home, "profile.json"), JSON.stringify(profile));
const plan = starterPlan(profile, date.slice(0, 10));
if (issue === "18" || issue === "20") {
  mkdirSync(join(home, "materials"), { recursive: true });
  plan.materials = Array.from({ length: 30 }, (_, i) => {
    const label = i === 0 ? "Old Joe Clark — melody and alternating bass practice" : i === 1 ? "ArtistWorks/Bluegrass guitar/" + "Long musical title with slow variations ".repeat(4) + ".md" : `Exercise ${i + 1}`;
    const file = `materials/exercise-${i}.md`;
    writeFileSync(join(home, file), issue === "20" ? `# Exercise ${i + 1}\n\n## Fingering\n\nPlay slowly.\n\n\`\`\`\nD   DU  UD U\n1 & 2 & 3 & 4 &\n\`\`\`` : `# Exercise ${i + 1}\n\nPlay slowly.`);
    return { label, file, note: "Scratch lesson source; melody and accompaniment" };
  });
}
writeFileSync(join(home, "plan/plan.json"), JSON.stringify(plan));
const fake = writeFakeBin(join(dir, "fake"));
const port = await new Promise<number>((resolve) => {
  const s = createServer().listen(0, "127.0.0.1", () => {
    const p = (s.address() as { port: number }).port;
    s.close(() => resolve(p));
  });
});
const base = `http://localhost:${port}`;
const server = spawn(process.execPath, ["server/index.ts"], {
  env: { ...process.env, NODE_ENV: "production", PORT: String(port), STRUNA_MODE: "studio", STRUNA_COACH_WEB: issue === "19" ? "1" : "0",
    STRUNA_HOME: home, STRUNA_STATE_DIR: join(dir, "state"), STRUNA_CACHE_DIR: join(dir, "cache"),
    STRUNA_LIBRARY_DIRS: "", STRUNA_TABS_DIR: "", CLAUDE_BIN: fake, CODEX_BIN: fake },
  stdio: ["ignore", "ignore", "pipe"],
});
let serverLog = "";
server.stderr.on("data", (b) => { serverLog += b; });
const checks: string[] = [];
function check(ok: unknown, message: string) { assert(ok, message); checks.push(message); }
async function fits(page: Page) {
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "No page horizontal scroll");
}
async function theme(page: Page) {
  const group = page.getByRole("radiogroup", { name: "Theme", exact: true });
  for (const name of ["Light", "Dark", "Device"]) {
    const option = group.getByRole("radio", { name, exact: true });
    await option.focus();
    await page.keyboard.press("Space");
    check(await option.getAttribute("aria-checked") === "true", `${name}: keyboard selection`);
    check(await option.evaluate((e) => e.matches(":focus-visible") && getComputedStyle(e).outlineStyle !== "none"), `${name}: visible focus`);
    check(await option.evaluate((e) => e.scrollWidth <= e.clientWidth), `${name}: label fits`);
    await fits(page);
    await page.screenshot({ path: join(dir, `${(await page.evaluate(() => innerWidth))}-${name}.png`), fullPage: true });
  }
  await group.getByRole("radio").evaluateAll((els) => els.forEach((el) => { el.textContent = `${el.textContent} ${el.textContent}`; }));
  check(await group.getByRole("radio").evaluateAll((els) => els.every((e) => e.scrollWidth <= e.clientWidth)), "Doubled labels fit");
  await fits(page);
  await page.screenshot({ path: join(dir, `${(await page.evaluate(() => innerWidth))}-doubled.png`), fullPage: true });
}
async function panePicker(page: Page) {
  await page.getByRole("radio", { name: /Short session/ }).click();
  await page.getByRole("button", { name: /^Start \d+ min$/ }).click();
  const add = page.getByRole("button", { name: "Add pane", exact: true });
  const menu = page.getByRole("menu", { name: "Choose pane content" });
  for (const mode of ["light", "dark", "Device"]) {
    await page.evaluate((mode) => {
      if (mode === "Device") delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = mode;
    }, mode);
    await add.focus();
    await page.keyboard.press("Enter");
    await menu.waitFor();
    check(await menu.locator(".pane-picker-title").evaluate((e) => getComputedStyle(e).display !== "none") === ((await page.evaluate(() => innerWidth)) < 720), "Narrow picker exposes a visible sheet title");
    check(await menu.getByRole("menuitem").first().evaluate((e) => e === document.activeElement), "Picker initially focuses first choice");
    check(await menu.evaluate((e) => e.scrollHeight > e.clientHeight && e.clientHeight <= innerHeight - 24), "Long picker scrolls within viewport");
    check(await menu.getByRole("menuitem").evaluateAll((els) => els.every((e) => e.scrollWidth <= e.clientWidth)), "Complete choice labels wrap without clipping");
    const pickerBounds = await menu.evaluate((e) => { const r = e.getBoundingClientRect(); const add = document.querySelector<HTMLElement>("[aria-haspopup='menu'][aria-expanded='true']")?.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth, height: innerHeight, overlapsOpener: Boolean(add && r.left < add.right && r.right > add.left && r.top < add.bottom && r.bottom > add.top) }; });
    check(pickerBounds.left >= -1 && pickerBounds.right <= pickerBounds.width + 1 && pickerBounds.top >= -1 && pickerBounds.bottom <= pickerBounds.height + 1, `Picker edges stay in viewport (${JSON.stringify(pickerBounds)})`);
    check((await page.evaluate(() => innerWidth)) < 720 || !pickerBounds.overlapsOpener, `Desktop picker does not cover its opener (${JSON.stringify(pickerBounds)})`);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    const long = menu.getByRole("menuitem").nth(2);
    check(await long.locator("span").textContent() === plan.materials[1]!.label.split("/").pop()!.replace(/\.md$/, ""), "Musical title comes before source");
    check((await long.getAttribute("role")) === "menuitem" && (await long.getAttribute("aria-label"))?.includes(plan.materials[1]!.label), "Full resource label remains in accessible choice text");
    await menu.getByRole("menuitem", { name: "Source details", exact: true }).click();
    check((await menu.locator(".pane-source-details").innerText()).includes(plan.materials[1]!.label), "Source details exposes the complete resource identity");
    await menu.getByRole("menuitem", { name: "Back to choices", exact: true }).click();
    await page.screenshot({ path: join(dir, `${(await page.evaluate(() => innerWidth))}-${mode}-picker.png`), fullPage: true });
    const scrollBeforeDismissal = await page.evaluate(() => scrollY);
    await page.keyboard.press("Escape");
    check(await add.evaluate((e) => e === document.activeElement), "Escape restores exact Add opener");
    check(await page.evaluate(() => scrollY) === scrollBeforeDismissal, "Escape keeps the reading page scroll position");
    await add.click();
    await page.evaluate(() => { (window as Window & { outsideClicks?: number }).outsideClicks = 0; addEventListener("click", () => { (window as unknown as Window & { outsideClicks: number }).outsideClicks++; }); });
    await page.mouse.click(2, 2);
    check(await add.evaluate((e) => e === document.activeElement), "Outside close restores Add opener");
    check(await page.evaluate(() => (window as Window & { outsideClicks?: number }).outsideClicks) === 0, "Outside dismissal does not click through to page content");
    await add.click();
    const panesBeforeSecondTap = await page.locator(".pane .panetitle").allTextContents();
    const addBox = await add.boundingBox();
    assert(addBox, "Add pane has a clickable box");
    await add.evaluate((e) => { (e as HTMLElement).dataset.secondTapClicks = "0"; e.addEventListener("click", () => { e.dataset.secondTapClicks = String(Number(e.dataset.secondTapClicks) + 1); }, { once: true }); });
    await page.mouse.click(addBox.x + addBox.width / 2, addBox.y + addBox.height / 2);
    check(JSON.stringify(await page.locator(".pane .panetitle").allTextContents()) === JSON.stringify(panesBeforeSecondTap), "A second activation at Add never chooses a resource");
    if ((await page.evaluate(() => innerWidth)) < 720) check(await add.getAttribute("data-second-tap-clicks") === "0", "A guarded sheet tap does not click through to Add");
    if (await menu.count()) await page.keyboard.press("Escape");
    await add.click();
    const closePicker = menu.getByRole("menuitem", { name: "Close picker", exact: true });
    if (await closePicker.isVisible()) {
      await closePicker.click();
      check(await add.evaluate((e) => e === document.activeElement), "Visible Close restores the exact Add opener");
    } else {
      await page.keyboard.press("Escape");
    }
    await add.click();
    await menu.getByRole("menuitem").nth(2).click();
    await menu.waitFor({ state: "detached" });
    check(await page.locator(".pane:visible .mdoc").filter({ hasText: "Exercise 2" }).innerText() === "Exercise 2\n\nPlay slowly.", "Touch/pointer choice opens selected resource");
    const change = page.locator(".pane:visible").last().getByRole("button", { name: /^Change what/ });
    await change.focus();
    await page.keyboard.press("Enter");
    await menu.waitFor();
    await page.keyboard.press("Escape");
    check(await change.evaluate((e) => e === document.activeElement), "Escape restores exact replacement opener");
    await change.focus();
    await page.keyboard.press("Enter");
    await menu.waitFor();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await menu.waitFor({ state: "detached" });
    check(await page.locator(".pane:visible .mdoc").filter({ hasText: "Exercise 3" }).innerText() === "Exercise 3\n\nPlay slowly.", "Keyboard replacement opens selected resource");
    await fits(page);
  }
  while (await page.locator(".pane").count() < 4) {
    const n = await page.locator(".pane").count();
    await add.press("Enter");
    await menu.getByRole("menuitem").nth(10 + n).press("Enter");
    await menu.waitFor({ state: "detached" });
  }
  check(await page.locator(".pane:visible [aria-haspopup='menu']").evaluateAll((els) => els.some((e) => e === document.activeElement)), "Adding fourth pane restores focus to visible control after Add disappears");
  await page.locator(".pane:visible [aria-haspopup='menu']").last().press("Enter");
  await menu.getByRole("menuitem").nth(25).press("Enter");
  await menu.waitFor({ state: "detached" });
  check(await page.locator(".pane:visible [aria-haspopup='menu']").evaluateAll((els) => els.some((e) => e === document.activeElement)), "Replacing fourth pane restores focus to visible replacement control");

}
async function coachModal(page: Page) {
  let turns = 0;
  page.on("request", (r) => { if (r.method() === "POST" && new URL(r.url()).pathname === "/api/chat") turns++; });
  const header = page.locator(".top").getByRole("button", { name: "Coach", exact: true });
  const dialog = page.getByRole("dialog", { name: "Coach", exact: true });
  const inside = () => page.waitForFunction(() => document.querySelector(".chat")?.contains(document.activeElement));
  await header.focus();
  await page.keyboard.press("Enter");
  await dialog.waitFor();
  await inside();
  await dialog.getByRole("textbox", { name: "Message", exact: true }).fill("Unsent practice question");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await page.waitForTimeout(300); // Also cover the historical slide-out delay.
  const restored = await header.evaluate((e) => e === document.activeElement);
  writeFileSync(join(dir, `focus-${(await page.evaluate(() => innerWidth))}.json`), JSON.stringify({ restored, active: await page.evaluate(() => document.activeElement?.tagName) }));
  check(restored, "Escape restores exact header opener");
  await header.press("Enter");
  await dialog.waitFor();
  check(await dialog.getByRole("textbox", { name: "Message", exact: true }).inputValue() === "Unsent practice question", "Unsent draft survives dismissal");
  const cycle = async (view: string) => {
    for (const key of ["Tab", "Shift+Tab"]) {
      for (let i = 0; i < 18; i++) {
        await page.keyboard.press(key);
        check(await dialog.evaluate((e) => e.contains(document.activeElement)), `${view}: ${key} remains inside modal`);
      }
    }
    await header.evaluate((e) => e.focus());
    check(await dialog.evaluate((e) => e.contains(document.activeElement)), `${view}: background cannot take focus`);
  };
  await cycle("conversation");
  await dialog.getByRole("button", { name: "Coach settings", exact: true }).first().click();
  await dialog.locator(".chatsettings .provrow").first().waitFor();
  await cycle("settings");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  check(await header.evaluate((e) => e === document.activeElement), "Done from settings restores header");
  const more = page.locator(".gstart .morechip");
  await more.focus();
  await page.keyboard.press("Enter");
  await dialog.locator(".promptsheet").waitFor();
  await inside();
  await cycle("prompt list");
  await page.screenshot({ path: join(dir, `${(await page.evaluate(() => innerWidth))}-${await page.locator("html").getAttribute("data-theme") ?? "Device"}-coach-prompts.png`), fullPage: true });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  check(await more.evaluate((e) => e === document.activeElement), "Escape restores exact More opener");
  // A delayed stand-in request must complete exactly once across dismissal.
  writeFileSync(join(dir, "fake/slow"), "600");
  await header.press("Enter");
  const input = dialog.getByRole("textbox", { name: "Message", exact: true });
  await input.fill("Modal lifecycle one request");
  await dialog.getByRole("button", { name: "Send", exact: true }).click();
  await dialog.locator(".thinking").waitFor();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await header.press("Enter");
  await dialog.locator(".thinking").waitFor({ state: "detached" });
  check(await dialog.locator(".msg.assistant").count() > 0 && await dialog.locator(".msg.error").count() === 0, "Running stand-in request completes after dismissal");
  check(turns === 1, "Dismissal does not duplicate request");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  const prompt = page.locator(".gstart .promptchips button").first();
  await prompt.press("Enter");
  await dialog.waitFor();
  await inside();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  check(await prompt.evaluate((e) => e === document.activeElement), "Context prompt restores exact launcher");
  // A removed context opener falls back to the header.
  await more.press("Enter");
  await dialog.waitFor();
  await more.evaluate((e) => e.remove());
  await page.keyboard.press("Escape");
  check(await header.evaluate((e) => e === document.activeElement), "Removed launcher falls back to header Coach");
  if ((await page.evaluate(() => innerHeight)) < 500) return; // Session reader-space overlap is tracked separately.
  await page.getByRole("button", { name: /^Short session/ }).click();
  await page.getByRole("button", { name: "Open a pane", exact: true }).press("Enter");
  await page.getByRole("menuitem", { name: "Coach", exact: true }).click();
  const embedded = page.locator(".pane-coach .chatbody");
  await embedded.waitFor();
  await embedded.getByRole("textbox", { name: "Message", exact: true }).focus();
  await page.keyboard.press("Escape");
  check(await embedded.isVisible() && await dialog.count() === 0, "Embedded Coach is nonmodal and ignores Escape");
  await header.focus();
  check(await header.evaluate((e) => e === document.activeElement), "Embedded Coach permits normal page focus");
  await page.goto(`${base}/#materials`);
  await page.getByRole("button", { name: "Find online", exact: true }).press("Enter");
  await page.getByRole("textbox", { name: "What do you want to learn or play?", exact: true }).fill("Slow chord changes (stand-in only)");
  await page.getByRole("button", { name: "Find and add materials", exact: true }).press("Enter");
  const hiddenContext = page.getByRole("button", { name: "Open Coach conversation", exact: true });
  await hiddenContext.press("Enter");
  await dialog.waitFor();
  await inside();
  await page.keyboard.press("Escape");
  check(await hiddenContext.evaluate((e) => e === document.activeElement), "Hidden workspace Coach permits Materials modal and restores its current opener");
}
async function semantics(page: Page) {
  await page.goto(`${base}/#materials`);
  await page.getByRole("button", { name: "Add", exact: true }).press("Enter");
  const choose = page.getByRole("button", { name: "Choose files", exact: true });
  await choose.focus();
  const cdp = await page.context().newCDPSession(page);
  const ax = await cdp.send("Accessibility.getFullAXTree");
  const exposed = ax.nodes.filter((n) => !n.ignored).map((n) => ({ role: n.role?.value, name: n.name?.value }));
  writeFileSync(join(dir, `upload-ax-${(await page.evaluate(() => innerWidth))}.json`), JSON.stringify(exposed, null, 2));
  check(await choose.evaluate((e) => e === document.activeElement && getComputedStyle(e).outlineStyle !== "none"), "Choose files has visible keyboard focus");
  check(!exposed.some((n) => n.role === "button" && !n.name), "Upload tree has no unnamed exposed button");
  check(await page.locator('input[type="file"]').evaluate((e) => (e as HTMLInputElement).tabIndex === -1), "Native upload is outside tab order");
  const chooserEvent = page.waitForEvent("filechooser");
  await choose.press("Space");
  const chooser = await chooserEvent;
  await chooser.setFiles({ name: `Accessible lesson-${(await page.evaluate(() => innerWidth))}-${await page.locator("html").getAttribute("data-theme") ?? "Device"}.md`, mimeType: "text/markdown", buffer: Buffer.from("# Lesson heading\n\n## Fingering\n\n\`\`\`\nD   DU  UD U\n1 & 2 & 3 & 4 &\n\`\`\`") });
  await page.locator(".itemopen").filter({ hasText: `Accessible lesson-${(await page.evaluate(() => innerWidth))}-${await page.locator("html").getAttribute("data-theme") ?? "Device"}` }).click();
  await page.locator(".mdoc").waitFor();
  check(await page.getByRole("heading", { level: 1 }).count() === 1, "Materials detail exposes one h1");
  check(await page.getByRole("heading", { level: 2, name: "Lesson heading" }).count() === 1 && await page.getByRole("heading", { level: 3, name: "Fingering" }).count() === 1, "Markdown headings nest below the view heading");
  check(await page.locator(".mdoc pre code").textContent() === "D   DU  UD U\n1 & 2 & 3 & 4 &\n", "Tab spaces survive Markdown rendering");
  await page.screenshot({ path: join(dir, `${(await page.evaluate(() => innerWidth))}-${await page.locator("html").getAttribute("data-theme") ?? "Device"}-material.png`), fullPage: true });
  await page.goto(`${base}/#practice`);
  await page.getByRole("button", { name: /^Short session/ }).click();
  await page.locator(".pane .mdoc").waitFor();
  check(await page.getByRole("heading", { level: 1 }).count() === 1, "Active practice exposes one h1 with Markdown open");
  const states = page.locator(".sessionstatus");
  const state = (text: string) => states.getByRole("status").filter({ hasText: new RegExp(`^${text}$`) });
  await state("Timer paused").waitFor();
  await page.getByRole("button", { name: "Start the stage timer", exact: true }).press("Enter");
  await state("Timer running").waitFor();
  await page.locator(".tempocol").press("Enter");
  await state("Click count-in").waitFor();
  await state("Click running").waitFor();
  await states.evaluate((e) => {
    e.setAttribute("data-mutations", "0");
    new MutationObserver((records) => e.setAttribute("data-mutations", String(Number(e.getAttribute("data-mutations")) + records.length)))
      .observe(e, { childList: true, subtree: true, characterData: true });
  });
  await page.waitForTimeout(1100); // Several timer ticks and at least one beat.
  check(await states.getAttribute("data-mutations") === "0", "Live text does not mutate on timer ticks or click beats");
  check(await page.locator(".clock .t").evaluate((e) => !e.closest('[aria-live], [role="status"]')), "Ticking clock is outside live regions");
  await page.getByRole("button", { name: "Pause the stage timer", exact: true }).press("Enter");
  await state("Timer paused").waitFor();
  await page.locator(".tempocol").press("Enter");
  await state("Click stopped").waitFor();
  const tools = page.getByRole("button", { name: "Tools", exact: true });
  if (await tools.isVisible()) await tools.press("Enter");
  const record = page.getByRole("button", { name: "Record take", exact: true });
  await record.focus();
  check(await record.evaluate((e) => e.matches(":focus-visible") && getComputedStyle(e).outlineStyle !== "none"), "Recording control has visible keyboard focus");
  await page.keyboard.press("Enter");
  await state("Recording take").waitFor();
  await page.waitForTimeout(1100); // Chromium's synthetic microphone, not hardware audio evidence.
  await page.getByRole("button", { name: /^Stop take/ }).press("Enter");
  await state("Take ready to save").waitFor();
  let refuse = true;
  await page.route("**/api/recordings?**", async (r) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (refuse) await r.fulfill({ status: 503, json: { error: "Scratch save failure" } });
    else await r.continue();
  });
  const save = page.getByRole("button", { name: "Save take", exact: true });
  await save.press("Enter");
  await state("Saving take").waitFor();
  await state("The take was not saved: Scratch save failure").waitFor();
  refuse = false;
  await save.press("Enter");
  await state("Take saved").waitFor();
  check(await page.locator(".takesaved").count() === 1, "Scratch take save success remains visible");
  await page.screenshot({ path: join(dir, `${(await page.evaluate(() => innerWidth))}-${await page.locator("html").getAttribute("data-theme") ?? "Device"}-practice-status.png`), fullPage: true });
  while (await page.getByRole("button", { name: /^Next stage/ }).count()) await nextStage(page);
  await page.getByRole("button", { name: /^Finish/ }).press("Enter");
  let refuseLog = true;
  await page.route("**/api/sessions", async (r) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (refuseLog) await r.fulfill({ status: 503, json: { error: "Scratch log failure" } });
    else await r.continue();
  });
  const logState = page.locator(".greview [role='status']");
  const write = page.getByRole("button", { name: "Write the log", exact: true });
  await write.press("Enter");
  await logState.filter({ hasText: "Saving session log" }).waitFor();
  await logState.filter({ hasText: "The log was not written. Scratch log failure" }).waitFor();
  refuseLog = false;
  await write.press("Enter");
  await page.getByRole("status").filter({ hasText: /^Session log saved$/ }).waitFor();
  check(await page.getByRole("heading", { level: 1, name: "Log written" }).count() === 1, "Log success remains visible with polite status");
}
try {
  for (let i = 0; ; i++) {
    if (server.exitCode !== null) throw new Error("Scratch server exited");
    if (await fetch(`${base}/api/health`).then((r) => r.ok, () => false)) break;
    assert(i < 100, "Scratch server starts");
    await new Promise((r) => setTimeout(r, 100));
  }
  const token = readFileSync(join(dir, "state/access-token"), "utf8").trim();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  try {
    for (const [width, height] of [[320, 700], [390, 844], [844, 390], [1153, 814], [1003, 814], [502, 407]]) {
      for (const mode of issue === "19" || issue === "20" ? ["light", "dark", "Device"] : ["light"]) {
      const context = width === 502
        ? await chromium.launchPersistentContext(join(dir, `zoom-profile-${mode}`), { executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"], viewport: { width: 1003, height: 814 } })
        : await browser.newContext({ viewport: { width: width!, height: height! }, colorScheme: "light" });
      if (width === 502) {
        const settings = await context.newPage();
        await settings.goto("chrome://settings/appearance");
        await settings.evaluate(async () => {
          const { chrome } = globalThis as unknown as { chrome: { settingsPrivate: { setDefaultZoom: (factor: number) => Promise<void> } } };
          await chrome.settingsPrivate.setDefaultZoom(2);
        });
        await settings.close();
      }
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
      await page.goto(`${base}/?token=${token}`);
      await page.locator(".gstart").waitFor();
      if (width === 502) check(await page.evaluate(() => innerWidth === 501 && devicePixelRatio === 2), "Native desktop zoom is 200% at 1003×814");
      await page.emulateMedia({ colorScheme: mode === "Device" ? "dark" : "light" });
      await page.evaluate((mode) => { if (mode !== "Device") document.documentElement.dataset.theme = mode; }, mode);
      if (issue === "28") await theme(page);
      if (issue === "18") await panePicker(page);
      if (issue === "19") await coachModal(page);
      if (issue === "20") {
        try { await semantics(page); }
        catch (error) {
          await page.screenshot({ path: join(dir, `${width}-${mode}-failure.png`), fullPage: true });
          writeFileSync(join(dir, "partial-checks.json"), JSON.stringify({ checks, error: String(error), active: await page.evaluate(() => document.activeElement?.outerHTML) }, null, 2));
          throw error;
        }
      }
      check(!errors.length, `${width}: no page errors`);
      await context.close();
      }
    }
  } finally { await browser.close(); }
  writeFileSync(join(dir, "checks.json"), JSON.stringify({ issue, checks }, null, 2));
  console.log(`Issue #${issue}: ${checks.length} checks passed. Artifacts: ${dir}`);
} finally {
  writeFileSync(join(dir, "server.log"), serverLog);
  server.kill();
  await new Promise((resolve) => server.exitCode !== null ? resolve(null) : server.once("exit", resolve));
}
