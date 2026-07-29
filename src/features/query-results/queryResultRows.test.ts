import { describe, expect, it } from "vitest";
import type { QueryStatementResult } from "../query-execution/queryExecution";
import {
  buildQueryGridRows,
  getSelectionBounds,
  isPositionSelected,
  serializeGridSelection,
  type GridSelection,
} from "./queryResultRows";

const statement: QueryStatementResult = {
  statementIndex: 0,
  status: "succeeded",
  kind: "rows",
  columns: [],
  batches: [
    { offset: 0, rows: [["one", null]] },
    {
      offset: 1,
      rows: [
        ["two", "value"],
        ["three", "last"],
      ],
    },
  ],
  rowCount: 3,
  retainedRowCount: 3,
  truncated: false,
};

describe("query result rows", () => {
  it("preserves batch offsets as stable row indexes", () => {
    expect(buildQueryGridRows(statement)).toEqual([
      { rowIndex: 0, values: ["one", null] },
      { rowIndex: 1, values: ["two", "value"] },
      { rowIndex: 2, values: ["three", "last"] },
    ]);
  });

  it("normalizes reverse selections and checks their bounds", () => {
    const selection: GridSelection = {
      anchor: { rowIndex: 2, columnIndex: 1 },
      focus: { rowIndex: 0, columnIndex: 0 },
    };

    expect(getSelectionBounds(selection)).toEqual({
      firstColumnIndex: 0,
      lastColumnIndex: 1,
      firstRowIndex: 0,
      lastRowIndex: 2,
    });
    expect(
      isPositionSelected(selection, { rowIndex: 1, columnIndex: 1 }),
    ).toBe(true);
    expect(
      isPositionSelected(selection, { rowIndex: 1, columnIndex: 2 }),
    ).toBe(false);
  });

  it("serializes rectangular selections as tab-separated text", () => {
    const rows = buildQueryGridRows(statement);
    expect(
      serializeGridSelection(rows, {
        anchor: { rowIndex: 2, columnIndex: 1 },
        focus: { rowIndex: 0, columnIndex: 0 },
      }),
    ).toBe("one\tNULL\ntwo\tvalue\nthree\tlast");
  });
});
