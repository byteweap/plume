import { describe, expect, it } from "vitest";
import { analyzeSqlRisks } from "./sqlRiskAnalysis";

describe("analyzeSqlRisks", () => {
  it("describes DROP statements and preserves qualified quoted targets", () => {
    const sql = 'DROP TABLE IF EXISTS public.users, "Audit"."Events" CASCADE;';

    expect(analyzeSqlRisks(sql)).toEqual([
      expect.objectContaining({
        type: "drop",
        severity: "critical",
        category: "schema-change",
        from: 0,
        to: sql.length,
        operationFrom: 0,
        objectType: "TABLE",
        targets: ["public.users", '"Audit"."Events"'],
        statementSummary: sql,
      }),
    ]);
  });

  it("collects all TRUNCATE targets without treating options as targets", () => {
    const risks = analyzeSqlRisks(
      'truncate table only public.accounts, "Audit"."Events" restart identity cascade',
    );

    expect(risks).toEqual([
      expect.objectContaining({
        type: "truncate",
        severity: "critical",
        category: "data-loss",
        objectType: "TABLE",
        targets: ["public.accounts", '"Audit"."Events"'],
      }),
    ]);
  });

  it.each([
    ["DELETE FROM users", "unconditional-delete", "users"],
    ["UPDATE public.users SET active = false", "unconditional-update", "public.users"],
    ["delete from only public.events returning id", "unconditional-delete", "public.events"],
    ['update only "Audit"."Events" set processed = true', "unconditional-update", '"Audit"."Events"'],
  ])("detects an unconditional mutation in %s", (sql, type, target) => {
    expect(analyzeSqlRisks(sql)).toEqual([
      expect.objectContaining({
        type,
        severity: "high",
        category: "data-loss",
        targets: [target],
      }),
    ]);
  });

  it.each([
    "DELETE FROM users WHERE id = 1",
    "DELETE FROM users USING sessions WHERE users.id = sessions.user_id",
    "UPDATE users SET active = false WHERE id = 1",
    "UPDATE users SET active = (SELECT active FROM defaults WHERE id = 1) WHERE id = 2",
  ])("does not flag a mutation with a top-level WHERE clause: %s", (sql) => {
    expect(analyzeSqlRisks(sql)).toEqual([]);
  });

  it("detects data-modifying CTEs and the outer statement independently", () => {
    const sql =
      "WITH removed AS (DELETE FROM audit RETURNING *) " +
      "DELETE FROM sessions";

    expect(analyzeSqlRisks(sql)).toEqual([
      expect.objectContaining({
        type: "unconditional-delete",
        targets: ["audit"],
        operationFrom: sql.indexOf("DELETE FROM audit"),
      }),
      expect.objectContaining({
        type: "unconditional-delete",
        targets: ["sessions"],
        operationFrom: sql.lastIndexOf("DELETE FROM sessions"),
      }),
    ]);
  });

  it("does not inherit an inner or outer WHERE clause across CTE boundaries", () => {
    const sql =
      "WITH changed AS (UPDATE accounts SET active = false WHERE id = 1 RETURNING *) " +
      "UPDATE summaries SET stale = true";

    expect(analyzeSqlRisks(sql)).toEqual([
      expect.objectContaining({
        type: "unconditional-update",
        targets: ["summaries"],
        operationFrom: sql.lastIndexOf("UPDATE summaries"),
      }),
    ]);
  });

  it("returns statement-relative source ranges for a multi-statement request", () => {
    const sql =
      "SELECT 1;\nDELETE FROM public.logs;\nUPDATE users SET locked = true;";
    const deleteFrom = sql.indexOf("DELETE");
    const deleteTo = sql.indexOf(";", deleteFrom) + 1;
    const updateFrom = sql.indexOf("UPDATE");

    expect(analyzeSqlRisks(sql)).toEqual([
      expect.objectContaining({
        type: "unconditional-delete",
        from: deleteFrom,
        to: deleteTo,
        operationFrom: deleteFrom,
        targets: ["public.logs"],
      }),
      expect.objectContaining({
        type: "unconditional-update",
        from: updateFrom,
        to: sql.length,
        operationFrom: updateFrom,
        targets: ["users"],
      }),
    ]);
  });

  it("ignores dangerous words in comments, strings, and quoted identifiers", () => {
    const sql = `
      -- DROP TABLE accounts;
      SELECT 'DELETE FROM users', $$ TRUNCATE audit $$,
             "UPDATE records SET value = 1"
      /* DELETE FROM sessions */;
    `;

    expect(analyzeSqlRisks(sql)).toEqual([]);
  });

  it("does not inspect dollar-quoted PostgreSQL function bodies", () => {
    const sql = `CREATE FUNCTION clear_data() RETURNS void LANGUAGE plpgsql AS $$
      BEGIN
        DELETE FROM users;
        DROP TABLE audit;
      END
    $$;`;

    expect(analyzeSqlRisks(sql)).toEqual([]);
  });

  it("does not confuse ALTER TABLE DROP COLUMN with a DROP statement", () => {
    expect(analyzeSqlRisks("ALTER TABLE users DROP COLUMN display_name")).toEqual(
      [],
    );
  });

  it("flags an executing EXPLAIN ANALYZE but not a plain EXPLAIN", () => {
    expect(analyzeSqlRisks("EXPLAIN DELETE FROM users")).toEqual([]);
    expect(analyzeSqlRisks("EXPLAIN ANALYZE DELETE FROM users")).toEqual([
      expect.objectContaining({
        type: "unconditional-delete",
        targets: ["users"],
      }),
    ]);
    expect(
      analyzeSqlRisks("EXPLAIN (ANALYZE, BUFFERS) UPDATE users SET active = false"),
    ).toEqual([
      expect.objectContaining({
        type: "unconditional-update",
        targets: ["users"],
      }),
    ]);
  });

  it("caps and normalizes the statement summary", () => {
    const sql = `DELETE\nFROM logs RETURNING '${"x".repeat(220)}'`;
    const [risk] = analyzeSqlRisks(sql);

    expect(risk?.statementSummary).toHaveLength(180);
    expect(risk?.statementSummary.endsWith("...")).toBe(true);
    expect(risk?.statementSummary).not.toContain("\n");
  });
});
