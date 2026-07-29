import { invokeCommand } from "../../platform/tauri";
import {
  SqlCompletionCatalogCache,
  type SqlCompletionCatalog,
  type SqlCompletionConnection,
} from "./sqlCompletion";

export const sqlCompletionApi = {
  getCatalog(
    connection: SqlCompletionConnection,
  ): Promise<SqlCompletionCatalog> {
    return invokeCommand<SqlCompletionCatalog>("get_sql_completions", {
      sessionId: connection.sessionId,
      database: connection.database,
    });
  },
};

export const sqlCompletionCatalogCache = new SqlCompletionCatalogCache(
  (connection) => sqlCompletionApi.getCatalog(connection),
);
