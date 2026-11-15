# Issue #66 — compact Materials presentation

Default Materials rows show one musical title and one compact kind/source line. The row’s accessible name remains the musical title. The existing **Use in practice** and **Manage** actions remain beside each row.

The item detail page shows the musical title once. A native **Details** disclosure retains the source title, description, difficulty, source, and plan context where available; it does not change uploaded Markdown or source records. Item routes, history, filtering, scroll restoration, external links, and destructive-action confirmation use their existing flows.

Validation: `pnpm typecheck`, `node --test web/src/materials/item.test.ts web/src/materials/route.test.ts`, and `pnpm build` passed. The full shared Materials action matrix passed after building the current production assets: `node scripts/smoke-materials.ts "$(mktemp -d)/issue-66-and-21-full" 21` reported 32 cases at 320×700, 390×844, 1003×814, and native 200% desktop zoom (502×407), each in Light, Dark, Device/light, and Device/dark. It checked compact rows, source disclosure, one app-generated item title, row actions, focus/menu behavior, routes, and horizontal overflow. The prior Device/light timeout came from an old production `dist` bundle, not the current source. This remains browser-emulation evidence, not a physical-device or screen-reader claim.
