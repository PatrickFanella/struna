# Struna: design

Date: 2026-11-13. Status: draft for owner approval.

Visual update, November 14, 2026: [Struna’s app system](struna-design.md) replaces the Method book palette and typography. This document retains the original product design; `design-system.html` is a historical layout study.

## Intent

A private web app for practicing guitar on Kvant. When the owner opens it with the guitar in hand, it starts today's session from the plan already in the Ars Malefica vault. The lesson library is a secondary area, and the Guitar Pro tab collection is a third. A chat panel talks to Claude or ChatGPT through the owner's existing subscriptions, with no API keys.

The vault plan already exists and is unused: the progress ledger still says "baseline pending" from 2026-08-06, and the one session log (2026-08-26) is mostly blank. The app exists to lower the friction of starting a session and to capture evidence without typing into Obsidian.

## Goals

1. Open the app and start today's session in one tap. The session follows the vault's practice system.
2. During the session: the current block's material on screen, a stage timer, a metronome, a clean-pass tempo helper, and recording a take. A chromatic tuner and a standalone metronome are available from any screen.
3. At the end, write a session log into the vault in the existing template's format.
4. A chat panel using the Claude subscription (`claude` CLI) or ChatGPT subscription (`codex` CLI). It knows the current block and screen, and can use the vault's `guitar-practice-coach` skill.
5. A searchable library of all guitar lesson media: videos, PDFs, ebooks.
6. A separate browser for the Guitar Pro tab collection, with a tab player.
7. Public URL behind Authelia, usable from an iPad or phone on a music stand.

## Non-goals

- Tabs from the 24,600-file Guitar Pro collection are not part of lessons or blocks. That collection is browse-only.
- No API-key access to model providers, and no offering the app to anyone else.
- The app does not advance blocks, decide weekly reviews, or edit the ledger's decisions. Those stay with the owner and the coach skill (in chat or another agent session).
- No Super Productivity integration in this version.
- No editing, moving or deleting of library files.
- Calibre-Web stays as it is. The books also have local copies in the Guitar folder, which the app reads.

## Anti-goals (failure even if it works)

- Making a practice session feel like using software: more than a tap or two before playing, or forms to fill in mid-session.
- Advancing on calendar time or checked boxes. The vault's rule is that only evidence advances the plan.
- Exposing the owner-only Country Guitar Online archive or the vault to anyone but the owner: a route that skips Authelia, a listener on the LAN or tailnet, or search-engine indexing.
- Giving the chat broad write or shell access to the vault or home directory.

## Constraints

- **Host:** Kvant (Debian 13, Node 24.22, ffmpeg installed). The media, the vault and the signed-in `claude` and `codex` CLIs are all here.
- **Access:** `struna.subcult.tv` through Almaz Caddy with `import authelia`. Authelia has one user (`onnwee`). The `*.subcult.tv` default policy is one-factor; no Authelia change is needed. The app listens on Kvant loopback only. Almaz reaches it through an SSH tunnel unit bound to the Caddy bridge gateway, following `prichal-public-staging-edge-tunnel.service`. Pass `ControlMaster=no,ControlPath=none` (see the Tdarr tunnel note in the Kvant briefing). As defense in depth, the app rejects requests whose Authelia `Remote-User` header is not `onnwee`. Send `X-Robots-Tag: noindex` on every response.
- **Archive handling:** the Country Guitar Online archive README says owner-only and not to sync it to public services. Serving it to the authenticated owner is fine; caching or uploading it elsewhere is not.
- **Vault writes:** the vault is a Git repository with Obsidian Sync. Other agents and devices edit it. The app writes only new files, plus appends inside its own files. It never rewrites notes it did not create, and it does not commit. The owner or the coach commits.
- **Devices:** iPad or phone on a stand first, so iOS Safari must work. Sampled videos are all H.264. 140 of 645 are `.mkv`, which Safari cannot play.
- **Subscriptions:** chat uses the CLIs' existing logins (`claude` subscription OAuth, `codex` ChatGPT login). This is single-user personal use on the owner's own machine.

