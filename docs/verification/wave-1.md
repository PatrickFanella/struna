# Wave 1 delivery and verification

Checked November 15, 2026 UTC. This covers the 15 Wave 1 units in roadmap #2. Later waves, production deployment and full device/audio qualification are outside this delivery.

All 15 work PRs were merged under the PatrickFanella GitHub account during this session. Most targeted other stack branches. At the final readback, main contained only the theme fix; the integration PR brings the already-reviewed combined code onto main. The application tree before adding this report is identical to the final remote expanded-reader branch and is recorded at commit `4baefb8cb50f1505eb54a04e5300d70b6a4b2100`.

| Work issue | Delivered outcome | Work PR |
| --- | --- | --- |
| #28 | Content-sized theme choices | [#30](https://github.com/PatrickFanella/struna/pull/30) |
| #7 | Stage material/tempo metadata, priority, overrides and personal-mode compatibility | [#33](https://github.com/PatrickFanella/struna/pull/33) |
| #10 | Per-duration scope, explicit additions and saved attempted/unmeasured checklists | [#34](https://github.com/PatrickFanella/struna/pull/34) |
| #18 | Wrapping pane picker and visible focus return | [#37](https://github.com/PatrickFanella/struna/pull/37) |
| #19 | Coach modal containment, dismissal, exact opener and hidden-pane behavior | [#40](https://github.com/PatrickFanella/struna/pull/40) |
| #12 | Retained pause state, active time and persistent legacy timing disclosure | [#36](https://github.com/PatrickFanella/struna/pull/36) |
| #13 | Musical names and source metadata tied to stable identity | [#32](https://github.com/PatrickFanella/struna/pull/32) |
| #14 | Durable material URLs and restored list context | [#39](https://github.com/PatrickFanella/struna/pull/39) |
| #22 | Explicit find-and-add behavior and actual request outcomes | [#43](https://github.com/PatrickFanella/struna/pull/43) |
| #8 | ADR 0001 for an enforceable plan candidate/Apply protocol | [#31](https://github.com/PatrickFanella/struna/pull/31) |
| #23 | Direct Metronome and deliberate Tuner microphone start/release | [#35](https://github.com/PatrickFanella/struna/pull/35) |
| #27 | Provider identity, Draft/Send semantics and honest write disclosures | [#41](https://github.com/PatrickFanella/struna/pull/41) |
| #25 | Stage-first hierarchy and a filled Start/Resume/Pause action | [#38](https://github.com/PatrickFanella/struna/pull/38) |
| #26 | Mounted reader expansion and compact phone tools | [#42](https://github.com/PatrickFanella/struna/pull/42) |
| #20 | Nested headings, named upload inspection and persistent state feedback | [#44](https://github.com/PatrickFanella/struna/pull/44) |

The original PRs remain the per-issue review record. Issue #8 was closed as an architecture spike and #9 was updated with its implementation requirements. A production plan-approval boundary is not implemented in Wave 1.

## Checks

- `pnpm typecheck`, `pnpm test` and `pnpm build` passed. All **317 tests passed**, with no skips or failures. Build retains the existing PDF/alphaTab bundle-size advisory.
- Full Studio smoke: **260 checks passed**, using a UTC scratch studio and stand-in CLIs. Log: `/tmp/struna-wave1-verified-generic.log`; screenshots: `/tmp/struna-wave1-final-studio-shots`.
- Personal smoke passed a synthetic recording, new scratch log and return to the next session. It seeded an existing 84 BPM material tempo, applied the 87 BPM clean-pass suggestion and verified 87 survived progression. Log: `/tmp/struna-wave1-verified-personal.log`.
- Practice matrix passed all nine combinations of 320×700, 390×844 and 1003×814 with Light, Dark and Device. It checked stage material selection after Coach, tempo overrides/revisit/reload/reset, the 2/6/2 Quick scope, pre-start and Workspace additions, persisted checklist results, active time, legacy disclosure through review, reader focus/DOM/scroll retention and synthetic recording continuity. Artifacts: `/tmp/struna-stage-tempo-bzTcmI`.
- Semantics: **159 assertions passed**, including native Chromium 200% zoom at a 1003×814 window (`innerWidth=501`, DPR 2). Upload accessibility-tree inspection, keyboard controls, one exposed view h1, tab whitespace, state transitions, failed saves/retries and absence of live tick/beat updates are covered. Artifacts: `/tmp/struna-wave1-semantics-keyboard-final`.
- Theme: **61 assertions passed**, including native 200% zoom and doubled labels. Artifacts: `/tmp/struna-wave1-theme-final`.
- Combined pane-picker and Coach modal checks passed; four-pane and later native-zoom cases are recorded in `issue-18.md` and `issue-19.md`. The combined modal run passed 1,458 assertions at `/tmp/struna-wave1-controls19-fixed`.
- Materials checks passed **36 matrix cases**, plus zoom-equivalent reflow/scaling cases, at `/tmp/struna-wave1-materials`.
- Tool states and independent microphone ownership passed 16 cases at `/tmp/struna-wave1-tools-final`. Coach labels, Draft/Send, repeat-send guards and direct-write disclosures passed 16 cases at `/tmp/struna-wave1-coach-final`. Their 502×407 cases are reflow equivalents, not native browser zoom.
- All six hosted review findings were addressed and their threads resolved. Follow-up evidence is appended to the stage-tempo, scope and active-time reports. Copied Studio tokens remain byte-identical to the baseline; product styling lives in app styles.

These are local checks. GitGuardian is the configured hosted head check. The repository has no application build/test CI workflow; local results are not represented as hosted CI.

## Limits

All write checks used scratch home/state/cache directories, stand-ins and synthetic microphone input. No live player vault, library, log or recording was changed. No production service was restarted or deployed.

Native-phone Safari, a human screen reader, hardware microphone/audio judgment and holding a guitar while reaching controls remain unverified. Issues #25/#26 explicitly requested musician/owner review. Their PRs were externally marked ready and merged, but no physical-device or player-review evidence was available to this run. The screenshots are review artifacts, not proof of those checks. Full roadmap qualification remains #29.
