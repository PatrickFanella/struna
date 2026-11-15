# Issue 60: Compact stage header

The active stage has one heading/ordinal, one Start/Pause/Resume timer and the existing concise instruction disclosure. Session outline and details holds plan context, the full stage list, stage elapsed and active practice time. End session is a quiet action; Next stage stays distinct. The timing and skippable-break transition functions are unchanged.

The existing Jost display, Atkinson body, warm semantic colors, radius and focus styles are retained. No new shadow or motion is introduced.

Verification on November 15, 2026: `pnpm typecheck`, `pnpm test` (340 passing), and `pnpm build` passed. Baseline screenshots are retained at `/tmp/struna-wave-one-TS2pFK`. `scripts/smoke-wave-one.ts` checks the header at 320x700, 390x844, 844x390, 1153x814 and 1003x814 across light/dark/Device with a six-string tab Studio fixture. Keyboard opening/closing of the outline retains focus and does not change timer/stage state; Start/Pause/Resume and horizontal overflow are asserted. Later wave integration evidence records the final rerun and native desktop zoom.

This issue owns the header; the default phone music/control viewport and desktop frame remain #62/#64. Physical-device and screen-reader output remain #29.
