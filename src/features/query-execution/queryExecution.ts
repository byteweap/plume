import type { CommandError } from "../../platform/tauri";
import type { SqlExecutionTarget } from "../sql-editor/SqlEditor";

export interface ExecuteQueryRequest {
  queryId: string;
  sessionId: string;
  database: string;
  sql: string;
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
}

export interface QueryStatementResult {
  kind: "rows" | "command";
  columns: QueryColumn[];
  rows: Array<Array<string | null>>;
  rowCount: number;
  affectedRows?: number;
  truncated: boolean;
}

export interface QueryExecutionResult {
  queryId: string;
  status: "succeeded";
  results: QueryStatementResult[];
}

export type QueryExecutionState =
  | { status: "idle" }
  | {
      status: "running";
      queryId: string;
      target: SqlExecutionTarget;
      cancelError?: CommandError;
    }
  | {
      status: "cancelling";
      queryId: string;
      target: SqlExecutionTarget;
      requestStatus: "requesting" | CancelQueryResult["status"];
    }
  | {
      status: "cancelled";
      queryId: string;
      target: SqlExecutionTarget;
    }
  | {
      status: "succeeded";
      queryId: string;
      target: SqlExecutionTarget;
      result: QueryExecutionResult;
    }
  | {
      status: "failed";
      queryId: string;
      target: SqlExecutionTarget;
      error: CommandError;
    };

export function createQueryId(): string {
  return globalThis.crypto.randomUUID();
}
