# Stage material and tempo — issue #7

Optional `material: { file }` or `material: { url }` and `targetBpm` belong on each plan stage. File rules match plan materials; BPM must be an integer from 30 to 300, matching the click. The Coach schema and validator describe the same fields. Old plans need no changes.

Suggestions use the explicit target, then a confirmed record keyed `material:<file-or-url>`, then 72 BPM with a fallback explanation. Older label-keyed records are accepted only when the material label identifies one distinct plan material. Invalid saved BPM values get an explicit fallback. No prose is parsed for tempo. Confirming new per-material measurements is separate work in #11.

The session remembers the suggested tempo and player override per session kind, stage key and material identity. Stage entry applies it once, changes made in tools persist on revisit and reload, and Use suggestion resets the override. A missing file opens a visible missing-resource explanation without clearing the session.

Checked November 15, 2026 UTC:

- `pnpm typecheck`, `pnpm test` (300 passed), and `pnpm build` passed. Build retains the pre-existing bundle size warning.
- `node --test server/generic/studio.test.ts web/src/practice/stageTempo.test.ts`: 18 passed, including metadata validation, missing files, the 80 BPM roll target, isolated material records, legacy ambiguity and out-of-range records.
- `node scripts/smoke-stage-tempo.ts`: passed all nine combinations of 320×700, 390×844 and 1003×814 with Light, Dark and Device. Checked stage entry, manual override, revisit, reload and reset. Screenshots: `/tmp/struna-stage-tempo-nVvE18/shots` on Kvant.

The browser run used a scratch studio and disabled providers. No production data, real audio, Safari or physical phone was tested. GitHub currently has no project CI workflow; local checks are not hosted CI evidence.

Hosted review follow-up: personal sessions retain their label-keyed clean-tempo initialization and keep the player’s click through later stages. The personal scratch smoke seeded 84 BPM, applied the clean-pass suggestion to 87 and verified 87 survived progression. The Studio smoke now selects Coach before entering a material-bearing stage and checks that the music pane becomes visible, including at phone widths. Both smokes passed; Studio artifacts: `/tmp/struna-stage-tempo-GgmNal`.
