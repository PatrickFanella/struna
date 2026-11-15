# Issue 67: Coach opens on demand

New practice sessions open only their selected music panes. Coach can be deliberately pinned beside music from its desktop drawer or the pane picker and later unpinned with the Coach pane's labeled action. Existing restored sessions retain a saved Coach pane, so the previous automatic pane is treated as a compatible explicit pin rather than discarded.

Coach shortcuts now show at most two relevant prompts before More. The full catalog, Draft/Send labels, preview and Apply behavior remain in the existing panel. Draft text is held outside an individual mounted panel, so closing, reopening, pinning or unpinning Coach keeps unsent text and any running request remains in the shared conversation state.

Validation on November 15, 2026: typecheck/build and all 341 unit tests passed. The Coach clarity smoke passed 20 viewport/theme cases, including native desktop 200% zoom and the 1440x900 regression for the old automatic-Coach threshold, at `/tmp/struna-coach-pin-final-root-20261115`. The keyboard/modal harness retained embedded nonmodal checks and passed 2,199 assertions at `/tmp/struna-coach-final-root-keyboard-20261115`.

`COACH_PIN_ONLY=1 node scripts/smoke-coach-clarity.ts /tmp/struna-coach-pin-continuity-root-20261115` passed the focused desktop case with an actual local six-string Markdown reader. Direct drawer pin closes the modal, leaves one embedded owner and retains the reader DOM marker and 80px scroll. The header focuses that owner. A delayed offline request survives Unpin/reopen with exactly one POST, and a draft survives a stage change. Default/open/pinned screenshots are retained at `/tmp/struna-coach-pin-review-shots-20261115`. The built asset was `index-BKz0Zkp3.js` with `index-D7msHcSY.css`.

Saved Coach panes are retained because legacy state cannot distinguish an earlier automatic pane from a deliberate choice. No other pane, reading state or session is discarded. Device, real audio and screen-reader qualification remain under #29.
