# Issue #8 verification

2026-11-14, baseline c2b27ca. Architecture spike only; no production code changed.

- `node scripts/spike-plan-candidate.ts`: passed both CLI-shaped stand-ins;
  retained evidence `/tmp/struna-8-v3g5sS`. Invalid/repair, byte-identical preview,
  live/archive bytes before explicit scratch activation and stale fingerprint checked.
- `pnpm typecheck`, `pnpm test`, `pnpm build`: passed (297 tests, none skipped). Build reports its existing large-chunk warning. Logs: `/tmp/struna-8-{typecheck,test,build}.log`.
- No UI was changed. Browser widths/themes/zoom are not applicable to this spike.
- No live provider, credential, deployment, player data, audio or human test used.
- The copied scratch workspace does not validate real provider permission enforcement.
  ADR 0001 makes the offline real-CLI enforcement probe a gate for #9.
