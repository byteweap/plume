import { invokeCommand } from "../../platform/tauri";
import type {
  DatabaseCollectionKind,
  DatabaseCollectionSummary,
  DatabaseObject,
  NamedObject,
  ServerOverview,
} from "./databaseTree";

export const databaseTreeApi = {
  getServerTree(sessionId: string): Promise<ServerOverview> {
    return invokeCommand<ServerOverview>("get_server_tree", { sessionId });
  },
  getDatabaseTree(
    sessionId: string,
    database: string,
  ): Promise<DatabaseCollectionSummary[]> {
    return invokeCommand<DatabaseCollectionSummary[]>("get_database_tree", {
      sessionId,
      database,
    });
  },
  getDatabaseCollectionItems(
    sessionId: string,
    database: string,
    collection: DatabaseCollectionKind,
  ): Promise<NamedObject[]> {
    return invokeCommand<NamedObject[]>("get_database_collection_items", {
      sessionId,
      database,
      collection,
    });
  },
  getSchemaObjects(
    sessionId: string,
    database: string,
    schema: string,
  ): Promise<DatabaseObject[]> {
    return invokeCommand<DatabaseObject[]>("get_schema_objects", {
      sessionId,
      database,
      schema,
    });
  },
};
