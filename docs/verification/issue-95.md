# Today with one practice action (#95)

Both owner modes use the same duration preview. Each duration is calculated from its plan stages. Native radios support keyboard arrows; selection changes no session or server state. One Start button names the chosen minutes. Current plan details retain full instruction, goal and provenance; the main task is visually limited to two lines. Material links open the existing private detail route.

Primary navigation is Today, Materials and AI Coach; Personal Library and Tabs remain under More. The no-plan, error, completed-plan, theme and profile controls retain their existing paths. No sample progress is added.

`pnpm typecheck`, `pnpm test`, `pnpm build` and the 24-case `scripts/verify-visual-system.ts` cover the implementation. The visual check now asserts that keyboard duration selection does not start a session and that choices plus Start fit above navigation at 390×844. The stage-tempo and break smoke scripts use the new single Start action and native duration selection.

Local evidence: /tmp/struna-wave2-today-final. Chromium viewport/theme checks are separate from Safari, hardware and native zoom qualification.
