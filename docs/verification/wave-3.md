# Wave 3: per-material session review and saved logs

Issue [#15](https://github.com/PatrickFanella/struna/issues/15), the sole Wave 3 unit in roadmap [#2](https://github.com/PatrickFanella/struna/issues/2). Checked November 15, 2026 UTC from main baseline `f52edc36cd0dc22ad6a089e4e4958a4c53c14974`.

## Behavior and compatibility

Studio review shows a separate optional clean-BPM field for each material in the selected session and each explicitly added or checkpointed material. Only confirmed clean-pass checkpoints prefill BPMs. A Full session's skipped Black Mountain Rag stays blank; Quick omits that tune entirely. Neither the current metronome click nor a plan target is a clean result.

The review normalizes workspace `plan:` keys and known catalog item IDs to the plan's material identity. This prevents duplicate fields for one roll and makes its saved tempo available to the stage suggestion. Drafts belong to the session start time and retain manual edits, explicit blanks and optional notes through Back, section navigation and reload. Switching between full and partial review does not discard those edits. A pain stop overrides an earlier non-pain draft. Confirmed checkpoints mark the corresponding review checklist work as attempted.

`POST /api/sessions` accepts an optional `measurements` array of `{ materialKey, materialLabel, bpm }`. Keys must be unique; a BPM must be a whole number from 20 through 400, or `null` for unmeasured. New Markdown logs retain the complete array in the Material measurements section; `GET /api/logs` returns those identities and values, and Today history displays measured BPMs. Coach instructions explain the same section and forbid borrowing one material's BPM for another. Reflection fields live under Optional notes.

Legacy scalar-tempo requests and logs still parse and render. Existing files are never rewritten; new logs use exclusive filenames. New per-material logs omit the old scalar tempo lines to avoid implying that the click was unused or that one BPM applies to everything. A section quoted inside a next instruction cannot masquerade as stored measurements.

After a successful log write, non-pain measurements in the existing 30–300 BPM suggestion range update the tempo cache by material identity. Values from 20–29 and 301–400 remain in the log with an explicit saved-log-only notice. Overlong cache identities also receive a notice. Cache failures return a saved log plus a warning, so the UI does not invite another log submission. A failed log save retains the form and reports failure without showing success. Pain sessions never update cached tempos.

## Reproduction and scope

Run `pnpm typecheck`, `pnpm test`, `pnpm build`, then `node scripts/smoke-stage-tempo.ts`. For the broader Studio walk, run `SMOKE_PORT=5398 node scripts/smoke-generic.ts /tmp/struna-wave3-reproduction /tmp/struna-wave3-reproduction-shots` with fresh scratch directories. The smoke script requires Chromium and isolates its home, state and cache; providers are offline stand-ins. It changes no live player data.

Native-phone Safari, human screen-reader use, physical guitar/touch and hardware audio remain unverified and belong to Wave 4, issue #29. Real authenticated model inference was not run; the Coach evidence here covers its saved input format and the existing stand-in flow. This change includes no deployment and does not satisfy Wave 4 qualification.

## Validation evidence

- `pnpm test`: **338 passed**, no failures or skips. Log: `/tmp/struna-wave3-tests-final.log`. The new checks cover file/API readback, material identities, null measurements, accepted range edges, duplicate keys, old-log compatibility, exclusive writes, pain/cache handling and a forced cache-write failure.
- `pnpm typecheck` and `pnpm build`: passed. The existing large PDF/alphaTab bundle advisory remains.
- `node scripts/smoke-stage-tempo.ts`: **12 width/theme/zoom cases passed**. Each case runs both Quick and Full/partial review paths. Sizes: 320×700, 390×844 and 1003×814 with Light/Dark/Device; desktop 200% zoom uses Chromium's native default zoom, with `innerWidth=501` and DPR 2. Log: `/tmp/struna-wave3-stage-final.log`; full artifact set: `/tmp/struna-stage-tempo-gxceix`.
- Full Studio smoke: **262 checks passed**, with offline provider stand-ins. It covers setup, explicit plan Apply, practice, review/save, Materials, provider settings and credential isolation. Log: `/tmp/struna-wave3-generic-qualified.log`; screenshots: `/tmp/struna-wave3-generic-qualified-shots`. The smoke now opens Optional notes before editing reflection fields and scopes its plan-Apply instruction locator to Today to avoid matching the Coach overlay.
- The matrix confirms a roll checkpoint at 80, a separate skipped-tune blank, an omitted tune's absent field, edited BPM and notes surviving Back/navigation/reload, invalid 401 rejection, failed-save draft retention without a success screen or file, successful file/API identity/value agreement, correct per-material cache updates, a visible 400-BPM saved-log-only notice, and measured BPMs in Today history. It also reruns stage timing, direct tempo entry, expanded-reader continuity and partial-session regressions.

Retained review screenshots:

| Case | Screenshot |
| --- | --- |
| 320×700 Light, 400 BPM kept in the log | [Phone review](wave-3/320-light-material-review.png) |
| 390×844 Dark, roll edited and tune blank | [Phone review](wave-3/390-dark-material-review.png) |
| 1003×814 Device theme | [Desktop review](wave-3/1003-device-material-review.png) |
| Desktop native 200% zoom, Light | [Zoomed review](wave-3/502-light-material-review.png) |
