import type { SqlExecutionTarget } from "../sql-editor/SqlEditor";

export const INITIAL_TABLE_DATA_LIMIT = 200;

export interface TableDataReference {
  database: string;
  schema: string;
  table: string;
}

export function quotePostgresIdentifier(identifier: string): string {
  return `"${identifier.split('"').join('""')}"`;
}

export function createInitialTableDataTarget(
  reference: Pick<TableDataReference, "schema" | "table">,
): SqlExecutionTarget {
  const sql = `SELECT *\nFROM ${quotePostgresIdentifier(reference.schema)}.${quotePostgresIdentifier(reference.table)}\nLIMIT ${INITIAL_TABLE_DATA_LIMIT};`;
  return {
    sql,
    from: 0,
    to: sql.length,
    source: "document",
  };
}
