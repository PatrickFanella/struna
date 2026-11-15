# Struna personal mode

`STRUNA_MODE=personal` is the default for existing owner-hosted installations. It reads an Obsidian guitar practice system and a local media library. Studio mode is the self-contained option described in the README.

| Variable | Default |
| --- | --- |
| `STRUNA_VAULT_ROOT` | `~/Work/Vaults/Ars Malefica` |
| `STRUNA_THREAD` | `001 Projects/Threads/Guitar` |
| `STRUNA_MEDIA_ROOT` | `~/Documents/Reference Library/Ars Malefica/Guitar` |
| `STRUNA_CALIBRE_RECEIPT` | `~/.local/state/guitar-books-from-calibre-20261114.json` |

The thread contains the practice plan, progress ledger, materials, log template and logs. Practice starts the session named by that plan. The library indexes lesson videos, PDFs, ebooks and sheets; Guitar Pro tabs remain a separate browse-and-play collection. A scan reads the source files and writes its index to SQLite. It does not modify the source files.

Session logs are new files under the thread's `Practice/Logs/` folder. A repeated date gets another filename rather than replacing an existing log. Takes live under `STRUNA_MEDIA_ROOT/Recordings/`. The app does not commit vault changes.

The personal coach gets context for the current block, week, session, stage, fragment and tempo. It follows the vault's guitar-practice instructions. Writes are limited to the guitar thread; it cannot commit or push. Use scratch copies of the vault and media folders for tests that write logs, takes or coach notes.

The supplied deployment templates target `struna.subcult.tv`, redirect the previous hostname to it, and use an authenticated reverse proxy, a shared edge secret and a Unix socket. Installed paths and service names are operational state: the personal templates in `deploy/` use Struna unit names but retain the existing checkout, socket and secret paths. They do not migrate a running installation. When updating an existing unit, keep its paths explicit until the corresponding socket, proxy and secret paths have been changed together and checked live.
