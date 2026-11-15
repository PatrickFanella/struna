# Issue #14 — reloadable material details

Verified November 14, 2026. Stack base: `feat/materials-wave-one` (issue #13, PR #32); this PR contains only the route/history increment. Historical MAT-02 observations supplied the requirement.

Details use `#materials/item/<encoded-id>`. The normal authenticated API resolves an item independently of the current list filter or 500-item list window. The hash contains the existing material identifier, never an access token or absolute host path. Invalid, unknown, deleted and inaccessible items have a recovery view and a return action. Browser history stores search, kind, filter expansion and list scroll position. Item reloads retain that history entry. Other section hashes continue using App's existing section selection.

`pnpm typecheck`, `pnpm test` (302 passing), and `pnpm build` passed. The build retains its large-chunk advisory.

`node scripts/smoke-materials.ts captures/issue-14 14` passed 12 width/theme combinations with both identity and route checks (24 result records). Widths: 320×700, 390×844, 1003×814. Themes: Light, Dark, Device/light, Device/dark. Each exercises link reload, text reload, pasted text URL, browser back/forward, in-app back after reload, preserved search/kind/scroll, actual deletion then reload, unknown/malformed IDs, recovery, and the Practice section hash. Existing identity/new-tab assertions and 200% text checks also pass. One early smoke assertion omitted the required app write header; the final run uses it for the scratch deletion.

Local artifacts: `captures/issue-14/results.json`, and `<width>x<height>-<theme>-{list,details,restored-list,deleted-item,route-recovery,text-200}.png`. Scratch home/state/cache `/tmp/struna-materials-A1W6Kp` is retained. All external browser requests were blocked; provider executables were inert stand-ins. No live-library write, provider invocation, deployment, human review or audio assessment is claimed. Text enlargement is not browser chrome zoom.
