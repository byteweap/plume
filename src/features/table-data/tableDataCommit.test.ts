import { describe, expect, it, vi } from "vitest";
import { createCommitTableDataRequest } from "./tableDataCommit";
import type { TableDataChangeSet } from "./tableDataChanges";

describe("createCommitTableDataRequest", () => {
  it("strips local presentation state and preserves explicit value modes", () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "1138bb0e-cf61-4dbd-a723-6aa3ddd173ab",
    );
    const changes: TableDataChangeSet = {
      updatedRows: [
        {
          rowId: "local-row-id",
          pageIndex: 3,
          rowIndex: 4,
          locator: {
            keyName: "items_pkey",
            columns: [{ columnName: "id", value: "1" }],
          },
          cells: [
            {
              columnIndex: 1,
              columnName: "note",
              originalValue: "old",
              newValue: { kind: "value", value: "" },
            },
          ],
        },
      ],
      insertedRows: [
        {
          localId: "local-insert",
          pageIndex: 2,
          values: [{ kind: "default" }, { kind: "null" }],
        },
      ],
      deletedRows: [],
    };

    expect(
      createCommitTableDataRequest(
        "session-1",
        { database: "plume", schema: "public", table: "items" },
        [
          {
            name: "id",
            ordinal: 0,
            dataType: { oid: 23, name: "int4", schema: "pg_catalog", kind: "simple" },
          },
          {
            name: "note",
            ordinal: 1,
            dataType: { oid: 25, name: "text", schema: "pg_catalog", kind: "simple" },
          },
        ],
        { name: "items_pkey", kind: "primary-key", columns: ["id"] },
        changes,
      ),
    ).toEqual({
      requestId: "1138bb0e-cf61-4dbd-a723-6aa3ddd173ab",
      sessionId: "session-1",
      database: "plume",
      schema: "public",
      table: "items",
      columns: [
        {
          name: "id",
          dataType: { oid: 23, name: "int4", schema: "pg_catalog", kind: "simple" },
        },
        {
          name: "note",
          dataType: { oid: 25, name: "text", schema: "pg_catalog", kind: "simple" },
        },
      ],
      keyColumns: ["id"],
      updatedRows: [
        {
          locator: { columns: [{ columnName: "id", value: "1" }] },
          cells: [{ columnName: "note", value: { kind: "value", value: "" } }],
        },
      ],
      insertedRows: [{ values: [{ kind: "default" }, { kind: "null" }] }],
      deletedRows: [],
    });
  });
});
