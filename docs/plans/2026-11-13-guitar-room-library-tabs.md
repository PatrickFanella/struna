# Guitar Room: Library and Tabs Implementation Plan (Plan B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the searchable lesson library and the Guitar Pro tab browser to Guitar Room.

**Architecture:**
- A scan job builds a SQLite FTS5 index over the Guitar media folder (including the local book copies) and the vault lesson PDFs.
- The server streams media with HTTP range support and remuxes `.mkv` files to MP4 once, into a cache.
- The browser views PDFs with pdf.js (from Plan A), EPUBs with `epubjs`, and plays Guitar Pro files with alphaTab.

**Tech stack:** Plan A's stack, plus `ffmpeg` and `ffprobe` (installed on Kvant), `epubjs`, `@coderline/alphatab`, and `unzip -p` for zip entries.

**Spec:** `/home/shared/Work/Lab/guitar-room-design/design.md`, sections "Where the material lives", "Library" and "Tabs". Plan A (`2026-11-13-guitar-room-practice.md`) must be complete. This plan uses its `config`, `openDb`, `HttpError`, `send`, `route`, the pdf.js material viewer and the app shell.

## Global Constraints

- **Plan A's constraints apply.**
- **Library sources, relative to `config.mediaRoot`** (`~/Documents/Reference Library/Ars Malefica/Guitar`):
  - `Lesson Videos/ArtistWorks/<Instructor>/*.mp4`;
  - `Lesson Videos/Country Guitar Online/Free Lessons/<slug>/*.{mkv,mp4}` with `*.info.json` (fields `title`, `duration`, `webpage_url`);
  - `Source Archives/Country Guitar Online Assessment Archive - 2026-08-07/` (stream captures in `03-Anonymous-Stream-Archive/{Vimeo,Youtube}/<id>.mp4`, PDFs under `04-WordPress-Media/PDFs` and `01-Public-Articles-and-Resources`);
  - `Books/*.{pdf,epub}` (guitar books) and `Books/Music Books/*.{pdf,epub}` (music books);
  - `Restricted or Rights Review/Music Sheets/*.zip`.
- **Vault lesson PDFs, under `<thread>/`:** `Practice/Materials/*.pdf`, `Sources/Raw/ArtistWorks/**/*.pdf`, `Sources/Raw/Country Guitar Online/Downloads/**/*.pdf`, `Sources/Raw/Tony Rice/*.pdf`.
- **Video titles:** CGO titles and descriptions come from the vault article notes, `Sources/Raw/Country Guitar Online/Articles/*.md` (front matter `video-archive:` and its source URL), and fall back to `.info.json` `title`. ArtistWorks titles come from file names: drop the leading `NN_`, the instructor initials and `_ArtistWorks`, and turn `_` into spaces. The archive's duplicate encodings of the same lesson share a group key, the Vimeo or YouTube numeric ID in brackets or the file stem.
- **Books:** titles are the file names without the extension. The Calibre ID for each book's "Open in Calibre-Web" link (`https://books.subcult.tv/book/<id>`) comes from `~/.local/state/guitar-books-from-calibre-20261114.json`, matched by destination path; no network call at scan time. When a book has both a PDF and an EPUB, it is one item with two formats, PDF preferred.
- **Tabs:** `Restricted or Rights Review/Guitar Pro Tabs and Wiring/Collection/Guitar_Pro_Tabs/<letter>/<Artist>/<Artist> - <Title>[ (n)].gp3|gp4|gp5`. That's about 21,100 gp3, 3,500 gp4 and 5 gp5 files.
- **Remux cache:** `~/.cache/guitar-room/remux/<sha1(path)>.mp4`. Copy the video stream. Convert audio to AAC 160k unless it is already `aac` or `mp3`. Evict least-recently-used files once the cache passes 40 GB.
- **Read-only:** the app never modifies, moves or deletes library files, including `Books/`. Media is served only from inside `mediaRoot` and the thread folder.
- **Library and Tabs are browse-only.** "Use in practice" opens an item in the session's material pane for that session only and never changes the block.

