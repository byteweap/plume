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
│   ├── ssh.rs         SSH authentication, verification, and forwarding
│   ├── session.rs     Server sessions and per-database clients
│   ├── query.rs       Query protocol and active-query ownership
│   └── metadata.rs    Read-only PostgreSQL catalog queries
├── error.rs       Stable errors safe to return to the UI
├── profiles.rs    Versioned connection-profile repository
└── lib.rs         Application composition and command registration
```

The command boundary converts internal failures into stable codes such as `authentication_failed`, `session_not_found`, and `metadata_error`. Driver errors remain technical details and are not the primary UI contract.

## Connection and Session Lifecycle

1. React validates the connection form. Rust stores the non-secret profile in
   SQLite and database/SSH secrets in the operating-system credential store.
2. `test_connection_profile` tests unsaved form changes and resolves an existing
   password from the credential store when the edit form leaves it blank.
3. `connect_saved_database` resolves secrets in Rust, starts the optional SSH
   tunnel, opens the initial client, and registers a server session.
4. React receives only an opaque session ID and tracks `disconnected`,
   `connecting`, `connected`, `busy`, `reconnecting`, `disconnecting`, and
   `error` states. Application startup restores profiles but never sessions.
5. Expanding another database asks the registry for a client. The registry
   reuses an existing client or creates one from the in-memory session settings.
6. `check_database_session` checks the optional tunnel and executes a real
   PostgreSQL health query. Explicit disconnect closes the tunnel and removes
   every database client owned by the session.
7. Safe reconnect opens and registers the replacement before removing the old
   session. It never replays the operation that detected the failure.

Profiles survive application restarts; PostgreSQL sessions do not. The frontend
creates an opaque query ID before execution, and the Rust active-query registry
binds it to a session, database, PostgreSQL cancel token, and resolved transport
settings until the command succeeds or fails. Cancellation requests must match
that ownership; duplicate requests share one in-flight cancellation attempt.

## Query Execution Boundary

The query workspace sends only the plain SQL resolved by the statement-boundary
module, a query ID, a session ID, and a database. Rust uses PostgreSQL's Simple
Query protocol, so a current target can contain a PostgreSQL function body and
the all-document target remains compatible with multiple statements. Responses
preserve statement framing, a zero-based statement index, completion status,
column names and metadata (PostgreSQL type OID, type name, schema, and category),
text-form values, nulls, actual row counts, retained row counts, and affected-row
counts. Row data is returned in fixed 256-row batches with a zero-based offset.
Each execution carries a user-selected shared retention budget between 100 and
10,000 rows, defaulting to 10,000. Excess rows and later statement results are
drained from the protocol stream and marked truncated without rewriting SQL.
A failed Describe (for example,
because the request contains multiple statements) returns an explicit `unknown`
type category instead of guessing.
The response echoes the query ID, and the frontend accepts it only for the
matching request that is still active in that tab. A successful cancel-packet
send moves the UI only into a waiting state. Cancellation becomes final only
when that same execution returns PostgreSQL SQLSTATE `57014`; a query that wins
the race and completes normally remains succeeded.

The frontend records user-perceived elapsed time from dispatch through the
terminal response. Active queries refresh their elapsed display without changing
stored execution state; terminal states freeze the duration. Successful
multi-statement responses summarize returned rows, affected rows, and whether
any statement was truncated.

PostgreSQL query failures cross the command boundary as a user-facing message
plus structured diagnostics: SQLSTATE, severity, and optional detail, hint, and
original-query position. Internal-query positions are not exposed. PostgreSQL's
one-based Unicode character position is mapped to CodeMirror's UTF-16 offsets
within the executed selection, statement, or document. The editor selects and
reveals the failing character only while that executed SQL still matches the
current document; the notice separately presents copyable technical details.

Execution results live only for the query-tab lifecycle and are not persisted in
drafts. P0-F01 defines the result protocol, and P0-F02 renders its retained
batches through a lazily loaded React Data Grid adapter with fixed row heights,
row and column virtualization, resizable columns, keyboard navigation,
rectangular selection, typed value presentation, and tab-separated copy. The
query toolbar selects the request-scoped result budget and the result panel
explicitly reports when that budget is reached. Row numbers select complete
rows, while copy actions serialize the current cell or row selection as
tab-separated text with optional column names.

CSV and JSON export operate on either all retained rows in the active statement
or the current rectangular selection. The frontend sends typed task requests
with the selected columns and raw values; CSV additionally carries the header,
delimiter, and encoding preferences. Rust owns the native save dialogs,
validates the retained-data bounds, quotes CSV fields, and writes UTF-8, UTF-8
with BOM, or UTF-16LE CSV. JSON is streamed as an indented array of objects,
preserves nulls, and deterministically disambiguates duplicate column names so
values are not overwritten. Format-specific progress events are scoped by UUID,
and a shared export registry lets a separate command request cancellation
without blocking the UI. Both formats write to a uniquely named temporary file
in the target directory. Completed output is flushed, synchronized, and
atomically persisted over the selected path; cancellation or any write failure
drops the temporary file and leaves an existing target untouched.

Opening a regular table from the object tree creates or activates a dedicated
table-data tab scoped by profile, database, Schema, and table. The initial load
uses the existing cancellable query protocol and virtualized result grid, but
generates a read-only `SELECT *` with quoted PostgreSQL identifiers and a
bounded `LIMIT`/`OFFSET`. The initial page size is 200. Each page requests one
additional probe row, which is removed before rendering, to determine whether
the next-page action is available without running a full count or draining the
result set. Users can move backward and forward or select 50, 100, 200, or 500
rows per page; changing the size returns to page one. Result headers control
sorting: a normal activation replaces the current order, while Ctrl/Cmd adds or
changes a secondary key through React Data Grid's native multi-sort behavior.
Sorts are persisted in the table-data tab, shown with priority and direction,
reset pagination to page one, and compile to PostgreSQL `ORDER BY` ordinals so
duplicate or unusual column names remain unambiguous. With no sort, the toolbar
warns that rows may move between page requests. Editability is layered onto
this tab model by the subsequent P0-G tasks.

The table-data filter band composes multiple AND conditions for equality,
inequality, literal substring containment, greater/less comparisons (including
inclusive variants), NULL, and NOT NULL. Applied filters persist in the tab and
reset pagination. Filter values never enter the SQL string: the frontend emits
text-typed placeholders plus the original PostgreSQL column metadata, and Rust
uses the extended query protocol to bind each value. Comparison placeholders
are cast from text to the server-reported column type, while selected values are
projected as text for generic transport and restored to their original result
metadata before rendering. Parameter counts, text casts, and result-column
shape are validated by the local core.

## SQL Completion Boundary

CodeMirror combines local PostgreSQL keyword and common-function completions
with an asynchronous database catalog source. Rust returns only non-system
Schemas for which the current user has `USAGE`, plus their tables, foreign
tables, views, materialized views, and visible columns. The frontend caches one
in-flight or completed catalog request per session and database; failed loads
are removed so a later completion can retry.

Catalog loading never blocks editor transactions. Static candidates can appear
while the database request is pending, and CodeMirror resolves qualified names
and table aliases against the returned schema tree. Before applying an
asynchronous response, the adapter verifies that the editor still targets the
same session and database, preventing a reconnect or tab switch from exposing
stale candidates.

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

## SSH Tunnel Semantics

- Password and encrypted or unencrypted private-key authentication are supported.
- One optional jump host performs its own SSH handshake, host-key verification,
  and authentication before opening the target SSH connection.
- Every endpoint must match the configured `known_hosts` file. When no path is
  supplied, the platform default `~/.ssh/known_hosts` is used. Unknown and
  changed host keys are rejected with distinct stable errors.
- The tunnel binds a random loopback port. PostgreSQL connects to that address,
  while retaining the original database host as its TLS server name. Therefore
  `verify-full` continues to validate the database certificate through SSH.
- A server session owns one tunnel and reuses its local endpoint for additional
  database clients. Health checks ping both SSH hops, and test/disconnect/drop
  paths close or abort the tunnel listener.

SSH passwords and private-key passphrases use independent credential-store
references. Profile responses and SQLite contain only endpoint parameters and
file paths, never those secrets or private-key contents.

## Security and Privacy Invariants

- The UI never opens raw PostgreSQL sockets.
- Passwords, private-key contents, and credential-bearing URLs must not appear in logs.
- The frontend receives an opaque session ID instead of retained credentials.
- Metadata queries are parameterized where user-provided identifiers are involved.
- Browser-only development must fail privileged operations explicitly; it must not fake successful database behavior.
- Saved database/SSH passwords and SSH key passphrases use macOS Keychain or
  Windows Credential Manager and never enter SQLite or serialized profile responses.

## Testing Strategy

- **Type and lint checks:** TypeScript strict mode, ESLint, rustfmt, and Clippy with warnings denied.
- **Current automated tests:** frontend validation, transformations, grouping, and tree interactions, plus Rust error, connection, metadata, and session unit tests.
- **PostgreSQL integration tests:** real connection, cross-database session, and catalog queries against disposable `plume` and `plume_secondary` databases. A second TLS-enabled service verifies plain fallback, encrypted negotiation, CA and hostname validation, and client-certificate authentication. Two OpenSSH services verify password and encrypted-key authentication, one-hop jump hosts, strict host keys, tunnel health/lifecycle, and SSH plus `verify-full`. Schema fixtures clean themselves up.
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
- Incrementally consumable result streaming and transaction ownership are not implemented.
- Data editing and object actions are not implemented.
- Linux packaging is not part of the first release target.

These limitations are product backlog items, not reasons to bypass the boundaries described above.
