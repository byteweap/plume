import type {
  QueryColumn,
  QueryStatementResult,
  QueryValue,
} from "../query-execution/queryExecution";
import { presentQueryResultValue } from "./queryResultValue";

export interface QueryGridRow {
  rowIndex: number;
  rowKey?: string;
  insertedId?: string;
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
  columns?: readonly QueryColumn[],
  options: { includeHeaders?: boolean } = {},
): string {
  const bounds = getSelectionBounds(selection);
  const rowsByIndex = new Map(rows.map((row) => [row.rowIndex, row]));
  const lines: string[] = [];

  if (options.includeHeaders) {
    const headers: string[] = [];
    for (
      let columnIndex = bounds.firstColumnIndex;
      columnIndex <= bounds.lastColumnIndex;
      columnIndex += 1
    ) {
      headers.push(
        columnIndex === -1 ? "#" : (columns?.[columnIndex]?.name ?? ""),
      );
    }
    lines.push(headers.join("\t"));
  }

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
          ? row.insertedId
            ? "+"
            : String(row.rowIndex + 1)
          : presentQueryResultValue(
              row.values[columnIndex],
              columns?.[columnIndex],
            ).copyText,
      );
    }
    lines.push(values.join("\t"));
  }

  return lines.join("\n");
}
