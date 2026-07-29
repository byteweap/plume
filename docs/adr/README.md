# Architecture Decision Records

Architecture Decision Records (ADRs) capture choices that are expensive to
reverse or that establish boundaries shared by several modules.

## Status

- **Accepted:** the decision governs implementation until superseded.
- **Proposed:** the constraints and candidates are recorded, but validation is
  still required before a choice becomes binding.
- **Superseded:** a later ADR replaces the decision.

## Index

| ADR | Status | Decision |
|---|---|---|
| [0001](0001-desktop-runtime-and-boundaries.md) | Accepted | Desktop runtime and module boundaries |
| [0002](0002-local-storage-and-credentials.md) | Proposed | Local storage and operating-system credentials |
| [0003](0003-sql-editor-and-data-grid.md) | Proposed | SQL editor and virtualized data grid |

Proposed ADRs must be resolved before implementation crosses their decision
gate. A code change that alters an accepted architectural boundary must update
or supersede the corresponding ADR in the same change.
