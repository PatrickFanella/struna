# Guitar Room

A private web app on Kvant for practicing guitar, published at `https://guitar.subcult.tv` behind Authelia. Practice is the default screen: it starts today's session from the practice plan in the Ars Malefica vault, with a stage timer, a metronome, the clean-pass tempo helper, take recording and a session log written back to the vault. A tuner and a metronome open from any screen, and a coach chat talks to Claude or ChatGPT through the owner's existing subscriptions. The Library screen searches the lesson videos, PDFs and books; the Tabs screen browses and plays the Guitar Pro collection.

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
| `HOST`, `PORT` | `127.0.0.1`, `5182` | Listen address. Keep it on loopback. |
| `ALLOWED_HOSTS` | (none) | Extra `Host` names accepted besides `localhost`, `127.0.0.1` and `[::1]`; production sets `guitar.subcult.tv`. Others get 403. |
| `REQUIRE_USER` | (none) | When set (production: `onnwee`), requests for a non-loopback host must carry Authelia's `Remote-User` with that name, or get 403. |
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

- **Claude** runs from the vault root as `claude -p --output-format stream-json` with `--tools Read,Glob,Grep,Edit,Write,Bash`, Edit and Write allowed only under `001 Projects/Threads/Guitar/`, Bash allowed only for the coach's validator (`python3 .agents/skills/guitar-practice-coach/scripts/validate-practice-system.py`), `--permission-mode dontAsk`, no settings sources, no MCP servers and no web tools. It may read the media folder (`--add-dir`). Conversations resume with `--resume`.
- **Codex** runs `codex exec --json` with the Guitar thread folder as its working directory, `--ignore-user-config --ignore-rules`, a `workspace-write` sandbox with network off and `approval_policy="never"`. The thread folder (and `/tmp`) is the only writable place; the rest of the vault, its `.git` and the media folder are read-only. Conversations resume with `codex exec resume`.

Both get the same instructions: read the vault's `AGENTS.md`, follow `.agents/skills/guitar-practice-coach/SKILL.md` when reviewing or planning practice, write only inside the Guitar thread, never commit or push, and list Super Productivity changes for the owner instead of making them. Each message is prefixed with a short context block: screen, block, week and session, stage, fragment, metronome tempo and the next instruction.

## Deployment

- **Kvant:** user unit `guitar-room.service` (copy in `deploy/`), running this checkout with `NODE_ENV=production`, `PORT=5182`, `ALLOWED_HOSTS=guitar.subcult.tv` and `REQUIRE_USER=onnwee`. After a code change: `pnpm build && systemctl --user restart guitar-room.service`.
- **Almaz:** user unit `guitar-room-edge-tunnel.service` forwards `172.20.0.1:34948` to Kvant `127.0.0.1:5182` over SSH (`ControlMaster=no`, `ControlPath=none`). `sites/guitar.Caddyfile` in `/opt/server/management/config/caddy/` serves `http://guitar.subcult.tv` behind the shared `authelia` snippet, imported at the end of the main Caddyfile. Validate with `docker exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`, then `caddy reload` the same way.

Rollback:

1. Kvant: `systemctl --user disable --now guitar-room.service`, then remove `~/.config/systemd/user/guitar-room.service`.
2. Almaz: remove the `# Guitar Room (Kvant)` comment and its `import` line from the main Caddyfile (the prior copy is `Caddyfile.before-guitar-room-20261114T032908Z`), delete `sites/guitar.Caddyfile`, validate and reload Caddy, then `systemctl --user disable --now guitar-room-edge-tunnel.service` and remove the unit.

Logs, recordings and the state database stay where they are.
