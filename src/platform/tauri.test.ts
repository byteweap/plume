import { describe, expect, it } from "vitest";
import { toCommandError } from "./tauri";

describe("toCommandError", () => {
  it("preserves validated PostgreSQL diagnostics", () => {
    expect(
      toCommandError({
        code: "query_failed",
        message: "syntax error",
        detail: "server detail",
        diagnostic: {
          sqlState: "42601",
          severity: "ERROR",
          hint: "Check the statement",
          position: 8,
        },
      }),
    ).toEqual({
      code: "query_failed",
      message: "syntax error",
      detail: "server detail",
      diagnostic: {
        sqlState: "42601",
        severity: "ERROR",
        hint: "Check the statement",
        position: 8,
      },
    });
  });

  it("omits malformed diagnostic fields", () => {
    expect(
      toCommandError({
        code: "query_failed",
        message: "syntax error",
        detail: 42,
        diagnostic: {
          sqlState: "42601",
          severity: "ERROR",
          hint: false,
          position: 1.5,
        },
      }),
    ).toEqual({
      code: "query_failed",
      message: "syntax error",
      detail: undefined,
      diagnostic: {
        sqlState: "42601",
        severity: "ERROR",
        hint: undefined,
        position: undefined,
      },
    });

    expect(
      toCommandError({
        code: "query_failed",
        message: "syntax error",
        diagnostic: { sqlState: 42601, severity: "ERROR" },
      }).diagnostic,
    ).toBeUndefined();
  });
});
