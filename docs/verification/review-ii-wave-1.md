# UI/UX Review II: Wave 1

November 15, 2026. Scope: #59, #60, #61, #63, #65, #66 and #67 under #58. This is scratch Chromium and source verification, not a production deployment or native phone/audio/screen-reader qualification. #62/#64 remain Wave 2; #29 remains the final shared gate.

The baseline was source `5cfebf29039ac4250a4d3226d9f1d3767fe6df8c`. The final combined UI build used `index-BKz0Zkp3.js` and `index-D7msHcSY.css`. Changes retain Struna’s Jost/Atkinson/Spline typography and warm semantic palette, radius and focus treatment. No new brand system or motion was introduced.

## Results

- Coach dismissal: current source passed the original 1,470-assertion harness. The audit build is unknown, so this is not a claim that its observation was disproved. The updated on-demand entry paths passed 2,199 assertions, including a genuinely removed outside launcher, native modal focus recovery, the embedded nonmodal owner, and Materials recovery.
- Header: the default has stage name/ordinal, one Start/Pause/Resume timer, instruction and progression controls. Session outline and details discloses full context and active-time accounting. Outline interaction does not alter timing; the existing break and neutral/pain exit transitions remain exercised.
- Tools: tune/playing/recording/note intent determines primary controls. No fallback BPM prompt appears during tuning or notes/recording. General custom/personal stages keep safe controls. Player overrides survive tool toggles and reload; pass checkpoints remain material-specific.
- Picker: the desktop menu reserves its opener; narrow screens have title/Close. A Source details view retains full provenance. Capture-phase dismissal consumes the subsequent click after unmount. The stricter picker corrections were delivered separately after the initial picker PR merged.
- Materials: rows have one musical title and a source/type line. Details retains full source title, description, difficulty and plan metadata. Routing, list return, management and external destinations passed; source Markdown was not rewritten.
- Coach demand: fresh sessions start with music, two relevant shortcuts live in the deliberately opened drawer, and desktop pin/unpin retains the reader and conversation state. Legacy saved Coach panes remain compatible pins. Direct drawer pin retained an actual reader DOM marker and 80px scroll. A delayed stand-in request survived Unpin/reopen with one POST; a draft survived a stage change.
- Landing: actual configured durations update one scope preview and one Start action without creating a session. Full direction/goal/context/stages remain in Plan details. Named materials stay reachable. The 390x844 baseline asserts all 10/25/45 choices and Start above persistent navigation; custom 10/20/6 and personal choices are separately covered.

## Evidence

- `pnpm typecheck`, `pnpm test` (341 pass) and `pnpm build`: passed. Existing large-bundle warning remains; no hosted application test workflow is configured in this repository. GitHub’s available security check is assessed separately on each PR head.
- `scripts/smoke-wave-one.ts`: 24 viewport/theme cases including 320x700, 390x844, 844x390, 1153x814, 1003x814 and native desktop 200% zoom; header/timer, duration keyboard focus and no-session-before-Start checks. Artifacts: `/tmp/struna-wave-one-0xECKF`; final landing-only screenshots: `/tmp/struna-wave-one-dO9bIs`; final measured geometry: `/tmp/struna-wave-one-dlmjfw`, retained in [landing-geometry.json](review-ii-wave-1/landing-geometry.json).
- Tools: 16 viewport/theme/zoom cases at `/tmp/struna-tools-wave1-20261115`, including synthetic microphone denial/unavailable/retry, stream custody and no microphone request from unrelated controls.
- Materials: 32 cases, exact artifact path in [issue-66.md](issue-66.md).
- Stage/duration/reading/tempo/log matrix: 12 cases at `/tmp/struna-stage-tempo-y6GN8q`.
- Full Studio walkthrough: `/tmp/struna-issue63-generic-final3-rPgALq`; screenshots `/tmp/struna-issue63-generic-final3-shots-cL7kU4`. Personal walkthrough: `/tmp/struna-issue63-personal-4PgzOj`.
- Stage breaks: 12 cases at `/tmp/struna-stage-breaks-20JbyH`. Reload preserves the stored break deadline; the controlled clock releases the restored-practice registration effect before checking its dialog.
- Picker: 355 checks at `/tmp/struna-issue65-final4-20261115`.
- Coach: 20 viewport/theme cases at `/tmp/struna-coach-pin-final-root-20261115`; focused direct-pin/stream/draft case at `/tmp/struna-coach-pin-continuity-root-20261115`; default/open/pinned captures at `/tmp/struna-coach-pin-review-shots-20261115`; 2,199 keyboard assertions at `/tmp/struna-coach-final-root-keyboard-20261115`.

The owner’s hierarchy and concise-direction checkpoint for #63 is pending. [Review the before/after artifact](review-ii-wave-1/landing-review.html). Automated Chromium, synthetic streams and accessibility-tree inspection do not establish native Safari/phone behavior, real microphone/audio behavior or actual screen-reader output. Those dated checks remain in #29. Music-and-controls viewport qualification beyond the shared header remains #62/#64.
