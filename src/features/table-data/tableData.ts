import type { SqlExecutionTarget } from "../sql-editor/SqlEditor";
import type {
  QueryExecutionResult,
  QueryRowBatch,
} from "../query-execution/queryExecution";

export const INITIAL_TABLE_DATA_LIMIT = 200;
export const TABLE_DATA_PAGE_SIZE_OPTIONS = [50, 100, 200, 500] as const;

export interface TableDataReference {
  database: string;
  schema: string;
  table: string;
}

export interface TableDataPage {
  pageIndex: number;
  pageSize: number;
}

export interface TableDataSort {
  columnIndex: number;
  columnName: string;
  direction: "ASC" | "DESC";
}

export function quotePostgresIdentifier(identifier: string): string {
  return `"${identifier.split('"').join('""')}"`;
}

export function createTableDataTarget(
  reference: Pick<TableDataReference, "schema" | "table">,
  page: TableDataPage,
  sorts: TableDataSort[] = [],
): SqlExecutionTarget {
  const probeLimit = page.pageSize + 1;
  const offset = page.pageIndex * page.pageSize;
  const orderBy = sorts.length
    ? `\nORDER BY ${sorts
        .map((sort) => `${sort.columnIndex + 1} ${sort.direction}`)
        .join(", ")}`
    : "";
  const sql = `SELECT *\nFROM ${quotePostgresIdentifier(reference.schema)}.${quotePostgresIdentifier(reference.table)}${orderBy}\nLIMIT ${probeLimit}\nOFFSET ${offset};`;
  return {
    sql,
    from: 0,
    to: sql.length,
    source: "document",
  };
}

export function createInitialTableDataTarget(
  reference: Pick<TableDataReference, "schema" | "table">,
): SqlExecutionTarget {
  return createTableDataTarget(reference, {
    pageIndex: 0,
    pageSize: INITIAL_TABLE_DATA_LIMIT,
  });
}

export function normalizeTableDataPage(
  result: QueryExecutionResult,
  pageSize: number,
): { result: QueryExecutionResult; hasNextPage: boolean } {
  const rowResultIndex = result.results.findIndex(
    (statement) => statement.kind === "rows",
  );
  const statement = result.results[rowResultIndex];
  if (!statement || statement.kind !== "rows") {
    return { result, hasNextPage: false };
  }

  const hasNextPage = statement.retainedRowCount > pageSize;
  if (!hasNextPage) return { result, hasNextPage: false };

  let remaining = pageSize;
  const batches: QueryRowBatch[] = [];
  for (const batch of statement.batches) {
    if (remaining === 0) break;
    const rows = batch.rows.slice(0, remaining);
    if (rows.length > 0) {
      batches.push({ offset: batch.offset, rows });
      remaining -= rows.length;
    }
  }

  return {
    hasNextPage,
    result: {
      ...result,
      results: result.results.map((item, index) =>
        index === rowResultIndex
          ? {
              ...item,
              batches,
              rowCount: Math.min(item.rowCount, pageSize),
              retainedRowCount: Math.min(item.retainedRowCount, pageSize),
            }
          : item,
      ),
    },
  };
}
