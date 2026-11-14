# Guitar Room

A private web app on Kvant for practicing guitar, published at `https://guitar.subcult.tv` behind Authelia. Practice is the default screen: it starts today's session from the practice plan in the Ars Malefica vault, with a stage timer, a metronome, the clean-pass tempo helper, take recording and a session log written back to the vault. A tuner and a metronome open from any screen, and a coach chat talks to Claude or ChatGPT through the owner's existing subscriptions. The Library screen searches the lesson videos, PDFs and books; the Tabs screen browses and plays the Guitar Pro collection.

The same code also runs as a practice app for any guitarist, with no vault: see [Generic mode](#generic-mode). Everything above that section describes the personal mode, which is the default.

The design is in `docs/design.md`, the approved visual reference in `docs/design-system.html` (open it with `?view=practice|tuner|metronome&theme=light|dark`), and the implementation plans in `docs/plans/`.

## Running it

```sh
pnpm install
pnpm dev          # API on 127.0.0.1:5182, Vite on 127.0.0.1:5183
pnpm test         # node:test over server/ and web/src/
pnpm build        # typecheck, then the web app into dist/
pnpm start        # production: serves dist/ and the API on 5182
```

`node scripts/smoke-library.ts` and `node scripts/smoke-tabs.ts` open real library items and tabs in Chromium (read only); see their headers for arguments. `node server/library/scan.ts --dry-run [--probe]` prints what the library scan finds, per source.

`node scripts/capture.ts <dir> [view ...]` screenshots the built app at phone (390×844, 2x) and iPad (820×1180) sizes in both themes, from a scratch copy of the fixture vault. `node scripts/smoke-practice.ts <dir> [tone.wav]` runs a short session end to end in Chromium (start, clean passes, a recorded take, the log) against a scratch vault. Both need `pnpm build` and Chromium at `/usr/bin/chromium` (or `CHROMIUM`).

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `SOCKET_PATH` | (none) | Listen on this Unix socket (mode 600) instead of TCP. Production uses `$XDG_RUNTIME_DIR/guitar-room/http.sock`, so other accounts on Kvant cannot connect. |
| `HOST`, `PORT` | `127.0.0.1`, `5182` | TCP listen address when `SOCKET_PATH` is not set (development). |
| `ALLOWED_HOSTS` | (none) | Extra `Host` names accepted besides `localhost`, `127.0.0.1` and `[::1]`; production sets `guitar.subcult.tv`. Others get 403. |
| `REQUIRE_USER` | (none) | When set (production: `onnwee`), requests must carry Authelia's `Remote-User` with that name, or get 403. Without `EDGE_SECRET_FILE`, loopback host names are exempt (development). |
| `EDGE_SECRET_FILE` | (none) | A file holding the secret the Almaz Caddy site sends as `X-Edge-Secret`. When set, every request must carry it, whatever its `Host`: the tunnel endpoint on Almaz is reachable from that host's containers, and only Caddy, after Authelia, adds the secret. |
| `GUITAR_VAULT_ROOT` | `~/Work/Vaults/Ars Malefica` | Vault root. Point it at a scratch copy when testing log writes or chat writes. |
| `GUITAR_MEDIA_ROOT` | `~/Documents/Reference Library/Ars Malefica/Guitar` | Guitar media folder; recordings go under `Recordings/`. |
| `GUITAR_STATE_DIR` | `~/.local/state/guitar-room` | SQLite database: settings, tempos, conversations. |
| `GUITAR_CACHE_DIR` | `~/.cache/guitar-room` | The video remux cache, in `remux/`. |
| `GUITAR_CALIBRE_RECEIPT` | `~/.local/state/guitar-books-from-calibre-20261114.json` | Calibre ids for the local book copies. |
| `GUITAR_NO_SCAN` | (none) | When set, skip the library and tab scans at startup. |
| `CLAUDE_BIN`, `CODEX_BIN` | `claude`, `codex` | The signed-in CLIs. |
| `CLAUDE_MODEL`, `CODEX_MODEL` | CLI default | Optional model choice for chat. |

Every response carries `X-Robots-Tag: noindex, nofollow`. Requests other than GET must carry the header `x-guitar-room: 1`, which a cross-site form cannot send without a preflight the server never answers.

## What the app writes

- **Session logs:** one new file per session, `001 Projects/Threads/Guitar/Practice/Logs/Practice Log - YYYY-MM-DD.md` (then `(2)`, `(3)` for later sessions that day), filling every line of `Practice Log Template.md`. Files are created with an exclusive open, so an existing note is never overwritten. The app never edits existing notes and never commits; the owner or the coach commits.
- **Recordings:** `<media>/Recordings/<block-id>/<YYYY-MM-DD>-<label>.<webm|m4a>`, with `-2`, `-3` when the name exists. Labels are baseline, weekly, midpoint and final; the limit is 200 MB.
- **App state:** `~/.local/state/guitar-room/guitar-room.sqlite`: the week correction, the last clean tempo per fragment, the last chat provider and chat history.

How the session is placed: a log counts when it is dated on or after the block's `started` date, has a clean working tempo above 0, was not stopped for pain, and is not a cross-training session. Seven counted sessions make a week (capped at 4); session 1–2 is decode, 3–4 connect, 5–6 vary and 7 prove. The start screen's week correction is stored in the app, not the vault.

## Library and tabs

The library is a SQLite FTS5 index in the state database, built by a scan of the Guitar media folder and the vault's lesson PDFs. The server scans at startup when the index is more than 24 hours old, and the Library screen's Rescan starts one on demand (one at a time). A scan writes a new table and swaps it in with one transaction, so searches never see a half-built index. The scan reads; it never changes, moves or deletes library files.

| Source | Where | Titles |
|---|---|---|
| ArtistWorks | `Lesson Videos/ArtistWorks/<instructor>/` (videos and `.mp3` backing tracks) | File names without the number, initials and `_ArtistWorks` |
| Country Guitar Online | `Lesson Videos/Country Guitar Online/Free Lessons/<lesson>/` | The vault article note whose `video-archive:` names the folder, else the `.info.json` title |
| Archive | `Source Archives/Country Guitar Online Assessment Archive - 2026-08-07/`: lesson videos, stream captures and PDFs | Stream captures through the archive's `stream-archive.sqlite3` (id, source page, then the vault article with that `source:` URL, else the page name) |
| Vault lessons | `Practice/Materials`, `Sources/Raw/ArtistWorks`, `Sources/Raw/Country Guitar Online/Downloads`, `Sources/Raw/Tony Rice` in the Guitar thread | File names |
| Books, music books | `Books/` and `Books/Music Books/` | File names without the `(z-library…)` suffix; a PDF and EPUB of one book are one item |
| Music sheets | Entries inside the zips in `Restricted or Rights Review/Music Sheets/` | Entry names |

Copies of one lesson (the lesson folder, the archive's copy and stream captures) share a Vimeo or YouTube id and show as one result, opening the lesson-folder copy. Books are the local copies in `Guitar/Books/`, copied back from Calibre-Web on 2026-11-14; each also links to its Calibre-Web page (`https://books.subcult.tv/book/<id>`), with ids from the copy receipt.

Media is served with HTTP range requests. A video that is not MP4 (the `.mkv` lessons) is converted once with ffmpeg into `~/.cache/guitar-room/remux/<sha1 of the path>.mp4`: H.264 video is copied, other video (14 AV1 lessons) is converted to H.264, and audio becomes AAC unless it already is AAC or MP3. The first play of an AV1 lesson waits for the conversion (20 seconds for the longest). The cache keeps the most recently used files up to 40 GB. `ffmpeg`, `ffprobe` and `unzip` must be installed.

The Tabs screen indexes `Restricted or Rights Review/Guitar Pro Tabs and Wiring/Collection/Guitar_Pro_Tabs` (about 24,600 gp3, gp4 and gp5 files) by artist and title, and plays them with alphaTab and its bundled Sonivox sound font. Tabs are never offered to practice sessions.

## How chat avoids the APIs

Chat runs the signed-in CLIs as child processes with `ANTHROPIC_*`, `CLAUDE_CODE_*` (except `CLAUDE_CODE_OAUTH_TOKEN`), `OPENAI_*` and `CODEX_API_KEY` removed from their environment, so both fall back to the stored subscription logins (Claude.ai and ChatGPT). If Claude reports an API key source anyway, the panel shows a notice. A signed-out or rate-limited CLI shows its own error text; there is no API-key fallback.

- **Claude** runs from the vault root as `claude -p --output-format stream-json` with `--tools Read,Glob,Grep,Edit,Write,Bash`, Edit and Write allowed only under `001 Projects/Threads/Guitar/`, Bash allowed only for the coach's validator (`python3 .agents/skills/guitar-practice-coach/scripts/validate-practice-system.py`, with arguments; redirections, `;` and `$(...)` after it are denied), `--permission-mode dontAsk`, no settings sources, no MCP servers and no web tools. It reads only the vault and the media folder (`--add-dir`): there is no Read, Glob or Grep allow rule, so in `dontAsk` mode a read anywhere else is denied. Conversations resume with `--resume`.
- **Codex** runs `codex exec --json` with the Guitar thread folder as its working directory, `--ignore-user-config --ignore-rules`, a `workspace-write` sandbox with network off and `approval_policy="never"`. The thread folder (and `/tmp`) is the only writable place; the rest of the vault, its `.git` and the media folder are read-only. Conversations resume with `codex exec resume`.

Both get the same instructions: read the vault's `AGENTS.md`, follow `.agents/skills/guitar-practice-coach/SKILL.md` when reviewing or planning practice, write only inside the Guitar thread, never commit or push, and list Super Productivity changes for the owner instead of making them. Each message is prefixed with a short context block: screen, block, week and session, stage, fragment, metronome tempo and the next instruction.

## Deployment

- **Kvant:** user unit `guitar-room.service` (copy in `deploy/`), running this checkout with `NODE_ENV=production` on the Unix socket `/run/user/1000/guitar-room/http.sock` (runtime directory mode 700), `ALLOWED_HOSTS=guitar.subcult.tv`, `REQUIRE_USER=onnwee` and `EDGE_SECRET_FILE=~/.config/guitar-room/edge-secret` (mode 600, 64 hex characters, created with `openssl rand -hex 32`). After a code change: `pnpm build && systemctl --user restart guitar-room.service`. Local check: `curl --unix-socket $XDG_RUNTIME_DIR/guitar-room/http.sock -H 'Host: localhost' -H "X-Edge-Secret: $(cat ~/.config/guitar-room/edge-secret)" -H 'Remote-User: onnwee' http://x/api/health`.
- **Almaz:** user unit `guitar-room-edge-tunnel.service` forwards `172.20.0.1:34948` to that socket over SSH (`ControlMaster=no`, `ControlPath=none`). `sites/guitar.Caddyfile` in `/opt/server/management/config/caddy/` (root, mode 640, because it holds the secret) serves `http://guitar.subcult.tv` behind the shared `authelia` snippet and adds `X-Edge-Secret`; it is imported at the end of the main Caddyfile. `deploy/guitar.Caddyfile` is the template; install it with the placeholder replaced by the secret file's contents, never by pasting the secret into a terminal. Validate with `docker exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`, then `caddy reload` the same way. To rotate the secret, write a new one on Kvant, reinstall the site file, reload Caddy, then restart `guitar-room.service`.

Rollback:

1. Kvant: `systemctl --user disable --now guitar-room.service`, then remove `~/.config/systemd/user/guitar-room.service` and `~/.config/guitar-room/edge-secret`.
2. Almaz: remove the `# Guitar Room (Kvant)` comment and its `import` line from the main Caddyfile (the prior copy is `Caddyfile.before-guitar-room-20261114T032908Z`), delete `sites/guitar.Caddyfile`, validate and reload Caddy, then `systemctl --user disable --now guitar-room-edge-tunnel.service` and remove the unit.

Logs, recordings and the state database stay where they are.

## Generic mode

`GUITAR_MODE=generic` turns the app into a practice room for any guitarist at any level. There is no Obsidian vault and no media library: everything lives in one plain folder, the studio. A setup form asks about the player (level, guitar, styles, songs they want, minutes per session), the app writes a starter plan, and the coach replaces it with one that fits and keeps adjusting it from the practice logs. The starter plans and the tuner's string-by-string tunings are for six-string guitar; a player who types another instrument under "Other" gets a starter plan that says so and asks the coach to rewrite it. The screens are Practice and Materials, plus Tabs when `GUITAR_TABS_DIR` is set. The tuner, metronome, stage timer, clean-pass helper and take recording are the same as in the personal mode.

One running instance serves one player: there are no accounts, and one server has one studio folder. For a second player, run a second instance with its own `GUITAR_HOME`, `GUITAR_STATE_DIR` and port.

### Running it

```sh
pnpm install && pnpm build
GUITAR_MODE=generic GUITAR_HOME=~/Guitar\ Room PORT=5184 pnpm start
```

Then open the access link the server prints, `http://localhost:5184/?token=…`. The server has no login of its own, and on loopback TCP any other account on the machine, or any container on the host network, could connect to it. So on TCP without `EDGE_SECRET_FILE` the generic mode answers only browsers that have opened its access link once: the first start writes a random token to `access-token` in `GUITAR_STATE_DIR` (mode 600), and the link stores it in an HttpOnly, SameSite=Strict cookie for a year. The token is printed in full only to a terminal; under systemd the log shows `http://localhost:5184/?token=$(cat …/access-token)` instead. Scripts can send the token as the `x-guitar-room-token` header; `/api/health` needs none. Delete the file and restart to issue a new token.

`deploy/guitar-room-generic.service` is an example user unit. To reach the app from another device, put a reverse proxy with its own login in front and use `ALLOWED_HOSTS`, `REQUIRE_USER`, `EDGE_SECRET_FILE` and `SOCKET_PATH` (an owner-only runtime directory, as in the unit's commented lines) as the personal deployment does; a Unix socket or an edge secret needs no access link. The coach needs the `claude` or `codex` CLI signed in for the account that runs the server; the rest of the app works without them. On a fresh clone, `pnpm install` skips the install scripts of `core-js` and `es5-ext` (they only print messages), as `pnpm-workspace.yaml` says.

`node scripts/smoke-generic.ts <scratch-dir> [screenshot-dir]` walks the whole mode in Chromium at phone and iPad size against scratch studio folders: the access link, setup, a session, the log, materials, prompts, coach settings and toasts. A stand-in CLI answers for the coach, so no subscription is used. It needs `pnpm build`. `SMOKE_PORT` picks the port (default 5196); the script stops if something already answers there, or if its server exits, so it never drives another instance.

### Configuration

`HOST`, `PORT`, `SOCKET_PATH`, `ALLOWED_HOSTS`, `REQUIRE_USER`, `EDGE_SECRET_FILE`, `CLAUDE_BIN`, `CODEX_BIN`, `CLAUDE_MODEL` and `CODEX_MODEL` work as in the table above. The vault and media variables are not used. `CODEX_BIN` should lead to the real Codex binary (a mise shim is followed with `mise which codex`): its sandbox must read Codex's install folder, and when the server cannot find it, it logs a warning and Codex falls back to a sandbox that limits only writes.

| Variable | Default | Meaning |
|---|---|---|
| `GUITAR_MODE` | `personal` | `generic` selects this mode. Any other value stops the server at start. |
| `GUITAR_HOME` | `~/Guitar Room` | The studio folder, created at start. A relative path is taken from the working directory. |
| `GUITAR_STATE_DIR` | `~/.local/state/guitar-room-generic` | SQLite database (tempos, conversations, coach settings, custom prompts) and the `access-token` file. Separate from the personal default, so both modes can run on one machine. |
| `GUITAR_CACHE_DIR` | `~/.cache/guitar-room-generic` | The video remux cache. |
| `GUITAR_LIBRARY_DIRS` | (none) | Extra folders of lessons, sheets and tabs, separated by `:`. They show under Materials and the coach can read them; nothing writes to them. |
| `GUITAR_TABS_DIR` | (none) | A Guitar Pro collection (gp3, gp4, gp5). When set, the Tabs screen appears. |
| `GUITAR_TIMEZONE` | the system zone | The zone for log dates, such as `Europe/Berlin`. An unknown name stops the server at start. In the personal mode the default stays `America/Chicago`. |
| `GUITAR_COACH_WEB` | `1` | `0` removes the coach's web search and page fetching, and the app's automatic download of the links the coach marks `"save": true`. |
| `GUITAR_APP_NAME` | `Guitar Room` | The name in the header and the page title. |

### The studio folder

```
<GUITAR_HOME>/
  profile.json            the setup form's answers
  coach-notes.md          what the coach wants to remember; the player may edit it
  plan/plan.json          the active plan
  plan/archive/<id>.json  earlier plans
  logs/YYYY-MM-DD.md      one file per session; a second that day is YYYY-MM-DD-2.md
  materials/              uploads, saved web copies, pasted text, lesson sheets the coach writes
  materials/links.json    web links, each with a title and a note
  materials/.trash/       files deleted from the Materials screen
  Recordings/<plan-id>/   takes
```

The app writes `profile.json`, new log files (created exclusively, never overwritten or edited), takes, files under `materials/`, `links.json` and the first starter plan. After that the plan belongs to the coach and the player: the app only reads and checks it. A plan the app cannot read shows its errors on the start screen, with buttons to ask the coach to fix it or to replace it with a starter plan (the unreadable file moves to `plan/archive/invalid-<time>.json`).

A plan has phases, each lasting a number of counted sessions, and two or three session kinds (for example 15, 10 and 5 minutes), each a list of timed stages. A log counts toward the plan when it is dated on or after the plan's `started` date, was not stopped for pain, and is not an off-day extra. The next instruction on the start screen is the newest counted log's, unless the coach changed the plan's `next` after that log.

### Materials

The Materials screen takes uploads (PDF, images, audio, video, Guitar Pro, MusicXML, text, Markdown, EPUB; 500 MB each), web links and pasted text. Pasted text that is not Markdown is saved in a fenced block, so chord charts and text tab keep their spacing. YouTube links play inside the app through `youtube-nocookie.com`; other links open in a new tab. Anything can be opened beside the session in a pane.

"Save a copy" downloads a link into `materials/`. The downloader takes only http and https on the standard ports, refuses any host that resolves to a loopback, private, link-local or otherwise non-public address, connects to the address it checked, follows at most three redirects with the same checks, stops at 200 MB, and accepts only files (PDF, images, audio, video, Guitar Pro, MusicXML, text); a web page stays a link. One 15-minute limit covers the whole download, from connecting through redirects and headers to the last byte. Two requests for the same link (two replies ending together, a tap on "Save a copy" while the coach's copy downloads) share one download, so no stray second copy is left. A link being downloaded shows "Saving a copy…". Files are served with `nosniff`, and types the app does not know are sent as downloads, so nothing a coach or a website wrote can run as a page of the app.

### The coach in this mode

Chat still runs the signed-in `claude` and `codex` CLIs with the API-key variables removed, as described under "How chat avoids the APIs". What differs is where they run and what they may touch:

- **Claude** runs from the studio folder with `--tools Read,Glob,Grep,Edit,Write,WebSearch,WebFetch`, `--permission-mode dontAsk`, no settings sources, no MCP servers and no Bash. Edit and Write are allowed only for `plan/**`, `materials/**`, `coach-notes.md` and `profile.json`. It can read the studio folder and the `GUITAR_LIBRARY_DIRS` folders (`--add-dir`) and nothing else. Logs, recordings and the library folders are read-only: the CLI refuses those writes.
- **Codex** runs `codex exec` from the studio folder with `--skip-git-repo-check`, `--ignore-user-config --ignore-rules`, `--disable apps`, `-c web_search="live"` and a permission profile instead of the `workspace-write` sandbox. The profile denies reads of the whole disk except the studio, the library folders, Codex's own install folder and the system's runtime paths, so commands cannot read the home folder, CLI logins, SSH keys or `/tmp`; the studio is writable except `logs/` and `Recordings/`, which are read-only as under Claude; the shell has no network. Checked with codex-cli 0.167.2: `~/.codex/auth.json` unreadable, `~/.ssh` hidden, a write to `logs/` refused. When the server cannot find Codex's install folder it falls back to the `workspace-write` sandbox, which limits only writes: Codex can then read every file the account can. Codex 0.167 still reads `~/.codex/AGENTS.md` when one exists.
- **Web access:** with `GUITAR_COACH_WEB=1` the coach can search the web and open pages (Claude's WebSearch and WebFetch, Codex's `web_search` tool). It is told to open a page before adding it to `materials/links.json`, to prefer free, legal teaching sources, and to set `"save": true` only on direct file links that are clearly free to download. Claude's WebFetch makes its request from this machine, so a hook (`server/generic/webfetch-guard.ts`, passed with `--settings`) first refuses anything but https, IP-number hosts, local names (`localhost`, `*.local`, `*.ts.net` and similar) and names that resolve to a loopback, private, link-local or CGNAT address, as the downloader does. With `GUITAR_COACH_WEB=0` Claude gets no web tools, Codex gets `web_search="disabled"`, and the app does not download what the coach marks `"save": true`; the player can still press "Save a copy". `--disable apps` stays on in both cases, because the ChatGPT apps connector carries a web search of its own.
- **Copyright:** whether the web is on or off, the coach may write out a short teaching excerpt (a riff, a few bars, a chord progression, a strumming pattern) and never a whole song's tab, notation or lyrics. For a full song it links an official or licensed source, or, without the web, asks the player to add their own copy.
- **After every reply** the app compares `plan/plan.json`, `profile.json` and `materials/` with how they were before and tells the open screens to reload what changed. With web access on, it starts downloading the links marked `"save": true` (at most ten per pass, 15 minutes per pass) and waits three seconds: quick downloads are part of the reply, slower ones carry on after it, and their failures are reported with the next reply. If the reply left the plan missing or invalid, a plan whose `started` is after today, or `links.json` unreadable, the app sends the exact errors back for one repair turn on the same conversation. If the file is still wrong after that, the chat shows a notice and the start screen shows the errors; it never tries a second time. Stop during this check ends the exchange: no repair turn starts.
- A turn may run for 15 minutes (5 in the personal mode), since building a plan with web research takes a few minutes.

Each message is prefixed with a context block: screen, today's date in `GUITAR_TIMEZONE` (the CLIs take their own date from the server's clock), level, plan, phase and session, stage, material, metronome tempo, next instruction and days since the last session.

### Prompts and automatic actions

The coach panel and the start screen offer ready-made prompts as buttons, chosen for the screen the player is on: only ten minutes, make today easier or harder, build a plan, explain this material, find lessons for a song, and about thirty more. "Make today easier" and "harder" change today's session; the coach changes the plan itself only when the recent logs agree. "Build my plan" proposes changes to an existing plan and waits for an answer before it replaces anything. A prompt that needs a value from the screen (the material, the stage, the tempo) shows only where that value exists. A prompt ending in "…" goes into the message box for the player to finish; the others are sent at once. Players add their own under Coach settings on the start screen (up to 30).

Seven events can send a message to the coach by themselves. Each has a mode, set under Coach settings: **Auto** sends it at once and shows a note with an Open button, **Ask first** shows a note with a button and sends nothing until it is tapped, **Off** does nothing. When no coach CLI is signed in, nothing is sent and the note says so; when the coach fails, the note says that too. The notes sit above the tab bar and take room on the page, so they never cover the session bar. Messages the app sent are marked "Automatic" in the conversation, and the Coach button shows a dot when a reply finished unseen (generic mode only).

| Event | Default | What the coach is asked |
|---|---|---|
| The setup form is saved for the first time | Auto | Replace the starter plan with one that fits the profile, and find three to five starting materials. |
| Material is added | Auto | Look at the new items and work them into the plan. Links and pasted text added one after another are sent once, when the Add panel closes or after 45 quiet seconds. |
| A session is logged | Auto | Review the new log and set the next instruction. Not sent for an off-day extra, which does not count. |
| A session is stopped for pain or tension | Auto | Advise, and lighten the plan. |
| The plan's sessions are all done | Ask first | Review the plan's logs and propose what comes next. |
| Seven or more days since the last session | Ask first | Ease the plan back in. |
| The profile is edited | Ask first | Adjust the plan. |

### Limits

- One player per instance, and no login in the app itself: on loopback TCP the access token is the only gate, and anyone with the link can use the coach on this account's subscriptions.
- The coach needs a signed-in CLI and a subscription with room left; a signed-out or rate-limited CLI shows its own error. Without a coach the starter plan, sessions, logs and materials still work, but nothing adjusts the plan.
- With web access on, the coach makes outbound requests from this host (Claude's WebFetch) and reads pages strangers wrote, so a hostile page could try to steer it. The WebFetch hook checks the address before the fetch, but WebFetch resolves the name again by itself, so a DNS answer that changes in between (rebinding) can get through. Coach replies never load images.
- Codex's read limits depend on the server finding its install folder. Either way, a dedicated account with no other secrets is the safest place to run the generic mode.
- Whether the coach really opened a page before linking to it cannot be checked by the app.
- The app does not back up or commit the studio folder.
- Not tested on iOS Safari.

