import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SavedConnection } from "../connections/connection";
import { I18nProvider } from "../../i18n/I18nProvider";
import { ConnectionTreeItem } from "./ConnectionTreeItem";
import { databaseTreeApi } from "./databaseTreeApi";

const connection: SavedConnection = {
  id: "connection-1",
  sessionId: "session-1",
  name: "Local",
  host: "localhost",
  port: 5433,
  database: "postgres",
  username: "postgres",
  environment: "development",
  sslMode: "disable",
  serverVersion: "18.0",
};

describe("ConnectionTreeItem", () => {
  afterEach(() => vi.restoreAllMocks());

  it("loads schemas and schema objects lazily", async () => {
    const getServerTree = vi
      .spyOn(databaseTreeApi, "getServerTree")
      .mockResolvedValue({
        databases: [
          {
            name: "postgres",
            owner: "root",
            allowConnections: true,
          },
        ],
        roles: [{ name: "root", canLogin: true, superuser: true }],
        tablespaces: [{ name: "pg_default" }],
      });
    const getDatabaseTree = vi
      .spyOn(databaseTreeApi, "getDatabaseTree")
      .mockResolvedValue([{ kind: "schemas", count: 1 }]);
    const getDatabaseCollectionItems = vi
      .spyOn(databaseTreeApi, "getDatabaseCollectionItems")
      .mockResolvedValue([{ name: "public" }]);
    const getSchemaObjects = vi
      .spyOn(databaseTreeApi, "getSchemaObjects")
      .mockResolvedValue([{ name: "users", kind: "table" }]);

    render(
      <I18nProvider>
        <ConnectionTreeItem
          connection={connection}
          environmentClassName="environment-development"
          selected
          onSelect={() => undefined}
        />
      </I18nProvider>,
    );

    expect(getServerTree).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Local/ }));

    const databasesButton = await screen.findByRole("button", {
      name: /Databases/,
    });
    expect(getServerTree).toHaveBeenCalledWith("session-1");
    expect(getDatabaseTree).not.toHaveBeenCalled();
    fireEvent.click(databasesButton);

    const databaseButton = await screen.findByRole("button", {
      name: "postgres",
    });
    fireEvent.click(databaseButton);

    const schemasButton = await screen.findByRole("button", {
      name: /Schemas/,
    });
    expect(getDatabaseTree).toHaveBeenCalledWith("session-1", "postgres");
    fireEvent.click(schemasButton);

    const schemaButton = await screen.findByRole("button", { name: "public" });
    expect(getDatabaseCollectionItems).toHaveBeenCalledWith(
      "session-1",
      "postgres",
      "schemas",
    );
    expect(getSchemaObjects).not.toHaveBeenCalled();

    fireEvent.click(schemaButton);

    const tablesButton = await screen.findByRole("button", {
      name: "Tables (1)",
    });
    expect(getSchemaObjects).toHaveBeenCalledWith(
      "session-1",
      "postgres",
      "public",
    );
    fireEvent.click(tablesButton);
    expect(await screen.findByText("users")).toBeVisible();
  });

  it("hides zero collection counts and renders an empty collection locally", async () => {
    vi.spyOn(databaseTreeApi, "getServerTree").mockResolvedValue({
      databases: [
        {
          name: "postgres",
          owner: "root",
          allowConnections: true,
        },
      ],
      roles: [],
      tablespaces: [],
    });
    vi.spyOn(databaseTreeApi, "getDatabaseTree").mockResolvedValue([
      { kind: "casts", count: 0 },
    ]);
    const getDatabaseCollectionItems = vi.spyOn(
      databaseTreeApi,
      "getDatabaseCollectionItems",
    );

    render(
      <I18nProvider>
        <ConnectionTreeItem
          connection={connection}
          environmentClassName="environment-development"
          selected
          onSelect={() => undefined}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Local/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Databases/ }));
    fireEvent.click(await screen.findByRole("button", { name: "postgres" }));

    const castsButton = await screen.findByRole("button", { name: "Casts" });
    fireEvent.click(castsButton);

    expect(await screen.findByText("No visible objects")).toBeVisible();
    expect(getDatabaseCollectionItems).not.toHaveBeenCalled();
  });
});
