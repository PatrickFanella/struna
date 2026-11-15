# Contextual hosted Coach — #104

November 15, 2026. Roadmap #77. Scratch-only implementation, deterministic local HTTP Responses provider, original open-string fixtures. No real provider key, charge, production data or deployment.

Hosted Coach now previews the current practice context beside the conversation. Opening the panel fetches metadata from the signed-in workspace; it makes no model request. The summary identifies Today/Playing/Review/Materials, the current plan and goal, stage/task where applicable, the selected material name, the click setting, a separate player-confirmed clean BPM (or unmeasured), and the relevant reflection. Today can include the newest saved reflection from the current plan. Review carries the current unsaved difficulty/pain/notes form, without saving it. A confirmed BPM follows the material across stages; a click setting alone never becomes a clean measurement. Neither is claimed to be audio analysis.

The new account POST `/api/chat/context` accepts a bounded selection, with no identity/path/host options. Plan, kind, stage and material references resolve within the authenticated account; foreign/missing references fail before a provider call. The server reads only existing practice metadata, never material/audio bytes, global owner state or credentials for context. Only the selected account's tested connection can execute an explicit Send. The direct Responses request still has no shell, tools or configurable endpoint. Instructions treat context as untrusted data and deny audio, file-reading and plan-write claims.

Each Send captures its selection once. The server resolves it again, emits the context actually sent, and saves that summary with the owned user turn. Later stage changes, panel close/reopen, pin/unpin and section navigation do not enqueue turns or rewrite a running turn's context. At most two relevant prompt buttons lead each view; More retains the deeper prompts. Draft fills the composer; Send runs the request. Failed turns restore the question if the player has not typed a newer draft. Context-preview failure leaves the draft and offers Retry practice context. Practice continues without Coach.

Account invalidation clears drafts and messages and aborts streaming/queued work. Raw streaming requests now also invalidate on session denial, discard buffered events after invalidation and cannot restore the old draft afterward. Server expiry/revocation continues to cancel active requests; a closed request cannot start a provider after asynchronous context lookup. The conversation is rechecked after that lookup to avoid appending to a deleted conversation.

## Verification

Commands: `pnpm typecheck`, `pnpm test`, `pnpm build`, `node scripts/verify-coach-context.ts /tmp/struna-wave6-context-full`, `node scripts/verify-connect-ai.ts /tmp/struna-wave6-connect-regression --quick`, `node scripts/verify-hosted-isolation.ts`.

The account context HTTP test exercises preview and delayed Responses requests from Today/Playing/Review, current-plan saved reflection, private material identity, distinct click/clean BPMs, text limits, malicious fields and foreign plan/stage/material rejection before model execution, captured context during another preview, persisted summary, provider failure, and cancellation/reply denial on account switch. It scans context/provider input for foreign data, dummy keys, host paths, session handles and material-content canaries. The source/runtime ownership inventory includes the new account route.

The built-browser matrix covers all six roadmap viewports and native Chromium 200% zoom, each in light/dark/Device-light/Device-dark. It checks a custom Draft without provider traffic, close/reopen, deliberate Today Send, a confirmed playing tempo, a delayed playing reply through pin/unpin (desktop), stage change and Materials navigation, review reflection, provider failure/draft recovery, composer geometry and account invalidation during a pending reply. No duplicate model request is allowed. Screenshots and JSON receipts are retained in the named scratch directory and CI artifacts. The connection regression now asserts the question plus the displayed Today context in the provider input.

This issue carries metadata and player reports, not audio/media interpretation. Hosted plan preview/Apply is still #108. Real provider permission/cost review and a deliberate real-provider turn, public account enablement, production OIDC and #110 Safari/device/guitar/microphone/audio/assistive-speech qualification remain separate.

## Combined local build and delivery

Export #102 is merged through PR #138 at main `32cff38d913401e1f80e85cfe8ef424eed30f985`; the owner explicitly approved its inventory and secret exclusions before merge. Its head `b04d85be3e46c247a7efc28ca2dd4acbfd69ba45` passed CI and GitGuardian. The context branch includes that merged work.

The combined branch passes typecheck, all 364 tests and production build. Its export UI matrix passes six cases, hosted browser isolation passes, and the contextual Coach integration passes focused 390/light, 844/dark and 1440/dark flows. The local reading matrix passed all 32 cases before integration; exact combined full matrices also run in hosted CI. The full context run was begun before the export merge, so the focused integration rerun and exact-head CI provide the combined-build evidence. All 28 local context cases passed. Durable flow/geometry receipts are in [wave-6-context-receipts.json](wave-6-context-receipts.json). The separate three-case focused rerun also passed and covers preview failure, disabled Send, Retry practice context and retained draft.

The CI timeout is now 20 minutes: the export baseline run took about ten minutes, and the added full delayed-context matrix needs additional time. No checks were removed or weakened.

Build hashes for the combined application:

| File | SHA-256 |
| --- | --- |
| dist/index.html | cc359d4abe816d4dd2cd00af54edcada7e1d572e91a614d637371ad791527fca |
| dist/assets/index-k6LoIs13.js | edf181d077b805eff536fe09f7aafc14deb481e23b1821e2384e08d5eac22782 |
| dist/assets/index-BNrrXA4O.css | 201b86ea5dea886b794b6eb59ba0ce09ad5efbb4bcb32bc3e1eafaf7a5219d25 |

## Review corrections

The two P2 findings on initial head `2df87af` were valid and corrected together:

- Context now reuses `genericToday` to resolve the effective stage instruction, including the active phase's focus and the first stage's current next instruction. The HTTP regression changes the counted-session phase and compares both preview and sent content against the instruction returned to practice.
- Review forwards its current measurements with its reflection. The selected material's edited value is authoritative during Review; a blank or invalid value is unmeasured and never falls back to an old checkpoint. Identity matching handles both plan and Materials aliases. Tests cover corrected values, values with no checkpoint, explicit blanks, invalid BPMs and unrelated material IDs.

Typecheck, all 366 tests and production build pass. All three focused built-browser cases (390/light, 844/dark, 1440/dark) pass. Their receipts are included under `reviewCorrections` in the durable JSON. The fixture also checks the phase-specific exercise in playing and Review, corrects a checkpoint from 60 to 54 BPM, clears it and sends an unmeasured turn, then sends the corrected value after restoring it. The full CI context matrix runs these assertions for every case.

Updated application build hashes:

| File | SHA-256 |
| --- | --- |
| dist/index.html | 62fd070ab4f0e8bc88d4522de0849dcc96add51bfe11c9613c9142795080cf1d |
| dist/assets/index-1IgAD16-.js | 8e48f57b0fb2847aeedb8dac75509e1721f3b671ea9f131e6987978fc6383e5d |
| dist/assets/index-BNrrXA4O.css | 201b86ea5dea886b794b6eb59ba0ce09ad5efbb4bcb32bc3e1eafaf7a5219d25 |
