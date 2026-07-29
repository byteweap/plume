import {
  completeFromList,
  ifNotIn,
  type Completion,
  type CompletionSource,
} from "@codemirror/autocomplete";
import {
  PostgreSQL,
  schemaCompletionSource,
  type SQLNamespace,
} from "@codemirror/lang-sql";
import type { Extension } from "@codemirror/state";

export interface SqlCompletionConnection {
  sessionId: string;
  database: string;
  defaultSchema?: string;
}

export interface SqlCompletionCatalog {
  schemas: SqlCompletionSchema[];
}

export interface SqlCompletionSchema {
  name: string;
  relations: SqlCompletionRelation[];
}

export interface SqlCompletionRelation {
  name: string;
  kind: "table" | "foreign-table" | "view" | "materialized-view";
  columns: string[];
}

export type LoadSqlCompletionCatalog = (
  connection: SqlCompletionConnection,
) => Promise<SqlCompletionCatalog>;

const commonPostgreSqlFunctionNames = [
  "avg",
  "coalesce",
  "count",
  "current_database",
  "current_schema",
  "current_user",
  "date_trunc",
  "extract",
  "generate_series",
  "greatest",
  "json_agg",
  "json_build_object",
  "least",
  "max",
  "min",
  "now",
  "nullif",
  "row_number",
  "string_agg",
  "sum",
] as const;
const commonPostgreSqlFunctionSet = new Set<string>(commonPostgreSqlFunctionNames);
const postgreSqlKeywordSet = new Set(
  `${PostgreSQL.spec.keywords ?? ""} ${PostgreSQL.spec.builtin ?? ""}`.split(" "),
);
const commonPostgreSqlFunctions: Completion[] = commonPostgreSqlFunctionNames
  .filter((label) => !postgreSqlKeywordSet.has(label))
  .map((label) => ({
    label,
    type: "function",
    detail: "PostgreSQL",
    boost: 1,
  }));

export class SqlCompletionCatalogCache {
  private readonly requests = new Map<string, Promise<SqlCompletionCatalog>>();

  constructor(private readonly loadCatalog: LoadSqlCompletionCatalog) {}

  load(connection: SqlCompletionConnection): Promise<SqlCompletionCatalog> {
    const key = completionConnectionKey(connection);
    const cached = this.requests.get(key);
    if (cached) return cached;

    const request = this.loadCatalog(connection).catch((error: unknown) => {
      if (this.requests.get(key) === request) this.requests.delete(key);
      throw error;
    });
    this.requests.set(key, request);
    return request;
  }

  clear(): void {
    this.requests.clear();
  }
}

export function createSqlCompletionExtensions(
  getConnection: () => SqlCompletionConnection | undefined,
  loadCatalog: LoadSqlCompletionCatalog,
): Extension {
  return [
    PostgreSQL.language.data.of({
      autocomplete: ifNotIn(
        ["QuotedIdentifier", "String", "LineComment", "BlockComment", "."],
        completeFromList(commonPostgreSqlFunctions),
      ),
    }),
    PostgreSQL.language.data.of({
      autocomplete: ifNotIn(
        ["String", "LineComment", "BlockComment"],
        createDatabaseCompletionSource(getConnection, loadCatalog),
      ),
    }),
  ];
}

export function createDatabaseCompletionSource(
  getConnection: () => SqlCompletionConnection | undefined,
  loadCatalog: LoadSqlCompletionCatalog,
): CompletionSource {
  return async (context) => {
    const token = context.matchBefore(/[\w$\u0080-\uffff".]+$/);
    if (!context.explicit && !token) return null;

    const connection = getConnection();
    if (!connection) return null;
    const connectionKey = completionConnectionKey(connection);

    try {
      const catalog = await loadCatalog(connection);
      const currentConnection = getConnection();
      if (
        context.aborted ||
        !currentConnection ||
        completionConnectionKey(currentConnection) !== connectionKey
      ) {
        return null;
      }

      return schemaCompletionSource({
        dialect: PostgreSQL,
        schema: buildCompletionSchema(catalog),
        defaultSchema: connection.defaultSchema,
      })(context);
    } catch {
      return null;
    }
  };
}

export function buildCompletionSchema(catalog: SqlCompletionCatalog): SQLNamespace {
  return Object.fromEntries(
    catalog.schemas.map((schema) => [
      schema.name,
      {
        self: { label: schema.name, type: "namespace" },
        children: Object.fromEntries(
          schema.relations.map((relation) => [
            relation.name,
            {
              self: {
                label: relation.name,
                type: relationCompletionType(relation.kind),
                detail: schema.name,
              },
              children: relation.columns.map((column) => ({
                label: column,
                type: "property",
                detail: `${schema.name}.${relation.name}`,
              })),
            },
          ]),
        ),
      },
    ]),
  );
}

export function buildPostgreSqlKeywordCompletion(
  label: string,
  type: string,
): Completion {
  return {
    label,
    type: commonPostgreSqlFunctionSet.has(label.toLowerCase()) ? "function" : type,
    boost: commonPostgreSqlFunctionSet.has(label.toLowerCase()) ? 1 : -1,
  };
}

function relationCompletionType(kind: SqlCompletionRelation["kind"]): string {
  return kind === "view" || kind === "materialized-view" ? "interface" : "class";
}

function completionConnectionKey(connection: SqlCompletionConnection): string {
  return `${connection.sessionId}\u0000${connection.database}`;
}
