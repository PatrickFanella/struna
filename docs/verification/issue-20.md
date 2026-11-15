# Issue 20: headings, upload names and practice state feedback

Materials and Coach Markdown now demote headings one level below the application's view-level h1, capped at h6. Fenced tablature keeps its spaces. A shared mapping is covered by a rendering test. SessionStatus adds persistent, polite timer, click and recording/save state text, excluding elapsed values and beat numbers. Log review reports pending/failure politely; the completion view shows save success. Discard is disabled while a take is saving.

Session.tsx changes are limited to importing/rendering the status component, removing the duplicate recording-error alert and disabling Discard during save. Practice.tsx adds the completion status line. The parent agent's stage metadata, timer design, instruction hierarchy and reader-space work remain separate.

The upload inspection found a named Choose files button, with no unnamed exposed button in the Chromium accessibility tree. The native file input already has `tabIndex=-1` and `aria-hidden=true`. It was left unchanged. The smoke activates the labeled button by keyboard and uploads Markdown through the resulting file chooser.

Validation on November 15, 2026 UTC:

- `pnpm typecheck`: passed.
- `pnpm test`: 298 passed; no failures or skips. The added rendering test checks heading levels and exact fenced-tab whitespace.
- `pnpm build`: passed with the existing large-chunk advisory.
- `node scripts/smoke-controls.ts /tmp/struna-issue20-complete-20261115 20`: 159 assertions passed. Additional awaited assertions exercise each state transition, including failed take/log saves and successful retries.

The smoke covers 320×700, 390×844 and 1003×814 in Light, Dark and Device modes, plus native 200% Chromium zoom at a 1003×814 window. The zoom pass uses a new persistent scratch profile, sets Chromium's default zoom through its settings API, and asserts `innerWidth === 501` and `devicePixelRatio === 2`. No existing browser profile is opened. Device follows an emulated dark preference.

Artifacts: `/tmp/struna-issue20-complete-20261115`. Files are `<width>-<theme>-material.png` and `-practice-status.png`; the real zoom screenshots use width `501`. Accessibility snapshots are `upload-ax-<width>.json`, with checks in `checks.json`. Each snapshot lists exposed role/name pairs. The smoke checks one exposed h1 in Materials detail and active practice, nested Markdown headings, tab spacing, keyboard upload/record focus, timer/click states, recording/save states, and log save states. A MutationObserver confirms no live-text mutation across 1.1 seconds of running timer/click activity.

Final cumulative zoom reruns also passed for issue 28 (61 assertions, `/tmp/struna-issue28-final-20261115`), issue 18 (149, `/tmp/struna-issue18-final-20261115`) and issue 19 (1,470, `/tmp/struna-issue19-complete-20261115`). The final issue 19 run also covers its hidden-section follow-up. Their earlier issue reports truthfully describe reduced-viewport approximations; these later runs add native zoom evidence. The standalone report's earlier source-resource inventory was unavailable, so pane fixtures use representative and synthetic names.

The broader existing studio smoke (`SMOKE_PORT=15296 node scripts/smoke-generic.ts /tmp/struna-wave1-integration-20261115 /tmp/struna-wave1-integration-shots-20261115`) completed with 259 passing checks and one failure. Its API repair assertion expected `conversation,thread,delta,changed,delta,thread,delta,changed,done`; the server also emitted `notice` before `done`. Server/provider implementation and that assertion are unchanged by these PRs. All remaining checks, including its UI flows, passed. Log: `/tmp/struna-wave1-integration-20261115.log`. This run is not claimed green; the unrelated event-sequence expectation was not changed.

Limitations: automation uses Chromium's synthetic microphone and stand-in CLIs, not real audio, real providers, human screen readers or physical devices. Every run owns fresh home/state/cache directories and blocks outside browser requests. The existing short-viewport session/pane overlap remains for the parent agent's reader-space changes; the visible state text and keyboard checks do not establish that broader layout is fixed.
