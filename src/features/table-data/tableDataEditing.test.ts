import { describe, expect, it, vi } from "vitest";
import type { QueryStatementResult } from "../query-execution/queryExecution";
import {
  createEmptyTableDataChangeSet,
  stageTableRowInsert,
} from "./tableDataChanges";
import { createTableDataGridEditing } from "./tableDataEditing";

const statement: QueryStatementResult = {
  statementIndex: 0,
  status: "succeeded",
  kind: "rows",
  columns: [
    { name: "id", ordinal: 0, dataType: { kind: "simple", name: "int8" } },
    { name: "name", ordinal: 1, dataType: { kind: "simple", name: "text" } },
  ],
  batches: [{ offset: 0, rows: [["42", "Ada"]] }],
  rowCount: 1,
  retainedRowCount: 1,
  truncated: false,
};

const key = {
  name: "users_pkey",
  kind: "primary-key" as const,
  columns: ["id"],
};

describe("table data grid editing", () => {
  it("stages cell values against the original row key without writing remotely", () => {
    const onChangesChange = vi.fn();
    const editing = createTableDataGridEditing(
      { pageIndex: 3, key, changes: createEmptyTableDataChangeSet() },
      statement,
      onChangesChange,
    );
    const row = { rowIndex: 0, values: ["42", "Ada"] };
    editing?.onCellValueChange(row, 1, { kind: "value", value: "" });

    expect(onChangesChange).toHaveBeenCalledOnce();
    const changes = onChangesChange.mock.calls[0]![0];
    expect(changes.updatedRows).toEqual([
      expect.objectContaining({
        pageIndex: 3,
        rowIndex: 0,
        locator: {
          keyName: "users_pkey",
          columns: [{ columnName: "id", value: "42" }],
        },
        cells: [
          expect.objectContaining({
            columnName: "name",
            originalValue: "Ada",
            newValue: { kind: "value", value: "" },
          }),
        ],
      }),
    ]);

    const withPendingValue = createTableDataGridEditing(
      { pageIndex: 3, key, changes },
      statement,
      vi.fn(),
    );
    expect(withPendingValue?.getPendingValue(row, 1)).toEqual({
      kind: "value",
      value: "",
    });
  });

  it("does not stage a row when its reliable key is absent", () => {
    const onChangesChange = vi.fn();
    const editing = createTableDataGridEditing(
      { pageIndex: 0, key, changes: createEmptyTableDataChangeSet() },
      { ...statement, columns: statement.columns.slice(1) },
      onChangesChange,
    );
    expect(editing).toBeUndefined();
    expect(onChangesChange).not.toHaveBeenCalled();
  });

  it("edits and discards inserted rows through the same local change callback", () => {
    const changes = stageTableRowInsert(
      createEmptyTableDataChangeSet(),
      "local-1",
      2,
    );
    const onChangesChange = vi.fn();
    const editing = createTableDataGridEditing(
      { pageIndex: 0, key, changes },
      statement,
      onChangesChange,
    );
    const insertedRow = {
      rowIndex: 1,
      rowKey: "inserted:local-1",
      insertedId: "local-1",
      values: [null, null],
    };
    expect(editing?.insertedRows).toEqual(changes.insertedRows);
    expect(editing?.getPendingValue(insertedRow, 0)).toEqual({ kind: "default" });

    editing?.onCellValueChange(insertedRow, 0, { kind: "null" });
    expect(onChangesChange.mock.calls[0]![0].insertedRows[0].values[0]).toEqual({
      kind: "null",
    });
    editing?.onDiscardInsertedRow("local-1");
    expect(onChangesChange.mock.calls[1]![0].insertedRows).toEqual([]);

    const anotherPage = createTableDataGridEditing(
      { pageIndex: 1, key, changes },
      statement,
      vi.fn(),
    );
    expect(anotherPage?.insertedRows).toEqual([]);
  });

  it("stages deletion snapshots, blocks edits, and restores the row locally", () => {
    const originalChanges = createEmptyTableDataChangeSet();
    const onDelete = vi.fn();
    const editing = createTableDataGridEditing(
      { pageIndex: 2, key, changes: originalChanges },
      statement,
      onDelete,
    );
    const row = { rowIndex: 4, values: ["42", "Ada"] };
    expect(editing?.isRowDeleted(row)).toBe(false);
    editing?.onToggleRowDeleted(row);

    const deletedChanges = onDelete.mock.calls[0]![0];
    expect(deletedChanges.deletedRows).toEqual([
      expect.objectContaining({
        pageIndex: 2,
        rowIndex: 4,
        locator: {
          keyName: "users_pkey",
          columns: [{ columnName: "id", value: "42" }],
        },
        originalValues: ["42", "Ada"],
      }),
    ]);

    const onRestore = vi.fn();
    const deletedEditing = createTableDataGridEditing(
      { pageIndex: 2, key, changes: deletedChanges },
      statement,
      onRestore,
    );
    expect(deletedEditing?.isRowDeleted(row)).toBe(true);
    deletedEditing?.onCellValueChange(row, 1, {
      kind: "value",
      value: "blocked",
    });
    expect(onRestore).not.toHaveBeenCalled();
    deletedEditing?.onToggleRowDeleted(row);
    expect(onRestore.mock.calls[0]![0].deletedRows).toEqual([]);
  });
});
