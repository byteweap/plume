import { describe, expect, it, vi } from "vitest";
import type { QueryStatementResult } from "../query-execution/queryExecution";
import { createEmptyTableDataChangeSet } from "./tableDataChanges";
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
});
