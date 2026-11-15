# Wave 2 implementation and verification

Checked November 15, 2026 UTC for roadmap #2. All six Wave 2 units have implementation PRs. Coach approval and the combined main integration remain draft for the explicit human checkpoint on #9. No deployment is included.

| Work issue | Outcome | Work PR |
| --- | --- | --- |
| #11 | Actual clean-pass BPM checkpoints, stable material/tab identity and separate helper state | [#46](https://github.com/PatrickFanella/struna/pull/46) |
| #16 | Neutral exit, recording keep/discard choice and explicitly partial, non-counting logs | [#47](https://github.com/PatrickFanella/struna/pull/47) |
| #17 | Musical goal and direct named stage-resource URLs, with return to Practice | [#48](https://github.com/PatrickFanella/struna/pull/48) |
| #21 | Short accessible open names, one practice action and per-item Manage menus | [#49](https://github.com/PatrickFanella/struna/pull/49) |
| #24 | Direct validated BPM entry, cancel/commit and Use stage tempo with source | [#50](https://github.com/PatrickFanella/struna/pull/50) |
| #9 | Immutable Coach candidates, complete preview and guarded explicit Apply | [#53, draft](https://github.com/PatrickFanella/struna/pull/53) |

Work PRs #46–#50 were merged externally during implementation. They targeted stack branches, so those merge events alone do not put the complete tree on main. At the readback, main was `d2eb44c`, containing the original checkpoint unit. [Follow-up #52](https://github.com/PatrickFanella/struna/pull/52) addresses hosted review findings in the combined branch. The main integration carries the complete tree, including those corrections and Coach approval, and does not bypass #9's human checkpoint.

The verified combined application tree is `eb246d3f961333a4af73204c0f44aa2c294920ce`. Merging `origin/main` into the integration branch produced no file differences from that tree. This report adds documentation only.

## Validation

- `pnpm test`: **332 passed**, no failures or skips. Final log: `/tmp/struna-wave2-combined-tests.log`.
- `pnpm build`, including `pnpm typecheck`: passed. The existing large PDF/alphaTab bundle advisory remains. Log: `/tmp/struna-wave2-combined-build.log`.
- Full Studio smoke: **262 checks passed** on the combined code. It covers setup, automatic Coach behavior, explicit plan Apply, timed practice, saved logs, Materials, provider settings and credential isolation. Log: `/tmp/struna-wave2-final.log`; screenshots: `/tmp/struna-wave2-final-shots`.
- Practice matrix: **9 width/theme cases passed**, including clean checkpoints, separate exercise state, stage tempo reset, direct entry/invalid-value cancellation, reader continuity, retained timing, partial review/reload and Today resource navigation. Artifacts: `/tmp/struna-stage-tempo-WOBNcw`; log: `/tmp/struna-wave2-stage-final.log`.
- Coach proposal matrix: **12 width/theme/zoom cases passed**. It covers 320×700, 390×844 and 1003×814 with Light/Dark/Device, plus actual Chromium 200% default zoom at the desktop size (`innerWidth=501`, DPR 2). It checks exact before/after preview, reload, Dismiss, active-session refusal, failed restore registration/retry and explicit Apply. The hostile stand-ins cannot write the active plan or archive. Artifacts: `/tmp/struna-proposals-browser-jGk85h`; log: `/tmp/struna-wave2-proposals-final.log`.
- Materials matrix: **24 cases passed** after the hosted corrections, with exact accessible names, menu keys/focus return, delete cancellation, tap targets, durable routes and phone reflow. Artifacts: `/tmp/struna-wave2-materials-followup`. The script's text-scaling/reflow equivalents are distinct from native browser zoom.
- Personal-mode smoke passed a synthetic recording and new scratch log; it seeded 84 BPM, applied 87 after three clean passes and retained that tempo across stages. Log: `/tmp/struna-wave2-personal2.log`.
- Tool matrix passed **16 cases**, including deliberate microphone ownership and tool states, at `/tmp/struna-wave2-tools-final`. Coach clarity passed **12 cases** with draft/send semantics and current plan-approval/non-plan-write disclosures at `/tmp/struna-wave2-coach-final`.
- The outer Linux write-boundary probe passed with actual installed Claude Code **2.1.322** and Codex **0.167.2**, without inference or provider requests. All seven configured provider IDs also passed hostile stand-in regression tests. Failed qualification disables the provider family; no direct-write fallback exists.

Independent code review found recording finalization, plan-link deletion, vanished-tab locks and restore-registration races. Those were corrected. Hosted review found stale measurement selections, missing native-tab choices, repeated plan-only downloads and ineffective plan-link deletion; those were corrected in #52 and their original threads resolved. ADR 0001 explains the outer OS boundary and the change from the originally proposed Codex file-grant mechanism.

GitGuardian is the configured hosted head check. The repository has no application build/test CI workflow; the local tests and browser matrices above are not represented as hosted application CI. Hosted check/mergeability status belongs to each exact PR head and should be reread before merge.

## Remaining checkpoint and scope limits

Issue #9 explicitly requires human code review of the file-write/approval boundary and a player review of the change preview. The draft PR includes the implementation, offline enforcement evidence, exact-byte preview and reproducible scratch tests for that review. Neither agent review nor screenshots count as the human checkpoint.

Native-phone Safari, a human screen reader, physical guitar/touch use and hardware audio remain unverified. Those broader checks remain in #29. Real authenticated model inference was not run. All regression writes used scratch home/state/cache paths and stand-ins; no live player vault, library, log or recording was used. Wave 3 (#15) and Wave 4 (#29) remain outside this implementation.
