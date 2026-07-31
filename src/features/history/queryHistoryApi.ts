import { invokeCommand } from "../../platform/tauri";
import type {
  QueryHistory,
  RecordQueryHistoryRequest,
} from "./queryHistory";

export const queryHistoryApi = {
  record(request: RecordQueryHistoryRequest): Promise<QueryHistory> {
    return invokeCommand<QueryHistory>("record_query_history", { request });
  },
};
