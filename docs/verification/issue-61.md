# Issue 61: Stage-relevant controls

Tune up leads with Open tuner and suppresses fallback tempo prompts both in its header and click settings. Deliberately opening the click still allows numeric BPM selection. Playing stages show click, clean passes/count, Miss and Adjust tempo together, including on phones. Recording stages lead with Record/Stop and keep finalization, errors and take save/discard safeguards reachable. Tools reveals the remaining actions. Unknown custom stages and personal mode keep general controls.

Stage intent is derived from supported keys/titles and an explicit target BPM; no schema or fixed mockup stage list is introduced. Existing tempo resolution and player-override storage remain intact. Toggling Tools neither changes tempo nor requests a microphone. Opening the tuner requires a separate Start microphone action.

November 15, 2026: typecheck/build and the focused stage-control, stage-tempo and checkpoint tests passed (5 tests). The extended scratch tools smoke tests denied/unavailable microphone recovery, no microphone on non-recording controls, tune suppression and default playing controls. The Studio matrix tests numeric overrides surviving tools toggles and recording-stage visibility. Final artifacts and full-suite results are recorded in the wave integration note. Physical audio and native device qualification stay in #29.
