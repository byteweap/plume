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

Every saved profile classifies its target as development, test, staging, or
production and carries a user-selected connection accent. The object tree uses
the compact semantic environment dot. Once a profile owns the active workspace,
an environment badge remains visible in the workspace header and status bar,
including offline and error states. The badge combines a fixed semantic tone
for the environment with the profile accent, so safety context is not inferred
from a connection name or transient session state.

Profiles survive application restarts; PostgreSQL sessions do not. The frontend
creates an opaque query ID before execution, and the Rust active-query registry
binds it to a session, database, PostgreSQL cancel token, and resolved transport
settings until the command succeeds or fails. Cancellation requests must match
that ownership; duplicate requests share one in-flight cancellation attempt.
Every query ID and structured table-data commit ID must also be atomically claimed
by the process-wide replay guard before any database call. Claims are never released,
including after connection loss or an ambiguous failure, so IPC retries, session
replacement, and recovery cannot resubmit an old operation. A duplicate receives
`operation_replay_blocked`; only a new explicit user action creates a new ID.

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

Before dispatch, the frontend safety layer parses that exact execution target
with CodeMirror's PostgreSQL grammar. It walks statement and writable-CTE syntax
nodes and reports structured risks for `DROP`, `TRUNCATE`, and `DELETE` or
`UPDATE` statements without their own top-level `WHERE` clause. Each report
includes the risk type, severity, category, statement and operation offsets, a
bounded statement summary, and identifiable target objects. Detection reads
only syntax-tree keyword nodes, so comments, strings, quoted identifiers,
dollar-quoted function bodies, and `ALTER TABLE ... DROP COLUMN` do not become
executable operations by textual coincidence. This module only classifies SQL;
the query workspace intercepts classified user SQL before allocating a query ID
or calling the backend. Its modal lists the connection name, host and port,
database, effective Schema, environment, risk type, target, and bounded statement
summary. Cancel has no execution side effect. Confirmation dispatches the frozen
execution target only if the tab, SQL text, profile, session, and database still
match the displayed context; otherwise the stale request is discarded. Internal
table-data reads remain on their separate structured execution path.

Each saved profile persists an `all`, `critical-only`, or `off` SQL-risk prompt
policy. Development, test, and staging profiles may select any level; production
profiles may select `all` or `critical-only` but can never disable every prompt.
The React form and Rust profile-validation boundary both enforce that invariant,
and execution fails safe by treating unexpected production `off` data as
`critical-only`. Existing databases migrate to `all`, and a missing policy from
an older caller also defaults to `all`.

Production profiles add a second confirmation factor for critical risks such as
`DROP` and `TRUNCATE`: the execute action stays disabled until the operator types
the current database name exactly. The requirement is based on the frozen
execution context shown in the modal, is case-sensitive, and does not add typed
verification to non-critical `DELETE` or `UPDATE` warnings.

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
this tab model by querying PostgreSQL's index catalogs once per table and
session. A table is editable only when the catalog exposes a valid, ready,
immediate, non-partial, non-expression primary or unique index whose key
columns are all `NOT NULL`; primary keys are preferred. The selected key name,
kind, and ordered columns are retained for later change tracking. Missing or
unavailable metadata fails closed, and the table header explains the read-only
reason instead of allowing ambiguous row targeting. A new session always
refreshes the decision, and stale responses from an earlier session are
ignored.

Pending table edits are a serializable frontend-only change set owned by the
table-data tab. Existing-row updates retain the original row locator, page and
row position, and both the original and staged value for every changed cell.
Inserted rows begin with an explicit `DEFAULT` state per column, which remains
distinct from `NULL` and a string value (including the empty string). Deleted
rows retain their locator and complete original row snapshot; staging a delete
removes earlier cell updates for that row. The immutable model coalesces repeat
edits and removes a cell change when it returns to its original value. It is
not a database command: paging, sorting, filtering, and query completion leave
the change set intact, and the workspace reducer accepts new staged changes
only while reliable-key editability is active.

Editable result columns use React Data Grid's native edit lifecycle, but a
Plume editor owns the staged value. Its explicit mode selector distinguishes a
text value from `NULL` and `DEFAULT`; the text mode preserves raw PostgreSQL
representations without JavaScript coercion, so an empty string, numeric text,
JSON, dates, arrays, and other server-typed values remain distinct until the
transaction command performs the PostgreSQL cast. Committing the editor only
updates the local change set. Pending cells render the staged value with a
visible marker and expose both original and staged presentations in their
tooltip. Read-only tables and result sets missing any selected key column do
not receive an editor.

The add-row action is enabled only when that editable grid has loaded its
columns. It creates a local UUID scoped to the current page and appends a
virtual row whose cells all begin as `DEFAULT`; the standard editor can change
each cell to explicit `NULL` or text without substituting an empty string.
Inserted rows never enter the query protocol. Their row-number cell provides a
discard icon that removes the local insert, and navigating to another page
hides rather than duplicates page-scoped inserts while preserving them in the
tab change set.

Existing rows expose a delete icon in the row-number column. Activating it
stages a full original-row snapshot and its reliable locator, removes any
earlier cell updates for that row, disables further editing, and renders the
row with a deletion treatment; the same control restores it. A unified,
collapsible preview band remains visible before commit and summarizes inserted,
updated, and deleted rows. It preserves `DEFAULT`, `NULL`, and text distinctions,
shows original-to-staged cell values, and lists every ordered delete locator,
including composite keys. Every preview item carries its origin page and cell;
activating it changes pages when needed, waits for that page to load, then uses
the grid handle to scroll to and select the target cell. No write statement is
issued by these interactions.

