# ADR 0005: Observe first-practice value before adding analytics

Date: 2026-11-15. Issue: #87. Roadmap: #77.
Status: decided. Begin with consented observation and a small manual evidence ledger; no tracker, analytics vendor or experiment is authorized.

## Questions and method

Can a new player try something useful without an account, upload, microphone, payment or AI connection? Can they find the music and controls while holding a guitar, finish or stop safely, leave an optional reflection and know what to do next? Can they return to that next action without losing guest work or confusing it with someone else's account?

Recruit a small formative group spanning new and experienced players, phone and desktop users, and at least one person exploring without a guitar. Five to eight sessions is a practical initial research batch, not a statistically representative sample or a conversion target. Record observed participant/device counts and limitations; do not infer population rates or learning gains from this batch. Ask permission to observe; do not record screens, microphone, voices or private practice content by default. Participants may skip questions and stop at any time.

Use the built app with original/public exercise fixtures, fresh guest storage and two synthetic account identities. Live accounts/real AI require their separate qualification and explicit participant consent. Observe the first attempt with neutral instructions and no feature tour. Record where help was needed before giving it; assisted completion is distinct from independent completion. Schedule a voluntary second visit on another day; a replay in the same session is not return behavior. Do not test payments while the support invitation is deferred.

## Observed tasks and evidence

| Task | What to observe | Failure or ambiguity to retain |
| --- | --- | --- |
| Welcome to first exercise | Choose suggested focus/experience or skip; find and start the short exercise without creating an account | Wrong turns, mandatory setup, time to first action, need for help; measure elapsed time without setting an invented target |
| Explore without a guitar | Find the offered path and understand what can be tried | No hardware must look like an error or an obligation to grant microphone permission |
| Read and play | Identify the intended strings/bars and reach pause/next/tempo controls in the viewport | Clipped music, accidental exits, hidden controls, unconfirmed tempo assumptions; distinguish browser geometry from real holding/playing |
| Use a tool when needed | Open tuner or metronome, understand permission/off states and return to the exercise | Real audio/mic results require hardware; emulator clicks do not establish audibility or pitch accuracy |
| Finish or exit | Complete normally, finish partially, or stop for pain without penalty wording | Separate completed, partial, neutral stop and pain stop. A safe stop is not a failed player |
| Reflect and continue | Skip reflection or save it, then identify one next action | Observed action and the player's reported usefulness remain separate; no inferred musical improvement |
| Return as guest | Reopen on a later day and find the next action | Same-day reopen, cleared browser storage and true later-day return are different outcomes |
| Save across devices | At a meaningful save/coaching action, sign in and return to it with explicit guest import | Denied/cancelled sign-in must retain guest work. Account B cannot see A's imported data; import retry cannot duplicate it |
| Optional coaching | Decline connection and continue; with a stand-in connect, request advice, inspect a plan preview and Apply deliberately | Saved key is not a successful real-provider turn. Advice/proposal must not silently change the plan |

For #109 cover 320×700, 390×844, 844×390, 820×1180, 1153×814 and 1440×900; explicit light/dark/Device, keyboard, reduced motion and native desktop 200% zoom. Record visible geometry for music plus playing controls, not just full-page screenshots. #110 adds real Safari/device, guitar/microphone, playback and screen-reader speech evidence with exact build/device/browser/date. Automated geometry, synthetic audio and real participant use are separate evidence classes.

## Manual ledger and interpretation

Keep a private research ledger outside the shipped app containing only: random study participant code (no account id), consent scope, date bucket, build SHA, device/browser class, task, independent/assisted/not-completed/skipped outcome, observed obstruction, and a content-free paraphrase of optional usefulness feedback. Do not copy emails, filenames, messages, logs, injuries, recordings, source music or provider credentials. Store consent/contact details separately under the study owner's access; keep the pseudonym mapping out of the results.

Delete the participant-code mapping and raw observation notes within thirty days of the batch review; retain only anonymous issue findings and aggregate task counts. Do not commit participant records or publish small identifiable slices. No cross-device identity stitching or third-party telemetry. A future instrumented study needs a separately selected measurement approach, consent/retention plan and scoped implementation issue.

Report counts with denominators: eligible observed attempts, independent completions, assisted completions, partial/neutral/pain exits and invited versus observed later-day returns. Exclude skipped/not-observed tasks from completion denominators and show them separately. Describe first-use value using both the observed task and optional “Was this useful, and what would you do next?” response; do not turn a self-report into measured technique improvement. Confirmed per-material BPM is a player-reported practice record, not an automatic assessment score.

## Minimal event vocabulary, only if later approved

Manual observation is sufficient initially. These are candidate aggregate events, not permission to instrument now. Allowed shared fields would be event name, schema version, build version, coarse date bucket, guest/account mode and viewport class; use a random short-lived study/session token only if needed for the chosen study, never an email/account id or persistent browser fingerprint.

| Candidate | Exact meaning | Safe additional fields |
| --- | --- | --- |
| `starter_started` | Player deliberately starts the starter | Original fixture variant enum, guitar/explore enum |
| `practice_exited` | Player finishes, stops or leaves the session | complete/partial/neutral/pain enum; coarse active-duration bucket; never pain details or reflection |
| `reflection_finished` | Player saves or skips optional reflection | saved/skipped enum; never text |
| `next_action_selected` | Player selects the offered return action | Fixed action enum; never prompt, material or URL |
| `return_observed` | A consented study participant returns on a later day | Manual yes/no evidence; do not ship tracking just to obtain it |
| `support_link_opened` | Player deliberately opens a future approved support destination | Destination enum only; disabled while support is deferred. A click is not a payment |

Do not send practice content, precise tempos, recordings, source filenames, URLs, messages, names, addresses, provider ids/keys or payment identities to analytics. Do not derive diagnoses, skill scores or musical improvement from event completion. If events become necessary, test their complete serialized payloads for forbidden fields with scratch fixtures before collection.

## Sustainable support evidence

The owner deferred the support invitation for launch (#86). Record support as **not offered / not measured**, never zero conversion. Future research first asks whether an optional invitation is understood as voluntary and separate from AI costs or features. If the owner later approves a destination, a link-open count measures interest only. Actual support evidence must come from owner-provided aggregate settled receipts, with refunds, platform fees, processing costs and period stated; compare with aggregate operating/maintenance costs and describe uncertainty. Never correlate a payer with practice activity or set a revenue/retention target without evidence.

## Exit and follow-up

The spike is complete when the task protocol, evidence distinctions, privacy boundary and ownership above are recorded. #103/#106 implement guest paths, #109 records responsive regressions and #110 runs the consented real-device/first-use qualification. Report findings as observed defects or open questions with exact builds. Repair blockers and observe the changed task again; do not run an underpowered A/B test. No user research results, return rates, support payments or measured improvement are claimed by this plan.
