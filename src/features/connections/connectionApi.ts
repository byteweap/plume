import { invokeCommand } from "../../platform/tauri";
import type {
  ConnectedDatabaseResult,
  ConnectionTestRequest,
  ConnectionTestResult,
} from "./connection";

export const connectionApi = {
  test(request: ConnectionTestRequest): Promise<ConnectionTestResult> {
    return invokeCommand<ConnectionTestResult>("test_connection", { request });
  },
  connect(request: ConnectionTestRequest): Promise<ConnectedDatabaseResult> {
    return invokeCommand<ConnectedDatabaseResult>("connect_database", { request });
  },
};
