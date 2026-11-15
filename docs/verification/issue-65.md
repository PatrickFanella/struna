# Issue 65: compact pane picker and guarded opener

The pane picker remains a bounded desktop menu anchored beside its trigger. It uses a narrow-screen bottom sheet with a visible title and Close picker action, while retaining one title and one secondary source/context line per resource. Long lists scroll inside the picker; menu items have a 48px minimum height and wrap without widening the page.

The picker renders in a document-body portal. Outside pointer dismissal prevents the underlying target from receiving the same interaction. When a narrow-screen sheet happens to cover its opener, the opener's original coordinates remain a guarded dismissal area, so a second tap cannot choose a resource behind that coordinate. Escape, Close picker and outside dismissal return focus to the exact opener. Keyboard selection remains available through the existing menu arrows, Home, End and Enter behavior.

Validation on November 15, 2026: typecheck, all 340 unit tests and build passed (existing bundle-size advisory). `node scripts/smoke-controls.ts /tmp/struna-issue65-20261115g 18` passed 190 checks. The run uses 30 local fixture titles and stand-in providers across viewport/theme cases; it does not establish physical-device or screen-reader results.
