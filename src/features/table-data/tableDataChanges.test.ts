import { describe, expect, it } from "vitest";
import {
  createEmptyTableDataChangeSet,
  createTableRowLocator,
  discardTableRowInsert,
  findPendingTableCellUpdate,
  getTableRowId,
  hasPendingTableDataChanges,
  restoreTableRowDelete,
  setTableRowInsertValue,
  stageTableCellUpdate,
  stageTableRowDelete,
  stageTableRowInsert,
  summarizeTableDataChanges,
  type TableRowLocator,
} from "./tableDataChanges";

const locator: TableRowLocator = {
  keyName: "users_pkey",
  columns: [
    { columnName: "tenant_id", value: "acme" },
    { columnName: "id", value: "42" },
  ],
};

describe("table data pending changes", () => {
  it("retains the original value while replacing and reverting a cell update", () => {
    const empty = createEmptyTableDataChangeSet();
    const changed = stageTableCellUpdate(empty, {
      locator,
      pageIndex: 2,
      rowIndex: 7,
      columnIndex: 3,
      columnName: "display_name",
      originalValue: "Ada",
      newValue: { kind: "value", value: "" },
    });
    const restaged = stageTableCellUpdate(changed, {
      locator,
      pageIndex: 9,
      rowIndex: 99,
      columnIndex: 3,
      columnName: "display_name",
      originalValue: "",
      newValue: { kind: "null" },
    });

    expect(empty.updatedRows).toEqual([]);
    expect(restaged.updatedRows).toEqual([
      expect.objectContaining({
        pageIndex: 2,
        rowIndex: 7,
        locator,
        cells: [
          {
            columnIndex: 3,
            columnName: "display_name",
            originalValue: "Ada",
            newValue: { kind: "null" },
          },
        ],
      }),
    ]);

    const reverted = stageTableCellUpdate(restaged, {
      locator,
      pageIndex: 2,
      rowIndex: 7,
      columnIndex: 3,
      columnName: "display_name",
      originalValue: "ignored",
      newValue: { kind: "value", value: "Ada" },
    });
    expect(reverted.updatedRows).toEqual([]);
    expect(hasPendingTableDataChanges(reverted)).toBe(false);
  });

  it("distinguishes DEFAULT, NULL, and an empty string in inserted rows", () => {
    const empty = createEmptyTableDataChangeSet();
    const inserted = stageTableRowInsert(empty, "local-1", 3);
    const withNull = setTableRowInsertValue(inserted, "local-1", 1, {
      kind: "null",
    });
    const withEmptyString = setTableRowInsertValue(withNull, "local-1", 2, {
      kind: "value",
      value: "",
    });

    expect(withEmptyString.insertedRows).toEqual([
      {
        localId: "local-1",
        values: [
          { kind: "default" },
          { kind: "null" },
          { kind: "value", value: "" },
        ],
      },
    ]);
    expect(discardTableRowInsert(withEmptyString, "local-1")).toEqual(empty);
  });

  it("captures deletion snapshots and removes staged updates for that row", () => {
    const updated = stageTableCellUpdate(createEmptyTableDataChangeSet(), {
      locator,
      pageIndex: 0,
      rowIndex: 4,
      columnIndex: 2,
      columnName: "active",
      originalValue: "false",
      newValue: { kind: "value", value: "true" },
    });
    const originalValues = ["acme", "42", "false"];
    const deleted = stageTableRowDelete(updated, {
      locator,
      pageIndex: 0,
      rowIndex: 4,
      originalValues,
    });
    originalValues[2] = "mutated outside";

    expect(deleted.updatedRows).toEqual([]);
    expect(deleted.deletedRows).toEqual([
      expect.objectContaining({
        locator,
        pageIndex: 0,
        rowIndex: 4,
        originalValues: ["acme", "42", "false"],
      }),
    ]);
    expect(
      stageTableCellUpdate(deleted, {
        locator,
        pageIndex: 0,
        rowIndex: 4,
        columnIndex: 2,
        columnName: "active",
        originalValue: "false",
        newValue: { kind: "value", value: "true" },
      }),
    ).toBe(deleted);
    expect(restoreTableRowDelete(deleted, locator)).toEqual(
      createEmptyTableDataChangeSet(),
    );
  });

  it("summarizes row and cell counts without ambiguous locator delimiters", () => {
    const first = getTableRowId({
      keyName: "key",
      columns: [{ columnName: "a:b", value: "c" }],
    });
    const second = getTableRowId({
      keyName: "key",
      columns: [{ columnName: "a", value: "b:c" }],
    });
    expect(first).not.toBe(second);

    let changes = stageTableRowInsert(createEmptyTableDataChangeSet(), "local-1", 2);
    changes = stageTableCellUpdate(changes, {
      locator,
      pageIndex: 0,
      rowIndex: 0,
      columnIndex: 0,
      columnName: "name",
      originalValue: "old",
      newValue: { kind: "default" },
    });
    changes = stageTableCellUpdate(changes, {
      locator,
      pageIndex: 0,
      rowIndex: 0,
      columnIndex: 1,
      columnName: "active",
      originalValue: "false",
      newValue: { kind: "value", value: "true" },
    });

    expect(summarizeTableDataChanges(changes)).toEqual({
      updatedRows: 1,
      updatedCells: 2,
      insertedRows: 1,
      deletedRows: 0,
      totalRows: 2,
    });
    expect(findPendingTableCellUpdate(changes, locator, 1)?.newValue).toEqual({
      kind: "value",
      value: "true",
    });
  });

  it("builds non-null locators from the original result row", () => {
    const columns = [
      { name: "id", ordinal: 0, dataType: { kind: "simple" as const } },
      { name: "tenant", ordinal: 1, dataType: { kind: "simple" as const } },
    ];
    expect(
      createTableRowLocator("items_key", ["tenant", "id"], columns, ["7", "acme"]),
    ).toEqual({
      keyName: "items_key",
      columns: [
        { columnName: "tenant", value: "acme" },
        { columnName: "id", value: "7" },
      ],
    });
    expect(
      createTableRowLocator("items_key", ["id"], columns, [null, "acme"]),
    ).toBeUndefined();
    expect(
      createTableRowLocator("items_key", ["missing"], columns, ["7", "acme"]),
    ).toBeUndefined();
  });
});