## Review Focus

1. **Range requests from iOS Safari** (`bytes=0-1`, open-ended `bytes=N-`, out-of-range) return 206 with the correct `Content-Range`, 416 for an unsatisfiable range, and the full file without a Range header. Tested in Task 3.
2. **Two requests for the same un-remuxed `.mkv` at once** (Safari opens several connections) start one ffmpeg run. Both wait for it, and neither gets a half-written file. Tested in Task 3.
3. **File names with `｜`, `#`, `%`, `?`, quotes and non-Latin script** (the CGO and Guitar Pro trees contain them) round-trip through the index and the URLs. Tested in Tasks 1 and 3.
4. **Media path traversal** (`../`, encoded or a symlink out of `mediaRoot`) returns 404. Tested in Task 3.
5. **A rescan while browsing** keeps search results consistent. The scan writes into a new table and swaps it in one transaction. Tested in Task 1.

---

### Task 1: Library scanner and index

**Files:**
- Create: `server/library/scan.ts`, `server/library/titles.ts`, `server/library/calibre.ts`, `server/library/index-db.ts`
- Test: `server/library/scan.test.ts`, `server/library/titles.test.ts`
- Fixtures: `server/fixtures/media/...`, a small tree that mirrors each source with zero-byte media and one real `.info.json`.

**Interfaces:**
- Produces:
  - `type Item = { id: string; source: "artistworks" | "cgo" | "archive" | "vault" | "books" | "music-books" | "sheets"; kind: "video" | "pdf" | "epub" | "zip-entry"; title: string; description: string; path: string | null; url: string | null; size: number | null; duration: number | null; group: string | null }`. `id` is `sha1(source + path|url)`.
  - `scanLibrary(opts: { mediaRoot; vaultRoot; threadRel; calibreReceipt?: string }): Promise<Item[]>`. `Item` also carries `alt: string | null` (the EPUB path when the PDF is primary) and `calibreId: number | null`.
  - `writeIndex(db, items: Item[])` fills `items_next` and the FTS5 table `items_fts(title, description)`, then swaps both in one transaction.
  - `searchLibrary(db, { q?: string; source?: Item["source"]; kind?: Item["kind"]; limit: number; offset: number }): { items: Item[]; total: number }`. Results are grouped: one row per `group`, preferring the vault-titled lesson-folder copy.
  - `artistWorksTitle(fileName)` and `cgoGroupKey(fileName)`.

- [ ] **Step 1: Write failing tests:**
  - `artistWorksTitle("05a_BS_You Are My Sunshine_Rhythm_Intro_ArtistWorks.mp4")` is `"You Are My Sunshine Rhythm Intro"`;
  - `cgoGroupKey("The Best Country Strumming Patterns ｜ Guitar Lesson [132673069].mkv")` and `cgoGroupKey("132673069.mp4")` are both `"vimeo:132673069"`;
  - the fixture scan yields one grouped CGO item titled from the vault article note, an ArtistWorks item, a vault PDF, two `zip-entry` items from a fixture zip, and one `books` item with `alt` set from a fixture PDF and EPUB pair whose `calibreId` comes from a fixture receipt;
  - `searchLibrary(db, { q: "strumming" })` finds the CGO lesson;
  - a title containing `｜` and `#` is stored and found unchanged;
  - running `writeIndex` while a `searchLibrary` loop runs never returns an empty or partial result.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - Read video durations with `ffprobe -v error -show_entries format=duration -of csv=p=0`, cached by path, size and mtime in the table `probe_cache`.
  - Read zip entries with `unzip -Z1`.
- [ ] **Step 4:** Run the tests. Expected: PASS. Run the scanner against the real roots with `node server/library/scan.ts --dry-run`, which prints counts per source. Expected: roughly 320 lesson-video files grouped into about 100 lessons, 7 guitar books, 9 music books and the vault PDFs. Record the real counts in the commit message.
- [ ] **Step 5:** Commit `feat: library index over lesson media, vault PDFs and Calibre`.

