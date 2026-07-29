import { describe, expect, it } from "vitest";
import {
  formatQueryDuration,
  summarizeQueryResult,
  type QueryExecutionResult,
} from "./queryExecution";

describe("query execution feedback", () => {
  it("summarizes row and command results across statements", () => {
    const result: QueryExecutionResult = {
      queryId: "query-1",
      status: "succeeded",
      results: [
        {
          statementIndex: 0,
          status: "succeeded",
          kind: "rows",
          columns: [],
          batches: [],
          rowCount: 0,
          retainedRowCount: 0,
          truncated: false,
        },
        {
          statementIndex: 1,
          status: "succeeded",
          kind: "rows",
          columns: [],
          batches: [{ offset: 0, rows: [] }],
          rowCount: 12,
          retainedRowCount: 10,
          truncated: true,
        },
        {
          statementIndex: 2,
          status: "succeeded",
          kind: "command",
          columns: [],
          batches: [],
          rowCount: 0,
          retainedRowCount: 0,
          affectedRows: 3,
          truncated: false,
        },
      ],
    };

    expect(summarizeQueryResult(result)).toEqual({
      returnedRows: 12,
      affectedRows: 3,
      truncated: true,
    });
  });

  it("distinguishes absent result kinds from zero counts", () => {
    expect(
      summarizeQueryResult({
        queryId: "query-1",
        status: "succeeded",
        results: [
          {
            statementIndex: 0,
            status: "succeeded",
            kind: "rows",
            columns: [],
            batches: [],
            rowCount: 0,
            retainedRowCount: 0,
            truncated: false,
          },
        ],
      }),
    ).toEqual({ returnedRows: 0, affectedRows: undefined, truncated: false });
  });

  it("formats millisecond, second, and minute durations", () => {
    expect(formatQueryDuration(-10)).toBe("0 ms");
    expect(formatQueryDuration(875)).toBe("875 ms");
    expect(formatQueryDuration(1_250)).toBe("1.3 s");
    expect(formatQueryDuration(125_250)).toBe("2 m 5.3 s");
  });
});
