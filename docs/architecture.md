# Plume Architecture

[English](architecture.md) · [简体中文](architecture.zh-CN.md)

This document records Plume's current architectural boundaries. It describes implemented behavior, not the complete target product. See the [product requirements](产品需求文档.md), [development task breakdown](开发任务分解.md), and [Architecture Decision Records](adr/README.md) for planned work and binding decisions.

## Design Goals

Plume optimizes for:

- A small desktop footprint and fast interaction.
- Predictable PostgreSQL behavior over broad database compatibility.
- Explicit safety around credentials and data-changing operations.
- Modules that can evolve independently as query, result, and editing capabilities are added.
- A UI that remains responsive when servers contain many databases and objects.

## System Boundary

```text
┌──────────────────────── Desktop application ────────────────────────┐
│                                                                    │
│  React UI → feature API → Tauri adapter → Rust command boundary    │
│                                              ↓                     │
│                                  PostgreSQL services and sessions  │
│                                              ↓                     │
└──────────────────────────────────────── PostgreSQL wire protocol ──┘
                                               ↓
                                         PostgreSQL server
```

There is no Plume application server. The desktop process connects directly to PostgreSQL.

## Dependency Direction

```text
React component
  → feature API
  → typed platform adapter
  → Tauri command
  → database service
  → PostgreSQL driver
```

Dependencies point toward feature and domain contracts. React components do not import Tauri APIs directly. Tauri command handlers translate the IPC contract but do not contain PostgreSQL query logic.

## Frontend Boundaries

```text
src/
├── app/          Global composition and the desktop workspace
├── features/     Domain features with types, API, UI, and tests
├── i18n/         Typed English and Simplified Chinese catalogs
├── platform/     Privileged runtime adapters
├── shared/       Small domain-neutral UI primitives
└── styles/       Global visual foundations
```

Rules:

- A feature calls privileged capabilities through its feature API.
- Only `platform/` imports `@tauri-apps/api`.
- Translatable UI text comes from the typed catalog.
- State stays local until multiple independent consumers share the same lifecycle.
- A global state library is introduced only when connection sessions, tabs, and background tasks require it.

## Rust Boundaries

```text
src-tauri/src/
├── commands/      Tauri commands and response shaping
├── credentials.rs  Operating-system credential adapter
├── database/
│   ├── connection.rs  PostgreSQL and TLS connection setup
│   ├── session.rs     Server sessions and per-database clients
│   └── metadata.rs    Read-only PostgreSQL catalog queries
├── error.rs       Stable errors safe to return to the UI
├── profiles.rs    Versioned connection-profile repository
└── lib.rs         Application composition and command registration
```

The command boundary converts internal failures into stable codes such as `authentication_failed`, `session_not_found`, and `metadata_error`. Driver errors remain technical details and are not the primary UI contract.

## Connection and Session Lifecycle

1. React validates the connection form. Rust stores the non-secret profile in
   SQLite and the password in the operating-system credential store.
2. `test_connection_profile` tests unsaved form changes and resolves an existing
   password from the credential store when the edit form leaves it blank.
3. `connect_saved_database` resolves the password in Rust, opens the initial
   client, and registers a server session.
4. React receives only an opaque session ID and tracks `disconnected`,
   `connecting`, `connected`, `busy`, `reconnecting`, `disconnecting`, and
   `error` states. Application startup restores profiles but never sessions.
5. Expanding another database asks the registry for a client. The registry
   reuses an existing client or creates one from the in-memory session settings.
6. `check_database_session` executes a real health query. Explicit disconnect
   removes every database client owned by the session.
7. Safe reconnect opens and registers the replacement before removing the old
   session. It never replays the operation that detected the failure.

Profiles survive application restarts; PostgreSQL sessions do not. Query
ownership and cancellation will continue to extend the registry boundary rather
than adding mutable session state to command modules.

## Lazy Metadata Navigation

Metadata is loaded by level:

1. Expanding a server loads databases, login/group roles, and tablespaces.
2. Expanding a database establishes its client if necessary and loads collection counts.
3. Expanding a database collection loads its items.
4. Expanding a Schema loads common Schema objects.

Each node owns `idle`, `loading`, `success`, and `error` states. Loaded data remains cached while the component exists. This avoids fetching an entire server catalog at connection time and provides a clear retry boundary.

## SSL Semantics

| Plume mode | PostgreSQL negotiation | Certificate validation | Hostname validation |
|---|---|---|---|
| `disable` | Plain only | No | No |
| `prefer` | Prefer TLS, allow plain fallback | No | No |
| `require` | TLS required | No | No |
| `verify-ca` | TLS required | Yes | No |
| `verify-full` | TLS required | Yes | Yes |

`verify-ca` and `verify-full` require a PEM root-certificate path. Any TLS
mode can also use a PEM client-certificate chain and its matching, unencrypted
PKCS#8 PEM private key. The two client paths must be supplied together. React,
the Rust profile repository, and the connection service enforce these rules
independently.

The command boundary classifies missing or unreadable certificate files,
invalid certificate material, hostname mismatches, and other TLS handshake
failures with separate stable error codes. Neither certificate contents nor
private-key contents are serialized into profile storage or logs.

## Security and Privacy Invariants

- The UI never opens raw PostgreSQL sockets.
- Passwords, private-key contents, and credential-bearing URLs must not appear in logs.
- The frontend receives an opaque session ID instead of retained credentials.
- Metadata queries are parameterized where user-provided identifiers are involved.
- Browser-only development must fail privileged operations explicitly; it must not fake successful database behavior.
- Saved passwords use macOS Keychain or Windows Credential Manager and never
  enter SQLite or serialized profile responses.

## Testing Strategy

- **Type and lint checks:** TypeScript strict mode, ESLint, rustfmt, and Clippy with warnings denied.
- **Current automated tests:** frontend validation, transformations, grouping, and tree interactions, plus Rust error, connection, metadata, and session unit tests.
- **PostgreSQL integration tests:** real connection, cross-database session, and catalog queries against disposable `plume` and `plume_secondary` databases. A second TLS-enabled service verifies plain fallback, encrypted negotiation, CA and hostname validation, and client-certificate authentication. Schema fixtures clean themselves up.
- **Planned end-to-end tests:** the ten acceptance scenarios in the product requirements.

The standard local gates are:

```bash
npm run check
npm run build
cd src-tauri
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

The repository-level `npm run check:all` command runs the complete local gate.
Use `npm run postgres:up`, `npm run test:postgres`, and `npm run postgres:down`
for the isolated database suite. CI additionally builds unsigned macOS and
Windows bundles and runs the suite against PostgreSQL 14, 16, and 18.

## Current Limitations

- PostgreSQL sessions are memory-only and reconnection is always explicit.
- SSH Tunnel is not implemented; the SSL portion of `P0-A12` and `P0-C07` is implemented and covered by the PostgreSQL 14/16/18 CI matrix.
- Query execution, cancellation, result streaming, and transaction ownership are not implemented.
- Data browsing, editing, export, and object actions are not implemented.
- Linux packaging is not part of the first release target.

These limitations are product backlog items, not reasons to bypass the boundaries described above.