## Where the material lives

All under `~/Documents/Reference Library/Ars Malefica/Guitar/` (the real path is under `/home/shared/Documents`), consolidated on 2026-11-13:

| Folder | Contents |
|---|---|
| `Lesson Videos/ArtistWorks/` | Bryan Sutton, Chris Eldridge and Tyler Grant toolkit videos and backing tracks |
| `Lesson Videos/Country Guitar Online/` | 73 free-lesson video folders with `.info.json`, thumbnails and subtitles |
| `Books/` | 7 guitar books (PDF/EPUB), including the Tony Rice Collection Tab Book; `Books/Music Books/` holds 12 files for the 9 Calibre music books. Copied back from Calibre-Web on 2026-11-14 (receipt `~/.local/state/guitar-books-from-calibre-20261114.json`) |
| `Source Archives/Country Guitar Online Assessment Archive - 2026-08-07/` | 5,231 files: 466 stream captures, 294 PDFs, MP3s, SQLite ledgers (`00-Reports-and-Ledgers/media-archive.sqlite3`, `stream-archive.sqlite3`) and `ORGANIZATION-MANIFEST.json` |
| `Restricted or Rights Review/Guitar Pro Tabs and Wiring/` | `Collection/Guitar_Pro_Tabs` (about 21,100 gp3, 3,500 gp4, 5 gp5), wiring diagrams, pedal export |
| `Restricted or Rights Review/Music Sheets/` | two zips: Real Book and fake-book PDFs, and the owner's own song sheets (`.odt`, `.docx`, `.pdf`) |

In the vault (`~/Work/Vaults/Ars Malefica/001 Projects/Threads/Guitar/`):

- `Practice/Guitar Practice System.md`: the session structure, speed rule, weekly rhythm and 15-minute floor.
- `Practice/Current Practice Block.md`: front-matter `active-block` holds the path to the active block note.
- `Practice/Blocks/*.md`: block notes, with front matter `block-id`, `started` and `target-session-count`, and `## Week N` sections that each have Vocabulary, Mechanism, Music and Improvisation constraint.
- `Practice/Practice Progress Ledger.md`: its `## Current state` section has "Next evidence needed".
- `Practice/Practice Log Template.md` and `Practice/Logs/`.
- Lesson PDFs: `Practice/Materials/*.pdf`, `Sources/Raw/ArtistWorks/**.pdf`, `Sources/Raw/Country Guitar Online/Downloads/**.pdf`, `Sources/Raw/Tony Rice/*.pdf`. Block notes link to these with wikilinks.
- `Tabs/*.tg`: four TuxGuitar studies used by Block 01.
- `Sources/Raw/Country Guitar Online/Articles/*.md`: 73 article notes with titles, source URLs and `video-archive:` paths. Use them as titles and descriptions for the CGO lesson videos.

Calibre-Web (`books.subcult.tv`, Almaz, library `/mnt/arkhiv/Books`) holds the books. On 2026-11-13 an owner-requested document triage moved the seven guitar books there and deleted their Kvant copies, and on 2026-11-14, at the owner's request, all of them were copied back to `Guitar/Books/` so they are always available on Kvant. Calibre-Web keeps its copies. Guitar books: IDs 1080, 1081, 1084, 1098, 1099, 1112 (Tony Rice Collection Tab Book) and 1113. Music books (fake books and songbooks): IDs 850–853, 988 and 1003–1006. Calibre-Web has its own PDF and EPUB reader at `/read/<id>/<format>`.

## Approaches considered

1. **One small web app on Kvant (chosen).** Practice screen, library, tab browser and chat in one page. The chat runs the signed-in CLIs from inside the vault, so it shares the practice screen's context.
2. **Open WebUI for chat plus a separate practice and library page.** A polished chat comes free, but it is two apps, the chat cannot see the practice screen, and it needs a fragile adapter that makes the CLIs look like an OpenAI API.
3. **T3 for chat plus a practice and library page.** The least chat code. But T3 threads are coding sessions that can edit files, which is awkward on a phone or iPad at the stand.

