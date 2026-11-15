# Issue #23: deliberate microphone tools

Verified 2026-11-14 on Kvant, Chromium with synthetic audio streams and a fresh
scratch Studio. No live data, provider, microphone hardware or deployment used.

## Checks

- `pnpm typecheck`: passed.
- `pnpm test`: 299 passed, none skipped.
- `pnpm build`: passed; existing bundle-size warning remains.
- `node scripts/smoke-tools.ts /tmp/struna-23-smoke-3`: passed all 16 combinations.
- Logs: `/tmp/struna-23-{typecheck,test,build,smoke}.log`.
- Scratch home/state and stand-in: `/tmp/struna-23-smoke-3/`.

The new smoke extends the scratch-fixture approach of smoke-generic.ts and keeps
its own owned server, unused loopback port and external-network block. It refuses
to delete or reuse an existing artifact directory. It asserts direct Metronome
entry and tool switching do not request input; Tuner is idle until Start;
denied/missing/unavailable states, retry, pending/active/stop, independent-stream
ownership, unmount cleanup and late permission-result cleanup work. Unit tests
also cover browsers without getUserMedia and raw audio constraints.

Each state has PNG evidence at 320x700, 390x844 and 1003x814, with explicit Light,
Dark, Device following light OS, and Device following dark OS. File pattern:
`/tmp/struna-23-smoke-3/<width>x<height>-<theme>-<state>.png`.
States: metronome, idle, NotAllowedError, NotFoundError, NotReadableError,
requesting, active. The same assertions/screenshots ran at 502x407 to exercise
approximately the layout available at 1003x814 at 200% zoom. This is a reflow
proxy, not a browser-chrome zoom or native device test. Checks are also retained
in `checks.txt` beside the PNGs. Light 320 idle and dark 390 active PNGs were
visually inspected.

The first two runs exposed existing Metronome subdivision overflow at 320 px;
the passing run includes a tool-scoped spacing fix. Those failed attempts remain
in `/tmp/struna-23-smoke` and `/tmp/struna-23-smoke-2`.

## Implementation boundaries and caveats

Each Tuner request owns its returned MediaStream. Stop/unmount disconnects its
nodes and stops only those tracks; recorder ownership is not globally stopped.
The existing micUsers recording event now also tells Tuner to release its own
stream. Session.tsx and Workspace.tsx were not edited. The independent native
stream in the smoke stands in for another consumer; this is not human recording,
physical microphone, audio-quality or real permission-dialog qualification.
Device appearance uses the app's existing missing-data-theme behavior and OS
media emulation; the theme control itself belongs to #28.

Stack base: `docs/8-coach-plan-preview-protocol` (PR #31). This PR changes only
#23; it does not enable plan candidates or preview behavior.
