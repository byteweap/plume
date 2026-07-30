import { describe, expect, it } from "vitest";
import type { QueryStatementResult } from "../query-execution/queryExecution";
import { getCsvExportData } from "./csvExport";

const statement: QueryStatementResult = {
  statementIndex: 0,
  status: "succeeded",
  kind: "rows",
  columns: [
    { name: "id", ordinal: 0, dataType: { kind: "simple" } },
    { name: "name", ordinal: 1, dataType: { kind: "simple" } },
    { name: "active", ordinal: 2, dataType: { kind: "simple" } },
  ],
  batches: [
    { offset: 0, rows: [["1", "Ada", "t"]] },
    { offset: 1, rows: [["2", null, "f"]] },
  ],
  rowCount: 2,
  retainedRowCount: 2,
  truncated: false,
};

describe("CSV export data", () => {
  it("exports every retained row and column by default", () => {
    expect(getCsvExportData(statement)).toEqual({
      columns: ["id", "name", "active"],
      rows: [
        ["1", "Ada", "t"],
        ["2", null, "f"],
      ],
    });
  });

  it("extracts a normalized rectangular selection", () => {
    expect(
      getCsvExportData(statement, {
        anchor: { rowIndex: 1, columnIndex: 2 },
        focus: { rowIndex: 0, columnIndex: 1 },
      }),
    ).toEqual({
      columns: ["name", "active"],
      rows: [
        ["Ada", "t"],
        [null, "f"],
      ],
    });
  });
});
