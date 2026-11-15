# Expanded reader and phone tools — issue #26

Expand reader gives a mounted file/tab pane the viewport. Escape or Close reader restores its opener, with background siblings inert and Tab contained during expansion. The same reader DOM stays mounted; its document, scroll and playback state remain in place. Expansion does not move the reader into another React tree.

At phone widths, the click remains available while clean-pass and recording controls open through Tools. An active recording keeps Stop take exposed. The tuning stage also offers Tuner. Pain/tension remains a separate action. The phone session can grow and scroll, with a bounded reading area and navigation in normal flow, so the navigation cannot cover secondary actions. Desktop layout retains the full tool row.

Checked November 15, 2026 UTC: `pnpm build` and `pnpm test` passed (303 tests). `node scripts/smoke-stage-tempo.ts` passed all nine report width/theme cases. Checks cover Tools reach at 320 px, a clean-pass state, fake-microphone recording continuity, viewport bounds, exact opener focus, the same reader DOM, retained 40 px scroll position, unchanged stored session state, and no page horizontal overflow. Fake recordings were discarded; no player recording was read or written. Screenshots: `/tmp/struna-stage-tempo-uhvrIp/shots`, including actual viewport captures named `*-reader.png`. The 390 px Dark expanded reader was inspected directly. Text tab uses its existing monospace scrolling surface.

A failed smoke found Tools beneath sticky navigation in a constrained 320 px session. The phone layout was corrected, and the full interaction matrix passed afterward.

**Human checkpoint remains open:** a player must check reading and control reach with a guitar at phone size. This PR remains draft for that review. Chromium with synthetic input does not qualify a real microphone, Safari, a native phone, screen reader or production deployment.
