# Wave 8: autonomous qualification and production release boundary

Observed November 16, 2026 UTC. Issue #110; roadmap #77. Status: **partial qualification**. The owner requested the checks possible without their hands or accounts, followed by deployment to the existing production service. This record does not close #110 or waive its remaining native/device/audio/assistive acceptance criteria.

## Named candidate and evidence

Qualification candidate: `0306a9ea6f96eca2737f22d291261b42d533f4bc`, based on Wave 7 main `9cb1366f84be754bc03a6075885732fa7fee7d35`. `roadmap-77-wave-8/candidate.json` pins every server/web/shared source file, package/build inputs and all built assets by SHA-256. Later report-only commits do not change those runtime inputs. The PR's exact head runs typecheck, tests, production build and both new acceptance scripts in CI, alongside all existing matrices.

The candidate includes a playback defect found by this qualification. Studio/personal take uploads returned only a saved path, so the existing UI never rendered its player. The response now includes a URL served by the owner's guarded recording route. It accepts only generated take names under Recordings, resolves containment and supports range/HEAD audio reads. Existing hosted recording ownership remains separate. A focused HTTP test covers playable bytes/MIME, ranges/HEAD, unrelated paths, traversal and a symlink escape; hosted inventory/isolation tests also pass. No existing log or take is rewritten.

## Acceptance matrix

| Check | Result | Scope and limit |
| --- | --- | --- |
| Typecheck, tests and production build | PASS | Candidate passes all 376 tests; existing bundle-size advisory remains. |
| One guest → private player → optional AI → deliberate Apply | PASS in automated Chromium | New `scripts/verify-wave-8.ts` walks the same identity through original guest exercise/reflection, local cancellation and failed-login retention, explicit sign-in/import, refresh/replay, private continuation, material upload/reader/handoff, AI skip, dummy-key save/test, contextual Send, structured proposal, exact unchanged base and deliberate Apply. All 28 cases pass on the named candidate (six roadmap viewports plus native Chromium 200% zoom, in light/dark/Device-light/Device-dark). Fake OIDC and offline Responses transport; no real registration or model request. |
| Responsive music and playing controls | PASS in automated Chromium | Existing 32-case reading geometry matrix covers roadmap sizes, four theme states and native desktop 200% zoom. This is not a physical phone/tablet or Safari claim. |
| Shared desktop browser | PASS for inspected steps | Chromium guest exercise at 390×844, resize to 844×390, keyboard Tab focus, optional reflection and reload retention; no horizontal page overflow. Landscape guest completion requires scrolling. Mouse/keyboard automation is not physical stand/reach evidence. |
| Tuner microphone allowed path | PASS with generated capture | Original generated 82.406889 Hz E2 WAV enters Chromium's fake capture device through the real getUserMedia/AudioWorklet/pitch path; E2/in-tune appears and Stop ends the track. No physical microphone or guitar. |
| Microphone denial | PASS as browser policy | The isolated browser context's microphone permission is set to denied and queried before the app requests it. The app displays permission denied. Existing synthetic suites cover missing/unavailable devices separately. |
| Metronome output | PASS as renderer capture | The actual WebAudio destination graph is teed into a MediaStream recorder while a silent source keeps its recording clock live. Decoded Opus has nonzero peak/RMS over about 2.52 seconds. No claim that a human heard speakers. |
| Recorded take save and playback | PASS with generated capture | A real MediaRecorder take from the fake capture is saved into a fresh scratch Studio. The guarded audio URL loads and play advances currentTime with no media error. Audio is synthetic; no private ambient sound was recorded. |
| Physical phone/Safari/tablet, guitar/stand reach | UNVERIFIED | Device discovery offered no iOS/Safari host. The Android emulator was held by another session; one bounded wait returned DEVICE_IN_USE, and that session was neither reused nor closed. No emulator UI result is claimed. |
| Native orientation and OS interruption | UNVERIFIED | Desktop CSS resize/retention and automated pause/reload checks are separate from real OS backgrounding, phone calls, route changes or lock-screen behavior. |
| Screen-reader speech and physical keyboard use | UNVERIFIED | Browser keyboard/focus/semantics checks ran, but no Orca/VoiceOver/TalkBack speech observation or human keyboard task was available. |
| Real player-owned provider | UNVERIFIED | No separately authorized player API credential/request was supplied. All new requests use dummy keys and an offline transport; existing host subscription logins are not borrowed for hosted players. |
| First-use usefulness and later return | NOT MEASURED | No human participant study. The script verifies behavior, not learning or independently reported value. Voluntary support stays deferred/not offered/not measured. |

## Commands and reproducibility

- `pnpm typecheck`; `pnpm test`; `pnpm build`.
- `node scripts/verify-wave-8.ts <fresh-output-directory>`: 28 viewport/theme/native-200%-zoom continuous journeys; writes a build reference, screenshots and receipts.
- `node scripts/verify-audio-path.ts <fresh-output-directory>`: owns a fresh offline Studio fixture and stops it afterward; generates only an original tone, captures metronome output, saves/plays a synthetic take, and checks actual browser permission denial. No real input device or model is used.
- `node scripts/verify-practice-layout.ts <fresh-output-directory>` and `node scripts/verify-hosted-isolation.ts`: existing geometry and account-boundary regression checks.

Committed receipts live in `roadmap-77-wave-8/`; full scratch output remains in the dated /tmp directories named in the task's private release receipt. CI uploads its own artifacts for the exact PR head. Hardware, human hearing, speech output, real identities/provider and real public sign-in are not inferred from those receipts or from historical #29.

## Production scope

Deployment is separately authorized by the current owner request. The existing `guitar-room.service` is a single-owner Studio process behind the existing Authelia/edge-secret boundary, with legacy compatible studio/state/cache paths. The release keeps that mode and boundary. It does not turn on public hosted accounts, register OIDC, delete live accounts, run inference, change backup retention or alter payment/support behavior.

A private online SQLite backup passes integrity and is restored to an isolated staging database. Staging startup and read-only health/app/Today/Materials/proposal checks pass, all existing table logical hashes match the backup, and all six Studio file hashes match. Before activation, the operator rechecks active work, captures a fresh backup, builds an immutable release from the exact merged commit, records current inputs and retains the previous release. After activation, live process cwd, authenticated origin APIs, served asset hashes, data integrity/retention and the public authentication gate must be checked. Code rollback repoints the current symlink and restarts only the existing service; it does not restore an old database over later practice data.

#110, Epic C and roadmap #77 remain open for the required human/native checks. Public hosted enablement additionally requires production identity setup, owner review of deletion/model authority/account safety, actual backup retention/restore policy and deliberate real-provider qualification. The user-authorized Studio deployment does not waive those gates.
