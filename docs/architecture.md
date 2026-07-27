# Architecture

## Goals

Plume's architecture optimizes for a small desktop footprint, predictable database behavior, and code that remains easy to extend as object browsing, query execution, editing, and SSH support are added.

The UI is not a privileged database client. Rust owns database connections, operating-system capabilities, cancellation, streaming, file access, and credential access. React owns presentation and short-lived interaction state.

## Dependency direction

```text
React component
  -> feature API
  -> typed platform adapter
  -> Tauri command
  -> database service
  -> PostgreSQL
```

Dependencies point inward toward feature and domain types. Database errors are converted to stable command errors at the Tauri boundary. Raw driver errors are never treated as the primary UI contract.

## Frontend boundaries

- `app/` composes the workspace and global providers.
- `features/<feature>/` contains a feature's types, validation, API, UI, and tests.
- `platform/` is the only place that imports privileged Tauri APIs.
- `shared/` contains small primitives with no product-domain knowledge.
- UI text comes from the typed catalog; components do not hard-code translatable interface labels.

State remains local until two or more independent consumers need the same lifecycle. A global state library should only be introduced when connection sessions, tabs, and background tasks demonstrate that need.

## Rust boundaries

- `commands/` validates the IPC boundary and maps internal errors.
- `database/` owns PostgreSQL configuration and protocol behavior.
- `error.rs` provides stable, serializable error codes without sensitive values.
- Passwords may be held only for the lifetime required to establish a connection and must never be logged.

Future connection pools and running queries will be owned by a dedicated application state service rather than global mutable values in command modules.

The current `ConnectionRegistry` is the application-state boundary for this development stage. It owns opaque in-memory PostgreSQL server sessions behind an asynchronous lock and creates per-database clients on demand. React receives a session ID, never a retained password. Server, database, collection, and Schema nodes load metadata on first expansion and cache it in component state until the node is removed.

## SSL behavior

| Plume mode | PostgreSQL negotiation | Certificate validation | Hostname validation |
|---|---|---|---|
| disable | Plain only | No | No |
| prefer | Prefer TLS, allow plain fallback | No | No |
| require | TLS required | No | No |
| verify-ca | TLS required | Yes | No |
| verify-full | TLS required | Yes | Yes |

`verify-ca` and `verify-full` require a PEM root certificate path. The configuration UI and Rust service enforce this independently.

## Testing strategy

- Unit tests cover validation, transformations, error contracts, identifier handling, and other deterministic logic.
- PostgreSQL integration tests will run against the supported version matrix and cover authentication, SSL, cancellation, metadata, and transactions.
- UI tests cover user-visible state transitions and keyboard behavior.
- End-to-end tests cover the ten acceptance scenarios in the product requirements.

## Current limitations

- Connection profiles and sessions are held in memory; system credential persistence is the next connection-management slice.
- SSH Tunnel is not implemented yet.
- Object navigation covers databases, roles, tablespaces, database-level PostgreSQL collections, and common Schema objects with lazy loading.
- SQL execution, data browsing, and editing remain upcoming P0 modules.