The owner chose 1, published publicly behind Authelia rather than tailnet-only.

## Design

### Screens

Bottom tabs on phone and iPad: **Practice** (default), **Library**, **Tabs**. Chat opens as a slide-over panel from any screen.

```
┌───────────────────────────────────────────┐
│ Block 01 · Week 1 · Session 2 (decode)    │
│ Next: G major-blues pattern 1 + NPH 1–2   │
├───────────────────────────────────────────┤
│ ● Set target 2:00 ▸ Prepare 5:00 ▸ ...    │
│   [ 1:42 remaining ]   [ Pause ] [ Next ] │
├───────────────────────────────────────────┤
│  (material: PDF page / tab for this stage)│
├───────────────────────────────────────────┤
│ ♩ 72  1/8  [−][+]  ▶   clean: ✓✓·  +3 BPM │
│ ● Record take                [ Chat ]     │
└───────────────────────────────────────────┘
```

### Visual direction: "Method book" (owner's choice, 2026-11-13)

The screens look like a printed method book: a white page, black engraving, and a teacher's red pencil for the one thing that needs attention now, such as the current stage, the tuner needle and target string, or the sounding beat. There are light and dark themes. The theme follows the device setting, with a manual toggle on the practice screen.

| Token | Light | Dark |
|---|---|---|
| Page | `#FCFCFA` | `#232428` (graphite, deliberately not near-black) |
| Panel | `#FFFFFF`, 1px `#E3E3DE` rule | `#2B2D32`, 1px `#393B42` rule |
| Ink (text, checks, primary button) | `#1A1A1A` | `#ECEBE6` |
| Graphite (secondary text) | `#5C5C58` | `#A3A29C` |
| Pencil (accent) | `#C2271B` | `#F87D70` |
| Empty stage | `#E3E3DE` | `#393B42` |
| Wash (selected fill, done stages) | `#EFEFEB` | `#353840` |
| Edge (control outlines, 3:1) | `#8E8E88` | `#7A7C83` |

- **Contrast:** checked on 2026-11-13. Text pairs are at least 5.3:1. Pencil is 5.7:1 (light) and 6.0:1 (dark) on its page and 5.35:1 on the dark panel. Large pencil text on the dark wash (the current string) is 4.6:1, which passes for large bold text only.
- **Type:**
  - Source Serif 4 (600/700) for headings, the stage clock and the tempo.
  - Atkinson Hyperlegible Next (400/600/700) for everything else, chosen for reading from a stand.
  - Tab fret numbers in Source Serif 4 600 with lining figures, on a panel-coloured knockout that breaks each string line. Atkinson's slashed zero is avoided in tab, where 0 means an open string. Small labels that contain numbers are set entirely in Source Serif or reworded ("left of 8 minutes") so every zero on a screen matches.
  - Load both families from Google Fonts or self-host them, and check they actually render.
- **States:** pencil marks only what is happening now (current stage, tuner needle and target string, sounding beat). Solid ink is the one principal action on a screen: Next stage on Practice, Stop on the metronome. The tuner has no solid button; Done is a quiet outline beside the Tuner/Metronome switch, and the tools open as their own sheet (grabber, Tuner/Metronome switch and Done in the first row) without the app header or tabs. A selected option is a wash fill with a 2px ink outline. Other controls use a 1.5px `--edge` outline (`#8E8E88` light, `#7A7C83` dark), which meets 3:1. Completed items (stages, clean passes, tuned strings) use graphite, ink fill or wash with a check, never color alone.
- **Shape and motion:**
  - Corners are 10px on panels and buttons. There are no shadows; panels are separated by a single rule line.
  - Motion is limited to the stage progress bar and the metronome's beat indicator. Both honor `prefers-reduced-motion`.
