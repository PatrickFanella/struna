# Wave 4 qualification — November 15, 2026 UTC

**Automated conformance: PASS. Overall qualification: INCOMPLETE.** The owner will perform the remaining human checks after this pass. [Issue #29](https://github.com/PatrickFanella/struna/issues/29) stays open; this evidence PR must not auto-close it. Nothing in this record is a deployment claim.

The tested application commit is `83d4d04e8f151224e2e15f50485859ac35fdc92f`, main after [PR #55](https://github.com/PatrickFanella/struna/pull/55). Every #29 prerequisite was read back as closed on GitHub. This PR changes regression harnesses, a scratch launcher and evidence only; it changes no server or web application code. The report's finding IDs and requirements come from the current work issues linked by roadmap #2, which cite the November 14 PDF; the original PDF was not re-audited in this run.

Evidence was collected on Kvant/Linux with Node `v24.22.1`, pnpm `12.18.0` and system Chromium `156.0.8078.79`. The shared T3 browser used Chrome headless shell `157.0.8103.78`. All writes used new scratch home/state/cache directories, fixture vault/media copies and offline provider stand-ins. No production logs, recordings or provider requests were submitted.

[Machine-readable evidence](wave-4/evidence.json) records results, exact harness SHA-256 values, screenshot hashes and artifact locations. [Operator checks](wave-4-manual.md) supplies the remaining device/audio/screen-reader procedure and a runnable scratch fixture.

## Fresh checks

The retained root is `/tmp/struna-wave4-5fng6a0g`. Each command below used a fresh directory and an unused port. The generic and personal scripts can reset their supplied scratch path, so never point them at an existing run or real data. The manual launcher refuses an existing path.

| Check | Observed result | Evidence |
| --- | --- | --- |
| `pnpm typecheck` | PASS, including the final harness/launcher changes | Compiler exit 0 |
| `pnpm test` | PASS: 338 tests, 0 failed/skipped | `/tmp/struna-wave4-tests.log` |
| `pnpm build` | PASS; existing large PDF/alphaTab bundle advisory | `/tmp/struna-wave4-build-final.log` |
| Studio smoke, UTC, port 5401 | PASS: 262 checks | `logs/studio.log`; `studio-shots/` |
| Theme controls (#28) | PASS: 61 assertions | `controls-28/checks.json`; `logs/controls-28.log` |
| Pane picker (#18) | PASS: 157 assertions | `controls-18/checks.json`; `logs/controls-18.log` |
| Coach keyboard (#19), refreshed locator | PASS: 1,470 assertions | `controls-19-final/checks.json`; `logs/controls-19-final.log` |
| Semantics/status/upload (#20) | PASS: 159 assertions | `controls-20-final/checks.json`; `logs/controls-20-final.log` |
| Materials actions (#21), port 5404 | PASS: 16 configurations, 32 result records | `materials-21-native/results.json`; `logs/materials-21-native.log` |
| Materials routes/find (#22), port 5404 | PASS: 16 configurations, 48 result records | `materials-22-native/results.json`; `logs/materials-22-native.log` |
| Full/Short/Quick, timing, review and discard | PASS: 12 configurations | `logs/stages-complete.log`; `/tmp/struna-stage-tempo-dPICq6` |
| Personal session, fake microphone, port 5403 | PASS: 84→87 BPM retained, scratch log and 32,183-byte recording written | `logs/personal.log`; `personal/` |
| Tuner/microphone states | PASS: 16 configurations; synthetic allowed/denied/missing/unavailable, lease and late-release cases | `tools-native/checks.txt`; `logs/tools-native.log` |
| Coach provider/prompt clarity | PASS: 16 configurations | `coach-clarity-native/checks.txt`; `logs/coach-clarity-native.log` |
| Coach proposals, OS boundary and Apply | PASS: 12 configurations plus active-session guard | `logs/proposals.log`; `/tmp/struna-proposals-browser-LoWth8` |
| Manual fixture launcher | PASS: Full/Short/Quick and named materials rendered; existing directory refused with EEXIST | `manual/`; `logs/manual-refusal.log`; shared-browser observations below |

Paths without a leading slash in this table are relative to the retained root. Full browser artifacts contain scratch access/stand-in state and are not a public asset pack. The committed screenshots and manifest contain only selected fixture evidence.

## Finding-by-finding matrix

`P` means the specified automated assertions passed against the merged application. It does not mean a physical device, actual screen reader or hardware audio passed. Every row covers 320×700, 390×844 and 1003×814, plus desktop native 200% zoom, in Light, Dark and Device. The named harness describes the precise interaction being asserted; human comprehension, touch/audio quality and spoken output remain separate gates.

| Finding | Checked behavior | 320 | 390 | 1003 | Native 200% | Fresh harness evidence |
| --- | --- | --- | --- | --- | --- | --- |
| VIS-01 | Theme labels, selection, doubled labels and keyboard focus | P | P | P | P | controls-28 |
| VIS-02 | Musical goal, direct stage resource and current-stage action hierarchy | P | P | P | P | stages; controls-20 |
| VIS-03 | Primary/secondary actions, selection/focus and material management | P | P | P | P | stages; materials-21-native; controls-28 |
| PRA-01 | Today/stage named material opens and return without starting a session | P | P | P | P | stages; materials-22-native |
| PRA-02 | Chosen duration's actual stages/checklist; omitted tune excluded | P | P | P | P | stages |
| PRA-03 | 80-BPM target source, stage override/reset and independent confirmed material state | P | P | P | P | stages; unit stage/checkpoint tests |
| PRA-04 | Paused/running transitions, stage versus active time and reload recovery | P | P | P | P | stages; unit sessionTimer tests |
| PRA-05 | Separate optional roll/tune BPMs, skipped null, retained edits, failed save and file/API readback | P | P | P | P | stages; unit/API log tests |
| PRA-06 | End/Resume, partial review, discard cancellation and confirmed discard without a log | P | P | P | P | stages; unit partial-count tests |
| MAT-01 | Musical names, source/provider, legacy fallback and destination/new-tab text | P | P | P | P | materials-21-native; materials-22-native |
| MAT-02 | Encoded item URL, reload/paste, history, search/kind/scroll restoration and missing recovery | P | P | P | P | materials-22-native |
| MAT-03 | Exact accessible open name, Use in practice, Manage menu and delete cancellation | P | P | P | P | materials-21-native |
| MAT-04 | Explicit find/add, loading, added/empty/error, unknown completion and provider/web recovery | P | P | P | P | materials-22-native |
| TOOL-01 | Direct Metronome without mic, idle Tuner, synthetic input states and independent lease release | P | P | P | P | tools-native |
| TOOL-02 | Named numeric BPM, Enter/Escape, invalid 301, stage suggestion reset and no implicit playback | P | P | P | P | stages; tempo unit tests |
| COA-01 | Provider labels, Draft/Send semantics, immutable preview, Dismiss and deliberate Apply | P | P | P | P | coach-clarity-native; proposals |
| COA-02 | Header/More/context focus, Tab/Shift+Tab containment, Escape/Done, retained draft and single request | P | P | P | P | controls-19-final |
| RWD-01 | Complete pane names, wrapping, internal scroll and Add/replace focus return | P | P | P | P | controls-18 |
| RWD-02 | Phone Tools/reader priority, expansion, scroll/focus/state retention and aligned tab text | P | P | P | P | stages; controls-20 |
| A11Y-01 | One exposed h1, nested headings, named upload, visible focus and quiet state live regions | P | P | P | P | controls-20-final |

Native zoom uses a new persistent Chromium profile with its default zoom set to 2, and asserts `innerWidth === 501` and `devicePixelRatio === 2` at a 1003×814 window. The Materials, tools and Coach-clarity harnesses now do this too. Earlier Materials CDP metric/text-scaling artifacts remain labeled as emulation; they are not the native-zoom proof used above. Materials/tools/Coach clarity exercise both light and dark OS preferences for Device; stage and control variants have their documented Device preference.

Full completion is exercised by the broader Studio smoke. The stage matrix additionally exercises Quick completion, a Full partial session with a skipped tune, Short completion with no inherited BPM, and confirmed discard. Its custom Short fixture has one Technique stage; the operator fixture also offers a longer Short with Logging. These are plan-driven fixtures, not hardcoded product session types.

## Gaps found and resolved in this pass

The old Coach keyboard test still expected Materials' retired “Ask the coach” action. The current flow submits Find and add materials, then exposes Open Coach conversation in its result/recovery state. The test now traverses that flow, proves the hidden Practice Coach does not steal modal ownership, and verifies focus returns to the current Materials opener. The separate removed-opener/header fallback assertion remains intact. No product defect was inferred from the outdated locator timeout.

The previous stage matrix previewed Short but did not complete/save it, and entered discard confirmation without confirming deletion. It now completes Short with a blank roll BPM, reads that exact null back from disk and confirms there is no omitted tune. It also confirms discard, checks the log directory is unchanged, and checks session/draft storage is cleared. The first added Short assertion incorrectly omitted the stage-count prefix in the heading; the corrected assertion matches the existing visible heading. Both failed exploratory runs are retained, distinct from the passing final run.

No unresolved automated application failure remains in these runs. The outstanding evidence gaps are tracked by #29 itself; no duplicate implementation issue was created for unavailable human/device evidence.

## Available environment and remaining gates

| Surface | November 15 observation | Qualification status |
| --- | --- | --- |
| Shared T3 browser, Linux Chrome 157, 390×844 | Fixture rendered without page overflow/console errors. Tuner stayed idle until Start microphone, then showed No microphone found with retry/Metronome recovery. Direct BPM entry saved 80; click visibly entered count-in and could be stopped. | PASS for these browser states only; audio audibility/pitch unverified |
| Android emulator, T3_Pixel_API_35 / Android 15 | Device panel opened, but Chrome launch was refused with DEVICE_IN_USE. One tool-recommended bounded wait remained busy. The other session was not reused, closed or interrupted. The temporary port forward was removed. | UNVERIFIED; no Android browser interaction or screenshot claimed |
| iOS/native Safari | No iOS device/simulator exposed on this machine; no physical phone route configured | UNVERIFIED — owner follow-up |
| Real screen reader | No Orca or speech client available in this environment. Accessibility-tree and live-region assertions are browser automation, not spoken output. | UNVERIFIED — owner follow-up |
| Real instrument/microphone | Shared browser found no microphone; host audio inventory exposed virtual PipeWire routes. Synthetic streams and fake-device capture are labeled above. | UNVERIFIED — owner follow-up |
| Audible metronome and real recorded playback | Browser visual state and a synthetic saved recording passed; nobody listened to real hardware output or played a guitar in this run | UNVERIFIED — owner follow-up |
| Live model provider | Stand-ins only; no real provider request submitted | UNVERIFIED; any later request needs an authorized scratch setup |

The shared browser tab and owned manual fixture server were closed/stopped after inspection. Scratch files remain. No other agent's device session or service was stopped. The fixed launcher token is intentionally public fixture data; no live token or account credential is part of the committed evidence.

## Retained screenshots and handoff

- [320 Light material review](wave-4/320-light-review.png)
- [390 Dark expanded reader](wave-4/390-dark-reader.png)
- [1003 Device session](wave-4/1003-device-session.png)
- [Native 200% Coach prompts](wave-4/native-200-coach.png)
- [Native 200% Materials empty result](wave-4/native-200-materials-no-results.png)
- [Shared-browser missing microphone](wave-4/shared-browser-no-microphone.png)

Continue with [the operator procedure](wave-4-manual.md). Record actual device/browser/date and spoken/audio outcomes, link any failures, and update #29. Merging this automated-evidence PR alone does not complete Wave 4.
