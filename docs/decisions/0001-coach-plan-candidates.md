# ADR 0001: Coach plan candidates require a server-owned Apply boundary

Decision date: 2026-11-14. Scope: Studio mode, issue #8; implementation belongs to #9.
Status: implemented for #9; human code and player-preview review remain required before release.

## Evidence at c2b27ca

`server/generic/coach.ts` gives Claude Edit/Write on `plan/**`, materials,
notes and profile. `genericSystem` explicitly instructs direct active-plan edits
and archiving. `afterTurn` detects changed bytes and validates after the write;
it cannot enforce prior approval. Codex's profile gives the workspace write
access with logs and Recordings read-only. Removing a prompt instruction or
restoring a file after a turn leaves a window in which Today can read new bytes.

Every configured provider still uses one of these two CLIs, not a separate
server-side file-writing API (`server/generic/providers.ts`, `launch/providerFor`):

| Provider id | Execution and write path |
| --- | --- |
| claude | Host Claude Code, Edit/Write tools |
| anthropic | Claude Code with isolated config and API-key environment |
| bedrock | Claude Code with isolated config and Bedrock environment; no web |
| codex | Host Codex exec, filesystem sandbox |
| chatgpt | Codex exec with app-owned CODEX_HOME |
| openai | Codex exec with isolated CODEX_HOME and API-key environment |
| endpoint | Codex exec with isolated CODEX_HOME and existing guarded egress proxy |

Credential storage, environment filtering, egress restrictions and read-only
logs/recordings/library boundaries must remain in place. Personal mode's vault
coach is outside this Studio-only decision.

## Decision

Remove the entire live `plan/**` tree from provider write access for every turn,
including automatic actions and repair turns. Give the provider one fresh,
turn-specific candidate file under `.coach-candidates/<random-id>/plan.json`
in the studio instead. It contains the base plan initially. The server owns
candidate metadata outside the provider-writable workspace, under state.
The provider may edit that candidate, never the active plan or archive.