- **Reference mockup:** `design-system.html` (historical Method book study), kept with this design.

### Practice

- **Starting a session:** the start screen shows the active block, the current week and session type, and the ledger's "Next evidence needed". There are two buttons: **Full session (45 min)** and **Short session (15 min)**. Starting is one tap.
- **Week and session type:** these come from evidence, not the calendar. The app counts sessions since the block's `started` date and treats seven sessions as a week. Session numbers map to types: 1–2 decode, 3–4 connect, 5–6 vary, 7 prove (designer's call; see below). The owner can correct the week from the start screen; the correction is stored in the app's own state, not the vault. A missed day changes nothing. The app never moves to a new block. If the count passes the block's `target-session-count`, it shows a prompt to run a block review with the coach.
- **What counts as a session:** a log file in `Practice/Logs/` dated on or after the block's `started` date, with a clean working tempo filled in. Owner-made logs count under the same test. That leaves out the mostly blank 2026-08-26 log, so the first session the app shows for Block 01 is Week 1, Session 1, the baseline. Full and 15-minute sessions both advance the session type and are counted separately (the ledger's "N full / N floor"). A session ended with "Stop: pain or tension" is logged and flagged but does not advance the session type.
- **Cross-training day:** Block 01 has an optional cross-training session ("if a seventh session is available"). The practice system says session 7 is "prove". The start screen therefore offers cross-training as a third, optional button. A cross-training session is logged but does not advance the count, so "prove" is never skipped.
- **What's next:** the start screen shows the next instruction from whichever is newer: the latest counted log's "Next instruction", or the ledger's `## Current state` "Next evidence needed" (by its last-review date).
- **Stages:** these are the six stages from the practice system (target 2, prepare 5, vocabulary 8, mechanism 10, music 15, record and review 5), or the floor's four (2, 4, 6, 3). Each stage shows its required output and the matching part of the week's section: Vocabulary, Mechanism, Music, or Improvisation constraint. Timers count down with a soft chime and do not auto-advance; the owner taps Next.
- **Material:** the block note's wikilinks resolve to vault PDFs and `.tg` files. PDFs open inline at a remembered page. Linked `.tg` files show a notice that they need a Guitar Pro export before they can be shown; the export is a separate owner task.
- **Metronome:** Web Audio, scheduled ahead for steady timing. BPM and subdivision (1/4, 1/8, triplet, 1/16) are always shown together. It also handles accent and count-in. Screen wake lock stays on during a session.
- **Tempo helper:** encodes the speed rule. Three taps on "clean" suggest +2–5 BPM. One miss means repeat at the same tempo. A second miss suggests lowering the tempo or shortening the loop. The last clean working tempo per fragment is stored. A **Stop: pain or tension** button ends the session and records the flag.
- **Recording:** browser MediaRecorder, audio only. Each take is labeled baseline, weekly, midpoint or final, plus a one-line purpose, and saved under `Guitar/Recordings/<block-id>/<date>-<label>.<ext>` in the media folder, not the vault. That folder is created on the first saved take.
- **Ending a session:** a short review sheet, mostly taps: material and fragment, starting and clean tempo with subdivision, three-clean-pass met or not, recall, pain flag, one improvement, one limiting failure, next instruction. It writes one new file per session, `Practice/Logs/Practice Log - YYYY-MM-DD.md`, filling every field of `Practice Log Template.md`, with `Session:` set to the session type and full or floor. A second session on the same day gets `Practice Log - YYYY-MM-DD (2).md`, and so on. The app never edits an existing log.

### Tuner and metronome

One sheet with two segments, **Tuner** and **Metronome**. A button in the header opens it from any screen. The session start screen also has a **Tune** button, so tuning comes before the first stage. Reference mockup: `design-system.html` (historical tools study).

