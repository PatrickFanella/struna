# Issue #16: neutral exit and partial review

End session pauses active time from the first stage and offers Resume, Review partial session and a separate discard confirmation. The native dialogs contain focus, handle Escape and restore their opener. Saved recordings remain; an active recording is stopped and its unsaved take must be kept or discarded before exit. Pain remains a separate no-count stop.

Partial metadata is additive in Studio and personal logs; absent metadata keeps old counting semantics. Partial logs do not advance plan progress or trigger the session-completed Coach action. A full-review draft cannot overwrite a new partial review's actual active minutes. Exiting alone creates no log.

Checks: 319 tests and production build/typecheck passed. Scratch browser matrix passed nine width/theme combinations at `/tmp/struna-stage-tempo-FWTIoz`: Resume retains panes/checkpoints/time, discard confirmation supports Escape, partial review survives reload, and a one-minute partial log saves. No hardware recording, native Safari or human assistive-use claim.
