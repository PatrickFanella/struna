# Struna app visual foundation

Version 1, November 15, 2026. Implements [roadmap #77](https://github.com/PatrickFanella/struna/issues/77) and [visual foundation #89](https://github.com/PatrickFanella/struna/issues/89). The owner-approved direction blends welcoming first-use surfaces with quiet, structured music reading. This foundation changes shared visual roles and identity assets; Today, onboarding, phone/tablet layouts, Materials, review and tools remain their own follow-up issues.

## Ownership and provenance

The historical Studio export at revision `856128658b937d0b8e342e3ac0e7fbee180799ac` remains unchanged. [struna-assets.json](struna-assets.json) retains all 16 source paths, resolved-byte SHA-256 values and destinations, including fonts and OFL licenses. The original Studio marks remain historical exported files; the app no longer references them. This is an app-owned adaptation, not an update or approval of the separate Studio brand pack.

[App tokens](../web/src/styles/tokens.css) import the historical export for font-family definitions and map app roles directly to the new palette. Never edit the copied `struna.css` to adapt the product. New app assets have a separate versioned section in the asset manifest. No private study images or temporary mockup files are required to build the app.

## Palette and accessible roles

| Approved color | Value | App role |
| --- | --- | --- |
| Vanilla | `#FFFAF0` | Light page |
| Dark ink | `#26314A` | Light text; text on warm accents |
| Forest | `#315E4D` | Primary light controls, mark, focus, confirmed clean-tempo suggestion |
| Apricot | `#F5B08C` | Illustration and future feature accent |
| Butter | `#FFE099` | Filled clean-pass checks and illustration accent |
| Pale green | `#E9EFDF` | Selected/quiet surface and illustration |
| Soft pink | `#F8E0D7` | Illustration and future feature accent |

White text on forest measures 7.40:1; dark ink on vanilla measures 12.45:1. Soft accent fills use dark ink, never white labels. Text, error, muted, focus and control-edge roles are checked by the visual verification script rather than assumed from the palette. State still has text, shape or selection semantics; color alone never reports a pass, pain exit or current control.

Dark mode is a complete app mapping: navy page `#1B2433`, panel `#253246`, warm ink `#F5F0E5`, muted `#BEC6D1`, visible edge `#8998A6`, green selection `#344A43`, mint primary `#A3D2BB` with navy labels, butter focus and pale coral errors. Peach, butter and pink become deeper accent surfaces with light ink. Primary fill changes in dark mode so its boundary remains visible against dark panels. Source PDF/image/video content retains its own appearance.

The existing Light/Dark/Device preference and storage compatibility remain. Explicit dark rules and the Device media query supply concrete color values; explicit overrides win over device changes. Keep color tokens concrete because EPUB documents and alphaTab consume them outside the app style context. Browser theme-color metadata matches vanilla/navy according to the device; explicit app color selection is a content theme and does not promise a matching installed OS chrome tint.

## Type and surface roles

Fonts are served locally from `/brand/fonts/`, with licenses alongside them. Jost 400 carries the lowercase wordmark, headings, BPM and clock. Atkinson Hyperlegible Next 400/700 carries prose, instructions, forms and controls. Spline Sans Mono 400 remains for codes and tablature. Font synthesis is disabled. Do not simulate a new font weight or mirror text.

Controls use `--r:14px`; dense source-reading surfaces use `--r-reading:6px` with `--space-reading:12px`; feature notices/checklists use `--r-feature:22px` and `--space-feature:20px`. Illustration sources use 24px corners. Keep the original tab/score alignment and the current playing geometry. Source pages and tab text must never be rounded or decorated in a way that hides notes. Use `--shadow-layer` only on genuinely overlaid menus; flat reading surfaces need no decorative shadow. The existing focus rule supplies a 3px outline with 2px offset. Decorative animations/transitions are disabled under reduced motion; no new decorative animation was added.

The cream/green combination is owner-selected, as recorded in #77; it is not a generic replacement theme. The fonts, palette, radii, absence of decorative shadows and motion follow that explicit direction. The original illustration depicts a rounded guitar and notes; it does not copy the supplied inspiration screenshots. It stays available for Today/onboarding follow-ups and is deliberately absent from active playing.

## Mark, browser icons and reusable sources

[app-mark.svg](../web/public/brand/app-mark.svg) preserves the exact original study path and string geometry supplied in #89. Only the path group has `translate(28 0) scale(-1 1)`, making its curve read as S. The wordmark remains adjacent lowercase text in Jost and is never transformed. The SVG uses `currentColor`; the header applies it as a mask in the theme's primary color, so a single source works in both themes. At narrow widths it scales proportionally from 28×34 to 24×29px.

[practice-illustration.svg](../web/public/brand/practice-illustration.svg) is an original editable illustration for later Today/onboarding work. Both new vectors and derived icons are dedicated under CC0-1.0, with provenance in SVG metadata and the asset manifest. Imported font licenses remain unchanged.

[build-app-icons.ts](../scripts/build-app-icons.ts) derives a fixed vanilla/forest icon from the canonical mark. Run `node scripts/build-app-icons.ts` with local Chromium (or set `CHROMIUM`) and refresh app-asset hashes in the manifest. It uses no network or running app. The generator keeps all foreground geometry within the maskable safe circle. `app-icon.svg` is the editable composition; SVG/48px PNG favicons, 180px Apple touch and 512px normal/maskable manifest PNGs use that same orientation. Browser icons contain no wordmark to mirror. The manifest is metadata only, with no service-worker/offline claim.

## Verification and limits

Run `pnpm typecheck`, `pnpm test`, `pnpm build`, then `node scripts/verify-visual-system.ts` for scratch-only Chromium checks. The script creates original open-string material, disables real coach executables, uses isolated home/state/cache/vault/media roots, binds an available loopback port and closes its own server/browser. It checks 24 combinations of the six roadmap viewport sizes and light/dark/Device, loaded local fonts, mark source, text/control contrast, keyboard focus, preference persistence and page overflow. It saves JSON and selected screenshots. Existing Studio smoke uses stand-in providers and exercises practice/review, materials and coach settings independently.

[Issue #89 verification](verification/issue-89.md) records the actual commands and evidence. The repository had no check workflow at this baseline; the new CI workflow runs the required suite/build and this scratch visual check on PRs. Native 200% zoom, real Safari/device, assistive speech and hardware audio remain distinct later qualification in #109/#110. These foundation checks do not establish new account isolation, real provider support or production deployment.
