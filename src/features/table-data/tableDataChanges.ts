import type {
  QueryColumn,
  QueryValue,
} from "../query-execution/queryExecution";

export type PendingTableValue =
  | { kind: "value"; value: string }
  | { kind: "null" }
  | { kind: "default" };

export interface TableRowLocator {
  keyName: string;
  columns: Array<{ columnName: string; value: string }>;
}

export interface TableRowLocation {
  pageIndex: number;
  rowIndex: number;
}

export interface PendingTableCellUpdate {
  columnIndex: number;
  columnName: string;
  originalValue: QueryValue;
  newValue: PendingTableValue;
}

export interface PendingTableRowUpdate extends TableRowLocation {
  rowId: string;
  locator: TableRowLocator;
  cells: PendingTableCellUpdate[];
}

export interface PendingTableRowInsert {
  localId: string;
  values: PendingTableValue[];
}

export interface PendingTableRowDelete extends TableRowLocation {
  rowId: string;
  locator: TableRowLocator;
  originalValues: QueryValue[];
}

export interface TableDataChangeSet {
  updatedRows: PendingTableRowUpdate[];
  insertedRows: PendingTableRowInsert[];
  deletedRows: PendingTableRowDelete[];
}

export interface StageTableCellUpdate extends TableRowLocation {
  locator: TableRowLocator;
  columnIndex: number;
  columnName: string;
  originalValue: QueryValue;
  newValue: PendingTableValue;
}

export interface StageTableRowDelete extends TableRowLocation {
  locator: TableRowLocator;
  originalValues: QueryValue[];
}

export function createEmptyTableDataChangeSet(): TableDataChangeSet {
  return { updatedRows: [], insertedRows: [], deletedRows: [] };
}

export function getTableRowId(locator: TableRowLocator): string {
  if (locator.columns.length === 0) {
    throw new Error("A table row locator requires at least one key column");
  }
  return JSON.stringify([
    locator.keyName,
    locator.columns.map(({ columnName, value }) => [columnName, value]),
  ]);
}

export function createTableRowLocator(
  keyName: string,
  keyColumns: readonly string[],
  columns: readonly QueryColumn[],
  values: readonly QueryValue[],
): TableRowLocator | undefined {
  const locatorColumns: TableRowLocator["columns"] = [];
  for (const columnName of keyColumns) {
    const columnIndex = columns.findIndex((column) => column.name === columnName);
    const value = columnIndex < 0 ? undefined : values[columnIndex];
    if (value === undefined || value === null) return undefined;
    locatorColumns.push({ columnName, value });
  }
  return keyColumns.length > 0
    ? { keyName, columns: locatorColumns }
    : undefined;
}

export function findPendingTableCellUpdate(
  changes: TableDataChangeSet,
  locator: TableRowLocator,
  columnIndex: number,
): PendingTableCellUpdate | undefined {
  const rowId = getTableRowId(locator);
  return changes.updatedRows
    .find((row) => row.rowId === rowId)
    ?.cells.find((cell) => cell.columnIndex === columnIndex);
}

export function stageTableCellUpdate(
  changes: TableDataChangeSet,
  update: StageTableCellUpdate,
): TableDataChangeSet {
  if (update.columnIndex < 0) throw new RangeError("Column index must be non-negative");
  const rowId = getTableRowId(update.locator);
  if (changes.deletedRows.some((row) => row.rowId === rowId)) return changes;

  const existingRow = changes.updatedRows.find((row) => row.rowId === rowId);
  const existingCell = existingRow?.cells.find(
    (cell) => cell.columnIndex === update.columnIndex,
  );
  const originalValue = existingCell?.originalValue ?? update.originalValue;
  const nextCells = (existingRow?.cells ?? [])
    .filter((cell) => cell.columnIndex !== update.columnIndex)
    .map((cell) => ({
      ...cell,
      newValue: clonePendingValue(cell.newValue),
    }));
  if (!matchesOriginalValue(update.newValue, originalValue)) {
    nextCells.push({
      columnIndex: update.columnIndex,
      columnName: update.columnName,
      originalValue,
      newValue: clonePendingValue(update.newValue),
    });
    nextCells.sort((left, right) => left.columnIndex - right.columnIndex);
  }

  const updatedRows = changes.updatedRows.filter((row) => row.rowId !== rowId);
  if (nextCells.length > 0) {
    updatedRows.push({
      rowId,
      locator: existingRow?.locator ?? cloneTableRowLocator(update.locator),
      pageIndex: existingRow?.pageIndex ?? update.pageIndex,
      rowIndex: existingRow?.rowIndex ?? update.rowIndex,
      cells: nextCells,
    });
  }
  return { ...changes, updatedRows };
}

