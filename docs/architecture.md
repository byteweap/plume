# Plume Architecture

[English](architecture.md) · [简体中文](architecture.zh-CN.md)

This document records Plume's current architectural boundaries. It describes implemented behavior, not the complete target product. See the [product requirements](产品需求文档.md) and [development task breakdown](开发任务分解.md) for planned work.

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
├── database/
│   ├── connection.rs  PostgreSQL and TLS connection setup
│   ├── session.rs     Server sessions and per-database clients
│   └── metadata.rs    Read-only PostgreSQL catalog queries
├── error.rs       Stable errors safe to return to the UI
└── lib.rs         Application composition and command registration
```

The command boundary converts internal failures into stable codes such as `authentication_failed`, `session_not_found`, and `metadata_error`. Driver errors remain technical details and are not the primary UI contract.

## Connection and Session Lifecycle

1. React validates the connection form and sends a short-lived request to Rust.
2. `test_connection` opens a client, verifies the server, returns metadata, and closes it.
3. `connect_database` opens the initial client and registers a server session.
4. React receives an opaque session ID. The password does not return to React.
5. Expanding another database asks the registry for a client. The registry reuses an existing client or creates one with the server session settings.
6. Sessions and profiles currently live in memory and disappear when Plume exits.

The current registry is intentionally small. Pooling, explicit disconnect, reconnection, query ownership, and cancellation will extend this boundary rather than adding global mutable state to command modules.

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

`verify-ca` and `verify-full` require a PEM root-certificate path. The React validation schema and Rust connection service enforce this independently.

## Security and Privacy Invariants

- The UI never opens raw PostgreSQL sockets.
- Passwords, private-key contents, and credential-bearing URLs must not appear in logs.
- The frontend receives an opaque session ID instead of retained credentials.
- Metadata queries are parameterized where user-provided identifiers are involved.
- Browser-only development must fail privileged operations explicitly; it must not fake successful database behavior.
- A future persistent credential implementation must use the operating-system credential facility.

## Testing Strategy

- **Type and lint checks:** TypeScript strict mode, ESLint, rustfmt, and Clippy with warnings denied.
- **Current automated tests:** frontend validation, transformations, grouping, and tree interactions, plus Rust error, connection, metadata, and session unit tests.
- **Planned PostgreSQL integration tests:** real catalog queries against an isolated test Schema; destructive fixtures must clean themselves up.
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

## Current Limitations

- Connection profiles and sessions are memory-only.
- System credential persistence is not implemented.
- SSH Tunnel is not implemented.
- Query execution, cancellation, result streaming, and transaction ownership are not implemented.
- Data browsing, editing, export, and object actions are not implemented.
- Linux packaging is not part of the first release target.

These limitations are product backlog items, not reasons to bypass the boundaries described above.
