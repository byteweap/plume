import type {
  QueryStatementResult,
  QueryValue,
} from "../query-execution/queryExecution";
import {
  buildQueryGridRows,
  getSelectionBounds,
  type GridSelection,
} from "./queryResultRows";

export type CsvDelimiter = "comma" | "semicolon" | "tab";
export type CsvEncoding = "utf-8" | "utf-8-bom" | "utf-16le";

export interface ResultExportData {
  columns: string[];
  rows: QueryValue[][];
}

export type CsvExportData = ResultExportData;

export interface CsvExportRequest extends CsvExportData {
  taskId: string;
  suggestedFileName: string;
  includeHeaders: boolean;
  delimiter: CsvDelimiter;
  encoding: CsvEncoding;
}

export interface CsvExportProgress {
  taskId: string;
  completedRows: number;
  totalRows: number;
}

export interface CsvExportResult {
  taskId: string;
  status: "completed" | "dismissed" | "cancelled";
  rowsWritten: number;
}

export interface CancelExportResult {
  taskId: string;
  status: "requested" | "alreadyFinished";
}

export function getResultExportData(
  statement: QueryStatementResult,
  selection?: GridSelection,
): ResultExportData | undefined {
  const rows = buildQueryGridRows(statement);
  if (statement.columns.length === 0) return undefined;

  if (!selection) {
    return {
      columns: statement.columns.map((column) => column.name),
      rows: rows.map((row) => row.values.slice(0, statement.columns.length)),
    };
  }

  const bounds = getSelectionBounds(selection);
  const firstColumnIndex = Math.max(0, bounds.firstColumnIndex);
  const lastColumnIndex = Math.min(
    statement.columns.length - 1,
    bounds.lastColumnIndex,
  );
  if (firstColumnIndex > lastColumnIndex) return undefined;

  const selectedRows = rows.filter(
    (row) =>
      row.rowIndex >= bounds.firstRowIndex &&
      row.rowIndex <= bounds.lastRowIndex,
  );
  if (selectedRows.length === 0) return undefined;

  return {
    columns: statement.columns
      .slice(firstColumnIndex, lastColumnIndex + 1)
      .map((column) => column.name),
    rows: selectedRows.map((row) =>
      row.values.slice(firstColumnIndex, lastColumnIndex + 1),
    ),
  };
}

export const getCsvExportData = getResultExportData;
