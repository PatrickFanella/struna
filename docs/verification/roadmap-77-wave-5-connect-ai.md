# Optional hosted AI connection — #97

November 15, 2026. Roadmap #77, ADR 0003. This implementation uses scratch accounts and a deterministic local HTTP provider. No real key, provider charge, production data or deployment was used. Hosted practice remains disabled in production.

Hosted Coach offers only a player-owned OpenAI API key and a project model name. Opening Coach explains that coaching is optional, API use is charged by OpenAI, a ChatGPT subscription alone does not provide the API key, and practice tools continue without it. The skip action returns to practice. A question typed before setup remains in memory through save, failure, test and return; returning does not send it. Send is a separate deliberate action.

Saving encrypts the key in the existing account store and sends no provider request. Saved and tested states are distinct: a successful deliberate connection test is required before chat execution. Key/model replacement clears the tested state. Failed revalidation also clears it. Disconnect cancels active tests/replies and removes the local connection; the UI explains that provider-wide revocation happens in the player's OpenAI account. Password inputs clear after every save attempt, and neither status responses nor browser storage contain the key.

`server/auth/responses.ts` implements the bounded direct Responses adapter. It always posts to `https://api.openai.com/v1/responses`, refuses redirects, sends `store:false`, streams text and caps output at 2048 tokens. Only recent messages from the owned conversation (at most 20, each bounded) accompany the current question. No shell, tools, owner credentials, custom/private endpoints or host subscription fallback are available. Automatic practice actions are denied by both browser and server. A test and a reply cannot overlap for one account. Upstream error bodies and fetch exceptions never become application messages; status-specific recovery covers refused keys, model/project permissions, rate/billing limits and unavailable service. Incomplete/malformed streams fail rather than recording successful replies; explicit cancellation records a stopped reply. The request timeout is 90 seconds. Token/time limits are not a money cap.

The wire contract was checked against the [official Responses creation reference](https://developers.openai.com/api/reference/resources/responses/methods/create), including streaming text/completion examples, `store` and `max_output_tokens`. This does not qualify a real account/model. Practice/material context and plan changes remain #104 and #108; copy states the current conversation-only boundary.

## Checks

- `pnpm typecheck`, all 362 tests and `pnpm build` pass.
- `server/auth/responses.test.ts`: real local HTTP stand-in, completed/incomplete streams, aborted transport, 400/401/403/404/429/500 recovery, denied network, saved/tested distinction, no automatic charges, A/B key and conversation-history separation, forged IDs, disconnect, test/reply serialization and sign-out during test.
- Existing account/credential suites plus #94 route inventory and A/B/anonymous hostile-route gate continue to pass.
- `node scripts/verify-connect-ai.ts /tmp/struna-wave5-connect-full`: all 28 cases passed. Six roadmap viewports (320x700, 390x844, 844x390, 820x1180, 1153x814 and 1440x900) plus native Chromium 200% zoom from 1153x814, each in light, dark, Device/light and Device/dark. Checks cover skip, no request on save, invalid-key recovery, test, pending-question return, one request on explicit Send, disconnect, secret-free status/storage, keyboard navigation and overflow. Zoom cases assert DPR 2; connection containers have no horizontal overflow. CI runs the matrix and retains screenshots.
- Built-browser #94 isolation and existing two-account practice restore/save checks pass on the combined build. Earlier owner Studio smoke passed; hosted changes do not enable any public writer.

Durable geometry/flow receipts: [wave-5-connect-ai-receipts.json](wave-5-connect-ai-receipts.json). Representative 320px and landscape screenshots were visually inspected: form fields and actions wrap and the settings panel scrolls vertically. Review findings on untested execution, cancellation messages and account concurrency were addressed with focused regression checks.

Provider permission/cost-copy and credential-handling review, a deliberate real-provider turn, public exposure approval, production OIDC registration and #110 real-device/Safari/guitar/microphone/audio/assistive-speech checks remain separate checkpoints. This issue does not purchase AI, create credits or add payment gates.

## Final build

After the review fixes, typecheck, all 362 tests and production build pass. The 28-case matrix passed after the tested-state/concurrency fixes; a final phone/light and desktop/dark rerun passed on these bytes after the remaining cleanup:

| File | SHA-256 |
| --- | --- |
| dist/index.html | 8433178a6373bcba84b5762e3d9f2c9e44ce76c14c1f35eaa3829574d8b2f853 |
| dist/assets/index-BN6pBXBf.js | 35d3c70d428468c5bda81ee23e129851196f885b13c1e309e8d15a0fc3ef1a45 |
| dist/assets/index-BcH9Mm3n.css | c21a823773f8188fec2c9649c0fedc4e73d6d0a454865ff49ff46359c98ab49a |
