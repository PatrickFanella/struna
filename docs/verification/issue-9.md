# Issue #9: Coach proposals and explicit Apply

Studio Coach turns write a fresh candidate rather than the live plan. The complete escaped before/after JSON and a summary for every changed top-level field appear in Coach with Apply and Dismiss. Advice leaves no proposal. Reload lists pending proposals without applying them. Materials, profile and notes edits still take effect directly, as the UI explains.

The server stores immutable exact bytes and their SHA-256 privately. Apply revalidates those bytes, dates and material paths, compares the original active-plan fingerprint and archive destination, and checks the current practice revision under a studio lock. Replacement archives exact old bytes without overwriting a destination. File/directory sync, an apply-intent record and an idempotent receipt support interruption recovery and repeated clicks. A changed plan or session assertion returns a recoverable conflict.

Every Studio provider, host login, automatic action and repair turn uses the same probed Linux OS boundary. No live plan/archive write grant remains. The startup catalog and pre-turn probe disable unsupported paths with a reason. Actual installed Claude Code 2.1.322 and Codex 0.167.2 passed the offline wrapper probe; this is separate from real-provider inference, which was not requested or run.

Practice uses expiring server leases. Restored practice waits for successful registration; connection failure is visible and retryable, and timers pause on loss/expiry. Expiring a vanished tab changes the revision. Sessions retain their original Today/stage snapshot. End or discard practice in every open tab before Apply.

Validation includes 332 passing unit/integration tests and production build/typecheck. Tests cover all seven provider IDs, automatic/resumed and repair paths, malicious live writes, no-change advice, failed/cancelled turns, invalid JSON, future dates, material escapes, symlinks/hardlinks, stale bases, multiple active tabs, expired leases, double Apply, archive collisions and both sides of interruption recovery. Browser evidence and artifact locations are recorded in the combined Wave 2 report.

Issue #9 requires human code review of the file-write/approval boundary and a player review of the preview. Those checks remain pending; this implementation is a draft until they are supplied. No deployment is included. ADR 0001 documents the effective outer boundary and why the original exact-file Codex grant was changed.
