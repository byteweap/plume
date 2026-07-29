# ADR 0002: Local Storage and Credentials

- Status: Accepted
- Date: 2026-07-29
- Decision gate: before P0-B09 or P0-C05 implementation

## Context

Connection profiles, preferences, query history, drafts, and session snapshots
need versioned local persistence and safe recovery. Passwords must use macOS
Keychain and Windows Credential Manager and must never be stored with ordinary
configuration.

## Constraints

- Storage must support schema versions, migrations, atomic commits, bounded
  history cleanup, and recovery from a damaged store.
- A connection profile stores only a credential reference, never the secret.
- Credential create, read, update, and delete behavior must be integration
  tested on both target operating systems.
- Deleting local application data must separately address profiles, history,
  drafts, cache, and credential references.

## Candidates

1. SQLite owned by Rust for structured application data, plus a Rust keyring
   adapter for operating-system credentials.
2. Versioned atomic JSON files for profiles/settings, SQLite for history, and a
   Rust keyring adapter for credentials.

Option 1 is accepted. Plume uses bundled SQLite through `rusqlite` for
structured local data and `keyring` with the native Apple and Windows backends
for credentials. A single transactional store keeps migrations and recovery
paths bounded, while operating-system storage keeps passwords outside ordinary
application data.

## Implementation Record

- The database is `plume.sqlite3` under Tauri's per-user application data
  directory. Parent directories are created with the current user's default
  permissions.
- `PRAGMA user_version` drives ordered migrations. Writes use SQLite
  transactions, WAL mode, foreign keys, and a five-second busy timeout.
- Startup runs SQLite `quick_check`. A damaged database and its WAL sidecars are
  moved to timestamped `.corrupt-*` backups before an empty database is created.
- Connection rows store a generated credential reference. Passwords are read,
  written, updated, and deleted through the credential adapter and are skipped
  by serialized profile responses.
- Credential failures map to a stable `credential_error`; storage, version, and
  missing-profile failures have separate command codes.
- Schema version 3 adds connection-bound SQL drafts. Draft rows store only the
  database/schema context, title, SQL text, and timestamps; deleting a
  connection cascades to its drafts. SQL text is bounded to 5 MiB per draft.
- Query edits are saved after a 600 ms debounce and can be retried explicitly.
  Startup restores saved query tabs with the welcome tab active and does not
  connect to PostgreSQL, execute SQL, or restore result data.
- Unit tests cover migrations, recovery, the credential lifecycle, duplication,
  deletion, draft CRUD/cascade behavior, and absence of passwords from both
  SQLite bytes and JSON. Desktop CI runs a real create/read/delete round trip on
  macOS Keychain and Windows Credential Manager; the test always deletes its
  generated entry.

## Acceptance Evidence

The ADR can become Accepted after the spike records dependency choice, database
location and permissions, migration/backup behavior, credential lifecycle,
failure mapping, and macOS/Windows test results.
