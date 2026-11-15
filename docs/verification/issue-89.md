# Issue #89: warm visual foundation

Local verification: November 15, 2026. Base: `460d25f406ae65611d97f6ffb00024397b66d24f`. This report qualifies the shared foundation only, not the later screen rebuild or hosted mode.

- `pnpm typecheck`: passed.
- `pnpm test`: 341 passed, zero failed/skipped. The first full run stalled in the existing file-download size-cap suite and its owned test process was stopped after about three minutes. The isolated file suite passed all 12 tests; a fresh full run then passed in about 11.5 seconds. No download code or tests were changed.
- `pnpm build`: passed. The existing PDF/alphaTab large-chunk warning remains.
- `node scripts/verify-visual-system.ts /tmp/struna-wave1-visual-evidence-final`: 24 viewport/theme cases passed. Durable numeric results: [visual-system.json](issue-89/visual-system.json).
- `SMOKE_PORT=19596 STRUNA_TIMEZONE=UTC node scripts/smoke-generic.ts /tmp/struna-wave1-studio-smoke /tmp/struna-wave1-smoke-shots`: all checks passed. This covers phone/tablet setup, practice/review, materials, provider settings and unavailable-Coach states using stand-in CLIs and scratch roots. The script checks the dummy credential does not leak into output, database, responses, pages or stand-in logs.
- All 16 historical Studio export hashes match the retained asset manifest. All nine new app vector/icon assets have separate recorded hashes. PNG dimensions are 48, 180 and 512px as declared; the mark's paths have the exact horizontal transform from #89.
- Inspected local Chromium screenshots at 320px light and 1440px dark. The mark reads as S beside untransformed Jost text; narrow controls wrap as before. Full-page Today captures demonstrate the foundation, not active-playing viewport geometry.

The visual script covers 320×700, 390×844, 844×390, 820×1180, 1153×814 and 1440×900 with light/dark and both Device schemes. It loads local Jost and regular/bold Atkinson, checks text contrast at least 4.5:1 and focus/control edges at least 3:1, a visible 3px keyboard focus outline, persisted explicit choice despite an opposite device scheme, the mask asset, 14px primary controls and absence of horizontal page overflow. Browser contexts request reduced motion and the existing global rule disables decorative animation/transition.

Measured light text/page contrast is 12.45:1; white/forest primary text is 7.40:1. Dark text/page is 13.72:1; dark primary text is 9.28:1. Accent text, error, muted and clean-pass text pairs also pass in the recorded JSON. Reading panes retain source spacing and use a separate radius; no PDF/EPUB/tab engine was replaced.

No real model request, provider/payment credential, owner vault, production write or public-account enablement was used. The scratch smoke includes local audio fixtures but does not prove hardware audibility, microphone accuracy or real-device permissions. Native zoom, Safari, assistive speech and guitar/phone behavior remain #109/#110 work. Hosted CI status belongs to the PR's exact head and is reported separately from these local results.
