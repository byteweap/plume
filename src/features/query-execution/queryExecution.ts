import type { CommandError } from "../../platform/tauri";
import type { SqlExecutionTarget } from "../sql-editor/SqlEditor";

export const DEFAULT_QUERY_ROW_LIMIT = 10_000;
export const QUERY_ROW_LIMIT_OPTIONS = [100, 500, 1_000, 5_000, 10_000] as const;

export interface ExecuteQueryRequest {
  queryId: string;
  sessionId: string;
  database: string;
  sql: string;
  rowLimit: number;
  parameters?: QueryValue[];
  resultColumns?: QueryColumn[];
}

export interface CancelQueryRequest {
  queryId: string;
  sessionId: string;
  database: string;
}

export interface CancelQueryResult {
  queryId: string;
  status: "requested" | "alreadyFinished";
}

export interface QueryColumn {
  name: string;
  ordinal: number;
  dataType: QueryDataType;
}

export interface QueryDataType {
  oid?: number;
  name?: string;
  schema?: string;
  kind:
    | "simple"
    | "enum"
    | "pseudo"
    | "array"
    | "range"
    | "multirange"
    | "domain"
    | "composite"
    | "unknown";
}

export interface QueryRowBatch {
  offset: number;
  rows: QueryValue[][];
}

export type QueryValue = string | null;

export interface QueryStatementResult {
  statementIndex: number;
  status: "succeeded";
  kind: "rows" | "command";
  columns: QueryColumn[];
  batches: QueryRowBatch[];
  rowCount: number;
  retainedRowCount: number;
  affectedRows?: number;
  truncated: boolean;
}

export interface QueryExecutionResult {
  queryId: string;
  status: "succeeded";
  results: QueryStatementResult[];
}

export interface QueryResultSummary {
  returnedRows?: number;
  affectedRows?: number;
  truncated: boolean;
}

export type QueryExecutionState =
  | { status: "idle" }
  | {
      status: "running";
      queryId: string;
      target: SqlExecutionTarget;
      startedAt: number;
      cancelError?: CommandError;
    }
  | {
      status: "cancelling";
      queryId: string;
      target: SqlExecutionTarget;
      startedAt: number;
      requestStatus: "requesting" | CancelQueryResult["status"];
    }
  | {
      status: "cancelled";
      queryId: string;
      target: SqlExecutionTarget;
      startedAt: number;
      durationMs: number;
    }
  | {
      status: "succeeded";
      queryId: string;
      target: SqlExecutionTarget;
      result: QueryExecutionResult;
      startedAt: number;
      durationMs: number;
    }
  | {
      status: "failed";
      queryId: string;
      target: SqlExecutionTarget;
      error: CommandError;
      startedAt: number;
      durationMs: number;
    };

export function createQueryId(): string {
  return globalThis.crypto.randomUUID();
}

export function summarizeQueryResult(
  result: QueryExecutionResult,
): QueryResultSummary {
  let returnedRows: number | undefined;
  let affectedRows: number | undefined;
  let truncated = false;

  for (const statement of result.results) {
    if (statement.kind === "rows") {
      returnedRows = (returnedRows ?? 0) + statement.rowCount;
    } else if (statement.affectedRows !== undefined) {
      affectedRows = (affectedRows ?? 0) + statement.affectedRows;
    }
    truncated ||= statement.truncated;
  }

  return { returnedRows, affectedRows, truncated };
}

export function formatQueryDuration(durationMs: number): string {
  const milliseconds = Math.max(0, durationMs);
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(1)} s`;

  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = ((milliseconds % 60_000) / 1_000).toFixed(1);
  return `${minutes} m ${seconds} s`;
}