### Task 2: Library API and screen

**Files:**
- Create: `server/library/routes.ts`, `web/src/library/Library.tsx`, `web/src/library/ItemRow.tsx`
- Modify: `server/index.ts`, `web/src/App.tsx` (replaces the Library empty state)

**Interfaces:**
- Consumes: `searchLibrary` and `scanLibrary` from Task 1.
- Produces:
  - `GET /api/library?q=&source=&kind=&offset=` returns `{ items, total, scannedAt }`.
  - `POST /api/library/scan` returns `{ started: true }`. One scan at a time; a second call while one runs returns `{ started: false }`.
  - The server runs a scan at startup when `scannedAt` is older than 24 hours.
  - The Library screen has a search field, source and kind filters, rows with title, source and duration or size, Rescan, and "Use in practice" on PDFs and videos. "Use in practice" sets `sessionStorage["guitar-room.material"]`, which the Plan A material pane reads.

- [ ] **Step 1: Write failing tests** in `server/library/routes.test.ts`:
  - `GET /api/library?q=strumming&source=cgo` returns the fixture lesson;
  - a second `POST /api/library/scan` during a scan returns `started: false`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement the routes and the screen with the Plan A tokens and components (selected filter is a wash with a 2px ink outline). Show a "No results" empty state, a loading state, and a scan-failed state that shows the error text.
- [ ] **Step 4:** Run the tests. Expected: PASS. Run `node scripts/capture.ts` and check the Library screen at phone and iPad sizes in both themes.
- [ ] **Step 5:** Commit `feat: library screen`.

### Task 3: Media streaming and mkv remux

**Files:**
- Create: `server/library/media.ts`, `server/library/remux.ts`
- Test: `server/library/media.test.ts`, `server/library/remux.test.ts`

**Interfaces:**
- Produces:
  - `GET /api/media/:id` streams the item's file with range support. A video whose container is not MP4 streams the remuxed file.
  - `GET /api/media/:id/entry` streams a zip entry through `unzip -p`, with the content type guessed from the extension.
  - `parseRange(header: string | undefined, size: number): { start: number; end: number } | "unsatisfiable" | null`
  - `ensureRemux(srcPath: string): Promise<string>` returns the cached MP4 path. Concurrent calls share one promise per path. ffmpeg writes to `<hash>.mp4.part` and renames on success.
  - `evictCache(dir, maxBytes)`.

- [ ] **Step 1: Write failing tests:**
  - `parseRange("bytes=0-1", 100)` is `{0,1}`, `"bytes=50-"` is `{50,99}`, `"bytes=-10"` is `{90,99}`, and `"bytes=200-"` is `"unsatisfiable"`;
  - `GET /api/media/:id` with `Range: bytes=0-1` returns 206, `Content-Range: bytes 0-1/<size>` and a 2-byte body;
  - with no Range it returns 200 and the full size;
  - an id whose stored path escapes `mediaRoot` (inserted directly in the test database) returns 404;
  - two concurrent `ensureRemux` calls on a 1-second fixture `.mkv` (generated in the test with `ffmpeg -f lavfi -i testsrc=d=1 -f lavfi -i sine=d=1 -c:v libx264 -c:a libopus`) run ffmpeg once, return the same path, and the output has an `aac` audio stream according to `ffprobe`;
  - `evictCache` removes the oldest file once the total passes the limit.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Content types: `video/mp4`, `application/pdf`, `application/epub+zip`. The remux command is `ffmpeg -nostdin -y -i <src> -map 0:v:0 -map 0:a:0? -c:v copy <audio args> -movflags +faststart <out>.part`.
- [ ] **Step 4:** Run the tests. Expected: PASS. Open a real CGO `.mkv` lesson in the dev server on the iPad, or on Safari with the iPad viewport. Expected: it plays and seeking works.
- [ ] **Step 5:** Commit `feat: media streaming with range support and mkv remux cache`.

### Task 4: Viewers

