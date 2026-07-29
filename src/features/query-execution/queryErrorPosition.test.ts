import { describe, expect, it } from "vitest";
import { resolveQueryErrorRange } from "./queryErrorPosition";

describe("query error position", () => {
  it("maps PostgreSQL character positions to UTF-16 editor offsets", () => {
    const document = "-- heading\nSELECT '😀', FROM;\n";
    const from = document.indexOf("SELECT");
    const sql = "SELECT '😀', FROM;";
    const position = Array.from(sql).indexOf("F") + 1;

    expect(
      resolveQueryErrorRange(
        document,
        { sql, from, to: from + sql.length, source: "statement" },
        position,
      ),
    ).toEqual({
      from: document.indexOf("FROM"),
      to: document.indexOf("FROM") + 1,
    });
  });

  it("supports an end-of-input cursor position", () => {
    const sql = "SELECT (";
    expect(
      resolveQueryErrorRange(
        sql,
        { sql, from: 0, to: sql.length, source: "document" },
        Array.from(sql).length + 1,
      ),
    ).toEqual({ from: sql.length, to: sql.length });
  });

  it("does not locate stale, invalid, or out-of-range positions", () => {
    const target = {
      sql: "SELECT 1",
      from: 0,
      to: 8,
      source: "selection" as const,
    };
    expect(resolveQueryErrorRange("SELECT 2", target, 1)).toBeNull();
    expect(resolveQueryErrorRange("SELECT 1", target, 0)).toBeNull();
    expect(resolveQueryErrorRange("SELECT 1", target, 10)).toBeNull();
  });
});
