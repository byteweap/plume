import { invokeCommand } from "../../platform/tauri";
import type {
  TableDataReference,
  TableEditabilityResponse,
} from "./tableData";

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
};
