# Guitar Room: Practice, Tools and Chat Implementation Plan (Plan A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A private web app on Kvant, published at `guitar.subcult.tv` behind Authelia. Practice is the default screen and runs today's session from the Ars Malefica practice plan. It has a tuner, a metronome and a Claude/ChatGPT chat that uses the owner's subscriptions.

**Architecture:**
- Same shape as `~/Work/Lab/practice-coach`: a Node 24 `node:http` server written in TypeScript and run directly by Node, plus a Vite/React single-page app.
- The server reads the vault and writes only new session-log files. It serves vault PDFs from the Guitar thread, stores app state in `node:sqlite`, and streams chat by running the signed-in `claude` and `codex` programs.
- Audio (metronome, tuner, take recording) runs entirely in the browser.

**Tech stack:**
- Node 24.22 (type stripping, `node:test`, `node:sqlite`), pnpm, TypeScript 7.
- Vite 8, React 19, `pdfjs-dist`.
- Web Audio with an AudioWorklet, MediaRecorder.
- systemd user unit, Caddy and Authelia on Almaz.

**Spec:** `/home/shared/Work/Lab/guitar-room-design/design.md`. The visual reference is `design-system.html` in the same folder; its views are `?view=practice|tuner|metronome&theme=light|dark`. Plan B, `2026-11-13-guitar-room-library-tabs.md`, adds the Library and Tabs screens on top of this plan.

## Global Constraints

- **Repository:** Gitea `PatrickFanella/guitar-room`, private, Gitea workflow. Checkout at `~/Work/PatrickFanella/guitar-room`. Commit as `SUBCULT Agent <info@subcult.tv>` with `-c commit.gpgsign=false`.
- **Server:** listens on `HOST=127.0.0.1`, `PORT=5182`. Reject any `Host` not in `localhost`, `127.0.0.1`, `[::1]` or `ALLOWED_HOSTS` (production: `guitar.subcult.tv`) with 403. When `REQUIRE_USER` is set (production: `onnwee`), reject requests whose `Remote-User` header differs, with 403. Every response carries `X-Robots-Tag: noindex, nofollow`.
- **Paths:**
  - Vault root: `~/Work/Vaults/Ars Malefica` (env `GUITAR_VAULT_ROOT`).
  - Thread: `001 Projects/Threads/Guitar`.
  - Practice folder: `<thread>/Practice`.
  - Media root: `~/Documents/Reference Library/Ars Malefica/Guitar` (env `GUITAR_MEDIA_ROOT`).
  - State: `~/.local/state/guitar-room/`. Cache: `~/.cache/guitar-room/`.
- **Vault writes:** the app creates new files only, under `<Practice>/Logs/`, and never edits or commits existing notes. Recordings go to `<media>/Recordings/<block-id>/<YYYY-MM-DD>-<label>.<ext>`, not the vault.
- **Dates:** session dates use time zone `America/Chicago`.
- **Full session stages:** Set the target 2, Prepare the motion 5, Build vocabulary 8, Train the mechanism 10, Apply it to music 15, Record and review 5 (minutes).
- **Short session stages:** Target and relaxed motion 2, Vocabulary 4, Musical phrase 6, Record and next instruction 3.
- **Session types:** sessions 1–2 decode, 3–4 connect, 5–6 vary, 7 prove. A week is seven counted sessions; weeks are capped at 4.
- **Tempo helper:** three clean passes suggest +3 BPM (the range is +2–5; the owner can change it). One miss: repeat at the same tempo. A second miss: suggest −4 BPM or a shorter loop.
- **Tuner:** in-tune zone ±5 cents. A4 from 432 to 446 Hz, default 440. Tunings:
  - standard `E2 A2 D3 G3 B3 E4`;
  - drop D `D2 A2 D3 G3 B3 E4`;
  - double drop D `D2 A2 D3 G3 B3 D4`.
- **Metronome:** time signatures `2/4, 3/4, 4/4, 6/8`. Subdivisions quarter, eighth, triplet, sixteenth. ±2 BPM steps. Tap tempo. Count-in on or off. BPM clamped to 30–300.
- **Visual system:** tokens, fonts and component styles come verbatim from `design-system.html` (round 10, commit `a5e78e0` in the design repository).
  - Pencil `#C2271B` / `#F87D70` marks only what is happening now.
  - Solid ink is the one principal action per screen.
  - Selection is a wash fill with a 2px ink outline.
  - Source Serif 4 is for headings, big numbers and any label containing digits; Atkinson Hyperlegible Next for everything else.
  - Copy has no middle dots, no "→" and no all-caps labels.
