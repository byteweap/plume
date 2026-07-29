import { invokeCommand } from "../../platform/tauri";
import type {
  CancelQueryRequest,
  CancelQueryResult,
  ExecuteQueryRequest,
  QueryExecutionResult,
} from "./queryExecution";

export const queryExecutionApi = {
  execute(request: ExecuteQueryRequest): Promise<QueryExecutionResult> {
    return invokeCommand<QueryExecutionResult>("execute_query", { request });
  },
  cancel(request: CancelQueryRequest): Promise<CancelQueryResult> {
    return invokeCommand<CancelQueryResult>("cancel_query", { request });
  },
};
