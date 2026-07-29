import { CompletionContext } from "@codemirror/autocomplete";
import { PostgreSQL, sql } from "@codemirror/lang-sql";
import { EditorState } from "@codemirror/state";
import { describe, expect, it, vi } from "vitest";
import {
  SqlCompletionCatalogCache,
  buildCompletionSchema,
  createDatabaseCompletionSource,
  type SqlCompletionCatalog,
  type SqlCompletionConnection,
} from "./sqlCompletion";

const connection: SqlCompletionConnection = {
  sessionId: "session-1",
  database: "postgres",
  defaultSchema: "public",
};

const catalog: SqlCompletionCatalog = {
  schemas: [
    {
      name: "public",
      relations: [
        {
          name: "items",
          kind: "table",
          columns: ["id", "display_name"],
        },
        {
          name: "item_view",
          kind: "view",
          columns: ["id"],
        },
      ],
    },
  ],
};

describe("SQL completion", () => {
  it("deduplicates catalog requests per session and database", async () => {
    const loadCatalog = vi.fn(async () => catalog);
    const cache = new SqlCompletionCatalogCache(loadCatalog);

    await Promise.all([cache.load(connection), cache.load(connection)]);
    await cache.load({ ...connection, defaultSchema: "other" });
    await cache.load({ ...connection, database: "analytics" });

    expect(loadCatalog).toHaveBeenCalledTimes(2);
  });

  it("removes failed requests so a later completion can retry", async () => {
    const loadCatalog = vi
      .fn<() => Promise<SqlCompletionCatalog>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(catalog);
    const cache = new SqlCompletionCatalogCache(loadCatalog);

    await expect(cache.load(connection)).rejects.toThrow("offline");
    await expect(cache.load(connection)).resolves.toBe(catalog);
    expect(loadCatalog).toHaveBeenCalledTimes(2);
  });

  it("discards a catalog response after the connection context changes", async () => {
    let resolveCatalog!: (value: SqlCompletionCatalog) => void;
    let currentConnection: SqlCompletionConnection | undefined = connection;
    const source = createDatabaseCompletionSource(
      () => currentConnection,
      () =>
        new Promise((resolve) => {
          resolveCatalog = resolve;
        }),
    );
    const state = EditorState.create({
      doc: "SELECT * FROM it",
      extensions: [sql({ dialect: PostgreSQL })],
    });
    const pending = source(new CompletionContext(state, state.doc.length, true));

    currentConnection = { ...connection, sessionId: "session-2" };
    resolveCatalog(catalog);

    await expect(pending).resolves.toBeNull();
  });

  it("builds typed schema, relation, and column namespaces", () => {
    expect(buildCompletionSchema(catalog)).toMatchObject({
      public: {
        self: { label: "public", type: "namespace" },
        children: {
          items: {
            self: { label: "items", type: "class" },
            children: [
              { label: "id", type: "property" },
              { label: "display_name", type: "property" },
            ],
          },
          item_view: {
            self: { label: "item_view", type: "interface" },
          },
        },
      },
    });
  });
});
