# ADR 0002: Resolve hosted identity before opening a private workspace

Date: 2026-11-15. Issue: #83. Roadmap: #77.
Baseline inspected: `460d25f406ae65611d97f6ffb00024397b66d24f`.
Status: implementation decision; owner review remains required before public-account mode can be enabled. This spike changes no runtime behavior.

## Decision

Add a distinct, opt-in hosted mode, separate from personal and Studio. Use one configured OpenID Connect provider first, with Google as the proposed initial provider, and a maintained OIDC client rather than hand-written token verification. #84 must verify the actual production registration and owner-selected issuer before advertising that method. No Google, Apple or email sign-in is configured or promised by this decision. If the selected provider cannot be configured, keep hosted mode disabled and record a replacement method before implementing it.

Map the verified `(issuer, subject)` pair to a server-generated opaque account id in a small identity SQLite database. Email and display name are mutable attributes, never workspace keys or automatic account-linking evidence. Use authorization code flow with PKCE, state and nonce, exact registered redirect URIs, and issuer/audience/expiry/signature checks through the OIDC library. Refuse unconfigured issuers and unsolicited, replayed or mismatched callbacks. The authentication provider's session and the Struna session are separate.

Issue an opaque random Struna session token, store only its hash with account id, creation, idle and absolute expiry, and revocation state in the identity database. Proposed expiry: seven idle days and thirty absolute days. Use a `__Host-struna-session` Secure, HttpOnly, SameSite=Lax, Path=/ cookie on the HTTPS hosted origin. Rotate on login; logout revokes it server-side and clears the cookie. Mutations require a same-origin check and session-bound CSRF token; the existing `X-Struna` header alone is insufficient. Reject disabled/deleting accounts on every request. Never accept a browser-supplied account id, path, email, `Remote-User` header or shared owner token as hosted identity.

Use a server-owned account registry to resolve an authenticated account to an explicit context:

```text
HostedContext = accountId + sessionId + workspace + database + credentialStore + cache + jobs
hosted-root/accounts/<opaque-id>/workspace/
hosted-root/accounts/<opaque-id>/state/struna.sqlite
hosted-root/accounts/<opaque-id>/private/    (credentials, inaccessible to models)
hosted-root/accounts/<opaque-id>/cache/
```

Keep the identity database and encryption key outside all workspaces, caches and model mounts. #93 chooses and verifies authenticated encryption and key injection; the existing plaintext provider JSON is not approved for hosted storage. Directory permissions protect local users but do not isolate tenants sharing a service UID. Each model process must have an outer filesystem boundary that exposes only its own workspace and runtime, never the hosted-root parent, identity store, owner home or sibling accounts. Direct provider APIs may avoid a CLI process, but must enforce the same context and plan-write rules.

Register hosted handlers once with an explicit required context resolver. Do not register closures for each account in the process-global router: first-match routing would select whichever closure registered first. Public routes have a small explicit allowlist (health with no private payload, sign-in/callback, public app shell and selected static assets). All other APIs require an authenticated context before reading state, resolving an id, starting a process or sending a stream. Missing/revoked identity returns 401; a foreign or missing resource returns the same 404. Resource ids are meaningful only within the resolved account database/root.

## Code-grounded inventory

The current app has no public-account mode. `server/config.ts` accepts only personal/Studio. `server/index.ts` opens one `db`, constructs one `Studio`, credential store, Coach and candidate store, and registers global route closures in `server/http.ts`. `guard` and `server/access.ts` protect an owner instance, not multiple players. Expanding an Authelia allowlist would therefore share private state.

