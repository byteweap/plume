import { describe, expect, it } from "vitest";
import {
  createInitialTableDataTarget,
  createTableDataQuery,
  createTableDataTarget,
  INITIAL_TABLE_DATA_LIMIT,
  normalizeTableDataPage,
  quotePostgresIdentifier,
  resolveTableDataEditability,
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

  it("builds persistent multi-column ordering by result ordinal", () => {
    expect(
      createTableDataTarget(
        { schema: "public", table: "users" },
        { pageIndex: 1, pageSize: 100 },
        [
          { columnIndex: 2, columnName: "created_at", direction: "DESC" },
          { columnIndex: 0, columnName: "id", direction: "ASC" },
        ],
      ).sql,
    ).toBe(
      'SELECT *\nFROM "public"."users"\nORDER BY 3 DESC, 1 ASC\nLIMIT 101\nOFFSET 100;',
    );
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

  it("builds typed parameterized predicates without embedding filter values", () => {
    const columns = [
      {
        name: "id",
        ordinal: 0,
        dataType: {
          name: "int4",
          schema: "pg_catalog",
          kind: "simple" as const,
        },
      },
      {
        name: "display name",
        ordinal: 1,
        dataType: { name: "text", schema: "pg_catalog", kind: "simple" as const },
      },
    ];
    const query = createTableDataQuery(
      { schema: "public", table: "users" },
      { pageIndex: 0, pageSize: 50 },
      [{ columnIndex: 0, columnName: "id", direction: "DESC" }],
      columns,
      [
        {
          columnIndex: 0,
          columnName: "id",
          dataType: columns[0]!.dataType,
          operator: "greaterThanOrEqual",
          value: "10",
        },
        {
          columnIndex: 1,
          columnName: "display name",
          dataType: columns[1]!.dataType,
          operator: "contains",
          value: "O'Reilly%",
        },
        {
          columnIndex: 1,
          columnName: "display name",
          dataType: columns[1]!.dataType,
          operator: "isNotNull",
          value: "",
        },
      ],
    );

    expect(query.parameters).toEqual(["10", "O'Reilly%"]);
    expect(query.target.sql).toBe(
      'SELECT "id"::text AS "id", "display name"::text AS "display name"\n' +
        'FROM "public"."users"\n' +
        'WHERE "id" >= $1::text::"pg_catalog"."int4"\n' +
        '  AND pg_catalog.strpos("display name"::text, $2::text) > 0\n' +
        '  AND "display name" IS NOT NULL\n' +
        'ORDER BY 1 DESC\nLIMIT 51\nOFFSET 0;',
    );
    expect(query.target.sql).not.toContain("O'Reilly%");
    expect(query.resultColumns).toEqual(columns);
  });

  it("fails closed when editability metadata lacks a reliable key", () => {
    expect(
      resolveTableDataEditability(
        {
          editable: true,
        },
        "session-1",
      ),
    ).toEqual({
      status: "read-only",
      sessionId: "session-1",
      reason: "metadata-unavailable",
    });
    expect(
      resolveTableDataEditability(
        {
          editable: true,
          key: {
            name: "users_pkey",
            kind: "primary-key",
            columns: ["tenant_id", "id"],
          },
        },
        "session-1",
      ),
    ).toMatchObject({
      status: "editable",
      key: { kind: "primary-key", columns: ["tenant_id", "id"] },
    });
  });
});
