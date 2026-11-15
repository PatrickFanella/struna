# Active stage action — issue #25

The current stage leads the session. Plan metadata follows it. The timer is the filled Start, Resume or Pause action; Next stage and Finish use the existing outline treatment. The destination stays visible under Next. Gold remains a focus outline, distinct from neutral selection and the error treatment for pain/misses.

The fonts remain Jost, Atkinson Hyperlegible Next and Spline Sans Mono. Colours use the existing warm `ink`, `on-ink`, `panel`, `edge` and `focus` tokens; radius is the existing 8 px. No new shadow or motion was introduced. These are product adaptations in app.css; Studio’s copied tokens remain unchanged.

Checked November 15, 2026 UTC: `pnpm build`, `pnpm test` (303 passed), and the extended `node scripts/smoke-stage-tempo.ts` passed. Nine report width/theme combinations cover keyboard focus on the clock, secondary Next styling, stage progression and timer behavior. Session screenshots: `/tmp/struna-stage-tempo-VuaYxC/shots/*-session.png`; baseline before the hierarchy change: `/tmp/struna-stage-tempo-nVvE18/shots`. The 390 px Light session screenshot was inspected directly. Text tabs keep their monospace alignment.

**Human checkpoint remains open:** the owner/musician must review the before/after hierarchy. Automation does not establish control reach while holding a guitar. This PR remains draft until that review. No production, Safari, real-audio or physical-device claim.
