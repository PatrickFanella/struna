# Issue #11: confirmed material checkpoints

A clean-pass click captures the current BPM, stable material identity, stage key, session kind, timestamp and pass context before a raise is applied. Measure material selects the exercise explicitly; helper/pass state is stored separately per stage/material. The compact summary shows the latest confirmed BPM per material. Session storage retains checkpoints across navigation, stages and reload. Older sessions begin with empty checkpoint/helper maps. Merely changing the click creates no checkpoint. Review defaults and per-material log fields remain issue #15.

Validation: `pnpm test` passed 318 tests; `pnpm build` includes a passing typecheck. The extended scratch stage-tempo smoke checks event BPM, separate exercise state and the nine width/theme cases. Physical audio and screen-reader use remain outside this automation.
