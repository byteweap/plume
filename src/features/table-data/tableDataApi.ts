import { invokeCommand } from "../../platform/tauri";
import type {
  TableDataReference,
  TableEditabilityResponse,
} from "./tableData";
import type {
  CommitTableDataRequest,
  CommitTableDataResult,
} from "./tableDataCommit";

export const tableDataApi = {
  getEditability(
    sessionId: string,
    reference: TableDataReference,
  ): Promise<TableEditabilityResponse> {
    return invokeCommand<TableEditabilityResponse>("get_table_data_editability", {
      sessionId,
      database: reference.database,
      schema: reference.schema,
      table: reference.table,
    });
  },
  commit(request: CommitTableDataRequest): Promise<CommitTableDataResult> {
    return invokeCommand<CommitTableDataResult>("commit_table_data_changes", {
      request,
    });
  },
};