Committing the preview converts only the write-relevant fields into a structured
request; local row IDs, page positions, and original display snapshots do not
cross the command boundary. Rust validates the reliable key shape, column set,
and explicit value modes, then opens a dedicated client from the active session's
database settings so concurrent reads on the shared client cannot enter the
write transaction. Schema, table, column, and type names are quoted as PostgreSQL
identifiers. Text values are bound parameters and explicitly cast from `text` to
the catalog-reported type; `NULL` and `DEFAULT` remain SQL states rather than
sentinel strings. Deletes, updates, and inserts execute in one transaction, and
every operation must affect exactly one row. Any validation, conversion,
constraint, or row-location failure explicitly rolls the transaction back and
keeps the complete frontend change set available for correction and retry.
Success commits once, clears the change set, and reloads the current page.
The adjacent discard-all action atomically replaces the staged model with an
empty change set. Because the grid derives pending values, inserted virtual
rows, and delete treatments exclusively from that model, the current page
immediately returns to its pre-edit query snapshot without issuing a query or
database command; any previous commit error is cleared at the same time.

Pending table changes also participate in a centralized leave guard. Closing a
table tab protects that tab, disconnecting or deleting a profile protects every
changed table tab owned by that profile, and a native window-close request
protects all changed table tabs in the workspace. The modal lists each affected
table and its insert/update/delete counts, then offers commit-and-continue,
discard-and-continue, or cancel. Commits run through the same transactional
command one table at a time and stop on the first error; the failed and any
remaining change sets stay open. Discard clears only the guarded sets before
the original close, disconnect, delete, or exit continues. Browser unload also
sets the platform's standard unsaved-work guard when custom desktop actions are
not available.

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

## Local Data Model

The shared SQLite store uses `PRAGMA user_version` migrations. Version 5 keeps
the existing connection-profile and query-draft tables and adds `query_history`,
`workspace_snapshots`, `workspace_tabs`, `local_tags` with their assignments,
and key/value `local_settings`. History rows store execution metadata and SQL,
while snapshots store tab metadata and unsaved SQL only; result sets, passwords,
private keys, and active PostgreSQL sessions never enter this database. The
migration is transactional, enables foreign keys, and rejects a database newer
than the running application rather than guessing at its shape.
User SQL executions append one history row after each terminal response, storing
the connection profile ID, database/schema, exact execution target, elapsed
milliseconds, outcome (`succeeded`, `failed`, or `cancelled`), and timestamp.
Structured table-data reads are excluded. A history write is best-effort and
never changes the database operation's user-visible result.
The history insert and retention cleanup share one SQLite transaction. The
default policy removes rows older than 90 days and, independently, rows beyond
the newest 10,000 entries; either bound is sufficient for deletion. The Rust
service accepts an explicit validated policy so a later settings surface can
change either limit without changing persistence semantics.
The current workspace snapshot is replaced atomically after local workspace
changes. Its explicit schema contains sidebar layout, ordered tab context, and
query SQL (including unsaved edits). It deliberately excludes execution state,
result rows, staged table edits, session identifiers, transactions, and
credentials. Persistence starts only after profiles and drafts initialize, so
an empty startup state cannot overwrite a recoverable snapshot.
Startup loads the snapshot and saved drafts only after the profile catalog is
available. Tabs for missing profiles are discarded; snapshot SQL wins over an
older draft, while drafts absent from the snapshot are appended. Every restored
table tab starts with empty rows, edits, editability, and execution state. The
active tab and layout may be restored, but no connection, SQL, write operation,
transaction, or replay-protection operation ID is recreated automatically.

The local-data command exposes four explicit, separately confirmed scopes:
`history` removes query history only; `drafts` removes query drafts, workspace
tabs, and snapshots; `cache` removes `cache.`-prefixed local settings and also
invalidates the in-process object-tree and SQL-completion catalogs; and `all`
removes those records, tags, settings, and every connection profile. A full
clear disconnects active database sessions before deleting database, SSH, and
jump-host secrets from the system credential store. It does not delete
user-selected certificate, private-key, or `known_hosts` files. The narrower
scopes never modify connection profiles or system credentials.

## Security and Privacy Invariants

- The UI never opens raw PostgreSQL sockets.
- Passwords, private-key contents, and credential-bearing URLs must not appear in logs.
- Rust diagnostics pass driver and library errors through one redaction boundary
  before writing them to stderr. The same boundary sanitizes command error messages,
  details, and hints before IPC serialization. It removes URI userinfo, secret-like
  key/value fields, authorization credentials, and PEM private-key blocks. Panic
  reporting includes source location only and suppresses the panic payload.
- The frontend receives an opaque session ID instead of retained credentials.
- Metadata queries are parameterized where user-provided identifiers are involved.
- Browser-only development must fail privileged operations explicitly; it must not fake successful database behavior.
- Saved database/SSH passwords and SSH key passphrases use macOS Keychain or
  Windows Credential Manager and never enter SQLite or serialized profile responses.

## Testing Strategy

- **Type and lint checks:** TypeScript strict mode, ESLint, rustfmt, and Clippy with warnings denied.
- **Current automated tests:** frontend validation, transformations, grouping, and tree interactions, plus Rust error, connection, metadata, and session unit tests.
- **Unit baseline:** `npm run test:unit-baseline` pins representative tests for PostgreSQL URL parsing, quoted identifiers, SQL execution boundaries, risk recognition, typed result-value presentation, and staged table-data changes. The baseline is included in `npm run check`.
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
