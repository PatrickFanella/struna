<picture>
  <source media="(prefers-color-scheme: dark)" srcset="web/public/brand/mark-dark.svg">
  <img src="web/public/brand/mark-primary.svg" width="48" height="48" alt="Struna's Octave S mark">
</picture>

# Struna

A practice room for guitar you host yourself. Open a plan, work through timed stages, find a clean tempo, record a take, and leave a session log for next time.

**In development.** One instance serves one player. Struna has no public release yet.

[GitHub](https://github.com/PatrickFanella/struna) is the primary repository. [Gitea](https://git.subcult.tv/PatrickFanella/struna) is the secondary copy and is configured as a fetch-only remote.

## A session in Struna

- Start the session your plan calls for. Keep the lesson, sheet or tab beside the stage timer.
- Use the tuner and metronome from any screen.
- Log clean passes as you play. Three in a row suggest **+3 BPM**; one miss asks you to repeat; a second suggests **−4 BPM** or a shorter loop. You choose when to apply the change.
- Record a take and write what improved, what failed, and what to try next.
- Ask a coach to review the plan and logs. The coach can use a supported local subscription login, an API key, a ChatGPT sign-in, or a configured provider endpoint. Coaching is optional; practice tools work without it.

Studio mode keeps a player's profile, plan, materials and logs in a plain folder. Personal mode reads the owner's existing Obsidian guitar practice system and adds a searchable lesson library and Guitar Pro collection.

## Run it

Requirements: Node.js 24 or later and pnpm. `ffmpeg`, `ffprobe` and `unzip` are needed for media conversion and archive browsing. This is a Node/React app; no separate database service is required.

```sh
git clone https://github.com/PatrickFanella/struna.git
cd struna
pnpm install --frozen-lockfile
pnpm build
STRUNA_MODE=studio STRUNA_HOME="$HOME/Struna" PORT=5184 pnpm start
```

Open the access link the server prints. Its token is stored in an HttpOnly, SameSite=Strict cookie. Under a service manager, the log shows how to read the link from the owner-only token file rather than printing the token itself. `/api/health` remains available without it.

For development:

```sh
STRUNA_MODE=studio STRUNA_HOME="$HOME/Struna" pnpm dev
```

The API listens on `127.0.0.1:5182` and Vite on `127.0.0.1:5183`. Open the API's access link on the Vite origin so requests through its proxy have the access cookie. Use a scratch studio folder when testing writes.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `STRUNA_MODE` | `personal` | `studio` for a self-contained player folder; `personal` for the Obsidian integration. |
| `STRUNA_HOME` | `~/Struna` | Studio folder, created at startup. |
| `STRUNA_STATE_DIR` | `~/.local/state/struna-studio` in studio mode; `~/.local/state/struna` in personal mode | SQLite state, access token and coach configuration. Keep it outside the studio and library folders. |
| `STRUNA_CACHE_DIR` | `~/.cache/struna-studio` or `~/.cache/struna` | Remux cache. |
| `STRUNA_TIMEZONE` | Device/server zone in studio mode; `America/Chicago` in personal mode | Dates for plans and logs. |
| `STRUNA_APP_NAME` | `Struna` | Header and page title, for an instance with its own name. |
| `STRUNA_LIBRARY_DIRS` | None | Read-only lesson folders, separated by `:`. |
| `STRUNA_TABS_DIR` | None | Optional Guitar Pro collection in studio mode. |
| `STRUNA_COACH_WEB` | `1` | Set `0` to disable coach web access. |
| `STRUNA_COACH_HOST_LOGINS` | Automatic | `1` offers this account's signed-in CLIs; `0` hides them. By default they are offered only on a local TCP instance protected by its access token. |
| `STRUNA_COACH_DEVICE_SIGNIN` | `0` | `1` permits the app's ChatGPT device sign-in on a remotely hosted instance. |
| `STRUNA_COACH_PRIVATE_ENDPOINTS` | `0` | `1` permits private provider addresses on a remotely hosted instance. Local instances permit them by default. |
| `STRUNA_COACH_MAX_BUDGET_USD` | `2` | Per-turn limit for Claude API-key and Bedrock runs. |
| `HOST`, `PORT` | `127.0.0.1`, `5182` | TCP listener. |
| `SOCKET_PATH` | None | Use an owner-only Unix socket instead of TCP. |
| `ALLOWED_HOSTS` | Loopback host names | Additional accepted host names, separated by commas. |
| `REQUIRE_USER` | None | Require the matching `Remote-User` header from an authenticated reverse proxy. |
| `EDGE_SECRET_FILE` | None | File containing the shared proxy secret. When set, every request must carry the matching `X-Edge-Secret`. |
| `CLAUDE_BIN`, `CODEX_BIN` | `claude`, `codex` | Coach executables. Point `CODEX_BIN` at the real binary if install discovery fails. |
| `CLAUDE_MODEL`, `CODEX_MODEL` | CLI defaults | Model overrides for local CLI coaches. |
| `STRUNA_NO_SCAN` | Unset | Skip startup library and tab scans. |

Personal mode additionally accepts `STRUNA_VAULT_ROOT`, `STRUNA_THREAD`, `STRUNA_MEDIA_ROOT` and `STRUNA_CALIBRE_RECEIPT`. See [personal mode](docs/personal-mode.md) for the layout and its write boundaries.

## Hosting and coach access

The access token protects a local TCP instance; it is not a multi-user login system. For remote access, put an authenticated reverse proxy in front, use an owner-only Unix socket or shared edge secret, and set `REQUIRE_USER`. Never put an unprotected instance on the LAN or internet.

The coach works in the player's studio folder. Its saved credentials live outside that folder, and the server refuses unsafe state-folder placement. Claude's allowed reads are limited to the studio and selected libraries. Codex needs a discovered install and a permission profile that limits reads; if discovery fails, its coaches are disabled. Review the provider terms before offering an account to anyone else.

Local subscription coaches use existing CLI logins. The app removes API-key settings for that path. Coaches configured inside Struna instead get their own config folder and an allowlisted environment. Key fields show only a short hint after saving. Provider endpoints must implement the Responses API wire format; this path is experimental.

Deployment templates are [struna-studio.service](deploy/struna-studio.service), [struna.service](deploy/struna.service), [struna-edge-tunnel.service](deploy/struna-edge-tunnel.service) and [struna.Caddyfile](deploy/struna.Caddyfile). The personal unit and tunnel retain the existing checkout, socket and secret paths for compatibility; the Studio unit is a new-install example. Adapt paths before installing them. Do not enable a replacement unit alongside the existing writer. Repository changes do not update installed units or restart services.

## Your files

Studio mode keeps `profile.json`, `coach-notes.md`, `plan/plan.json`, `materials/`, `logs/` and `Recordings/` under `STRUNA_HOME`. Plans and notes are plain files. The coach reads the logs before adjusting the plan.

State, credentials and caches are separate. A fresh instance uses `struna.sqlite`; a video remux is cached under `STRUNA_CACHE_DIR/remux/`. Personal-mode logs are created as new files in the vault. Existing notes, lessons and source media are not rewritten by the library scan.

## Upgrading an existing installation

The name changed from Guitar Room to Struna. Existing installations can upgrade without renaming their data first:

- `STRUNA_*` variables take precedence. Old `GUITAR_*` variables remain accepted, including `GUITAR_MODE=generic`, which selects Studio mode.
- When no explicit path is set, existing `guitar-room` / `guitar-room-generic` state and cache folders and an existing `~/Guitar Room` studio are reused if the corresponding Struna folder does not exist. If both exist, Struna uses the new folder. Set explicit paths to choose another location.
- An existing `guitar-room.sqlite` remains in use if the selected state folder has no `struna.sqlite`. Files are not copied, moved or deleted during this fallback.
- Browser preferences and an in-progress session are read from their old keys when no new key exists. New settings use `struna.*`.
- The server accepts the old `x-guitar-room` and `x-guitar-room-token` headers and access cookie as well as the new `x-struna` and `x-struna-token` names.
- Installed service names, secret files, sockets and checkout paths remain where they are until an operator migrates them. Use the new templates for new installs; retain explicit old paths while replacing a live unit.

For an existing clone, set `origin` to `https://github.com/PatrickFanella/struna.git`, keep Gitea as `gitea`, and set `git config remote.pushDefault origin`. The hosted rename keeps the repository history. Local checkout folders do not have to be renamed.

## Development and verification

```sh
pnpm typecheck
pnpm test
pnpm build
```

The tests cover configuration, access, practice plans, logs, materials, providers, audio logic and library routes. Browser checks need Chromium at `/usr/bin/chromium`, or `CHROMIUM` pointing at another installation.

```sh
STRUNA_TIMEZONE=UTC node scripts/smoke-generic.ts /tmp/struna-studio-smoke /tmp/struna-studio-shots
CLAUDE_BIN=/bin/false CODEX_BIN=/bin/false node scripts/smoke-practice.ts /tmp/struna-practice-smoke
CLAUDE_BIN=/bin/false CODEX_BIN=/bin/false node scripts/capture.ts /tmp/struna-captures
```

The smoke scripts use scratch folders. The studio smoke uses stand-in coach CLIs; the personal smoke above disables real coaches. `scripts/smoke-library.ts` and `scripts/smoke-tabs.ts` inspect configured real collections; read their headers before running them.

## Design

Struna means “string”. The app follows **The string**, the Studio direction built around a clean note and an open string in bronze. Bronze marks clean passes and the next suggested tempo; misses are said in words. The launch-only **Packet** artwork stays out of the practice interface.

The [design integration](docs/struna-design.md) records the typography, palette, component states and verification. [Asset provenance](docs/struna-assets.json) pins the selected Studio files and hashes. Studio owns the brand masters; this repository owns the app. The original [product design](docs/design.md) and [implementation plans](docs/plans/) remain development references.
