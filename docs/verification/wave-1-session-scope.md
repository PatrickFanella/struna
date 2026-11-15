# Duration preview and checklist — issue #10

Each start action describes that session kind’s own stages and minutes. Custom IDs use the same plan data. Starting snapshots those stages for this session, so later plan edits cannot replace the selected scope. The final stage has an optional checklist of exactly those stages and explicitly added resources; review names attempted and unmeasured work. Old sessions without a snapshot use their existing plan kind.

Checked November 15, 2026 UTC: `pnpm build` and `pnpm test` passed (301 tests). The extended `node scripts/smoke-stage-tempo.ts` passed all nine Light/Dark/Device combinations at 320×700, 390×844 and 1003×814. Its custom Quick fixture shows Tuning 2, Technique 6 and Logging 2; Full alone includes Tune practice. The browser checked each duration summary, the Quick checklist, saved checkbox state after reload and the review’s attempted/unmeasured summary. Screenshots: `/tmp/struna-stage-tempo-rlVhoz/shots` on Kvant.

All fixtures were scratch data with providers disabled. No live player files, physical phone or Safari were exercised. The project has no GitHub CI workflow; hosted security status is a separate check.
