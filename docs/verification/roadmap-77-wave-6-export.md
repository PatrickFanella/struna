# Private practice export — #102

November 15, 2026. Roadmap #77. Scratch accounts and dummy connections only; no production enablement or deployment.

The account's “Your practice data” section offers one Export practice data button. It downloads UTF-8 JSON with `format: struna-practice-export`, version 1, an export timestamp, an explicit inventory and `data`. The POST accepts no identity, path or query options. The verified session selects the workspace, with the existing origin, session and CSRF checks. The response is an attachment with `Cache-Control: no-store`. The browser uses the account-aware API wrapper before creating a download, so an invalidated document cannot download a late response.

## Inventory for the personal-data review checkpoint

| Included | Representation |
| --- | --- |
| Profile | Known profile fields, schema version 1 |
| Current plan | Validated plan, schema version 1; material references remain relative files or player-entered web links |
| Saved logs | Complete Markdown, including notes, per-material measurements, checklist and recording references; portable log names |
| Confirmed tempos | Fragment identity, BPM, subdivision, updated time |
| Coach conversations | Conversation id/provider/title/times and ordered role/text/time messages; no provider thread handles or arbitrary message metadata |
| Custom prompts | The player's saved labels and text |

Material files and links, take audio and metadata, archived plans, unapproved plan candidates, browser-only drafts/preferences, credentials/provider settings, identity/session records, caches and operator configuration are excluded. Download material files and audio separately from Materials and each take. Media inventory is deliberately excluded too: this bounded text export does not claim to be a complete workspace backup. No support payment or entitlement is consulted.

The implementation selects known files and SQL columns; it never copies the SQLite database, general settings, private credential directory or a directory archive. Profile and plan unknown fields are discarded by the existing schemas. User-authored text remains intact, including anything the player deliberately typed into a note, prompt or conversation; the secret exclusion concerns stored credentials and application/operator secrets, not a claim to detect secrets in arbitrary writing. The UI asks the player to keep the download private.

Limits: 20 MiB compact JSON total, 1 MiB per source text file, 5000 text/row entries. Exceeding a limit returns 413 with recovery guidance. Invalid/unreadable data returns a generic 503 without paths or a partial attachment. The source is unchanged; the player can retry. Export is built synchronously after parsing the request, and session validity is rechecked before response delivery. Existing account tree validation denies symlinks/hardlinks before opening data.

## Evidence

- `pnpm typecheck`, all 363 tests and `pnpm build` pass.
- `server/auth/export.test.ts` creates A/B accounts, logs, tempos, custom prompts, conversations and dummy encrypted credentials. It round-trips JSON and the full Markdown log, validates the exported plan, scans for B/owner/credential/session/CSRF/path canaries, and compares profile/plan/log bytes before and after. Anonymous, foreign selectors, stale session, invalid CSRF, corruption, oversize and post-sign-out requests are denied.
- The hosted route inventory includes the new account POST and passes source and runtime comparisons plus the hostile-route matrix.
- `node scripts/verify-export.ts /tmp/struna-wave6-export`: six built-browser cases (320x700, 844x390, 1440x900; light/dark), including download filename/content, a refused export followed by successful retry, no page errors and no horizontal overflow. Screenshots and receipts live in that scratch directory; CI runs this matrix and retains its artifacts.

This is a readable export fixture, not a general import feature. The personal-data inventory/secret-exclusion human checkpoint is presented with this PR. Production exposure, real device/Safari and assistive speech qualification remain separate.
