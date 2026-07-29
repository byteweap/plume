import { invokeCommand } from "../../platform/tauri";
import type {
  ExecuteQueryRequest,
  QueryExecutionResult,
} from "./queryExecution";

export const queryExecutionApi = {
  execute(request: ExecuteQueryRequest): Promise<QueryExecutionResult> {
    return invokeCommand<QueryExecutionResult>("execute_query", { request });
  },
};
