# ADR 0002: Local Storage and Credentials

- Status: Proposed
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

Option 1 is the current recommendation because one transactional store reduces
migration and recovery paths. It remains proposed until a technical spike
verifies packaging impact, corruption recovery, and both credential backends.

## Acceptance Evidence

The ADR can become Accepted after the spike records dependency choice, database
location and permissions, migration/backup behavior, credential lifecycle,
failure mapping, and macOS/Windows test results.
