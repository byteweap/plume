import { describe, expect, it } from "vitest";
import {
  createInitialTableDataTarget,
  INITIAL_TABLE_DATA_LIMIT,
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
      sql: 'SELECT *\nFROM "Sales Data"."order""items"\nLIMIT 200;',
      from: 0,
      to: 52,
      source: "document",
    });
    expect(INITIAL_TABLE_DATA_LIMIT).toBe(200);
  });
});
