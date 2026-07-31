import type { SqlExecutionTarget } from "../sql-editor/SqlEditor";
import type {
  QueryColumn,
  QueryDataType,
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

export interface TableIdentityKey {
  name: string;
  kind: "primary-key" | "unique-key";
  columns: string[];
}

export interface TableEditabilityResponse {
  editable: boolean;
  key?: TableIdentityKey | null;
  reason?: "no-reliable-key" | null;
}

export type TableDataEditability =
  | { status: "idle" }
  | { status: "loading"; sessionId: string }
  | { status: "editable"; sessionId: string; key: TableIdentityKey }
  | {
      status: "read-only";
      sessionId: string;
      reason: "no-reliable-key" | "metadata-unavailable";
    };

export interface TableDataPage {
  pageIndex: number;
  pageSize: number;
}

export interface TableDataSort {
  columnIndex: number;
  columnName: string;
  direction: "ASC" | "DESC";
}

export type TableDataFilterOperator =
  | "equals"
  | "notEquals"
  | "contains"
  | "greaterThan"
  | "greaterThanOrEqual"
  | "lessThan"
  | "lessThanOrEqual"
  | "isNull"
  | "isNotNull";

export interface TableDataFilter {
  columnIndex: number;
  columnName: string;
  dataType: QueryDataType;
  operator: TableDataFilterOperator;
  value: string;
}

export interface TableDataQuery {
  target: SqlExecutionTarget;
  parameters: Array<string | null>;
  resultColumns?: QueryColumn[];
}

export function resolveTableDataEditability(
  response: TableEditabilityResponse,
  sessionId: string,
): TableDataEditability {
  if (response.editable && response.key) {
    return { status: "editable", sessionId, key: response.key };
  }
  return {
    status: "read-only",
    sessionId,
    reason: response.reason ?? "metadata-unavailable",
  };
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

export function createTableDataQuery(
  reference: Pick<TableDataReference, "schema" | "table">,
  page: TableDataPage,
  sorts: TableDataSort[],
  columns: QueryColumn[],
  filters: TableDataFilter[],
): TableDataQuery {
  if (filters.length === 0) {
    return {
      target: createTableDataTarget(reference, page, sorts),
      parameters: [],
    };
  }

  const parameters: string[] = [];
  const predicates = filters.map((filter) => {
    const column = quotePostgresIdentifier(filter.columnName);
    if (filter.operator === "isNull") return `${column} IS NULL`;
    if (filter.operator === "isNotNull") return `${column} IS NOT NULL`;

    parameters.push(filter.value);
    const parameter = `$${parameters.length}::text`;
    if (filter.operator === "contains") {
      return `pg_catalog.strpos(${column}::text, ${parameter}) > 0`;
    }
    const typedColumn = getComparableColumn(column, filter.dataType);
    const typedParameter = getTypedParameter(parameter, filter.dataType);
    const operator = {
      equals: "=",
      notEquals: "<>",
      greaterThan: ">",
      greaterThanOrEqual: ">=",
      lessThan: "<",
      lessThanOrEqual: "<=",
    }[filter.operator];
    return `${typedColumn} ${operator} ${typedParameter}`;
  });
  const projection = columns
    .map((column) => {
      const identifier = quotePostgresIdentifier(column.name);
      return `${identifier}::text AS ${identifier}`;
    })
    .join(", ");
  const probeLimit = page.pageSize + 1;
  const offset = page.pageIndex * page.pageSize;
  const orderBy = sorts.length
    ? `\nORDER BY ${sorts
        .map((sort) => `${sort.columnIndex + 1} ${sort.direction}`)
        .join(", ")}`
    : "";
  const sql = `SELECT ${projection}\nFROM ${quotePostgresIdentifier(reference.schema)}.${quotePostgresIdentifier(reference.table)}\nWHERE ${predicates.join("\n  AND ")}${orderBy}\nLIMIT ${probeLimit}\nOFFSET ${offset};`;
  return {
    target: { sql, from: 0, to: sql.length, source: "document" },
    parameters,
    resultColumns: columns,
  };
}

function getComparableColumn(column: string, dataType: QueryDataType): string {
  return dataType.name ? column : `${column}::text`;
}

function getTypedParameter(parameter: string, dataType: QueryDataType): string {
  if (!dataType.name) return parameter;
  const schema = dataType.schema
    ? `${quotePostgresIdentifier(dataType.schema)}.`
    : "";
  return `${parameter}::${schema}${quotePostgresIdentifier(dataType.name)}`;
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
