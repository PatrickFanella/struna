# Active practice time — issue #12

Next and Back restart the destination stage timer while retaining the running or paused state. Back’s tooltip explains the restart. Stage position, stage elapsed time and accumulated active practice are separately named; the bar’s accessible description identifies its percentage as current-stage timer progress. Ticks are not live announcements.

Active time is accumulated on pause, transition and review entry. Review uses that total instead of wall-clock session age. Reloads use the stored resume boundary without adding it twice. Old sessions recover their known current-stage time; earlier time was never recorded, so the interface states that limit instead of inventing it.

Checked November 15, 2026 UTC: `pnpm build` passed and `pnpm test` passed all 303 tests. Pure timer regressions cover waiting, paused and running Next/Back, repeated transitions, final pause, reload, legacy recovery and zero played minutes. The extended `node scripts/smoke-stage-tempo.ts` passed nine width/theme cases at 320×700, 390×844 and 1003×814 in Light/Dark/Device, including waiting Next, running Next, a controlled 65-second active interval and one played minute in review. Screenshots: `/tmp/struna-stage-tempo-Txrzaz/shots` on Kvant.

Scratch studio only, providers disabled. No production, physical-device, Safari or audible-timing qualification. Build retains the existing bundle-size warning. Hosted status is checked independently from these local results.
