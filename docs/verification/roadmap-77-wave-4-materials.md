# Account Materials (#90)

Materials routes register against the verified request workspace and its cache. Hosted collections have no library folders. Account directories reject symlinks, hard links and special files before opening data. Direct reader URLs require the document session and current cookie; responses, including ranges, use no-store. Uploads recheck session validity before publishing. Existing personal/Studio registrations are unchanged.

The HTTP test `server/auth/materials.test.ts` uses two offline identities and temporary roots. It checks upload, list/search/detail, foreign IDs, anonymous reads, native range responses, missing/stale session URLs, traversal, unavailable library roots, deletion and a symlink into the other workspace. No owner collection is read or modified.

Run `pnpm typecheck`, `pnpm test` and `pnpm build`. Public hosted activation remains blocked pending #94 and ownership review. This is scratch account qualification, not deployment or native audio/reader qualification.
