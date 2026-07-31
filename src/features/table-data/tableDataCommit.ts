import type { QueryColumn } from "../query-execution/queryExecution";
import type { TableDataReference, TableIdentityKey } from "./tableData";
import type {
  PendingTableValue,
  TableDataChangeSet,
  TableRowLocator,
} from "./tableDataChanges";

export interface CommitTableDataRequest extends TableDataReference {
  requestId: string;
  sessionId: string;
  columns: Array<Pick<QueryColumn, "name" | "dataType">>;
  keyColumns: string[];
  updatedRows: Array<{
    locator: CommitTableDataLocator;
    cells: Array<{ columnName: string; value: PendingTableValue }>;
  }>;
  insertedRows: Array<{ values: PendingTableValue[] }>;
  deletedRows: Array<{ locator: CommitTableDataLocator }>;
}

export interface CommitTableDataLocator {
  columns: Array<{ columnName: string; value: string }>;
}

export interface CommitTableDataResult {
  requestId: string;
  insertedRows: number;
  updatedRows: number;
  deletedRows: number;
}

export function createCommitTableDataRequest(
  sessionId: string,
  reference: TableDataReference,
  columns: readonly QueryColumn[],
  key: TableIdentityKey,
  changes: TableDataChangeSet,
): CommitTableDataRequest {
  return {
    requestId: crypto.randomUUID(),
    sessionId,
    ...reference,
    columns: columns.map(({ name, dataType }) => ({ name, dataType })),
    keyColumns: [...key.columns],
    updatedRows: changes.updatedRows.map((row) => ({
      locator: toCommitLocator(row.locator),
      cells: row.cells.map((cell) => ({
        columnName: cell.columnName,
        value: clonePendingValue(cell.newValue),
      })),
    })),
    insertedRows: changes.insertedRows.map((row) => ({
      values: row.values.map(clonePendingValue),
    })),
    deletedRows: changes.deletedRows.map((row) => ({
      locator: toCommitLocator(row.locator),
    })),
  };
}

function toCommitLocator(locator: TableRowLocator): CommitTableDataLocator {
  return {
    columns: locator.columns.map((column) => ({ ...column })),
  };
}

function clonePendingValue(value: PendingTableValue): PendingTableValue {
  return value.kind === "value"
    ? { kind: "value", value: value.value }
    : { kind: value.kind };
}
