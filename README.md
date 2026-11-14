# Guitar Room

A private web app on Kvant for practicing guitar, published at `https://guitar.subcult.tv` behind Authelia. Practice is the default screen: it starts today's session from the practice plan in the Ars Malefica vault, with a stage timer, a metronome, the clean-pass tempo helper, take recording and a session log written back to the vault. A tuner and a metronome open from any screen, and a coach chat talks to Claude or ChatGPT through the owner's existing subscriptions.

The design is in `docs/design.md`, the approved visual reference in `docs/design-system.html` (open it with `?view=practice|tuner|metronome&theme=light|dark`), and the implementation plans in `docs/plans/`.

## Running it

```sh
pnpm install
pnpm dev          # API on 127.0.0.1:5182, Vite on 127.0.0.1:5183
pnpm test         # node:test over server/ and web/src/
pnpm build        # typecheck, then the web app into dist/
pnpm start        # production: serves dist/ and the API on 5182
```

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
| `GUITAR_CACHE_DIR` | `~/.cache/guitar-room` | Caches. |
| `CLAUDE_BIN`, `CODEX_BIN` | `claude`, `codex` | The signed-in CLIs. |
| `CLAUDE_MODEL`, `CODEX_MODEL` | CLI default | Optional model choice for chat. |

Every response carries `X-Robots-Tag: noindex, nofollow`. Requests other than GET must carry the header `x-guitar-room: 1`, which a cross-site form cannot send without a preflight the server never answers.

## What the app writes

- **Session logs:** one new file per session, `001 Projects/Threads/Guitar/Practice/Logs/Practice Log - YYYY-MM-DD.md` (then `(2)`, `(3)` for later sessions that day), filling every line of `Practice Log Template.md`. Files are created with an exclusive open, so an existing note is never overwritten. The app never edits existing notes and never commits; the owner or the coach commits.
- **Recordings:** `<media>/Recordings/<block-id>/<YYYY-MM-DD>-<label>.<webm|m4a>`, with `-2`, `-3` when the name exists. Labels are baseline, weekly, midpoint and final; the limit is 200 MB.
- **App state:** `~/.local/state/guitar-room/guitar-room.sqlite`: the week correction, the last clean tempo per fragment, the last chat provider and chat history.

How the session is placed: a log counts when it is dated on or after the block's `started` date, has a clean working tempo above 0, was not stopped for pain, and is not a cross-training session. Seven counted sessions make a week (capped at 4); session 1–2 is decode, 3–4 connect, 5–6 vary and 7 prove. The start screen's week correction is stored in the app, not the vault.

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
