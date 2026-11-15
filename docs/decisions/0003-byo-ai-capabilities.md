# ADR 0003: Hosted coaching starts with player-owned API credentials

Date: 2026-11-15. Issue: #85. Roadmap: #77.
Baseline inspected: `460d25f406ae65611d97f6ffb00024397b66d24f`.
Status: decided for implementation; no real provider turn or hosted connection is qualified by this spike.

## Decision and current implementation

Preserve the existing personal/Studio paths for their current owner use. For public hosted accounts, start with player-owned OpenAI API keys through a direct Responses API adapter. An Anthropic Messages API adapter is an eligible later method, not a launch promise. Do not expose the existing CLI execution service to public hosted users. Practice remains available with no connection. No host key, host subscription, instance role or operator-paid trial may substitute for missing player access.

`server/generic/providers.ts` defines seven ids. All currently execute Claude Code or Codex through `launch`/`providerFor`; none is a direct HTTP model adapter. `credentials.ts` keeps one set of entries in plaintext JSON and per-provider CLI directories under the single state root. `coachPolicy` allows host logins by local/explicit operator policy, device sign-in by local/explicit policy, and keys by local/`REQUIRE_USER`. Those are single-owner controls, not account authorization. The public hosted implementation must bypass these owner policies and refuse unsupported ids server-side as well as hiding them.

| Existing path | Current local/owner capability | Public hosted decision | Charges and qualification limit |
| --- | --- | --- | --- |
| `claude` / host Claude plan | Runs the owner's already-signed-in Claude Code | Never use the host login for players; no Struna Claude consumer sign-in | Owner's own plan limits; no general API entitlement follows from a consumer subscription |
| `codex` / host ChatGPT plan | Runs the owner's already-signed-in Codex | Never use the host login for players | Owner's own plan/workspace limits; subscription use differs from Platform API billing |
| `chatgpt` / isolated device sign-in | Codex device flow, app-owned `CODEX_HOME`; documented upstream beta with account/admin eligibility | Local-owner-only for this roadmap. No public subscription-login promise | A local flow and isolated auth file do not qualify a public execution service |
| `openai` / player API key | Existing Studio path runs Codex with isolated config and key environment | Eligible first hosted method **through a new direct Responses adapter**, after #93/#94 isolation | Player's API account, model permissions, rates and limits; no Struna allowance. A key cannot make the existing public CLI path acceptable |
| `anthropic` / player API key | Existing Studio path runs Claude Code with isolated config, API-key environment and turn budget | Direct Messages adapter eligible later; not in the initial hosted list | Player's Claude Console usage; requires API access and separate integration qualification |
| `bedrock` / region and bearer key | Claude Code with isolated config, explicit bearer key; shared AWS config and instance metadata disabled | Defer hosted support until expiry/region/model/billing handling and adapter are qualified | AWS account/model access; AWS recommends short-term keys for production; long-term-key form is insufficient production qualification |
| `endpoint` / Responses endpoint | Codex custom provider with model/header/key, guarded egress and optional local private-network access | Defer arbitrary hosted endpoints; no server-loopback/private-network opt-in for public players | “OpenAI compatible” is not enough: Responses streaming, tool calls and conversation behavior need an exact version/model test |

## Verified upstream facts and boundaries

- [Official OpenAI authentication documentation](https://developers.openai.com/codex/auth/) distinguishes ChatGPT subscription authentication from API-key billing, documents device authentication and isolated credential storage, recommends API keys for programmatic workflows, and warns against exposing Codex execution in public/untrusted environments. This is why the hosted OpenAI method needs a direct API adapter rather than reusing `codex exec`.
- [Anthropic's Claude Code terms and authentication guidance](https://code.claude.com/docs/en/legal-and-compliance) allows certain unmodified-binary hosting under its conditions, but distinguishes that from offering Claude consumer login inside another product. Struna will not collect Claude session tokens or build consumer login. Use documented API credentials for a hosted integration; billing must stay with the player. This conservative product decision does not claim every form of Claude Code hosting is prohibited.
- [Anthropic API overview](https://platform.claude.com/docs/en/api/overview) documents Console API credentials and Messages requests. A Claude consumer plan is not the API credential used by this adapter.
- [AWS Bedrock API keys](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html) documents bearer authentication, regional short-term credentials and expiry. Hosting needs renewal/error handling, not an assumed indefinite key.
- [Ollama compatibility](https://docs.ollama.com/api/openai-compatibility) documents Responses with stateless limitations. [LM Studio compatibility](https://lmstudio.ai/docs/developer/openai-compat) lists a Responses endpoint. These are possible local methods, not evidence that every model supports Struna's entire tool/resume sequence. `127.0.0.1` in a hosted URL is the server, not the player's laptop.

The endpoint presets OpenRouter, Azure, xAI, Groq and “Other” only fill forms in `PRESETS`; their presence is not a verified provider contract. Do not advertise them as hosted supported methods. Their current versions, exact endpoint semantics and account terms were not qualified. No live model account, paid request, subscription or endpoint was used in this spike.

## Concrete handoff

#93 stores only the owning account's encrypted key outside model-readable roots, exposes saved status without secret values, and revokes locally on disconnect. It must cancel owned active requests and invalidate pending proposals/resume state on replacement or removal. Disconnecting Struna does not revoke a provider key globally; tell the player how to revoke it at the provider if needed.

#97 initially offers only OpenAI API-key connection in hosted mode. It owns the bounded direct Responses adapter as part of the connection outcome, with a deterministic local HTTP stand-in for streaming, errors, cancellation and an explicit test action. If that exceeds one reviewable PR, split the adapter before coding; do not substitute public CLI execution. Keep Anthropic and arbitrary endpoints deferred. A missing hosted adapter is a clear unavailable state, never a silent CLI/host-credential fallback.

#104 supplies current practice context from the authenticated workspace only. The hosted adapter must not grant a model a shell or filesystem. For #108, parse and validate a model's structured plan proposal into the existing server-owned candidate lifecycle; retain exact-byte preview, explicit Apply, base hash, active-session revision, archive and recovery rules from ADR 0001. Hosted model output cannot directly write profile, materials, active plan or another account. Any future tool must accept context-bound resource ids, not arbitrary file paths.

Proposed connection copy: **Connect your OpenAI API key**. “AI coaching is optional. Your OpenAI API account pays for model usage; a ChatGPT subscription alone does not supply this API key. Your practice tools work without it.” Only show a connection as tested after a successful deliberate request; distinguish saved, tested, expired/refused and rate-limited states. Require an explicit player action before a provider charge; automatic owner-mode actions must not silently spend a hosted player's key.

Before offering the method: run two-identity scratch tests with an offline provider; prove A/B credential, context, stream, disconnect, late-output and proposal isolation; verify no keys in logs, exports, response bodies, browser persistence or app-info. A real per-player authenticated turn, provider cost/error behavior and production setup remain later human/provider checkpoints. Do not claim the existing stand-in smoke as real-provider qualification.
