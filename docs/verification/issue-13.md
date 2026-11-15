# Issue #13 — recognizable material names

Verified November 14, 2026 against a fresh scratch studio. The historical MAT-01 report is the requirement source, not live test evidence.

Rows, details and practice panes use optional `shortTitle`, while `title` retains the publisher's title. An existing plan label supplies the short name by the same URL or relative file identity. `provider` and `level` remain secondary metadata; older entries fall back to their existing title and source host. Source links name their destination and say “new tab.” The Coach instructions document the optional fields. No existing library is rewritten.

Checks: `pnpm typecheck`, `pnpm test` (299 passing), `pnpm build` passed. Build reports the existing large-chunk advisory.

Browser: `node scripts/smoke-materials.ts captures/issue-13 13` passed all 12 cases: 320×700, 390×844, 1003×814, each in Light, Dark, Device/light and Device/dark. Assertions cover list and detail names, original title/provider/level/plan metadata, legacy fallback, source URL and `_blank`, horizontal overflow and browser errors. Each case also checks 200% root text size (a text enlargement test, not browser chrome zoom).

Artifacts are retained locally under `captures/issue-13/`: `<width>x<height>-<theme>-list.png`, `-details.png`, `-text-200.png`, and `results.json`. Scratch home/state/cache: `/tmp/struna-materials-69GmGZ`, retained. Screenshots and scratch state are ignored/untracked artifacts, not committed library data.

The browser used Chromium and blocked external requests. Provider executables were inert stand-ins. No live provider, live library, deployment, human playability or audio assessment was exercised.