For Claude, replace Edit/Write(plan/**) with exact Edit/Write rules for that
turn's candidate; keep the existing other write rules and web hook. Do not add
Bash or a broader tool grant. For Codex, retain the root/read/runtime/network
policy, make the workspace read-only by default, and explicitly grant only
materials, coach-notes.md, profile.json and that turn's candidate file writes.
Plan and archive remain read-only, including through shell commands. Do not use
the workspace-write fallback. Missing files/directories are prepared by the
server before launch. Resume must receive fresh permissions on every turn.

This is a permission change, not a claim about real CLI enforcement. Before
#9 enables any provider path, its CLI/version must pass an offline sandbox
probe: attempts to overwrite, delete, rename or symlink active plan/archive,
including traversal and absolute aliases, must fail while the candidate remains
writable. Scratch stand-ins cannot prove a real sandbox. Disable a provider
with a plain explanation if the path cannot enforce these restrictions; never
fall back to direct plan writes. Existing policy already disables unsandboxed
Codex in the provider catalog. Preserve that fail-closed behavior.

## Candidate lifecycle and preview

1. Serialize Coach turns per studio as today. Capture the exact active bytes
   (or an explicit missing sentinel), SHA-256, provider, turn/conversation id,
   and expected archive target state in a server-owned record. Generate the
   turn id server-side; never accept a client path.
2. On successful final completion only, accept a regular candidate file within
   that turn directory (no symlinks, hardlinks or oversized JSON). Run
   `validatePlan`, date and existing material-access checks. Reject malformed
   candidates and failed/cancelled turns. Compare bytes with the base: unchanged
   output means no proposal. An advice turn has no proposal unless it actually
   changed the candidate; do not infer writes from its prose.
3. Store immutable validated bytes plus their digest privately under state,
   remove the provider scratch candidate and expose only a random proposal id.
   The browser shows a structured before/after comparison of every changed plan
   field (including stage text, materials, durations, next, phases and ids),
   with a complete escaped JSON diff available. Labels must not omit changes.
   Preview and Apply both refer to that exact digest.
4. `POST /api/plan-candidates/:id/apply` uses the existing token/origin/user
   access checks and a per-studio mutation lock. Revalidate stored bytes and
   material paths; re-read active bytes and compare SHA-256 under the lock.
   A changed base, changed archive target or active practice session returns a
   recoverable 409, with no write. The client must send current active-session
   state and block Apply during practice; the server must also reject a stale
   session-state assertion. Since practice is currently client-owned, scope
   #9 to the single-player client and disclose that other open tabs must agree
   through shared session state before Apply is enabled. No silent session reset.
5. For adjustments retain id/started. For replacement the server, not the model,
   archives exact old bytes at a validated safe id path, refusing collisions.
   Persist a private apply intent before archive creation; atomically rename
   the new active file on the same filesystem. On crash, recover the journal
   before serving Today: before-active state rolls back only an archive created
   by this intent; after-active state completes the receipt. Never overwrite an
   existing archive. A failed archive step must leave the old active file intact.
   Emit `changed.plan` only after commit. Record applied state for idempotent
   retries; a second click returns the same receipt without another write.
6. Dismiss deletes the pending candidate. Cancellation/error invalidates it,
   kills the owned run and discards late output. Reload lists pending proposals
   but cannot apply them. Expire pending records after 24 hours; startup removes
   abandoned staging directories and recovers apply intents. New turns may
   supersede a proposal visibly; never rebase or auto-apply one.

## Bounded #9 implementation

One Studio-only end-to-end PR: narrow candidate store and lifecycle, permission
profiles for both CLI families, token-protected list/apply/dismiss routes,
shared active-session guard, after-turn event, minimal Coach diff/Apply/Dismiss
UI and regression tests. Keep all non-plan writes on their current paths; do not
create a general file review product. Bootstrap starter creation remains an app
write. Automatic Coach actions and validation repair turns use the same staging
path. Prompt/settings copy must describe proposal behavior only when the route
is enabled. #27 must continue to disclose direct writes until #9 lands.

Tests must cover both CLI families and all seven catalog ids, fresh/resumed and
automatic turns, advice/no change, invalid JSON, future date, material escape,
symlinks, changed base, double Apply, archive collision, crash recovery,
cancellation/late output, reload and an active session. A deliberate hostile
stand-in must attempt live writes; assert permission configuration separately
from the real CLI offline enforcement gate. Browser evidence uses scratch
homes and stand-ins, never provider requests or live player data.

## Spike verification and limits

`node scripts/spike-plan-candidate.ts` is a disposable filesystem experiment,
not production routing or an approval boundary. Both CLI-shaped stand-ins write
an invalid candidate, repair it, and leave active/archive bytes unchanged in an
isolated copied working directory. It checks validation, exact-byte preview,
conflict detection, cancellation by discard and deliberate activation in scratch.
This proves the candidate lifecycle is testable without a provider. The
production candidate path and permission profiles above still require #9 tests
and offline real-CLI sandbox qualification. No browser/UI or human/audio evidence
is claimed by this architecture spike.

## Implementation qualification, November 15, 2026 UTC

The implementation adds an outer Linux Bubblewrap boundary around both CLI families. The studio root is mounted read only; materials, the existing notes/profile files and the turn-specific candidate directory are the only writable studio paths. File and directory aliases are checked before launch. Claude's tool grants also exclude the live plan. Codex retains its existing inner read/runtime/network profile, with the outer mount boundary narrowing its effective writes. This preserves the credential, web and endpoint-proxy policies.

This updates the originally proposed Codex file-grant mechanism: an offline probe of Codex 0.167.2 with exact writable-file roots failed during synthetic mount construction. The outer boundary handles those file mounts directly and applies to the entire CLI process tree, including host, configured-key, resumed, automatic and repair turns. No workspace-write fallback was introduced.

Before offering providers at startup, and again before a turn, the app probes the wrapper with hostile writes and the actual executable's `--version`. Relative, absolute, traversal, unlink, rename, symlink and hard-link attempts against active/archive paths are refused; candidate, materials, notes and profile writes succeed. Both installed Claude Code 2.1.322 and Codex 0.167.2 passed this offline wrapper probe. No model request or production account was used. Missing Bubblewrap, failed namespace setup or failed CLI launch disables that family with a reason.

Validated exact bytes are stored privately in SQLite. Apply and starter mutations share a studio lock. Apply revalidates candidate/material paths, the base fingerprint, archive absence and a fresh practice revision. Prepared files and relevant directories are synced around archive linking and atomic activation; private intent/receipt records recover a process interruption before Today is served. Dismiss/expiry remove pending bytes. Advice, errors, cancellation and stale provider configuration never activate a proposal.

Practice registration uses two-minute server leases with twenty-second heartbeats. Expiry advances the revision, so an old idle assertion cannot apply. Restored practice is gated on registration, failure is visible and retryable, and the timer pauses on connection loss/expiry. A session carries its original Today/stage snapshot. This is a single-player browser protocol; every active tab must register, and other open tabs must finish or discard practice before Apply.

These are code, stand-in and offline-wrapper checks. A real authenticated model turn, human review of this boundary, player review of the preview, native-phone Safari, hardware audio and human assistive use remain unverified. The original human checkpoint on #9 still applies.
