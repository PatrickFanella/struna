# Issue #24: direct BPM entry

The large BPM display is a named numeric-keyboard input. Enter/Set BPM validates whole numbers from 30–300; Escape/Cancel edit restores the click value. Invalid or blank input changes nothing. Entry never starts playback. Step, tap, count-in, signature and subdivision controls remain. An active Studio stage exposes Use stage tempo and its source in Metronome as well as the session; outside a stage the panel explains the missing suggestion.

Checks: 320 tests and production build/typecheck passed. The scratch stage matrix passed nine width/theme cases at `/tmp/struna-stage-tempo-k8Vg94`, including direct entry, 301 rejection, Escape restoration, stopped playback and return to the stage's suggestion. Hardware audio/native-phone checks remain unverified.
