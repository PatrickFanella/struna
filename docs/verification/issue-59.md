# Issue 59: Coach Escape reconciliation

Decision: the current source does not reproduce the reported Coach dismissal failure. On commit `5cfebf29039ac4250a4d3226d9f1d3767fe6df8c`, the dedicated current-build harness closed the modal from the header Message field with Escape and restored focus to the header Coach button after the historical 300 ms delay. The same run passed Done from settings, More, context prompts, a removed launcher fallback, a hidden Practice Coach while Materials opens the modal, unsent-draft retention, and an embedded nonmodal Coach pane. The report did not supply an audited build SHA, asset identity, URL, browser version, or exact launcher beyond Message with BODY focus, so this result covers current source only and does not disprove its observation.

Source comparison: current `Chat.tsx` uses native `dialog.showModal()`, prevents the browser's default cancel close, calls the application close path, and restores a connected visible opener or header fallback. This is the modal approach delivered by PR #40 for issue #19. The issue #19 record documents the earlier reproducible defect as focus loss after Escape, rather than a failure to close. Wave 4 recorded a passing current keyboard matrix at commit `83d4d04e8f151224e2e15f50485859ac35fdc92f`; the rerun below repeats that matrix at the current post-#57 source.

Validation on November 15, 2026 UTC:

- `pnpm build`: passed; the existing large-bundle advisory remains.
- `node scripts/smoke-controls.ts /tmp/struna-issue59-20261115 19`: passed, 1,470 assertions. The scratch-only run used Chromium through Playwright, fresh local state and offline Coach stand-ins. Artifacts include `checks.json`, focus records and width/theme screenshots under `/tmp/struna-issue59-20261115`.

No deployed build identity could be compared: the repository says Struna has no public release, and its deployment templates are explicitly not a deployment record. No live instance, provider, user storage, physical device, real screen reader, microphone, or audio was accessed. This spike does not close issue #29's device and screen-reader qualification gaps.

Resulting action: do not reopen issue #19 and do not create a second Coach-dismissal fix from the report alone. Close #59 with this evidence and retain #29 for live/device qualification. If a later audit supplies its build identity and a reproducible launcher/state, file a new minimal regression issue with that evidence.
