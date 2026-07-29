# ADR 0003: SQL Editor and Data Grid

- Status: Proposed
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

CodeMirror 6 and React Data Grid are the current lightweight recommendation.
The ADR remains proposed until a representative spike measures cold-start and
bundle impact, memory use with large batches, scrolling, selection/copy,
editing control, keyboard behavior, and light/dark rendering on both platforms.

## Acceptance Evidence

Record the spike source, dataset, test hardware, measured results, license, and
known limitations. The accepted decision must also define the abstraction
boundary so stored drafts and query/result protocols do not depend on library
specific types.
