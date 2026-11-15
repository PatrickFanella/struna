# Skippable breaks between stages

Checked November 15, 2026 UTC against merged-main base `f05a02036e79c21fcbe484ed87da4920c550cff1`.

Selecting Next stage opens a 20-second rest in both Studio and personal mode. Skip break or Escape advances immediately. Automatic completion and skipping retain the timer's previous running/paused state; break time is excluded from active practice. The metronome stops for rest and stays stopped until explicitly started again. Back remains immediate, and Finish opens review directly. Existing active/unsaved-take guards still prevent moving stages during a recording.

The deadline, next stage and prior timer state live in the existing session snapshot. Reloading retains the deadline; an expired/restored break resumes from the time it is handled, so an inactive browser gap cannot become practice time. Older sessions need no new metadata. Repeated completion/Next operations cannot skip another stage. The existing pause/exit behavior remains separate.

The dialog uses the existing branded component, palette, radius and focus treatment, with Jost display and Atkinson body fonts. No new font, color, shadow or entrance motion was introduced. The countdown has timer semantics with live announcements disabled; a stable status explains the pause. Skip receives initial focus; completing/skipping the break places keyboard focus on the new stage's timer.

Validation:

- `pnpm test`: **340 passed**, no failures or skips. Log: `/tmp/struna-breaks-tests.log`. Focused timer tests cover break accounting, running/paused restoration, early skip, repeated operations, old sessions and a serialized break restored after its deadline.
- `pnpm typecheck` and `pnpm build`: passed; the existing large PDF/alphaTab bundle advisory remains.
- `node scripts/smoke-stage-breaks.ts`: **12 width/theme/native-200%-zoom cases passed**. The clock is installed before Session mounts and paused before exact-time assertions. Final artifacts: `/tmp/struna-stage-breaks-fP2VWi`; log: `/tmp/struna-breaks-smoke-final.log`. It checks 20→15 seconds, no premature completion, automatic completion, frozen active time, stopped click, both skip paths, deadline recovery on reload, focus restoration, immediate Back and direct Finish.
- Existing Full/Short/Quick practice matrix: **12 cases passed**, including saved-log/API readback and confirmed discard. Log: `/tmp/struna-breaks-regression-5bpohw/stages.log`; artifacts: `/tmp/struna-stage-tempo-pIzoGd`.
- Studio smoke: **262 checks passed**. Log: `/tmp/struna-breaks-regression-5bpohw/studio.log`.
- Semantics/upload/recording/save regression: **159 assertions passed**, including take/log failures and retries. Log and artifacts: `/tmp/struna-breaks-regression-5bpohw/controls-20.log`, `controls-20/`.
- Personal-mode synthetic recording/log smoke passed and retained its 84→87 BPM progression. Log: `/tmp/struna-breaks-regression-5bpohw/personal.log`.

Existing browser/capture walks share a small Next-and-Skip keyboard helper; the dedicated break smoke exercises real countdown behavior. Tests use scratch state, offline providers and synthetic audio where applicable. No live player data or production service was changed. Physical guitar/audio, native Safari and real screen-reader output remain unverified.

Retained screenshots: [320 Light](stage-breaks/phone-light.png), [390 Dark](stage-breaks/phone-dark.png), [native desktop 200% Dark](stage-breaks/desktop-200.png). Native-zoom captures use CDP directly to preserve browser metrics.
