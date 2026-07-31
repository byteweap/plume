import type { QueryStatementResult } from "../query-execution/queryExecution";
import type { QueryResultGridEditing } from "../query-results/QueryResultGrid";
import type { TableIdentityKey } from "./tableData";
import {
  createTableRowLocator,
  discardTableRowInsert,
  findPendingTableCellUpdate,
  findPendingTableRowDelete,
  restoreTableRowDelete,
  setTableRowInsertValue,
  stageTableCellUpdate,
  stageTableRowDelete,
  type TableDataChangeSet,
} from "./tableDataChanges";

interface TableDataEditingContext {
  pageIndex: number;
  key: TableIdentityKey;
  changes: TableDataChangeSet;
}

export function createTableDataGridEditing(
  context: TableDataEditingContext,
  statement: QueryStatementResult,
  onChangesChange: (changes: TableDataChangeSet) => void,
): QueryResultGridEditing | undefined {
  if (
    context.key.columns.some(
      (keyColumn) => !statement.columns.some((column) => column.name === keyColumn),
    )
  ) {
    return undefined;
  }

  function getLocator(values: QueryStatementResult["batches"][number]["rows"][number]) {
    return createTableRowLocator(
      context.key.name,
      context.key.columns,
      statement.columns,
      values,
    );
  }

  return {
    insertedRows: context.changes.insertedRows.filter(
      (row) => row.pageIndex === context.pageIndex,
    ),
    getPendingValue: (row, columnIndex) => {
      if (row.insertedId) {
        return context.changes.insertedRows.find(
          (insertedRow) => insertedRow.localId === row.insertedId,
        )?.values[columnIndex];
      }
      const locator = getLocator(row.values);
      return locator
        ? findPendingTableCellUpdate(context.changes, locator, columnIndex)?.newValue
        : undefined;
    },
    isRowDeleted: (row) => {
      if (row.insertedId) return false;
      const locator = getLocator(row.values);
      return locator
        ? Boolean(findPendingTableRowDelete(context.changes, locator))
        : false;
    },
    onCellValueChange: (row, columnIndex, newValue) => {
      if (row.insertedId) {
        onChangesChange(
          setTableRowInsertValue(
            context.changes,
            row.insertedId,
            columnIndex,
            newValue,
          ),
        );
        return;
      }
      const column = statement.columns[columnIndex];
      const locator = getLocator(row.values);
      if (
        !column ||
        !locator ||
        findPendingTableRowDelete(context.changes, locator)
      ) {
        return;
      }
      onChangesChange(
        stageTableCellUpdate(context.changes, {
          locator,
          pageIndex: context.pageIndex,
          rowIndex: row.rowIndex,
          columnIndex,
          columnName: column.name,
          originalValue: row.values[columnIndex] ?? null,
          newValue,
        }),
      );
    },
    onDiscardInsertedRow: (localId) =>
      onChangesChange(discardTableRowInsert(context.changes, localId)),
    onToggleRowDeleted: (row) => {
      if (row.insertedId) return;
      const locator = getLocator(row.values);
      if (!locator) return;
      const changes = findPendingTableRowDelete(context.changes, locator)
        ? restoreTableRowDelete(context.changes, locator)
        : stageTableRowDelete(context.changes, {
            locator,
            pageIndex: context.pageIndex,
            rowIndex: row.rowIndex,
            originalValues: row.values,
          });
      onChangesChange(changes);
    },
  };
}
