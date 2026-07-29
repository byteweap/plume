import type {
  QueryStatementResult,
  QueryValue,
} from "../query-execution/queryExecution";

export interface QueryGridRow {
  rowIndex: number;
  values: QueryValue[];
}

export interface GridPosition {
  columnIndex: number;
  rowIndex: number;
}

export interface GridSelection {
  anchor: GridPosition;
  focus: GridPosition;
}

export interface GridSelectionBounds {
  firstColumnIndex: number;
  lastColumnIndex: number;
  firstRowIndex: number;
  lastRowIndex: number;
}

export function buildQueryGridRows(
  statement: QueryStatementResult,
): QueryGridRow[] {
  return statement.batches.flatMap((batch) =>
    batch.rows.map((values, index) => ({
      rowIndex: batch.offset + index,
      values,
    })),
  );
}

export function getSelectionBounds(
  selection: GridSelection,
): GridSelectionBounds {
  return {
    firstColumnIndex: Math.min(
      selection.anchor.columnIndex,
      selection.focus.columnIndex,
    ),
    lastColumnIndex: Math.max(
      selection.anchor.columnIndex,
      selection.focus.columnIndex,
    ),
    firstRowIndex: Math.min(
      selection.anchor.rowIndex,
      selection.focus.rowIndex,
    ),
    lastRowIndex: Math.max(
      selection.anchor.rowIndex,
      selection.focus.rowIndex,
    ),
  };
}

export function isPositionSelected(
  selection: GridSelection | undefined,
  position: GridPosition,
): boolean {
  if (!selection) return false;

  const bounds = getSelectionBounds(selection);
  return (
    position.columnIndex >= bounds.firstColumnIndex &&
    position.columnIndex <= bounds.lastColumnIndex &&
    position.rowIndex >= bounds.firstRowIndex &&
    position.rowIndex <= bounds.lastRowIndex
  );
}

export function serializeGridSelection(
  rows: readonly QueryGridRow[],
  selection: GridSelection,
): string {
  const bounds = getSelectionBounds(selection);
  const rowsByIndex = new Map(rows.map((row) => [row.rowIndex, row]));
  const lines: string[] = [];

  for (
    let rowIndex = bounds.firstRowIndex;
    rowIndex <= bounds.lastRowIndex;
    rowIndex += 1
  ) {
    const row = rowsByIndex.get(rowIndex);
    if (!row) continue;

    const values: string[] = [];
    for (
      let columnIndex = bounds.firstColumnIndex;
      columnIndex <= bounds.lastColumnIndex;
      columnIndex += 1
    ) {
      values.push(
        columnIndex === -1
          ? String(row.rowIndex + 1)
          : formatQueryValue(row.values[columnIndex]),
      );
    }
    lines.push(values.join("\t"));
  }

  return lines.join("\n");
}

export function formatQueryValue(value: QueryValue | undefined): string {
  return value ?? "NULL";
}
