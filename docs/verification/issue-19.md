# Issue 19: Coach modal lifecycle

Before the fix, the dedicated keyboard reproduction opened Coach from its header, typed a draft and pressed Escape. Escape closed the visible panel, but focus was still on the now-hidden TEXTAREA immediately afterwards. After 300 ms it was BODY. Reproduction files: `/tmp/struna-issue19-before-20261115/focus-320.json` and `/tmp/struna-issue19-before2-20261115/focus-320.json`. The historical report's refusal to close on Escape was not reproduced; focus loss was.

Coach now uses `dialog.showModal()` for background inertness and Escape/cancel handling. A single wrapper tracks the actual launching element, restores it on close and falls back to header Coach if it was removed. Tab/Shift+Tab cycle over currently visible enabled controls. Conversation, settings and prompt-list focus effects skip hidden or inert content. The panel remains mounted: local drafts survive, and the existing module-owned request/queue lifecycle is unchanged. Workspace panes pass their real shown state; embedded Coach remains nonmodal.

Validation on November 15, 2026 UTC:

- `pnpm typecheck`: passed.
- `pnpm test`: 297 passed, no skips or failures.
- `pnpm build`: passed, existing large-chunk advisory remains.
- `node scripts/smoke-controls.ts /tmp/struna-issue19-20261115b 19`: 1,458 assertions passed.

The smoke exercises header, More and context-prompt keyboard entry; initial focus; 18 forward and reverse Tabs in conversation/settings/prompts; attempted programmatic background focus; Escape and Done restoration; removed-opener fallback; draft retention; and a delayed stand-in reply that completes once across dismissal. Embedded Coach is tested at the three report dimensions. Screenshots for every width and Light/Dark/Device are in `/tmp/struna-issue19-20261115b`, named `<width>-<theme>-coach-prompts.png`; checks are in `checks.json`. Device follows an emulated dark preference.

Dimensions: 320×700, 390×844, 1003×814 and 502×407, the latter a 200% desktop layout-viewport equivalent. Native zoom UI was not driven. Embedded-pane testing at that short layout is excluded because the existing session bar overlaps pane controls; modal checks do run there. No live provider, live user storage, human screen reader, hardware recording or audio judgment was used. The scratch runner blocks external browser requests and owns home/state/cache and both CLI stand-ins.

A final review added a follow-up commit for a Coach pane retained in a different hidden section. Opening from Materials' Find online prompt must show a modal even though that hidden pane is still mounted. The opener form disappears after submitting, so this path also verifies header fallback when focus had already fallen to BODY. `openCoach` now checks actual pane visibility, and restoration rejects nonfocusable/disabled targets. Typecheck, all 297 tests and build passed again; `/tmp/struna-issue19-hidden-section-20261115c` passed 1,467 checks. This follow-up preserves the already-published branch history rather than rewriting it.
