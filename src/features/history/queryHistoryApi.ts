import { invokeCommand } from "../../platform/tauri";
import type {
  QueryHistory,
  RecordQueryHistoryRequest,
} from "./queryHistory";

export const queryHistoryApi = {
  record(request: RecordQueryHistoryRequest): Promise<QueryHistory> {
    return invokeCommand<QueryHistory>("record_query_history", { request });
  },
  list(search = ""): Promise<QueryHistory[]> {
    return invokeCommand<QueryHistory[]>("list_query_history", {
      request: { search, limit: 100 },
    });
  },
  clear(): Promise<void> {
    return invokeCommand<void>("clear_query_history");
  },
};
