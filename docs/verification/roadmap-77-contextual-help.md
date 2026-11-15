# Contextual help (#107)

Short task disclosures now accompany the selected Tuner or Metronome, the expanded session recording tools and the guest exercise. A first visit shows the tip; closing its summary or choosing “Got it, hide tip” remembers dismissal. The summary remains a keyboard-accessible help entry, so players can read the tip again without resetting practice. Returning users keep their current guest step and do not repeat welcome screens.

Help never starts the microphone, recording, click or timer. Permission still follows an explicit Start microphone or Record take action. Copy describes denied access and optional alternatives, distinguishes suggestions and player reports from measurements, and retains the existing exploration/completion distinction. There is no slideshow, forced focus, animation or analytics.

`pnpm typecheck`, all 351 tests and `pnpm build` pass. `node scripts/verify-contextual-help.ts` passes eight fresh/returning Chromium cases at 320×700 and 390×844, with explicit light/dark, Device light/dark and reduced motion. It checks keyboard reopening, dismissal/reload, both orientation changes, zero microphone requests on help/tool opening, explicit denied capture with the Metronome alternative, unchanged guest data, unchanged session/timer/panes, reader scroll/node continuity and an unsent Coach draft. Local evidence: `/tmp/struna-help-ahUoVi/evidence`. CI runs the same script and retains its screenshots and JSON.

The fixture uses a fresh Studio, an offline provider stand-in and simulated microphone denial. It does not qualify real capture, guitar use, Safari, assistive speech or the later account/guest import flow.
