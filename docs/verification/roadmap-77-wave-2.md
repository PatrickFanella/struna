# Roadmap #77, Wave 2

This is the November 15, 2026 private-practice roadmap. Older `wave-2.md` files describe earlier work and are not evidence for this wave.

| Issue | Delivery |
| --- | --- |
| #84 | Configured OIDC sign-in, hashed revocable sessions and a distinct hosted shell; all private practice routes remain denied. PR #117 and corrective PR #120 |
| #95 | Today with native plan-duration selection, material preview and one Start action. PR #118 |
| #96 | Review draft retention and retry-safe personal/Studio log publication. PR #121 |
| #98 | Phone reader and frequent playing controls in one frame. PR #122 |
| #99 | Aligned tablet/desktop frame with deliberate Coach pinning. PR #123 |
| #100 | Warm private collection, source details and recovery actions. PR #124 |
| #101 | Coherent tools, keyboard return and coordinated/pending microphone capture. PR #125 |
| #103 | Public `/try`, original exercises, optional choices and browser-local guest reflection. See the guest delivery PR |

Local combined checks: `pnpm typecheck`, all 348 tests and `pnpm build` pass. Existing build output still warns about large reader/app chunks; this wave does not change the reading engines or claim bundle optimization.

Scratch browser evidence:

- Visual foundation: 24 viewport/theme cases, contrast, local fonts, mark, focus and concrete EPUB/alphaTab colors.
- Reading: 24 phone/tablet/desktop/native-200%-zoom cases; complete six-string block plus playing controls at the required portrait phone and desktop/tablet sizes; mounted reader and unsent Coach draft continuity.
- Session/review: 12 width/theme/native-zoom cases; Quick/Full/Short scope, passes, fake recording retention, active timing, neutral exits, draft/reload, failed saves, lost success responses and immutable saved-log readback. Receipt: `/tmp/struna-stage-tempo-9pDNT5`.
- Materials: 16 viewport/theme combinations with route/manage/back/filter/scroll checks, plus a focused 320px four-theme long-title rerun. Receipts: `/tmp/struna-wave2-materials`, `/tmp/struna-wave2-materials-long`.
- Tools: 16 viewport/theme combinations with synthetic streams, denied/missing/unavailable capture, numeric BPM, keyboard return, capture conflicts and pending-permission cancellation/late release. Receipt: `/tmp/struna-tools-1794733214242`.
- Guest: 18 viewport/theme cases plus blocked storage, anonymous bootstrap and private-route denial. Receipt: `/tmp/struna-wave2-guest`.

Each issue's verification note describes its boundaries. Hosted CI runs typecheck, tests, build, visual foundation, reading and guest checks on the exact PR head and retains screenshot/JSON artifacts. The scratch tests use separate home/state/cache roots, original fixtures and offline stand-ins. They do not write the owner vault or charge a provider.

Public OIDC registration, focused security review before exposure, hosted private-route isolation, production deployment, real Safari/devices, screen-reader speech and guitar/audio hardware remain separate. Wave 2 does not enable hosted practice, connect a live AI account, add support/payment gates or complete the whole roadmap.
