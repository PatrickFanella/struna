# Struna in the app

The app uses Struna’s “The string” direction from `subcult-tv/studio/brands/struna/`. The owner requested this integration on November 14, 2026. Studio remains the owner of the guide, palette, type and mark; this repository owns the implementation. The source pack still records pending owner review. This change applies it to the app; it does not approve social posts or deploy a website.

Source: [Struna guide at revision 8561286](https://github.com/subculture-collective/subcult-tv/blob/856128658b937d0b8e342e3ac0e7fbee180799ac/studio/brands/struna/GUIDE.md), introduced by [PR #86](https://github.com/subculture-collective/subcult-tv/pull/86). [struna-assets.json](struna-assets.json) records the exact source revision, selected paths, SHA-256 hashes and destinations. All 16 exported files are unchanged copies, with resolved Git LFS bytes. The source checkout was read without checking out or pulling its main branch.

## Palette and meaning

[The copied Studio tokens](../web/src/styles/struna.css) are imported by [the app mapping](../web/src/styles/tokens.css). The theme follows the device until the player chooses Light or Dark; the existing stored preference stays in use.

| App role | Studio role | Use |
| --- | --- | --- |
| `page`, `panel` | `bg`, `panel` | Page, fields, reading surfaces and panes |
| `ink`, `muted` | `ink`, `muted` | Primary text, labels and metadata |
| `edge`, `rule`, `wash` | `edge`, `rule`, `wash` | Control outlines, dividers and neutral selection |
| `ring` | `ring` | Filled clean-pass checks only |
| `ring-ink` | `ring_ink` | Clean-pass suggestion text and the next tempo |
| `focus` | `ring_ink` | Visible keyboard focus, as specified by the guide |
| `err` | `err` | Miss text, recording state, pain stops and error text |

Bronze does not indicate the current stage, a metronome beat, a selected string, an unread reply or upload progress. Those states use ink and neutral outlines. A miss is worded in the error colour, with no red fill. The tempo helper still suggests +3 BPM after three clean passes, repetition after one miss and −4 BPM after the second.

Clean-pass fills have a dark check (`#1A1714`) in both themes and a `ring_ink` outline. This keeps the check readable on bronze in dark mode and gives the light fill a boundary above 3:1. Bronze fill itself is not suitable for text on the light background.

## Type, layout and motion

Fonts load from `/brand/fonts/`, with OFL licences beside them. No Google Fonts connection is needed.

- Jost 400: the lowercase `struna` wordmark, headings, clock, BPM and numeric controls.
- Atkinson Hyperlegible Next 400 and 700: instructions, buttons, forms, logs and coach messages.
- Spline Sans Mono 400: small labels, codes and fixed-width text, including text tablature.

The normal scale is labels 12 px, small text 14 px, body 16 px, instructions 18 px, h2 24 px, h1 30 px, BPM 34 px and clock 36 px. The existing compact session headings and phone clock retain smaller sizes to leave room for the lesson. The standalone metronome and tuner keep larger readouts for use on a stand. EPUB documents receive the local body font and current ink colour inside their own frames; PDF and image source content keeps its original appearance.

The existing practice workspace, material panes, navigation, forms and responsive layout remain the product structure. Controls keep touch-sized targets; a narrow-header adjustment fits the mark and tool buttons at 320 px. Panels use the existing simple outlines with an 8 px base radius. Existing panel and menu motion keeps its reduced-motion path. No decorative motion or new shadows were added. Warm neutral colours come from the owner-selected pack.

## Identity assets

The header uses the original primary and dark Octave S SVGs with 15% clear space. The wordmark is lowercase; custom `STRUNA_APP_NAME` values remain available. The default app name and page title are Struna. New storage keys, API headers, package and service templates use `struna`. Existing configuration and stored data remain readable through the compatibility paths documented in the README.

Browser tabs use the hand-tuned 16 px SVG and the larger favicon assets. The manifest uses the supplied 512 px normal and maskable PNGs; Apple touch uses the supplied 180 px PNG. The manifest is app metadata, with no service worker or offline-cache claim. Packet artwork, social templates, reference studies and private Studio material are excluded from the app build.

## Updating the exported files

Start with the revision and source/target list in `struna-assets.json`. Read the new Studio guide and review the requested selection before updating it. Read each selected file from the chosen Git revision, resolve binary pointers with `git lfs smudge` in the source repository, and compare the resolved bytes to that revision’s `asset-manifest.json`. Copy only the listed destinations. Keep the imported `struna.css` unchanged; product adaptations belong in `tokens.css` and the component styles. Record the new revision and hashes together.

Do not pull or switch the Studio checkout merely to export files: social jobs also use it. Regenerate a changed brand only in Studio using its own generator and instructions. The old [Method book mockup](design-system.html) remains a historical layout study, not the current token source.

## Checking the integration

Run `pnpm build` and `pnpm test`. The existing `scripts/capture.ts` can capture fixture-backed practice, review, tuner, metronome, coach, library and tabs at desktop, phone and iPad sizes in both themes. `scripts/smoke-generic.ts` exercises setup, practice, materials and coach settings with a stand-in CLI; set `STRUNA_TIMEZONE=UTC` for this smoke run because its repair-plan fixture uses UTC dates.

Review loaded fonts, explicit theme overrides, keyboard focus, clean-pass and miss states, icon dimensions and narrow-screen overflow. Check every exported hash against `struna-assets.json` and ensure the build contains only the selected brand assets. A local build and fixture browser run do not establish production deployment or physical-device behaviour.

Local verification completed November 15, 2026 UTC:

- `pnpm build`: passed, including TypeScript. Vite still reports the existing large PDF/alphaTab bundle warning.
- `pnpm test`: all 290 tests passed.
- Studio smoke with `STRUNA_TIMEZONE=UTC`: all checks passed, including phone/iPad setup, sessions, materials and coach settings with stand-in CLIs.
- Personal practice smoke: passed clean-pass tempo change, take recording, log creation and the return to today, using scratch folders and disabled real coach CLIs.
- Browser conformance: passed at 320, 390, 820 and 1440 px in both modes for loaded fonts, marks, persisted theme overrides, clean/miss states, keyboard focus, horizontal overflow and reduced motion.
- EPUB check: a generated fixture loaded local Atkinson regular/bold and the correct ink colour in both themes.
- Asset checks: all 16 source hashes matched; PNG dimensions, SVG parsing, resolved LFS bytes, selected public files and CSS token references passed.

Measured bronze text contrast is 5.33:1 in light mode and 8.19:1 in dark mode. Dark checks against bronze fills measure 5.61:1 and 7.01:1. Screenshots use fixture content. These results cover local Chromium; production and physical Safari/device behaviour were not checked.

The repository-wide naming follow-up makes GitHub `PatrickFanella/struna` the primary source, uses `STRUNA_*` configuration and the public mode name `studio`, and renames the service templates. Legacy variables, saved state, browser settings and access credentials remain readable. The README documents precedence and the boundary between templates and installed services.
