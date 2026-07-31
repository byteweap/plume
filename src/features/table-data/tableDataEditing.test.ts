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
});
