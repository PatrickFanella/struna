# Roadmap #77, Wave 3

November 15, 2026. This records the combined private-practice build, not the earlier report-driven roadmap.

| Issue | Delivery |
| --- | --- |
| #88 | Account-owned profiles, starter plans, Today, logs, tempos, practice leases and bootstrap; session-bound requests and partitioned browser storage. PR #127 |
| #107 | Dismissible, recoverable help beside selected tools, recording and guest reading; no automatic permission requests. PR #128 |
| #109 | Expanded viewport/theme regressions, keyboard/scroll geometry and durable exact-build receipts in this document's companion directory |

## Build and method

The tested application source is `010ba6c5e4dd3f7d403f79808808dbd90ca67365`, integrated to main as `23a53f482413b30744fce35db068c64f297e7e2f`. A Git comparison confirms identical `server`, `web`, package manifest and lockfile bytes. This evidence PR changes scripts and documentation only. [Build identity](roadmap-77-wave-3/build.json) records both source trees, Node/Chromium versions and SHA-256 for all 46 built assets and the geometry receipts. Rebuilding after the runs produced the same application JS/CSS filenames and hashes.

Local `pnpm typecheck`, all 351 tests and `pnpm build` pass. Existing large reader/application chunk warnings remain. Hosted CI on the implementation heads passed typecheck, tests, build, visual/reader/guest checks and the new account/help browser walks; GitGuardian also passed. Responsive evidence here is automated Chromium, with real desktop browser zoom configured through Chrome settings. It is not mobile Safari or a physical-device/audio result.

Every run used a new scratch home/state/cache, offline provider stand-ins or no provider, and fixture music. Existing owner data, services and provider accounts were not used. Microphone streams were synthetic; denial and missing/unavailable devices were simulated. The scripts own their server processes and close them at exit. Before running the older Studio/personal smokes, their headers, reset behavior, paths and unused ports were inspected.

## Responsive matrix and geometry

The reading, session/review, tools and Materials matrices each cover 320×700, 390×844, 844×390, 820×1180, 1153×814 and 1440×900, the retained 1003×814 breakpoint case, and native desktop 200% zoom from a 1153×814 window. Every size runs explicit light, explicit dark, Device light and Device dark: 32 cases per surface. Reduced-motion preference is enabled for these expanded runs.

| Surface | Retained evidence | What passed |
| --- | --- | --- |
| Reading | [32 geometry/focus cases](roadmap-77-wave-3/reading.json) | Music/control geometry, 48px targets, keyboard reach, no horizontal page overflow, expanded-reader dismissal, tool return, pane/reader scroll and desktop Coach draft continuity |
| Today and session/review | [192 geometry observations](roadmap-77-wave-3/session-review.json) | Custom Quick/Full/Short scopes, explicit tempo confirmation, clean/miss passes, unmeasured/skipped materials, pause/next/back/break timing, neutral/partial/pain exits, recording retention, review/reload, failed-save retry and immutable log readback |
| Tuner/Metronome | [224 geometry observations](roadmap-77-wave-3/tools.json) | Numeric BPM, keyboard/focus return, click state, explicit capture, denial/missing/unavailable/retry, independent capture leases, pending cancellation and late stream release |
| Materials | [448 geometry observations](roadmap-77-wave-3/materials.json) | Long titles, compact list/details, filters/back/scroll/route continuity, missing/malformed recovery, searching/loading, empty results, provider error/retry, partial/interrupted streams and manual recovery; additional 200% text checks |
| Contextual help | [8 fresh/returning phone cases](roadmap-77-wave-3/help.json) | Keyboard reopen/dismiss, remembered tips, orientation, reader/session/timer/guest continuity, unsent Coach draft and explicit denied microphone |

At 390×844 in the light fixture, the complete six-string block spans y=401–535 inside the reader (y=393–624). Click and clean/miss controls span y=634–682, above navigation at y=759. [Initial phone viewport](roadmap-77-wave-3/390-reading.png).

At 320×700 the reader is deliberately scrollable and the complete six-line block is slightly taller than the visible reading area; controls remain reachable above navigation. At 844×390 the short-height layout scrolls: the entire block and click/clean controls coexist after scrolling, rather than all fitting in the initial viewport. The added assertions prove that geometry and bring each playing control into view with keyboard focus. [Landscape reading and controls](roadmap-77-wave-3/landscape-reading.png), [native desktop 200% reading and controls](roadmap-77-wave-3/native-200-reading.png). These receipts establish browser focus/viewport clearance, not physical notch/safe-area or guitar-hand reach.

Other scratch evidence:

- Visual foundation: 24 conformance cases; `/tmp/struna-wave3-visual`.
- Guest: 18 viewport/theme cases plus unavailable storage, anonymous shell and denied private API checks; `/tmp/struna-wave3-guest`.
- Account practice: two synthetic identities with concurrent HTTP isolation, forged ownership, stale-session and delayed-body revocation checks; two independent phone UI walks through profile, restored session/review and log readback. Embedded and fetched app-info paths both pass. See [account boundary evidence](roadmap-77-account-practice.md).
- Personal mode: scratch fixture, confirmed tempo progression, synthetic recording saved with its purpose, log readback and updated session count; `/tmp/struna-wave3-personal-final-20261115`.
- Studio: offline provider API/configuration checks, phone/tablet setup, deliberate plan preview/Apply, complete practice/log/return, Materials uploads/read/delete and Coach recovery; `/tmp/struna-wave3-studio-rerun-20261115` and `/tmp/struna-wave3-studio-shots-rerun`.

## Reproduce

Run `pnpm typecheck`, `pnpm test`, then `pnpm build`. Use fresh output paths and unused ports for scripts that reset their supplied scratch directory.

```sh
node scripts/verify-practice-layout.ts /tmp/struna-wave3-rerun-reading
node scripts/smoke-stage-tempo.ts
node scripts/smoke-tools.ts /tmp/struna-wave3-rerun-tools
node scripts/smoke-materials.ts /tmp/struna-wave3-rerun-materials 66
node scripts/verify-contextual-help.ts /tmp/struna-wave3-rerun-help
node scripts/verify-hosted-practice.ts
node scripts/verify-hosted-practice.ts --without-bootstrap
node scripts/verify-visual-system.ts /tmp/struna-wave3-rerun-visual
node scripts/verify-guest.ts /tmp/struna-wave3-rerun-guest
SMOKE_PORT=58088 node scripts/smoke-practice.ts /tmp/struna-wave3-rerun-personal
SMOKE_PORT=58096 node scripts/smoke-generic.ts /tmp/struna-wave3-rerun-studio /tmp/struna-wave3-rerun-studio-shots
```

The older personal and Studio smokes were updated to match current labels and the Current plan disclosure. Their failures were stale test selectors, not reasons to change product behavior. No larger application defect was exposed by these runs.

## Remaining gates

Hosted practice remains scratch-only: production startup refuses `STRUNA_HOSTED_PRACTICE=1`. Materials/recordings/Coach/credentials and guest import still need their account boundaries in later waves. File/database ownership and guest/owner isolation require review before exposure; #94 owns full hostile-route qualification. Production OIDC registration and deployment have not been performed.

Real Safari/devices, guitar/microphone, audio playback, assistive speech, physical reach and consented first-use/return observations belong to #110. No musical improvement, real later-day return, security certification or support/payment result is claimed. Launch support stays deferred.
