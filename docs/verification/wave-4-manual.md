# Wave 4 operator checks

Status on November 15, 2026 UTC: **not performed**. These are the remaining human checks for [#29](https://github.com/PatrickFanella/struna/issues/29). Automated evidence is in [the qualification record](wave-4.md). The owner chose to do these after the automated pass. Do not close #29 until dated evidence establishes the required outcomes.

## Start an isolated fixture

From this repository with Node 24 or newer and pnpm installed:

```sh
pnpm install --frozen-lockfile
pnpm build
PORT=5410 node scripts/qualification-studio.ts
```

Open the public test access link printed by the last command. The launcher creates a new `/tmp/struna-manual-*` directory with its own profile, plan, library, logs, recordings, state and cache. It uses a deliberately public fixed test token and offline Coach stand-ins. Use test material only; do not enter personal data or provider credentials. It binds to loopback and refuses an existing directory if one is supplied. Keep that terminal running; Ctrl+C stops the server and retains the artifacts.

Full contains Tuning, Technique, Tune practice and Logging. Short contains Technique and Logging. Quick contains Tuning, Technique and Logging. Baseline roll targets 80 BPM; Black Mountain Rag targets 96 BPM. This setup supplies real browser audio APIs, rather than the smoke runners' fake microphone.

For desktop Safari/VoiceOver on a Mac, run the same commands from a checkout there, or forward the running Kvant scratch server to the Mac with `ssh -N -L 5410:127.0.0.1:5410 kvant` and open its printed localhost link. Use the Mac's own microphone and speakers. For a physical phone, use an authorized secure route to this scratch server. No native-phone route or trusted phone certificate was configured by this run. A remote HTTP LAN URL does not provide the secure context needed for microphone checks. Do not substitute the production service to get around that access gap.

Record the tested Git commit, date/time, device model, OS version, browser version and screen-reader name/version with each result. Preserve screenshots, the words actually spoken by the screen reader, and scratch log/recording filenames. Mark a check unverified if the necessary device or route is unavailable; do not turn a skipped check into a pass.

## Native phone and Safari

1. Open the fixture in the native phone browser and in Safari. Select Light, Dark and Device; use both OS appearances for Device. Inspect the three duration summaries, long material names, text wrapping and focus/control boundaries. Check portrait/landscape and desktop 200% zoom. A resized Chromium window is separate evidence.
2. Open Baseline roll directly from Today and return. Confirm that this does not start a timer. Start Quick, advance to Technique and verify the 80-BPM Plan target. Pause, advance and go back: the timer should remain paused. Resume, navigate to Materials and return; the same session should remain.
3. Open Tools, select Baseline roll in Measure material and log a clean pass at 80. In Full, end before attempting the tune and select Review partial session. The roll should be 80 and Black Mountain Rag blank. Edit the roll to 82; use Back, revisit review and reload. The edit should remain. Save one scratch log, read the new file under `home/logs/`, and compare the per-material identities/BPMs with Today history. A partial log must not advance plan progress.
4. Complete Short without confirming a clean pass. Its roll field should stay blank despite the click's tempo, and it must not ask for the omitted tune. Start another session, End, Resume, then End and Discard. Confirm no extra log was created.
5. Expand the reader, scroll, close it and reopen it. Inspect aligned tab strings and the restored reading position. Check Tools, timer, tempo entry and recording controls with touch, including after rotating the phone.
6. In Materials, open Baseline roll, reload its item URL, and use browser Back/Forward. Apply search/kind filters, open a result and return; confirm list context. Upload a small test Markdown file through Choose files. Verify clear item-open, Use in practice and Manage actions and a recoverable missing-item URL.
7. After ending/discarding any active session, open Coach, choose the offline Claude Code stand-in and send the exact text `PROPOSE PLAN`. It proposes changing the next instruction to “Play the proposed slow roll”. Review the before/after preview, Dismiss, propose again and explicitly Apply. The automated proposal matrix proves the write boundary separately; this human step checks comprehension and usable presentation. No live provider request is needed for this step.

## Screen-reader output

Use a real screen reader, such as VoiceOver with Safari or NVDA with a supported desktop browser. Write down actual spoken phrases rather than copying DOM or accessibility-tree labels.

1. Navigate Today, Materials detail and active practice by headings. Confirm one exposed view-level heading, followed by nested lesson headings; read a short tab and record how it is presented.
2. Reach Choose files by keyboard; activate it and return after selecting a test file. Record its announced name and the resulting upload status.
3. Open Coach from the header, then from More/context prompts. Record its dialog/name and initial focus. Tab and Shift+Tab through conversation, settings and prompts; Escape and Done should restore the exact opener. Confirm an unsent draft survives. An embedded Coach pane should allow normal page navigation.
4. Start/pause the stage timer, start/stop the click, record/stop/save a take, and save a log. Record the state announcements. Timer ticks and individual beats should not repeatedly interrupt speech. Distinguish quiet live-region behavior from a failed or muted screen reader.
5. Read the optional roll/tune BPM fields, blank/unmeasured state, Optional notes disclosure and log-save success. If any announcement is unclear or absent, record the exact action, actual output and expected output; link a follow-up issue from #29.

## Instrument, microphone and playback

Use a real guitar and the device's actual microphone/speakers or headphones. Do not supply fake audio flags or a generated tone as hardware evidence.

1. Open Metronome directly. It should not request microphone permission. Set 80 BPM, test plus/minus and tap tempo, count-in and subdivisions. Listen for the audible pulse and accent; enter 90 and use Enter, then cancel an edit with Escape. Record whether timing and sound are usable.
2. Open Tuner. It should start idle. Select Start microphone and deny permission; record the recovery message. Permit access through the browser's site settings, retry and play real strings. Record the string/note, reference pitch and observed tuner response, including sharp/flat direction. Stop/close Tuner and confirm the browser's microphone indicator clears when no recorder owns it.
3. Test missing/unavailable input only when you can actually disconnect/select an unavailable input without disturbing another task. Record the real browser outcome. The synthetic denied/missing/unavailable matrix is already separate evidence.
4. During practice, record several seconds of real playing, stop, replay locally and save the take. Replay the saved recording and confirm intelligible audio, duration and the correct take. Note the actual filename under `home/Recordings/`. Starting/stopping Tuner during recording must not cut off the recorder's microphone lease.
5. End with an unsaved take. Check the deliberate keep/discard choice and Resume. After a saved take, discard a new unsaved session; the saved recording must remain. Check the separate pain/tension stop and its non-counting log; do not induce pain to test the control.

## Provider access and closure

No real provider was called in this qualification. The manual launcher is intentionally offline. Any live-provider check needs a separately authorized scratch setup and an available account/operator; do not copy production credentials or replace the stand-in with a real binary for convenience. Record the provider/model, date, request purpose and input boundary if that check is authorized later.

Attach the completed evidence to #29 or update its qualification record with actual results. Link remaining failures as issues. Merging the automated-evidence PR alone does not close the qualification or establish deployment readiness.