export function stageTableRowInsert(
  changes: TableDataChangeSet,
  localId: string,
  columnCount: number,
): TableDataChangeSet {
  if (columnCount < 0) throw new RangeError("Column count must be non-negative");
  if (changes.insertedRows.some((row) => row.localId === localId)) return changes;
  return {
    ...changes,
    insertedRows: [
      ...changes.insertedRows,
      {
        localId,
        values: Array.from({ length: columnCount }, () => ({
          kind: "default" as const,
        })),
      },
    ],
  };
}

export function setTableRowInsertValue(
  changes: TableDataChangeSet,
  localId: string,
  columnIndex: number,
  value: PendingTableValue,
): TableDataChangeSet {
  const row = changes.insertedRows.find((item) => item.localId === localId);
  if (!row) return changes;
  if (columnIndex < 0 || columnIndex >= row.values.length) {
    throw new RangeError("Column index is outside the inserted row");
  }
  const values = [...row.values];
  values[columnIndex] = clonePendingValue(value);
  return {
    ...changes,
    insertedRows: changes.insertedRows.map((item) =>
      item.localId === localId ? { ...item, values } : item,
    ),
  };
}

export function discardTableRowInsert(
  changes: TableDataChangeSet,
  localId: string,
): TableDataChangeSet {
  const insertedRows = changes.insertedRows.filter((row) => row.localId !== localId);
  return insertedRows.length === changes.insertedRows.length
    ? changes
    : { ...changes, insertedRows };
}

export function stageTableRowDelete(
  changes: TableDataChangeSet,
  deletion: StageTableRowDelete,
): TableDataChangeSet {
  const rowId = getTableRowId(deletion.locator);
  if (changes.deletedRows.some((row) => row.rowId === rowId)) return changes;
  return {
    ...changes,
    updatedRows: changes.updatedRows.filter((row) => row.rowId !== rowId),
    deletedRows: [
      ...changes.deletedRows,
      {
        rowId,
        locator: cloneTableRowLocator(deletion.locator),
        pageIndex: deletion.pageIndex,
        rowIndex: deletion.rowIndex,
        originalValues: [...deletion.originalValues],
      },
    ],
  };
}

export function restoreTableRowDelete(
  changes: TableDataChangeSet,
  locator: TableRowLocator,
): TableDataChangeSet {
  const rowId = getTableRowId(locator);
  const deletedRows = changes.deletedRows.filter((row) => row.rowId !== rowId);
  return deletedRows.length === changes.deletedRows.length
    ? changes
    : { ...changes, deletedRows };
}

export function hasPendingTableDataChanges(changes: TableDataChangeSet): boolean {
  return (
    changes.updatedRows.length > 0 ||
    changes.insertedRows.length > 0 ||
    changes.deletedRows.length > 0
  );
}

export function summarizeTableDataChanges(changes: TableDataChangeSet) {
  const updatedCells = changes.updatedRows.reduce(
    (total, row) => total + row.cells.length,
    0,
  );
  return {
    updatedRows: changes.updatedRows.length,
    updatedCells,
    insertedRows: changes.insertedRows.length,
    deletedRows: changes.deletedRows.length,
    totalRows:
      changes.updatedRows.length +
      changes.insertedRows.length +
      changes.deletedRows.length,
  };
}

function matchesOriginalValue(value: PendingTableValue, original: QueryValue): boolean {
  if (value.kind === "default") return false;
  if (value.kind === "null") return original === null;
  return value.value === original;
}

function clonePendingValue(value: PendingTableValue): PendingTableValue {
  return value.kind === "value"
    ? { kind: "value", value: value.value }
    : { kind: value.kind };
}

function cloneTableRowLocator(locator: TableRowLocator): TableRowLocator {
  return {
    keyName: locator.keyName,
    columns: locator.columns.map((column) => ({ ...column })),
  };
}