**Files:**
- Create: `web/src/library/Viewer.tsx`, `web/src/library/VideoView.tsx`
- Modify: `web/src/practice/Material.tsx` (accepts a library item as well as a vault path)

**Interfaces:**
- Consumes: `/api/media/:id`, `/api/media/:id/entry`, and the Plan A PDF viewer.
- Produces:
  - `<Viewer item>` picks: video, using `<video controls playsinline preload="metadata">` with the speed control 0.5, 0.75, 1 and a remembered position per item in `localStorage`; PDF, using the existing viewer; EPUB, using `epubjs` with the location remembered per item; a zip entry, which uses the PDF viewer for `.pdf` entries and a download link otherwise. Books also show "Open in Calibre-Web" when `calibreId` is set.
  - The material pane can show a video, with the same controls, during a session.

- [ ] **Step 1:** Implement the viewer. Run it in the dev server. Expected: an ArtistWorks MP4, a remuxed CGO MKV, a vault PDF, a PDF from the Music Sheets zip, the Tony Rice Collection Tab Book (PDF) and Unlocking the Neck (EPUB) each open correctly.
- [ ] **Step 2:** "Use in practice" on a video, then start a short session. Expected: the material pane shows the video, and the next session starts with the block's own material again.
- [ ] **Step 3:** Run `pnpm typecheck && pnpm build`. Expected: PASS.
- [ ] **Step 4:** Commit `feat: library viewers and practice hand-off`.

### Task 5: Tabs browser

**Files:**
- Create: `server/tabs.ts`, `web/src/tabs/Tabs.tsx`, `web/src/tabs/TabPlayer.tsx`
- Modify: `server/index.ts`, `web/src/App.tsx` (replaces the Tabs empty state), `vite.config.ts` (copies alphaTab's font and soundfont assets)
- Test: `server/tabs.test.ts`

**Interfaces:**
- Produces:
  - `parseTabName(relPath): { artist: string; title: string; version: number; ext: "gp3" | "gp4" | "gp5" }`
  - `scanTabs(root): Promise<void>` builds the table `tabs(id, artist, title, version, ext, path)` and FTS5 table `tabs_fts(artist, title)`, using the same swap-in-one-transaction approach as Task 1.
  - `GET /api/tabs?q=&artist=&offset=` returns `{ items, total }`.
  - `GET /api/tabs/:id/file` streams the file as `application/octet-stream`.
  - `<TabPlayer src>` is the alphaTab `AlphaTabApi` with the player enabled (bundled soundfont), play and pause, tempo 25–150%, looping a selected bar range, and track selection. It renders in ink on the page color in both themes.

- [ ] **Step 1: Write failing tests:**
  - `parseTabName("3/311/311 - Beautiful Disaster (2).gp3")` gives `{ artist: "311", title: "Beautiful Disaster", version: 2, ext: "gp3" }`;
  - `"_/_Unknown/Song.gp4"` gives `artist "_Unknown"` and `title "Song"`;
  - a fixture tree of 3 files indexes 3 rows, and `q=disaster` finds 2;
  - names with quotes and non-Latin script round-trip.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. The Tabs screen has search, an artist list, results, and the player in a full-height panel. Tabs never offers "Use in practice", because tabs stay out of lessons.
- [ ] **Step 4:** Run the tests. Expected: PASS. In the dev server, open a gp3, a gp4 and a gp5 from the real collection. Expected: each renders and plays, and the loop and tempo controls work.
- [ ] **Step 5:** Commit `feat: Guitar Pro tab browser`.

### Task 6: Release

- [ ] **Step 1:** Run `pnpm test && pnpm build`, then restart `guitar-room.service`. Through `guitar.subcult.tv` in a signed-in browser, play a CGO video from the library and open a tab.
- [ ] **Step 2:** Update the README: sources, the rescan, the remux cache location and limit, and the local book copies with their Calibre-Web links. Update the Kvant briefing entry in Machinum with the cache path and the ffmpeg dependency. Commit and push both.