| Surface at the baseline | Hosted boundary and owning follow-up |
| --- | --- |
| `generic/routes.ts`: `/api/app`, `/api/profile`, `/api/today`, `/api/sessions`, `/api/logs`; `practice.ts`: `/api/tempos` | #88 resolves Studio home, settings, plan/archive, logs, confirmed tempos and timezone from context. No module-global database fallback |
| `index.ts`: `appInfo`, `withAppInfo`, static SPA fallback; `web/src/mode.ts` bootstrap | #84 serves an anonymous-safe shell; #88 scopes authenticated app-info. `profile` existence is private. HTML with account data is no-store; never reuse one account's injected bootstrap for another |
| `generic/materials.ts`: list/item/file/upload/text/link/save/delete, read-only library folders, derived `src` ids | #90 resolves only the account's materials and approved roots, validates real paths and symlinks, scopes downloads and caches. Global owner library folders are absent in hosted mode |
| `recordings.ts` upload; material-file reads of `Recordings/` | #91 owns upload and playback/range authorization, recording roots and all legacy take paths |
| `chat.ts`: `/api/chat` SSE, `/api/providers`, conversations CRUD; `conversations.ts` resume thread ids and generation resets | #92 binds conversation, stream, cancellation and resume to account/session. Logout/deletion cancels owned work; late output cannot append, emit or apply into revoked state |
| `generic/prompts.ts`: `/api/prompts`, custom prompts and automatic actions | #92 scopes database settings and prompt/action state. Prompts can contain private content even though they look like configuration |
| `generic/providers.ts`: key save/remove and ChatGPT login lifecycle; `credentials.ts` config/CLI directories | #93 owns only that account's connection and generation. Never inherit host logins/environment or expose host status/details; #85 determines eligible methods |
| `generic/coach.ts`, `generic/planCandidates.ts`: context, writable notes/profile/materials, proposal list/apply/dismiss, practice-state leases | #92 and #108 preserve candidate staging, exact preview/Apply, active-session conflict checks and revocation. Candidate, lease and CLI thread ids must resolve within the owning context |
| `generic/chat-images.ts`: `/api/chat/image`; `library/remux.ts`; PDF/EPUB/media conversion | #90/#92 namespace cached bytes, in-flight jobs and serving authorization. A guessed cache key or URL cannot grant read access |
| `materials.ts` module maps `queues`, `libraries`, `downloading`; `planCandidates.ts` `locks`; Coach turn state, provider login child and timers | #90/#92/#93 scope keys and lifetimes by account. Some current maps already include a home path; retain that property and prove no cross-account collision. Shared execution must not imply shared context |
| Personal `practice.ts` vault-file and week override; `coach-once.ts` guide/review; `library/routes.ts`, `library/media.ts`, `tabs.ts` | Never register owner/personal routes in hosted mode. Personal vault, Calibre receipt, global media/tabs and read-only owner collections stay in the separate owner process |
| Browser persistence in `api.ts`, `screen.ts`, `chat/*`, `practice/*`, tools and theme | #88/#92/#106 namespace private saved state by account and clear it on account changes/sign-out. Guest transfer is explicit and idempotent; theme may stay device-wide. A restored guest or owner snapshot cannot silently become another account's state |

Per-account SQLite keeps existing unqualified settings/tempo/conversation queries reusable without adding tenant predicates everywhere. It costs file handles and per-account schema management; use a bounded context cache with eviction only after streams/jobs finish, explicit close, and lazy migrations under the account lock. Never use the owner database as a migration template. Export/deletion (#102/#105) cover workspace, SQLite/WAL, private credentials, caches, proposals and pending jobs. Identity deletion revokes access before asynchronous cleanup; restoration from backups must honor deletion records.

## Fail-closed rollout and checks

#84 may build sign-in and the anonymous shell, but cannot expose any still-global private endpoint. Until its owner resolves each inventory row, return a clear unavailable response for that hosted surface. Add an explicit hosted readiness gate that refuses startup/enablement if any private route still uses owner/global context; do not treat successful sign-in as isolation qualification. #94 proves the completed inventory before public access. Owner review of this document is required before enabling hosted mode, not before reversible implementation and scratch tests.

Use two synthetic OIDC identities, a fake issuer and fresh scratch roots. For every listed read/write/stream/static path: request as anonymous, expired/revoked A, A, B and A with B's ids; verify denial leaves owner and B bytes unchanged. Include HTML injection/cache headers, range/HEAD, symlink escapes, prompts, failed context resolution, late SSE output, provider-change resets, shared job/cache keys, account switching and browser reload. Refuse to start with a root equal to/inside an owner workspace or credential path. Disable public mode on incomplete isolation; keep personal/Studio deployments separate. No production migration, provider registration or deployment is part of this spike.

## Handoff

#84 implements OIDC/session mechanics and the hosted gate; #88 resolves profile/plan/log/tempo/app-info contexts; #90–#93 complete the remaining private surfaces; #94 tests the full route matrix. #85 may require a hosted provider adapter instead of the existing owner CLIs. #106 owns guest import; #102/#105 own account export/deletion. These are implementation decisions, not evidence that those future boundaries exist.