- **Tuner:** chromatic, from the device microphone.
  - Shows the nearest note with its octave, a cents reading in words ("12 cents flat", "In tune"), and a needle on a −50 to +50 scale with a ±5-cent in-tune zone.
  - A row of string buttons for the selected tuning marks strings already tuned this sitting. Choosing a string fixes the target note; otherwise the tuner follows whatever note it hears.
  - Tunings: standard, drop D and double drop D, which are the ones the library's lessons use. A4 reference is adjustable from 432 to 446 Hz, default 440.
  - The red pencil marks the needle and the current string; in tune shows as text, not color alone.
  - **Builder notes:**
    - Request the microphone with echo cancellation, noise suppression and auto gain turned off, or iOS will distort the pitch.
    - Run pitch detection (for example YIN or McLeod) in an AudioWorklet.
    - Detection must handle the low E (82 Hz) and a capo up to the 7th fret.
    - The microphone is released when the sheet closes.
- **Metronome:** the same engine as the session metronome, so a tempo set here carries into the session and back.
  - Large BPM with time signature (2/4, 3/4, 4/4, 6/8). Beat dots: the sounding beat fills in pencil red (pencil always means "now"); the accented first beat has a heavier ink ring and an ink accent mark (>).
  - −2 / +2 and tap tempo, plus a subdivision choice (quarter, eighth, triplet, sixteenth).
  - Start and stop; count-in on or off.
  - Sound is scheduled ahead on the Web Audio clock, not with timers, so it stays steady when the screen is busy. It keeps running while the sheet is closed until stopped.
  - The session's clean-pass tempo helper stays in the session screen; this standalone metronome has no speed trainer.
- **Microphone sharing:** the tuner and take recording do not run at the same time. Starting a recording closes the tuner.

### Library

- **Index:** one SQLite search index (FTS5) built by a scan job over the Guitar media folder and the vault lesson PDFs. It records path, kind, title, source, size and duration. CGO lesson titles and descriptions come from the vault article notes and the videos' `.info.json`. The ArtistWorks titles come from the toolkit note. Books use their file names, cleaned of the `(z-library…)` suffix. The archive's duplicate encodings of the same lesson are grouped under one title, with the CGO article note as the key.
- **Browse and search:** by source (ArtistWorks, Country Guitar Online, books, music books, archive, vault lessons) and by kind. Free-text search covers titles and descriptions.
- **Viewing:**
  - Videos stream with HTTP range support.
  - `.mkv` files are remuxed once to MP4 on first play, copying the video stream; audio is converted to AAC if Safari can't play the original. The remuxed copies are cached outside the media folder.
  - PDFs open in pdf.js and EPUBs in an EPUB reader.
  - The Music Sheets zips are listed by entry and opened from inside the zip.
  - Books open in the app: PDFs in pdf.js, EPUBs in an EPUB reader. Each book also links to its Calibre-Web page (`books.subcult.tv/book/<id>`).
- **"Use in practice":** opens the item in the practice material pane for the current session only. It does not change the block.

### Tabs

- A file-name index over `Collection/Guitar_Pro_Tabs` with search by artist and title.
- alphaTab renders and plays gp3, gp4 and gp5, with tempo control and looping a bar range.
- Separate from Practice and never suggested inside sessions.

### Chat

