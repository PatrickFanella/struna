# Tuner and Metronome (#101)

The tools use the warm theme, large numeric displays, 48px controls and explicit playing/stopped text. Tuning, count-in, subdivisions, tap tempo and direct BPM entry remain. Selected strings have an underline as well as their pressed state; tuned strings retain a check and accessible label.

The tools sheet is a named modal dialog with keyboard focus containment, Escape dismissal and return to its opener. Escape inside the BPM editor retains its established cancel-edit behavior. Closing/switching the tuner releases its own stream, including a late permission result. Metronome requests no microphone.

Recording reserves capture before requesting permission. Tuner refuses a new capture while that reservation is active, without calling getUserMedia. Recording failure, cancel and stop release only that recorder's reservation. Session owns the recorder before awaiting permission; cancellation and exit stop any late stream and allow a later request. This coordinates existing capture consumers without replacing pitch detection, recording formats or click scheduling.

Checks: typecheck/build, microphone/recording unit tests, and scratch tools smoke using synthetic streams. The smoke covers no-mic Metronome, direct numeric BPM, keyboard dismissal/focus return, denied/missing/unavailable tuner input, retry, delayed capture, independent streams, close/late release, session return and a recording-versus-tuner conflict. Matrix: 320×700, 390×844, 1003×814 and native desktop 200% zoom with light/dark/Device. Real instrument pitch, microphone hardware, audible click quality and Safari remain separate qualification gates.
