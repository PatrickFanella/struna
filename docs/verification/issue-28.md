# Issue 28: theme segment sizing

Changed only the Theme control layout. It now sizes buttons to their labels, wraps the group and its caption, and allows button height to grow. Existing Jost, Atkinson Hyperlegible Next, Spline Sans Mono and warm theme tokens are retained; no color, radius, shadow or motion changes.

Validation on November 15, 2026 (UTC):

- `pnpm typecheck`: passed.
- `pnpm test`: 297 passed, no skips or failures.
- `pnpm build`: passed; existing large-chunk advisory remains.
- `node scripts/smoke-controls.ts /tmp/struna-issue28-20261115b 28`: 60 assertions passed.
- Screenshot/check directory: `/tmp/struna-issue28-20261115b`. Names use `320`, `390`, `1003` and `502`, followed by `Light`, `Dark`, `Device` or `doubled`; checks are in `checks.json`.

The smoke selects all three options with Space, checks selected state and visible keyboard focus, label bounds and page overflow, and doubles all labels. Viewports: 320×700, 390×844, 1003×814 and 502×407. The last approximates the layout viewport of 1003×814 at 200% desktop zoom; native browser zoom UI was not driven. Device was exercised with an emulated light preference. This is automated Chromium evidence, not human usability or hardware evidence.

A first run opened the page while the build was still writing and timed out waiting for the start screen. The retained passing run started after the build completed. The script refuses to reuse existing scratch directories. Home, state, cache and CLI stand-ins are private to each run; browser requests outside localhost are blocked.
