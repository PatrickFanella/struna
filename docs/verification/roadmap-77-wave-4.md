# Roadmap #77 — Wave 4

Dated November 15, 2026. This wave extends the scratch-only hosted practice boundary established by #88. Production startup still rejects hosted-practice enablement. No owner workspace, live issuer, model provider, billing account or deployment was used.

| Issue | Delivery | Evidence |
| --- | --- | --- |
| #90 | Account Materials, cache and reader isolation; upload session recheck; scoped practice handoff | PR #131; [Materials checks](roadmap-77-wave-4-materials.md) |
| #91 | Opaque account takes, range playback endpoints, retry protection and explicit limits | PR #132; [recording checks](roadmap-77-wave-4-recordings.md) |
| #92 | Private conversations/prompts and owned cancellable replies; host execution denied | PR #133; [Coach checks](roadmap-77-wave-4-coach.md) |
| #93 | Authenticated account encryption, redacted status and connection invalidation | PR #134; [credential checks](roadmap-77-wave-4-credentials.md) |
| #106 | Identity-bound guest handoff, explicit import choice and idempotent saved-note receipt | PR #135; [guest checks](roadmap-77-wave-4-guest.md) |

Local `pnpm typecheck`, all 357 tests and `pnpm build` pass. New scratch HTTP tests cover two accounts, anonymous/foreign IDs and paths, native file/range URLs, concurrent uploads and take retries, revocation during upload/reply, conversation/prompt isolation, ciphertext substitution/integrity, forbidden host/endpoint authority, and guest import conflicts/concurrency/readback. Existing personal/Studio checks continue to run. The Materials review defects were fixed: the browser handoff uses account-scoped storage, and publication no longer exposes a temporary hard-link count to validation. PR #130 was superseded by #131 to remove a false-positive traversal literal from the scanned commit history without rewriting or deleting the original branch.

The combined built-browser check passed 28 cases: six roadmap viewports in light, dark, Device/light and Device/dark, plus native Chromium 200% zoom in all four theme states. Each case exercised guest cancel/failed-sign-in retention, login and explicit import, refresh/replay, saved-note reading, a real XHR upload, native text reading and the scoped Materials-to-practice handoff. Import geometry had no horizontal overflow; the zoom cases measured DPR 2 and a 576x407 CSS viewport from the 1153x814 desktop. Keyboard Tab navigation was exercised. Durable geometry receipts are in [wave-4-ui-receipts.json](wave-4-ui-receipts.json); CI reruns the matrix and uploads screenshots. A final phone/desktop rerun checks the human-readable saved-material title.

The browser build used for these checks:

| File | SHA-256 |
| --- | --- |
| dist/index.html | 224e444db8677e8eedf13303d58341144a98bdabd51ec936317d8f48835659f6 |
| dist/assets/index-BIbaGfUf.js | 9c0ff52b348b2fc99600e72c768b5bf3692abbee431303692cf3d61e656520bd |
| dist/assets/index-BcH9Mm3n.css | c21a823773f8188fec2c9649c0fedc4e73d6d0a454865ff49ff46359c98ab49a |

These are scratch Chromium and HTTP results. They do not establish public-hosted readiness, a production OIDC registration, real inference, audible recording playback, Safari/real-device behavior, guitar/microphone behavior or assistive speech. Focused ownership review before exposure, #94 hostile-route qualification, #97 BYO-AI execution, later plan Apply/account lifecycle and #110 native qualification remain separate. Launch support stays deferred.
