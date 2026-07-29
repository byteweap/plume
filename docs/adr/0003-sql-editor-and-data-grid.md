# ADR 0003: SQL Editor and Data Grid

- Status: Accepted
- Scope: SQL editor only; grid decision remains proposed
- Date: 2026-07-29
- Decision gate: before P0-E01 or P0-F02 implementation

## Context

The SQL editor and result grid dominate bundle size, keyboard behavior, large
result performance, accessibility, and future maintenance cost. Both choices
must work inside Tauri's webview on macOS and Windows.

## Required Capabilities

The editor must provide PostgreSQL syntax highlighting, line numbers, bracket
matching, indentation, find/replace, selection-aware execution, asynchronous
completion, diagnostics, and stable text/selection APIs.

The grid must provide row and column virtualization, stable scrolling, column
resizing, keyboard navigation, range selection, copy, accessible semantics,
custom type rendering, and controlled editing without loading the full result
set into memory.

## Candidates

- Editor: CodeMirror 6 or Monaco Editor.
- Grid: React Data Grid, AG Grid Community, or TanStack Table plus TanStack
  Virtual.

CodeMirror 6 and React Data Grid were the initial lightweight recommendation.
The editor spike is complete. The grid still requires a representative spike
covering large batches, scrolling, selection/copy, editing control, keyboard
behavior, and light/dark rendering before P0-F02 begins.

## Decision

Use CodeMirror 6 with the PostgreSQL dialect for P0-E01. Load the editor only
when a query tab is opened so the application startup bundle does not absorb
the editor and parser cost.

Business state stores SQL as plain strings. The adapter in
`src/features/sql-editor` exposes value, selection replacement, execution
target resolution, label, focus, and lifecycle operations. Execution targets
contain only the selected, current-statement, or full-document SQL string,
its plain numeric range, and its source. CodeMirror `EditorState`,
`EditorView`, syntax-tree, and transaction types must not enter workspace tabs,
draft persistence, or future query execution protocols. This boundary
resolution does not itself execute SQL.

The data-grid library is not selected by this decision.

## Acceptance Evidence

The repeatable spike is `scripts/benchmark-sql-editor.mjs` and runs with
`npm run benchmark:editor`. It mounts 10,000 PostgreSQL statements (508,893
characters), replaces and selects text, and fails when mount exceeds 1,000 ms,
an update exceeds 100 ms, memory growth exceeds 128 MB, or the selection API
returns an incorrect value.

On the 2026-07-29 macOS ARM64 development machine (Darwin hardware identifier
`T8103`), the recorded result was:

| Measurement | Result | Gate |
|---|---:|---:|
| Mount | 111.92 ms | <= 1,000 ms |
| Document update | 13.42 ms | <= 100 ms |
| Heap delta | 20.86 MB | <= 128 MB |
| Selected text | `SELECT` | `SELECT` |

Production bundle measurements from the same revision are:

| Asset | Before | After | Delta |
|---|---:|---:|---:|
| Startup JavaScript | 334,895 B | 337,300 B | +2,405 B |
| Startup JavaScript gzip | 99.25 kB | 100.13 kB | +0.88 kB |
| Lazy editor JavaScript | - | 430,920 B | +430,920 B |
| Total CSS | 18,502 B | 20,470 B | +1,968 B |
| `dist` directory | 356 kB | 780 kB | +424 kB |

CodeMirror, its PostgreSQL language package, and the underlying Lezer parser
packages use the MIT license. The runtime dependency inventory remains pinned
by `package-lock.json` and is summarized in `THIRD_PARTY_NOTICES.md`.

CI executes the same benchmark, component tests, frontend checks, and unsigned
desktop build on macOS and Windows. This provides a repeatable Windows gate but
does not replace the release candidate's manual Windows WebView2 visual and
keyboard smoke test. That smoke test, editor diagnostics, asynchronous
completion, query execution, and the separate data-grid decision remain
follow-up work.
