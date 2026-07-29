# ADR 0003: SQL Editor and Data Grid

- Status: Accepted
- Scope: SQL editor and query-result grid
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
target resolution, error revealing, completion-context updates, label, focus,
and lifecycle operations. Execution targets contain only the selected,
current-statement, or full-document SQL string, its plain numeric range, and
its source. Completion receives only an opaque session ID, database, and
optional default Schema; database catalog loading remains asynchronous and
cached outside editor state. CodeMirror `EditorState`, `EditorView`,
syntax-tree, and transaction types must not enter workspace tabs, draft
persistence, or query execution protocols. This boundary resolution does not
itself execute SQL.

Use React Data Grid 7.0.0-beta.57 for P0-F02. This is the newest release whose
peer range supports the application's React 19.1 baseline; the exact version is
pinned until a stable React 19-compatible release is available. Load the result
panel only after a query succeeds so the startup bundle does not absorb the grid.

The adapter in `src/features/query-results` converts retained protocol batches
to lightweight indexed rows, adds a frozen row-number column, owns controlled
column widths, and layers rectangular selection over the grid's active-cell
model. Query-result protocol types and workspace tabs do not expose React Data
Grid types. Fixed row heights keep vertical positions deterministic. Values are
copied as tab-separated text; richer type rendering and row/header copy remain
P0-F03 and P0-F05 work.

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

The repeatable data-grid spike is `scripts/benchmark-data-grid.mjs` and runs
with `npm run benchmark:grid`. It mounts 10,000 rows by 40 columns in a
1,000-by-600 viewport, scrolls to the final row, and fails when mount exceeds
1,000 ms, scrolling exceeds 100 ms, heap growth exceeds 128 MB, rendered DOM
rows or cells exceed their bounded thresholds, the final row is not reached,
or resizable columns are unavailable.

On the same macOS ARM64 development machine, the recorded result was:

| Measurement | Result | Gate |
|---|---:|---:|
| Mount | 58.13 ms | <= 1,000 ms |
| Scroll to final row | 9.68 ms | <= 100 ms |
| Heap delta | 25.04 MB | <= 128 MB |
| Initial rendered rows / cells | 25 / 260 | <= 40 / 600 |
| Final rendered rows / cells | 4 / 50 | <= 40 / 600 |
| Final row and resize capability | Verified | Required |

Production bundle measurements against the immediately preceding revision are:

| Asset | Before | After | Delta |
|---|---:|---:|---:|
| Startup JavaScript | 351.81 kB | 354.52 kB | +2.71 kB |
| Startup JavaScript gzip | 104.29 kB | 105.09 kB | +0.80 kB |
| Startup CSS | 21.16 kB | 22.21 kB | +1.05 kB |
| Lazy result-grid JavaScript | - | 42.03 kB | +42.03 kB |
| Lazy result-grid JavaScript gzip | - | 15.26 kB | +15.26 kB |
| Lazy result-grid CSS | - | 11.42 kB | +11.42 kB |
| Lazy result-grid CSS gzip | - | 2.97 kB | +2.97 kB |

Component tests cover multi-statement switching, keyboard tab navigation,
rectangular selection serialization, native clipboard integration, and the
keyboard-accessible editor/result splitter. React Data Grid and its sole runtime
dependency, `clsx`, use the MIT license.

CI executes both repeatable benchmarks, component tests, frontend checks, and
unsigned desktop builds on macOS and Windows. This provides a repeatable Windows
gate but does not replace the release candidate's manual WebView visual and
keyboard smoke tests on both platforms. Editor diagnostics, asynchronous
completion, query execution, and grid interactions now have automated coverage.
