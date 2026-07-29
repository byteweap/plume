# ADR 0001: Desktop Runtime and Module Boundaries

- Status: Accepted
- Date: 2026-07-29
- Owners: Plume maintainers

## Context

Plume needs direct PostgreSQL access, operating-system credential storage, file
exports, and native desktop packaging while keeping the user interface easy to
iterate. Database credentials and privileged operations must not spread into
the web UI.

## Decision

- Use Tauri 2 as the macOS and Windows desktop runtime.
- Use React and TypeScript for presentation and local interaction state.
- Use Rust for PostgreSQL sessions, TLS, credentials, file access, and other
  privileged capabilities.
- Use `tokio-postgres` as the PostgreSQL protocol driver. Database behavior is
  implemented behind Rust service modules rather than directly in commands.
- React feature modules call typed feature APIs. Only `src/platform/` imports
  Tauri APIs.
- Tauri commands form a narrow, serializable IPC boundary with stable command
  IDs, request/response types, and safe error codes.
- Long-running work will extend this boundary with task IDs, progress events,
  and explicit cancellation rather than exposing generic shell, SQL, or file
  capabilities.

## Consequences

- Browser development can render the UI but must reject privileged operations.
- Frontend and Rust types must evolve together and be covered by contract tests.
- Passwords may appear in a short-lived connection request but never return to
  React after a session is established.
- PostgreSQL integration tests are required for behavior that mocks cannot
  validate.
