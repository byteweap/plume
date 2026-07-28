export interface NamedObject {
  name: string;
}

export interface DatabaseSummary extends NamedObject {
  owner: string;
  allowConnections: boolean;
}

export interface RoleSummary extends NamedObject {
  canLogin: boolean;
  superuser: boolean;
}

export interface ServerOverview {
  databases: DatabaseSummary[];
  roles: RoleSummary[];
  tablespaces: NamedObject[];
}

export type DatabaseCollectionKind =
  | "casts"
  | "catalogs"
  | "event-triggers"
  | "extensions"
  | "foreign-data-wrappers"
  | "languages"
  | "publications"
  | "schemas"
  | "subscriptions";

export interface DatabaseCollectionSummary {
  kind: DatabaseCollectionKind;
  count: number;
}

export type CatalogCollectionKind =
  | "catalog-objects"
  | "aggregates"
  | "collations"
  | "domains"
  | "fts-configurations"
  | "fts-dictionaries"
  | "fts-parsers"
  | "fts-templates"
  | "foreign-tables"
  | "functions"
  | "materialized-views"
  | "operators"
  | "procedures"
  | "sequences"
  | "tables"
  | "trigger-functions"
  | "types"
  | "views";

export interface CatalogCollectionSummary {
  kind: CatalogCollectionKind;
  count?: number;
}

export type DatabaseObjectKind =
  | "table"
  | "foreign-table"
  | "view"
  | "materialized-view"
  | "sequence"
  | "function"
  | "procedure"
  | "type";

export interface DatabaseObject extends NamedObject {
  kind: DatabaseObjectKind;
}

export type LoadState<Value> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; value: Value }
  | { status: "error"; message: string };

export const databaseObjectKinds: DatabaseObjectKind[] = [
  "table",
  "foreign-table",
  "view",
  "materialized-view",
  "sequence",
  "function",
  "procedure",
  "type",
];

export function groupDatabaseObjects(
  objects: DatabaseObject[],
): Record<DatabaseObjectKind, DatabaseObject[]> {
  const groups: Record<DatabaseObjectKind, DatabaseObject[]> = {
    table: [],
    "foreign-table": [],
    view: [],
    "materialized-view": [],
    sequence: [],
    function: [],
    procedure: [],
    type: [],
  };

  for (const object of objects) groups[object.kind].push(object);
  return groups;
}