- **Chat:**
  - Child processes get `subscriptionEnv()`, which removes `ANTHROPIC_*`, `CLAUDE_CODE_*` (except `CLAUDE_CODE_OAUTH_TOKEN`), `OPENAI_*` and `CODEX_API_KEY`. Never fall back to an API key; show the CLI's error text.
  - The chat may write only inside `<thread>/`. Claude's only allowed Bash command is `python3 .agents/skills/guitar-practice-coach/scripts/validate-practice-system.py`. Codex runs with the thread folder as its working directory, a `workspace-write` sandbox and network off.
  - Neither may commit or push.

## Review Focus

1. **Blank or placeholder logs** (`00 BPM`, `___ BPM`, an empty Clean working tempo) do not count as sessions. A log with the pain flag set to yes is shown but not counted. Tested in Task 3.
2. **A second save on the same date** never overwrites. It creates `Practice Log - YYYY-MM-DD (2).md`, then `(3)`, and so on, even when two saves race. Tested in Task 4.
3. **A missing note** (an active-block path that doesn't exist, or a wikilink to a missing PDF) shows a readable message on the start screen and marks the material missing. The server keeps running. Tested in Tasks 2 and 5.
4. **File requests outside the Guitar thread** (`../`, absolute paths, URL-encoded traversal, symlinks pointing out) are refused with 404. Tested in Task 5.
5. **A denied microphone, or Safari's recorder format,** shows "Microphone access is off" with a retry. Recording picks `audio/mp4` when `audio/webm` isn't supported, and the file gets the matching extension. Tested in Tasks 8 and 9.

---

### Task 1: Repository, server skeleton and guards

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `.gitignore`, `README.md`, `docs/design.md`, `docs/design-system.html` (copies from the design repository), `docs/plans/` (copies of both plans)
- Create: `server/config.ts`, `server/http.ts`, `server/index.ts`
- Test: `server/http.test.ts`

**Interfaces:**
- Produces:
  - `config` (`server/config.ts`), with fields `host, port, production, allowedHosts: Set<string>, requireUser?: string, vaultRoot, threadDir, practiceDir, mediaRoot, stateDir, cacheDir, timeZone: "America/Chicago", claudeBin, codexBin, claudeModel?, codexModel?, chatTimeoutMs: 300_000`.
  - `HttpError(status, message)`.
  - `guard(req): void` throws 403 on a bad host or user.
  - `send(res, status, body)` sends JSON with the noindex header.
  - `readJson(req): Promise<any>` with a 1 MB limit.
  - `route(method, path, handler)` registers a route on the router in `server/index.ts`.
  - In production the server serves the built app from `dist/`, falling back to `index.html` for paths without `/api/`.

- [ ] **Step 1:** Create the Gitea repository: `tea repo create --login subcult-agent --owner PatrickFanella --name guitar-room --private`. Clone it to `~/Work/PatrickFanella/guitar-room`. Copy `package.json` scripts, engines and dev dependencies from practice-coach, renaming the package to `guitar-room` and dropping CodeMirror. Add `pdfjs-dist`. Run `pnpm install`.
- [ ] **Step 2: Write failing tests** in `server/http.test.ts`:
  - `guard` accepts host `localhost:5182`;
  - it rejects `evil.example` with status 403;
  - with `requireUser: "onnwee"`, a request whose `remote-user` is `mallory` gets 403 and `onnwee` passes;
  - `send` sets `x-robots-tag` to `noindex, nofollow`.
- [ ] **Step 3:** Run `pnpm test`. Expected: FAIL, module not found.
- [ ] **Step 4:** Implement `server/config.ts`, `server/http.ts` and `server/index.ts`, with `GET /api/health` returning `{ ok: true }`.
- [ ] **Step 5:** Run `pnpm test` and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 6:** Commit `feat: server skeleton with host and user guards`.

### Task 2: Read the active block from the vault

**Files:**
- Create: `server/vault.ts`, `server/frontmatter.ts`
- Test: `server/vault.test.ts`
- Fixtures: `server/fixtures/vault/001 Projects/Threads/Guitar/Practice/{Current Practice Block.md, Practice Progress Ledger.md, Blocks/G Vocabulary and Nine Pound Hammer - Block 01.md, Logs/Practice Log - 2026-08-26.md, Materials/Aaron Jaxon - Blues Scales for Bluegrass Guitar.pdf}`. These are copies of the real notes; the PDF can be a one-page stub.

**Interfaces:**
- Produces:
  - `type Week = { n: number; title: string; vocabulary: string; mechanism: string; music: string; improvisation: string }`
  - `type Material = { label: string; path: string; kind: "pdf" | "tg" | "other"; exists: boolean }`. `path` is relative to the vault root.
  - `type Block = { id: string; title: string; path: string; started: string; targetSessions: number; goal: string; weeks: Week[]; materials: Material[]; crossTraining: string[] }`
  - `type Ledger = { nextEvidence: string; lastReview: string | null }`. `lastReview` is the `YYYY-MM-DD` from the "Last review" line.
  - `readActiveBlock(vaultRoot): Promise<Block>` and `readLedger(vaultRoot): Promise<Ledger>`.
  - Both throw `VaultError(message)` when a file is missing.

- [ ] **Step 1: Write failing tests:**
  - the fixture block gives `id === "g-vocabulary-nine-pound-hammer-01"`, `started === "2026-08-06"`, `targetSessions === 28` and `weeks.length === 4`;
  - `weeks[0].vocabulary` starts with `"G major-blues pattern 1 and G minor-blues pattern 1"`;
  - `weeks[0].improvisation` starts with `"over G–C–G–D"`;
  - `materials` includes `{ kind: "pdf", exists: true }` for the Aaron Jaxon PDF and `{ kind: "tg", exists: false }` for `G Major Pentatonic - 3 note patterns.tg` (not in the fixture);
  - `crossTraining.length === 2`;
  - the ledger gives `nextEvidence` starting with `"establish a clean working tempo"` and `lastReview === "2026-08-06"`;
  - pointing the pointer at a missing block rejects with `VaultError`.
- [ ] **Step 2:** Run `node --test server/vault.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - The pointer is the `active-block:` front-matter key in `Practice/Current Practice Block.md`.
  - Weeks are the `## Week N — <title>` headings. The four fields are the paragraphs that start with `**Vocabulary:**`, `**Mechanism:**`, `**Music:**` and `**Improvisation constraint:**`.
  - Materials are every `[[target|label]]` or `[[target]]` wikilink in `## Anchor material`. Resolve a target in this order: as a vault-relative path; with `.md` removed; then by file-name search under the thread folder.
  - Cross-training is the bullet list under `## Optional cross-training day`.
  - The goal is the `> [!goal]` callout text.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat: read active practice block and ledger from the vault`.

### Task 3: Count sessions and place today's session

**Files:**
- Create: `server/sessions.ts`
- Test: `server/sessions.test.ts`

**Interfaces:**
- Produces:
  - `type LogFacts = { file: string; date: string; cleanTempo: number | null; kind: "full" | "floor" | "cross-training" | null; pain: boolean; nextInstruction: string | null }`
  - `parseLog(file: string, text: string): LogFacts`
  - `countSessions(logs: LogFacts[], blockStarted: string): { full: number; floor: number; counted: LogFacts[] }`
  - `type SessionType = "decode" | "connect" | "vary" | "prove"`
  - `placeSession(counted: number, weekOverride?: number): { week: number; sessionInWeek: number; type: SessionType; number: number }`
  - `nextInstruction(counted: LogFacts[], ledger: Ledger): { text: string; source: "log" | "ledger" }`
  - `readLogs(practiceDir): Promise<LogFacts[]>`

- [ ] **Step 1: Write failing tests:**
  - the real 2026-08-26 fixture log parses to `cleanTempo === null`, because `00 BPM` is a placeholder;
  - a log with `**Clean working tempo:** 84 BPM, eighth notes` gives `84`;
  - `___ BPM` gives `null`;
  - `**Session:** connect, floor` gives `kind "floor"`, and `**Session:** cross-training` gives `kind "cross-training"`;
  - `**Pain, numbness, or persistent tension:** yes — stop` gives `pain: true`;
  - `countSessions` excludes `null` tempo, `pain: true`, `cross-training` and logs dated before `blockStarted`;
  - `placeSession(0)` gives `{ week: 1, sessionInWeek: 1, type: "decode", number: 1 }`, `placeSession(6)` gives `prove`, `placeSession(7)` gives week 2 `decode`, and `placeSession(40)` keeps `week === 4`;
  - `placeSession(0, 3)` gives week 3, session 1;
  - `nextInstruction` returns the latest counted log's instruction when its date is after `ledger.lastReview`, and otherwise the ledger's `nextEvidence`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - The date comes from the `Practice Log - YYYY-MM-DD` file name (with an optional ` (n)` suffix).
  - `cleanTempo` is the first integer in the line, counted only when it is greater than 0.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat: evidence-based session counting`.

### Task 4: Write session logs

**Files:**
- Create: `server/logs.ts`
- Test: `server/logs.test.ts`

**Interfaces:**
- Consumes: `Block` from Task 2 and `placeSession` from Task 3.
- Produces:
  - `type SessionReview = { blockTitle: string; blockId: string; type: SessionType | "cross-training"; length: "full" | "floor"; material: string; target: string; startTempo: string; cleanTempo: string; subdivision: string; threePass: "met" | "not met"; recall: "memory" | "cue map" | "page-dependent"; recording?: { path: string; label: "baseline" | "weekly" | "midpoint" | "final"; purpose: string }; pain: boolean; improvement: string; failure: string; next: string; observation?: string }`
  - `writeSessionLog(practiceDir: string, review: SessionReview, now: Date, timeZone: string): Promise<{ file: string }>`

- [ ] **Step 1: Write failing tests** against a temporary directory:
  - the output for a fixed `now = 2026-11-14T03:30:00Z` is named `Practice Log - 2026-11-13.md`, because the date is in America/Chicago;
  - the front matter has `title: practice-log-2026-11-13`, `type: thread-note`, `status: active`, `created`/`updated: 2026-11-13`, `threads: - "[[Guitar]]"`, `tags: - method/practice-log - topic/guitar-practice`;
  - the body has every line of `Practice Log Template.md` filled. `**Session:** decode, full`. `**Clean working tempo:** 72 BPM, eighth notes`. `**Pain, numbness, or persistent tension:** no`. `**Agent audio assessment:** not assessed`. The `## Next instruction` section holds `review.next`;
  - a second call on the same date writes `(2)`, and two concurrent calls produce `.md` and `(2).md`;
  - an existing file is never overwritten.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Open each candidate name with flag `wx` and increment the suffix on `EEXIST`. Render from a template string that mirrors `Practice Log Template.md` line for line.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat: write new practice logs without touching existing notes`.

### Task 5: Practice API and app state

**Files:**
- Create: `server/db.ts`, `server/practice.ts`, `server/files.ts`
- Modify: `server/index.ts` (routes)
- Test: `server/practice.test.ts`, `server/files.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces:
  - `openDb(stateDir): DatabaseSync`, with tables `settings(key TEXT PRIMARY KEY, value TEXT)` and `tempos(fragment TEXT PRIMARY KEY, bpm INTEGER, subdivision TEXT, updated TEXT)`.
  - `GET /api/today` returns `{ block, position: ReturnType<typeof placeSession>, counts: {full, floor}, next: {text, source}, stages: { full: Stage[]; floor: Stage[] }, overDue: boolean, error?: string }`, where `Stage = { key: "target"|"prepare"|"vocabulary"|"mechanism"|"music"|"review"; title: string; minutes: number; output: string; weekField?: keyof Week }`. `overDue` is true when counted ≥ `targetSessions`.
  - `PUT /api/week-override {week: 1..4 | null}`.
  - `GET /api/tempos`, `PUT /api/tempos {fragment, bpm, subdivision}`.
  - `POST /api/sessions` takes a `SessionReview` and returns `{file}`.
  - `GET /api/vault-file?path=<vault-relative>` streams a file from the thread folder.
  - `resolveThreadFile(threadDir, rel): Promise<string>` returns the real path or throws a 404.

- [ ] **Step 1: Write failing tests:**
  - `GET /api/today` against the fixture vault returns `position.type === "decode"`, `stages.full.map(s => s.minutes)` equal to `[2,5,8,10,15,5]` and `stages.floor` equal to `[2,4,6,3]`;
  - with the block file renamed, it returns 200 with `error` set and `block: null`;
  - `resolveThreadFile` rejects `../../etc/passwd`, `%2e%2e/x`, an absolute `/etc/passwd`, and a symlink inside the thread that points outside it;
  - the week override persists across a new `openDb` on the same directory.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. The stage `output` text is the "Required output" column of the practice system's session table, copied verbatim. `weekField` maps vocabulary to `vocabulary`, mechanism to `mechanism` and music to `music`, with the improvisation constraint appended. The PDF content type is `application/pdf`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat: practice API, app state and safe vault file serving`.

### Task 6: App shell and visual system

**Files:**
- Create: `index.html`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/styles/tokens.css`, `web/src/styles/components.css`, `web/src/icons.tsx`, `web/src/api.ts`, `scripts/capture.ts`

**Interfaces:**
- Produces:
  - `<App>` with the header (wordmark, Tuner and Coach buttons) and the bottom tabs (Practice, Library, Tabs).
  - Library and Tabs render an empty state, "Coming soon", until Plan B.
  - `api.get<T>(path)`, `api.put`, `api.post`.
  - CSS custom properties exactly as in `design-system.html`; theme follows `prefers-color-scheme`, with a manual toggle stored in `localStorage`.
  - The icon set (`i-fork`, `i-chat`, `i-stand`, `i-books`, `i-tab`, `i-check`, `i-down`, `n-q`, `n-8`, `n-3`, `n-16`) copied from the mockup's SVG symbols.
  - `scripts/capture.ts`, ported from practice-coach's `scripts/capture.ts`, writes phone (390×844 at 2x) and iPad (820×1180) screenshots of a running dev server.

- [ ] **Step 1:** Port the tokens, the type scale with its `min-width: 700px` overrides, and the component styles from `design-system.html` into the two CSS files. Load the Google Fonts link for Atkinson Hyperlegible Next 400/600/700 and Source Serif 4 600/700.
- [ ] **Step 2:** Implement the shell. Run `pnpm dev` and `node scripts/capture.ts`. Expected: the header and tab bar match the mockup in both themes at both sizes. Compare side by side with the round 10 screenshots in the design repository.
- [ ] **Step 3:** Run `pnpm typecheck && pnpm build`. Expected: PASS.
- [ ] **Step 4:** Commit `feat: app shell in the Method book design system`.

### Task 7: Metronome engine

**Files:**
- Create: `web/src/audio/beats.ts`, `web/src/audio/metronome.ts`, `web/src/audio/tempo.ts`, `web/src/tools/Metronome.tsx`, `web/src/tools/ToolsSheet.tsx`
- Test: `web/src/audio/beats.test.ts`, `web/src/audio/tempo.test.ts`

**Interfaces:**
- Produces:
  - `scheduleBeats({ start: number, bpm: number, beatsPerBar: number, subdivision: 1|2|3|4, from: number, until: number }): { time: number; beat: number; sub: number; accent: boolean }[]`
  - `tapTempo(taps: number[]): number | null`. This is the median of the last up to 6 intervals. A gap longer than 2000 ms starts over. The result is clamped to 30–300 and returns `null` with fewer than 2 taps.
  - `tempoHelper(state: { cleans: number; misses: number }, event: "clean" | "miss"): { state; suggestion: { kind: "raise" | "repeat" | "lower"; delta: number } | null }`
  - `class Metronome { start(); stop(); set(opts: { bpm; beatsPerBar; subdivision; countIn: boolean }); onBeat(cb: (beat: number) => void) }`, a singleton shared by the practice row and the tools sheet.
  - `<ToolsSheet initial="tuner"|"metronome">` with the switch, Done, and Tuner/Metronome segments.

- [ ] **Step 1: Write failing tests:**
  - `scheduleBeats` at 60 BPM in 4/4 with eighths from 0 to 2 s gives 4 events at 0, 0.5, 1.0 and 1.5; only `time 0` has `accent: true`; `sub` alternates 0, 1;
  - at triplets, the spacing is 1/3 s;
  - `tapTempo([0,500,1000,1500])` is `120`;
  - `tapTempo([0,500,3000])` is `null`, because the gap reset leaves too few taps;
  - `tapTempo([0, 100, 200])` is `300`, clamped;
  - `tempoHelper` after three `clean` events suggests `{ kind: "raise", delta: 3 }` and resets cleans to 0;
  - one `miss` suggests `repeat`, and a second `miss` suggests `{ kind: "lower", delta: -4 }`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - A lookahead scheduler: every 25 ms, schedule beats up to 100 ms ahead on `AudioContext.currentTime`, as short oscillator clicks. The accent is 1500 Hz, the beat 1000 Hz and the subdivision 700 Hz at lower gain.
  - Implement `Metronome.tsx` per the mockup: the hanging time signature, BPM, beat dots with the accent wedge, Time and Count-in, Tempo (−2, Tap, +2), the 2×2 subdivision grid on phone, and Stop.
- [ ] **Step 4:** Run the tests. Expected: PASS. Run `pnpm dev`, open the metronome and listen at 72 BPM in eighths for a steady click.
- [ ] **Step 5:** Commit `feat: metronome engine and sheet`.

### Task 8: Tuner

**Files:**
- Create: `web/src/audio/pitch.ts`, `web/public/pitch-worklet.js`, `web/src/audio/mic.ts`, `web/src/tools/Tuner.tsx`
- Test: `web/src/audio/pitch.test.ts`

**Interfaces:**
- Produces:
  - `yin(buf: Float32Array, sampleRate: number, threshold = 0.12): number | null`, the frequency in Hz.
  - `noteFor(freq: number, a4 = 440): { name: string; octave: number; cents: number; midi: number }`
  - `TUNINGS: Record<"standard" | "dropD" | "doubleDropD", string[]>`
  - `openMic(): Promise<MediaStream>` uses `{ echoCancellation: false, noiseSuppression: false, autoGainControl: false }` and throws `MicDenied` on `NotAllowedError`.
  - `stopMic(stream)`.

- [ ] **Step 1: Write failing tests** with synthetic sines at 48 kHz over 4096 samples:
  - `yin` on 82.41 Hz is within 0.5 Hz, and on 146.83 Hz within 0.5 Hz;
  - on silence it is `null`;
  - `noteFor(82.41)` gives `{ name: "E", octave: 2 }` with `|cents| < 2`;
  - `noteFor(146.83 * 2**(-12/1200))` gives `D3` with `cents ≈ -12`;
  - `noteFor(440, 432)` gives `A4` with `cents ≈ +31`;
  - the `TUNINGS` arrays are exactly as in Global Constraints.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - The YIN difference function with cumulative mean normalization and parabolic interpolation, searching 60–1100 Hz so the low E and a capo at the 7th fret both work.
  - The worklet posts frames of 4096 samples with a hop of 1024.
  - `Tuner.tsx` per the mockup: the note readout and the cents reading in serif ("12 cents flat", "In tune" inside ±5 cents), the ±50 scale with the zone, the string chips (tuned, current and untuned), the Tuning and Pitch pickers, and the "Microphone access is off" state with Try again.
  - Release the mic when the sheet closes or switches to Metronome.
- [ ] **Step 4:** Run the tests. Expected: PASS. In the dev server, play an open D string, or a tone from another device, and see D3 near 0 cents.
- [ ] **Step 5:** Commit `feat: chromatic tuner`.

### Task 9: Practice session screen

**Files:**
- Create: `web/src/practice/Start.tsx`, `web/src/practice/Session.tsx`, `web/src/practice/StageBar.tsx`, `web/src/practice/Material.tsx`, `web/src/practice/TempoRow.tsx`, `web/src/practice/Review.tsx`, `web/src/audio/record.ts`, `server/recordings.ts`
- Modify: `server/index.ts` (adds `POST /api/recordings`)
- Test: `server/recordings.test.ts`, `web/src/audio/record.test.ts`

**Interfaces:**
- Consumes: `/api/today`, `/api/tempos`, `/api/sessions`, `/api/vault-file`, `Metronome`, `tempoHelper`, `<ToolsSheet>`.
- Produces:
  - `pickRecorderType(isSupported: (t: string) => boolean): { mime: string; ext: "webm" | "m4a" }` prefers `audio/webm;codecs=opus`, then `audio/mp4`.
  - `POST /api/recordings?blockId=&label=&ext=` takes the raw body and returns `{ path }` (media-root-relative). It writes `<media>/Recordings/<blockId>/<YYYY-MM-DD>-<label>.<ext>`, adding `-2`, `-3` and so on when the name exists. Labels are limited to `baseline|weekly|midpoint|final`, and the size to 200 MB.

- [ ] **Step 1: Write failing tests:**
  - `pickRecorderType(t => t === "audio/mp4")` returns `{ mime: "audio/mp4", ext: "m4a" }`;
  - `POST /api/recordings` stores `Recordings/g-vocabulary-nine-pound-hammer-01/2026-11-13-baseline.webm` in a temporary media root, and a second call gives `...-baseline-2.webm`;
  - `label=evil` returns 400, and `blockId=../x` returns 400.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement the screens per the mockup and the design's Practice section.
  - **Start:** the block, the week and session, "Next" from `/api/today`, and the buttons Full session (45 min), Short session (15 min), the block's cross-training option, and Tune. Show a review prompt when `overDue` is true, and the week override control.
  - **Session:**
    - the proportional stage bar (pencil outline and elapsed fill on the current stage; done stages as a wash with an ink check);
    - the stage heading, plus the week field text for vocabulary, mechanism and music;
    - a countdown with a soft chime at zero, which never advances on its own;
    - the material pane (pdf.js, with the page remembered per file in `localStorage`; a `.tg` shows "Export to Guitar Pro to view here");
    - the tempo row (BPM and subdivision, a four-dot beat row, Log clean pass with tick boxes driving `tempoHelper` and showing its suggestion);
    - Next stage (solid ink, with the next stage named), Record take, and Stop: pain or tension;
    - the screen wake lock while a session runs.
  - **Review:** the fields of `SessionReview`, with taps for enumerations and text fields for the rest. Prefill from the session (material, tempos, recording). Submitting posts `/api/sessions` and shows the file name written.
  - **Stop: pain or tension:** skips straight to the review with `pain: true`.
- [ ] **Step 4:** Run the tests. Expected: PASS. In the dev server, run a 15-minute short session against a scratch copy of the vault (`GUITAR_VAULT_ROOT=/tmp/...`), record a take and submit. Expected: a new log file whose text matches the template, and a recording file. Run `node scripts/capture.ts` and compare with the mockup's practice views.
- [ ] **Step 5:** Commit `feat: practice session screen`.

### Task 10: Coach chat

**Files:**
- Create: `server/providers/process.ts` (copied from practice-coach unchanged), `server/providers/claude.ts`, `server/providers/codex.ts`, `server/chat.ts`, `server/conversations.ts`, `web/src/chat/Chat.tsx`
- Test: `server/providers/args.test.ts`, `server/conversations.test.ts`

**Interfaces:**
- Consumes: `config`, `openDb`, `/api/today` data.
- Produces:
  - `claudeArgs({ system, threadId?, model?, vaultRoot, threadRel, mediaRoot }): string[]`
  - `codexArgs({ system, threadId?, model? }): string[]`. Codex's working directory is `<vault>/<threadRel>`.
  - `claudeChat(req)` and `codexChat(req)`: `AsyncGenerator<ChatEvent>`, as in practice-coach.
  - `buildContext(screen: { view: string; stage?: string; fragment?: string; bpm?: number; subdivision?: string }, today): string`.
  - Conversations table: `conversations(id TEXT PK, provider TEXT, title TEXT, thread_id TEXT, created TEXT, updated TEXT)`. Messages table: `messages(conversation TEXT, role TEXT, text TEXT, created TEXT)`.
  - `POST /api/chat {conversation?, provider: "claude"|"codex", message, screen}` responds with SSE events `thread`, `delta`, `notice`, `error` and `done`, and a `: keepalive` comment every 15 s.
  - `GET /api/conversations`, `GET /api/conversations/:id`, `PATCH /api/conversations/:id {title}`, `DELETE /api/conversations/:id`.
  - The last provider used is stored in `settings` under the key `provider`.

- [ ] **Step 1: Write failing tests:**
  - `claudeArgs` includes `-p`, `--output-format stream-json` and `--include-partial-messages`;
  - its `--tools` value is `Read,Glob,Grep,Edit,Write,Bash`;
  - its `--allowedTools` value contains `Edit(001 Projects/Threads/Guitar/**)`, `Write(001 Projects/Threads/Guitar/**)` and `Bash(python3 .agents/skills/guitar-practice-coach/scripts/validate-practice-system.py:*)`;
  - it includes `--strict-mcp-config` and `--add-dir <mediaRoot>`, and no `WebFetch` or `WebSearch`;
  - `--resume <id>` appears only when `threadId` is set;
  - `codexArgs` includes `exec`, `--json`, `--ignore-user-config`, `-c sandbox_mode="workspace-write"`, `-c sandbox_workspace_write.network_access=false` and `-c approval_policy="never"`, and uses `exec resume <id>` when `threadId` is set;
  - the conversations store round-trips create, append, rename and delete;
  - `buildContext` includes the block title, `Week 1, session 1: decode`, the stage, `72 BPM, eighth notes` and the next instruction text.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - The system prompt (the same for both providers) tells the coach: you are the owner's guitar practice coach in Ars Malefica; read and follow `.agents/skills/guitar-practice-coach/SKILL.md` when reviewing or planning practice; write only inside `001 Projects/Threads/Guitar/`; never commit or push; Super Productivity is unavailable, so list task changes for the owner instead of making them.
  - Prefix each user message with `buildContext(...)`. Abort the child when the response closes.
  - Show CLI errors verbatim. Show `notice` when Claude reports an API key source.
  - `Chat.tsx` is a slide-over panel: the provider switch, the conversation list (rename, delete), streaming markdown with `react-markdown` and `remark-gfm` as in practice-coach, and Stop.
- [ ] **Step 4:** Run the tests. Expected: PASS. Run a live smoke test from the dev server for each provider: ask "What is my next instruction?" and expect an answer that names the Block 01 baseline. Then ask the coach to create `001 Projects/Threads/Guitar/Practice/_chat-write-test.md` (expected: created) and `003 Resources/_chat-write-test.md` (expected: refused). Delete the test file afterwards.
- [ ] **Step 5:** Commit `feat: coach chat on Claude and ChatGPT subscriptions`.

### Task 11: Deploy behind Authelia and document

**Files:**
- Create: `deploy/guitar-room.service`, `deploy/guitar-room-edge-tunnel.service`, `deploy/guitar.Caddyfile`
- Modify: `README.md`
- Modify (vault, outside the repository): Machinum `10-inventory/Host Briefings/kvant.md` and `almaz.md`

**Interfaces:**
- Consumes: the built app (`pnpm build`) and the server.
- Produces:
  - Kvant user unit `guitar-room.service`, a copy of practice-coach's unit with `PORT=5182`, `ALLOWED_HOSTS=guitar.subcult.tv`, `REQUIRE_USER=onnwee` and `WorkingDirectory=%h/Work/PatrickFanella/guitar-room`.
  - Almaz user unit `guitar-room-edge-tunnel.service`, a copy of `practice-coach-edge-tunnel.service` with the forward `172.20.0.1:34948 → 127.0.0.1:5182`. Before choosing 34948, confirm it's free with `ss -ltn | grep 34948`.
  - Almaz `sites/guitar.Caddyfile`, a copy of `practice-coach.Caddyfile` with host `guitar.subcult.tv`, the upstream `172.20.0.1:34948` and `flush_interval -1`.

- [ ] **Step 1:** Run `pnpm build`. Install and start `guitar-room.service`. Expected: `curl -s -H 'Host: localhost' http://127.0.0.1:5182/api/health` returns `{"ok":true}`, and `curl -s -o /dev/null -w '%{http_code}' -H 'Host: guitar.subcult.tv' http://127.0.0.1:5182/api/health` returns `403` (no Remote-User).
- [ ] **Step 2:** On Almaz, install the tunnel unit and the site file. Back up the main Caddyfile first. Validate the Caddy config in the same way practice-coach's site was validated, then reload.
- [ ] **Step 3:** Check from outside. `curl -s -o /dev/null -w '%{http_code} %{redirect_url}' https://guitar.subcult.tv/` should give a 302 to `auth.subcult.tv`. Expected: no page content without login. Record that a signed-in browser session and startup after a reboot are not checked.
- [ ] **Step 4:** Write the README: purpose; configuration variables; how chat avoids the APIs (adapted from practice-coach); what the app writes; deployment and rollback (`systemctl --user disable --now guitar-room.service`, remove the Almaz site file and tunnel unit, reload Caddy).
- [ ] **Step 5:** Add a dated section to the Kvant and Almaz host briefings in Machinum, in the style of the Practice Coach entry. Run the documentation audit (`rtk proxy python "/home/onnwee/Work/Vaults/Ars Malefica/scripts/documentation.py" audit`). Commit and push Machinum.
- [ ] **Step 6:** Commit `chore: deployment units and README` and push to Gitea.