- **Providers:** Claude, through `claude -p` with streaming JSON output, resumed with `--resume <session-id>`. ChatGPT, through `codex exec --json`, resumed with `codex exec resume <id>`. The owner picks a provider per conversation, and the choice is remembered.
- **Context:** both run inside the vault's Git repository, so the vault's root `AGENTS.md` loads. Claude Code does not discover skills in `.agents/skills/`, so the app's system prompt tells both providers to read and follow `.agents/skills/guitar-practice-coach/SKILL.md` when reviewing or planning practice. Each message is prefixed with a short context block: screen, block, week and session, current stage, fragment, metronome tempo, and the next instruction.
- **Limits:** chat may read the vault and the Guitar media folder. It may write only inside the Guitar thread, `001 Projects/Threads/Guitar/`. That covers the ledger, blocks, logs and `Guitar MOC.md`, which the coach updates when a block changes.
  - Claude: launched from the vault root. Allow Read, Glob and Grep, plus Edit and Write limited to the Guitar thread. The only Bash allowed is the coach's validator, `python3 .agents/skills/guitar-practice-coach/scripts/validate-practice-system.py`. No web tools by default.
  - Codex: launched with the Guitar thread folder as its working directory, so that folder (plus temp) is the only writable place in its `workspace-write` sandbox. Its sandboxed shell can read elsewhere and run the validator, but cannot write outside the thread. Network stays off.
  - Neither may commit or push.
  - Super Productivity is out of scope. As the coach's state contract already says for clients without it, the coach lists the task changes for the owner instead of making them.
- **Storage:** conversations are stored in the app's SQLite database, so they survive restarts. They can be renamed and deleted.
- **Failures:** if a CLI is signed out or over its usage limit, show the CLI's error text; never fall back to an API key.

### Server and deployment

- **Code:** one TypeScript repository: a Node server (static files, file streaming, index, chat process management) and a React single-page app built with Vite. SQLite for app state, the index and chat history. State lives under `~/.local/state/struna/`, the remux cache under `~/.cache/struna/`.
- **Kvant:** user systemd unit `struna.service` (lingering is already on), loopback port chosen by the builder. The index scan runs at startup and on demand from the Library screen.
- **Almaz:**
  - `sites/struna.Caddyfile`: `http://struna.subcult.tv { import authelia; reverse_proxy 172.20.0.1:<port> }`;
  - user unit `struna-edge-tunnel.service`;
  - Caddy validation, then reload, per the existing site procedure.
- **Repository:** GitHub `PatrickFanella/struna`, private, GitHub workflow; secondary Gitea copy, checkout at `~/Work/PatrickFanella/struna`.
- **Documentation:** after deploy, add a dated section to the Kvant and Almaz host briefings in Machinum.

## Decided by the owner

- Practice comes first and opens today's session. Library is secondary; the Guitar Pro tab collection is a third, browse-only area kept out of lessons.
- The library covers the consolidated Guitar folder, other lesson PDFs, the Tony Rice book, and Calibre guitar books. All books are kept locally in `Guitar/Books/` (copied back from Calibre-Web), with Calibre-Web links.
- Chat covers both Claude and ChatGPT, through subscriptions, not API keys.
- Option 1: a single app.
- Public hostname behind Authelia, not tailnet-only.
- All guitar media consolidated into one folder, with the originals removed (done 2026-11-13).

## Calls made by the designer (owner may override)

- Name `struna`, host `struna.subcult.tv`, private GitHub repository under `PatrickFanella`.
- iPad or phone layout first.
- Week and session type derived from logged sessions, never the calendar. A session counts only when its log has a clean working tempo, so the blank 2026-08-26 log does not count and today starts at Block 01, Week 1, Session 1 (baseline).
- Session 7 is "prove", as in the practice system. Block 01's cross-training day is an extra optional session that does not advance the count.
- One log file per session, never appending to or editing an existing log.
- Recordings stored in the media folder, not the vault.
- Chat writes limited to the Guitar thread folder. Claude may run only the coach's validator. Codex keeps its sandboxed shell, which is needed for Codex to work at all.
- Authelia already passes `Remote-User` (`copy_headers` in the shared snippet, checked 2026-11-13), so the app's owner check works.
- Keep Authelia's default one-factor policy rather than adding an owner-only two-factor rule (adding a rule needs an Authelia restart, which signs out all sessions).
- No Super Productivity integration yet.

## Left to the builder

Frameworks within TypeScript, Node and React; the PDF, EPUB and zip viewer libraries; port number; index schema; exact chat process lifecycle and timeouts; remux cache eviction; visual styling within the layout sketch above; test strategy.
