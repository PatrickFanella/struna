# Issue #27: Coach provider and prompt clarity

Verified 2026-11-14 on Kvant with Chromium and the repository's fake Coach CLI.
Only fresh scratch STRUNA_HOME, STRUNA_STATE_DIR and STRUNA_CACHE_DIR paths were
used. No real provider requests, credentials, player data or deployment used.

## Checks

- `pnpm typecheck`: passed, including the final smoke script.
- `pnpm test`: 302 passed, none skipped.
- `pnpm build`: passed; existing bundle-size warning remains.
- `node scripts/smoke-coach-clarity.ts /tmp/struna-27-smoke-3`: passed all 16 combinations.
- Command logs: `/tmp/struna-27-{typecheck,typecheck-final,test,build,smoke}.log`.

The dedicated smoke extends the scratch Studio fixture pattern used by
smoke-generic.ts. It refuses an existing directory, starts only its own server
on a free loopback port, blocks external browser requests and uses fake Coach
executables. It checks:

- Short selected provider labels and separate wrapping host/readiness text;
  changing between the two ready host stand-ins does not submit a message.
- Complete plan-change Draft and incomplete Draft fill the composer, issue no
  POST /api/chat, and leave active-plan bytes unchanged.
- Advice, session-length, plan-change and materials intents have explicit
  Draft/Send labels in chips and the full prompt list.
- Advice Send and typed Send each submit once even with repeated activation;
  busy status appears, and a simulated 429 is visible as an error.
- Provider settings and automatic-action settings disclose direct file writes
  and make no promise of an implemented Apply preview.
- No page overflow or page errors in the tested states.

Matrix: 320x700, 390x844, 1003x814, plus 502x407 as a 200%-zoom reflow proxy;
each in Light, Dark, Device following light OS, and Device following dark OS.
The proxy tests the smaller CSS layout, not browser-chrome zoom. PNG pattern:
`/tmp/struna-27-smoke-3/<width>x<height>-<theme>-<state>.png`.
States: provider, draft-plan, prompt-list, sending, error, settings,
automatic-actions. `checks.txt` records each combination. Light 320 provider
and sending, and dark 390 provider screenshots were visually inspected.

The first two attempts stopped because assertions read asynchronous composer
and settings updates before React/data loading completed. The script now waits
for the filled composer and loaded provider rows; those attempts remain under
`/tmp/struna-27-smoke` and `/tmp/struna-27-smoke-2`.

## Scope and limitations

Prompt purpose is additive server metadata, separate from the existing grouping.
Plan-change, custom and incomplete requests draft first; other requests retain
Send behavior with an explicit label. Purpose describes what a request asks for,
not a permission boundary. The Coach retains its current direct-write access
until #9 implements ADR 0001. Settings, credentials, provider configuration,
Session.tsx and Workspace.tsx were not changed by this issue.

All seven catalog short names, host/app/API/endpoint location cases and
not-ready text are covered by unit tests. Browser sends used host stand-ins;
no configured remote endpoint or real sign-in was exercised. Native phone,
Safari, screen-reader, physical audio and human qualification are unverified.
The unrelated theme-control clipping in start settings is owned by #28.

Stack base: `fix/23-deliberate-microphone-tools` (PR #35), itself on #31.
