import { describe, expect, it } from "vitest";
import {
  createInitialTableDataTarget,
  createTableDataTarget,
  INITIAL_TABLE_DATA_LIMIT,
  normalizeTableDataPage,
  quotePostgresIdentifier,
} from "./tableData";

describe("table data initial query", () => {
  it("quotes identifiers and always applies the 200-row limit", () => {
    expect(quotePostgresIdentifier('odd"name')).toBe('"odd""name"');

    const target = createInitialTableDataTarget({
      schema: "Sales Data",
      table: 'order"items',
    });

    expect(target).toEqual({
      sql: 'SELECT *\nFROM "Sales Data"."order""items"\nLIMIT 201\nOFFSET 0;',
      from: 0,
      to: 61,
      source: "document",
    });
    expect(INITIAL_TABLE_DATA_LIMIT).toBe(200);
  });

  it("calculates bounded page offsets", () => {
    expect(
      createTableDataTarget(
        { schema: "public", table: "users" },
        { pageIndex: 2, pageSize: 50 },
      ).sql,
    ).toBe('SELECT *\nFROM "public"."users"\nLIMIT 51\nOFFSET 100;');
  });

  it("removes the probe row across retained batches", () => {
    const normalized = normalizeTableDataPage(
      {
        queryId: "query-1",
        status: "succeeded",
        results: [
          {
            statementIndex: 0,
            status: "succeeded",
            kind: "rows",
            columns: [],
            batches: [
              { offset: 0, rows: [["1"], ["2"]] },
              { offset: 2, rows: [["3"]] },
            ],
            rowCount: 3,
            retainedRowCount: 3,
            truncated: false,
          },
        ],
      },
      2,
    );

    expect(normalized.hasNextPage).toBe(true);
    expect(normalized.result.results[0]).toMatchObject({
      rowCount: 2,
      retainedRowCount: 2,
      batches: [{ offset: 0, rows: [["1"], ["2"]] }],
    });
  });
});
