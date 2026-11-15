# Account practice boundary (#88)

Hosted practice resolves only the account id read from the verified identity registry. The account owns `accounts/<id>/workspace`, `state/struna.sqlite`, `private` and `cache` below the hosted state root. Owner paths cannot overlap this root. Account directories are 0700, SQLite is 0600, and linked files/directories fail closed. Each request closes its database handle; no unbounded account cache or owner database is used.

The hosted router is registered once with a required request context. It exposes profile, starter plan/Today, logs, confirmed tempos and practice leases. App-info and HTML are account-scoped and no-store. Materials, recordings, conversations, providers, personal routes and plan proposals remain unavailable. No owner collections, CLI logins or guest imports enter an account.

The browser binds API requests to the session represented by its bootstrap, and mutations also require the session CSRF token and matching origin. A changed cookie cannot redirect an old tab's writes into another account. Request bodies are consumed before resolving the session, so a request delayed across revocation fails. Account changes invalidate pending API results and reload mounted state. Practice/review/client storage and private preferences have account prefixes; existing owner and guest keys are not imported or cleared. Theme remains device-wide.

## Verification

`pnpm typecheck`, `pnpm test` (351 tests) and `pnpm build` pass. The scratch HTTP test uses concurrent synthetic A/B identities and checks different profiles, generated plans, log/tempo readback, leases, forged account/path fields, session mismatch, CSRF/origin denial, delayed-body revocation, stable return identity, private bootstrap, file modes and symlink denial. Existing owner personal/Studio tests also pass.

`node scripts/verify-hosted-practice.ts` walks two independent 390×844 Chromium contexts through profile setup, practice, reload, partial review, draft reload and saved-log readback. Both restore their own session and review while an old unscoped owner session remains untouched. The November 15 local receipt is `/tmp/struna-account-ui-mQaN9k`; the script is repeatable and runs in CI. A second run with `--without-bootstrap` exercises Vite-style app-info loading before private components mount. This closes the automated review finding about development headers/storage scope. All state is scratch data, and the issuer is an offline adapter.

## Exposure checkpoint

`STRUNA_HOSTED_PRACTICE=1` permits development/scratch integration only. Startup refuses it with `NODE_ENV=production`. Normal hosted sign-in continues to deny private practice. Do not remove this gate until #90–#94 complete the private-route inventory and file/database ownership, guest/owner isolation and production OIDC have received the required review. This PR does not enable public accounts, migrate production data or deploy a service. Native Safari/devices and full security qualification remain separate.
