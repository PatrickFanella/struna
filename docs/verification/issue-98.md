# Phone practice frame (#98)

The active phone frame gives the reader the remaining height between compact stage context and playing controls. Click, clean pass and miss remain visible in playing stages with 48px targets; Tune, recording and review intents retain their controls. End and pain stop remain separate. The optional session checklist and source action live in the outline, and material/confirmed-tempo history has its own disclosure. Expansion changes CSS on the mounted reader instead of replacing it.

`verify-practice-layout.ts` uses a scratch Studio and original six-string text fixture at 390×844, 320×700 and 844×390, with light/dark/Device themes. It measures the entire six-string block against the reader bounds and the playing controls against phone navigation at 390×844, checks horizontal overflow and 48px playing targets, and verifies reading position/session continuity through expansion, tool return and orientation changes. Landscape may scroll vertically; notation scroll stays inside its reader.

Typecheck/build and the shared stage-tempo smoke cover the code. The stage smoke additionally exercises an in-flight fake recording through reader expansion and tool dismissal, pass states, neutral exits and review drafts. Native microphone/audio, Safari and real-device behavior remain later qualification gates. Local evidence: /tmp/struna-wave2-phone.
