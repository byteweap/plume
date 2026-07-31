import { startCompletion } from "@codemirror/autocomplete";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditorView } from "codemirror";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider";
import type { ConnectionProfile } from "../features/connections/connection";
import { connectionApi } from "../features/connections/connectionApi";
import { databaseTreeApi } from "../features/database-tree/databaseTreeApi";
import { queryDraftApi } from "../features/drafts/queryDraftApi";
import { queryHistoryApi } from "../features/history/queryHistoryApi";
import { queryExecutionApi } from "../features/query-execution/queryExecutionApi";
import {
  sqlCompletionApi,
  sqlCompletionCatalogCache,
} from "../features/sql-editor/sqlCompletionApi";
import { tableDataApi } from "../features/table-data/tableDataApi";
import { App, EnvironmentBadge, TableEditabilityStatus } from "./App";

const savedProfile: ConnectionProfile = {
  id: "profile-1",
  name: "Local saved",
  host: "localhost",
  port: 5432,
  database: "postgres",
  username: "postgres",
  environment: "development",
  color: "#2f6d52",
  sslMode: "disable",
  favorite: true,
  createdAt: 1,
  updatedAt: 1,
};
const clipboardWrite = vi.fn<(text: string) => Promise<void>>();

async function replaceEditorText(value: string) {
  const editor = await screen.findByRole("textbox", {
    name: "SQL query workspace",
  });
  const view = EditorView.findFromDOM(editor);
  if (!view) throw new Error("Expected a mounted CodeMirror editor");
  act(() => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
  });
  return editor;
}

describe("App sidebar", () => {
  beforeEach(() => {
    sqlCompletionCatalogCache.clear();
    clipboardWrite.mockReset();
    clipboardWrite.mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWrite },
    });
    vi.spyOn(queryDraftApi, "list").mockResolvedValue([]);
    vi.spyOn(queryDraftApi, "save").mockImplementation(async (request) => ({
      ...request,
      createdAt: 1,
      updatedAt: 2,
    }));
    vi.spyOn(queryDraftApi, "delete").mockResolvedValue();
    vi.spyOn(queryHistoryApi, "record").mockImplementation(async (request) => ({
      ...request,
      executedAt: 1,
    }));
    vi.spyOn(queryExecutionApi, "execute").mockImplementation(
      async (request) => ({
        queryId: request.queryId,
        status: "succeeded",
        results: [
          {
            statementIndex: 0,
            status: "succeeded",
            kind: "rows",
            columns: [
              {
                name: "value",
                ordinal: 0,
                dataType: {
                  oid: 23,
                  name: "int4",
                  schema: "pg_catalog",
                  kind: "simple",
                },
              },
            ],
            batches: [{ offset: 0, rows: [["2"]] }],
            rowCount: 1,
            retainedRowCount: 1,
            truncated: false,
          },
        ],
      }),
    );
    vi.spyOn(queryExecutionApi, "cancel").mockImplementation(async (request) => ({
      queryId: request.queryId,
      status: "requested",
    }));
    vi.spyOn(tableDataApi, "getEditability").mockResolvedValue({
      editable: true,
      key: {
        name: "users_pkey",
        kind: "primary-key",
        columns: ["id"],
      },
    });
    vi.spyOn(tableDataApi, "commit").mockImplementation(async (request) => ({
      requestId: request.requestId,
      insertedRows: request.insertedRows.length,
      updatedRows: request.updatedRows.length,
      deletedRows: request.deletedRows.length,
    }));
    vi.spyOn(sqlCompletionApi, "getCatalog").mockResolvedValue({ schemas: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("renders every connection environment with a persistent semantic tone", () => {
    window.localStorage.setItem("plume.locale", "en-US");
    render(
      <I18nProvider>
        <div>
          {(["development", "test", "staging", "production"] as const).map(
            (environment) => (
              <EnvironmentBadge
                key={environment}
                profile={{ environment, color: "#6b4ba1" }}
              />
            ),
          )}
        </div>
      </I18nProvider>,
    );

    for (const [environment, label] of [
      ["development", "Development"],
      ["test", "Test"],
      ["staging", "Staging"],
      ["production", "Production"],
    ] as const) {
      const badge = screen.getByLabelText(`Current environment: ${label}`);
      expect(badge).toHaveClass(`workspace-environment-${environment}`);
      expect(badge).toHaveStyle("--connection-accent: #6b4ba1");
    }
  });

  it("shows the reliable row key or a concrete read-only reason", () => {
    const { rerender } = render(
      <I18nProvider>
        <TableEditabilityStatus
          editability={{
            status: "editable",
            sessionId: "session-1",
            key: {
              name: "users_pkey",
              kind: "primary-key",
              columns: ["tenant_id", "id"],
            },
          }}
        />
      </I18nProvider>,
    );
    expect(screen.getByText("Editable")).toBeVisible();
    expect(screen.getByText("Primary key: tenant_id, id")).toBeVisible();

    rerender(
      <I18nProvider>
        <TableEditabilityStatus
          editability={{
            status: "read-only",
            sessionId: "session-1",
            reason: "no-reliable-key",
          }}
        />
      </I18nProvider>,
    );
    expect(screen.getByText("Read only")).toBeVisible();
    expect(
      screen.getByText("No primary key or non-null unique key can locate rows"),
    ).toBeVisible();
  });

  it("resizes by dragging the right divider", () => {
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    const resizer = screen.getByRole("separator", { name: "Resize sidebar" });
    const content = resizer.parentElement;
    const setPointerCapture = vi.fn();
    Object.defineProperties(resizer, {
      setPointerCapture: { value: setPointerCapture },
      hasPointerCapture: { value: () => false },
    });

    fireEvent.pointerDown(resizer, {
      button: 0,
      clientX: 286,
      pointerId: 1,
    });
    expect(content).toHaveClass("app-content-resizing");

    fireEvent.pointerMove(resizer, { clientX: 386, pointerId: 1 });

    expect(setPointerCapture).toHaveBeenCalledWith(1);
    expect(content).toHaveStyle({ "--sidebar-width": "386px" });

    fireEvent.pointerUp(resizer, { pointerId: 1 });
    expect(content).not.toHaveClass("app-content-resizing");
  });

  it("supports keyboard resizing and restores the default width", () => {
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    const resizer = screen.getByRole("separator", { name: "Resize sidebar" });
    const content = resizer.parentElement;

    expect(content).toHaveStyle({ "--sidebar-width": "286px" });

    fireEvent.keyDown(resizer, { key: "ArrowRight" });
    expect(content).toHaveStyle({ "--sidebar-width": "302px" });
    expect(resizer).toHaveAttribute("aria-valuenow", "302");

    fireEvent.doubleClick(resizer);
    expect(content).toHaveStyle({ "--sidebar-width": "286px" });
  });

  it("collapses and restores the sidebar at its previous width", () => {
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    const sidebar = screen.getByRole("complementary");
    const content = sidebar.parentElement;
    const resizer = screen.getByRole("separator", { name: "Resize sidebar" });

    fireEvent.keyDown(resizer, { key: "ArrowRight" });
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    expect(content).toHaveStyle({ "--sidebar-width": "0px" });
    expect(sidebar).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("separator", { name: "Resize sidebar" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));

    expect(content).toHaveStyle({ "--sidebar-width": "302px" });
    expect(sidebar).toHaveAttribute("aria-hidden", "false");
    expect(
      screen.getByRole("separator", { name: "Resize sidebar" }),
    ).toBeVisible();
  });

  it("restores saved profiles without connecting until the user selects one", async () => {
    vi.spyOn(connectionApi, "listProfiles").mockResolvedValue([savedProfile]);
    const connectSaved = vi.spyOn(connectionApi, "connectSaved").mockResolvedValue({
      sessionId: "session-1",
      database: "postgres",
      latencyMs: 12,
      serverVersion: "18.0",
      transport: "plain",
    });

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    const savedConnection = await screen.findByRole("button", {
      name: /Local saved/,
    });
    expect(savedConnection).toHaveTextContent("Disconnected");
    expect(connectSaved).not.toHaveBeenCalled();

    fireEvent.click(savedConnection);
    await waitFor(() => expect(connectSaved).toHaveBeenCalledWith("profile-1"));
    expect(await screen.findByText("PostgreSQL 18.0")).toBeVisible();
  });

  it("restores query drafts without connecting or executing them", async () => {
    vi.spyOn(connectionApi, "listProfiles").mockResolvedValue([savedProfile]);
    const connectSaved = vi.spyOn(connectionApi, "connectSaved");
    vi.mocked(queryDraftApi.list).mockResolvedValue([
      {
        id: "workspace-7",
        profileId: "profile-1",
        database: "postgres",
        schema: "public",
        title: "Audit users",
        sql: "select * from users;",
        createdAt: 1,
        updatedAt: 2,
      },
    ]);

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    const restored = await screen.findByRole("tab", { name: "Audit users" });
    expect(screen.getByRole("tab", { name: "Welcome" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(connectSaved).not.toHaveBeenCalled();

    fireEvent.click(restored);
    expect(
      await screen.findByRole("textbox", { name: "SQL query workspace" }),
    ).toHaveTextContent("select * from users;");
    expect(screen.getByText("Saved")).toBeVisible();
    expect(screen.getByText(/query draft remains editable/)).toBeVisible();
    expect(connectSaved).not.toHaveBeenCalled();
  });

  it("checks, explicitly reconnects, and disconnects without replaying the initial connect", async () => {
    vi.spyOn(connectionApi, "listProfiles").mockResolvedValue([savedProfile]);
    const connectSaved = vi.spyOn(connectionApi, "connectSaved").mockResolvedValue({
      sessionId: "session-1",
      database: "postgres",
      latencyMs: 12,
      serverVersion: "18.0",
      transport: "plain",
    });
    vi.spyOn(connectionApi, "checkSession").mockRejectedValue({
      code: "connection_failed",
      message: "The PostgreSQL session closed.",
    });
    const reconnectSaved = vi
      .spyOn(connectionApi, "reconnectSaved")
      .mockResolvedValue({
        sessionId: "session-2",
        database: "postgres",
        latencyMs: 9,
        serverVersion: "18.1",
        transport: "plain",
      });
    const disconnect = vi.spyOn(connectionApi, "disconnect").mockResolvedValue();

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: /Local saved/ }),
    );
    await screen.findByText("PostgreSQL 18.0");

    fireEvent.click(screen.getByRole("button", { name: "Connection actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Check connection" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The PostgreSQL session closed.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    await waitFor(() =>
      expect(reconnectSaved).toHaveBeenCalledWith("profile-1", "session-1"),
    );
    expect(await screen.findByText("PostgreSQL 18.1")).toBeVisible();
    expect(connectSaved).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Connection actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Disconnect" }));
    await waitFor(() => expect(disconnect).toHaveBeenCalledWith("session-2"));
    expect(await screen.findByText(/Disconnected · localhost:5432/)).toBeVisible();
  });

  it("does not replay a failed write query after an explicit reconnect", async () => {
    vi.spyOn(connectionApi, "listProfiles").mockResolvedValue([savedProfile]);
    vi.spyOn(connectionApi, "connectSaved").mockResolvedValue({
      sessionId: "session-1",
      database: "postgres",
      latencyMs: 12,
      serverVersion: "18.0",
      transport: "plain",
    });
    const reconnectSaved = vi
      .spyOn(connectionApi, "reconnectSaved")
      .mockResolvedValue({
        sessionId: "session-2",
        database: "postgres",
        latencyMs: 9,
        serverVersion: "18.1",
        transport: "plain",
      });
    vi.mocked(queryExecutionApi.execute).mockRejectedValueOnce({
      code: "connection_failed",
      message: "The connection closed after the write was submitted.",
    });

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Local saved/ }));
    await screen.findByText("PostgreSQL 18.0");
    fireEvent.click(screen.getAllByRole("button", { name: "New query" })[0]!);
    await replaceEditorText("INSERT INTO audit_events DEFAULT VALUES;");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Run selection or current statement",
      }),
    );

    await waitFor(() => expect(queryExecutionApi.execute).toHaveBeenCalledOnce());
    await waitFor(() => expect(queryHistoryApi.record).toHaveBeenCalledOnce());
    expect(queryHistoryApi.record).toHaveBeenLastCalledWith(
      expect.objectContaining({
        profileId: "profile-1",
        database: "postgres",
        sql: "INSERT INTO audit_events DEFAULT VALUES;",
        resultStatus: "failed",
      }),
    );
    const firstRequest = vi.mocked(queryExecutionApi.execute).mock.calls[0]![0];
    expect(firstRequest).toMatchObject({
      sessionId: "session-1",
      sql: "INSERT INTO audit_events DEFAULT VALUES;",
    });

    fireEvent.click(await screen.findByRole("button", { name: "Reconnect" }));
    await waitFor(() =>
      expect(reconnectSaved).toHaveBeenCalledWith("profile-1", "session-1"),
    );
    const run = screen.getByRole("button", {
      name: "Run selection or current statement",
    });
    await waitFor(() => expect(run).toBeEnabled());
    expect(queryExecutionApi.execute).toHaveBeenCalledOnce();

    fireEvent.click(run);
    await waitFor(() => expect(queryExecutionApi.execute).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(queryHistoryApi.record).toHaveBeenCalledTimes(2));
    expect(queryHistoryApi.record).toHaveBeenLastCalledWith(
      expect.objectContaining({ resultStatus: "succeeded" }),
    );
    const secondRequest = vi.mocked(queryExecutionApi.execute).mock.calls[1]![0];
    expect(secondRequest.sessionId).toBe("session-2");
    expect(secondRequest.queryId).not.toBe(firstRequest.queryId);
  });

  it("creates, switches, renames, and closes connection-bound query tabs", async () => {
    vi.spyOn(connectionApi, "listProfiles").mockResolvedValue([savedProfile]);
    vi.spyOn(connectionApi, "connectSaved").mockResolvedValue({
      sessionId: "session-1",
      database: "postgres",
      latencyMs: 12,
      serverVersion: "18.0",
      transport: "plain",
    });
    vi.spyOn(window, "prompt").mockReturnValue("Audit users");

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Local saved/ }));
    await screen.findByText("PostgreSQL 18.0");

    fireEvent.click(screen.getAllByRole("button", { name: "New query" })[0]!);
    expect(screen.getByRole("tab", { name: "Query 1" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Local saved / postgres")).toBeVisible();
    expect(
      await screen.findByRole("textbox", { name: "SQL query workspace" }),
    ).toBeVisible();
    await replaceEditorText("select * from users;");

    fireEvent.click(screen.getByRole("button", { name: "New query" }));
    const secondQuery = screen.getByRole("tab", { name: "Query 2" });
    fireEvent.doubleClick(secondQuery);
    expect(window.prompt).toHaveBeenCalledWith(
      "Enter a new tab name",
      "Query 2",
    );
    expect(screen.getByRole("tab", { name: "Audit users" })).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "Close tab Audit users" }),
    );
    expect(screen.queryByRole("tab", { name: "Audit users" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Query 1" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("textbox", { name: "SQL query workspace" }),
    ).toHaveTextContent("select * from users;");
    expect(queryDraftApi.delete).toHaveBeenCalledWith("workspace-3");
  });

  it("debounces draft persistence and reports the saved state", async () => {
    vi.spyOn(connectionApi, "listProfiles").mockResolvedValue([savedProfile]);
    vi.spyOn(connectionApi, "connectSaved").mockResolvedValue({
      sessionId: "session-1",
      database: "postgres",
      latencyMs: 12,
      serverVersion: "18.0",
      transport: "plain",
    });

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Local saved/ }));
    await screen.findByText("PostgreSQL 18.0");
    fireEvent.click(screen.getAllByRole("button", { name: "New query" })[0]!);
    await replaceEditorText("select current_user;");

    expect(screen.getByText("Unsaved")).toBeVisible();
    await waitFor(() => expect(queryDraftApi.save).toHaveBeenCalledTimes(1), {
      timeout: 1_500,
    });
    expect(queryDraftApi.save).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Query 1",
        sql: "select current_user;",
        profileId: "profile-1",
      }),
    );
    expect(await screen.findByText("Saved")).toBeVisible();
    expect(screen.getByRole("button", { name: "Save query draft" })).toBeDisabled();
  });

  it("does not restore a draft whose save finishes after its tab closes", async () => {
    vi.spyOn(connectionApi, "listProfiles").mockResolvedValue([savedProfile]);
    vi.spyOn(connectionApi, "connectSaved").mockResolvedValue({
      sessionId: "session-1",
      database: "postgres",
      latencyMs: 12,
      serverVersion: "18.0",
      transport: "plain",
    });
    let resolveSave!: (draft: Awaited<ReturnType<typeof queryDraftApi.save>>) => void;
    vi.mocked(queryDraftApi.save).mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Local saved/ }));
    await screen.findByText("PostgreSQL 18.0");
    fireEvent.click(screen.getAllByRole("button", { name: "New query" })[0]!);
    await replaceEditorText("select 1;");
    await waitFor(() => expect(queryDraftApi.save).toHaveBeenCalledTimes(1), {
      timeout: 1_500,
    });

    fireEvent.click(screen.getByRole("button", { name: "Close tab Query 1" }));
    expect(queryDraftApi.delete).toHaveBeenCalledTimes(1);
    act(() => {
      resolveSave({
        id: "workspace-2",
        profileId: "profile-1",
        database: "postgres",
        title: "Query 1",
        sql: "select 1;",
        createdAt: 1,
        updatedAt: 2,
      });
    });

    await waitFor(() => expect(queryDraftApi.delete).toHaveBeenCalledTimes(2));
    expect(queryDraftApi.delete).toHaveBeenLastCalledWith("workspace-2");
    expect(screen.queryByRole("tab", { name: "Query 1" })).toBeNull();
  });

  it("keeps a query tab offline and reuses its profile context after reconnect", async () => {
    vi.spyOn(connectionApi, "listProfiles").mockResolvedValue([savedProfile]);
    const connectSaved = vi
      .spyOn(connectionApi, "connectSaved")
      .mockResolvedValueOnce({
        sessionId: "session-1",
        database: "postgres",
        latencyMs: 12,
        serverVersion: "18.0",
        transport: "plain",
      })
      .mockResolvedValueOnce({
        sessionId: "session-2",
        database: "postgres",
        latencyMs: 8,
        serverVersion: "18.1",
        transport: "plain",
      });
    vi.spyOn(connectionApi, "disconnect").mockResolvedValue();

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Local saved/ }));
    await screen.findByText("PostgreSQL 18.0");
    fireEvent.click(screen.getAllByRole("button", { name: "New query" })[0]!);
    await replaceEditorText("select current_database();");

    fireEvent.click(screen.getByRole("button", { name: "Connection actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Disconnect" }));
    expect(
      await screen.findByText(
        "Connection unavailable; the query draft remains editable.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("textbox", { name: "SQL query workspace" }),
    ).toHaveTextContent("select current_database();");
    expect(screen.getByRole("tab", { name: "Query 1" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    await waitFor(() => expect(connectSaved).toHaveBeenCalledTimes(2));
    expect(connectSaved).toHaveBeenLastCalledWith("profile-1");
    expect(screen.getByRole("tab", { name: "Query 1" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByText("Local saved / postgres")).toBeVisible();
    expect(
      screen.getByRole("textbox", { name: "SQL query workspace" }),
    ).toHaveTextContent("select current_database();");
  });

  it("supports roving keyboard focus across workspace tabs", async () => {
    vi.spyOn(connectionApi, "listProfiles").mockResolvedValue([savedProfile]);
    vi.spyOn(connectionApi, "connectSaved").mockResolvedValue({
      sessionId: "session-1",
      database: "postgres",
      latencyMs: 12,
      serverVersion: "18.0",
      transport: "plain",
    });

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Local saved/ }));
    await screen.findByText("PostgreSQL 18.0");
    const connectionTab = screen.getByRole("tab", { name: "Local saved" });
    connectionTab.focus();
    fireEvent.keyDown(connectionTab, { key: "Home" });

    expect(screen.getByRole("tab", { name: "Welcome" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Welcome" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("keeps the active query tab while refreshing connection objects", async () => {
    vi.spyOn(connectionApi, "listProfiles").mockResolvedValue([savedProfile]);
    vi.spyOn(connectionApi, "connectSaved").mockResolvedValue({
      sessionId: "session-1",
      database: "postgres",
      latencyMs: 12,
      serverVersion: "18.0",
      transport: "plain",
    });
    const getServerTree = vi
      .spyOn(databaseTreeApi, "getServerTree")
      .mockResolvedValue({ databases: [], roles: [], tablespaces: [] });

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: /^Local saved/ }),
    );
    await screen.findByText("PostgreSQL 18.0");
    fireEvent.click(screen.getAllByRole("button", { name: "New query" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: /^Local saved/ }));
    await screen.findByRole("button", { name: "Databases" });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Refresh connection objects Local saved",
      }),
    );
    await waitFor(() => expect(getServerTree).toHaveBeenCalledTimes(2));

    expect(screen.getByRole("tab", { name: "Query 1" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Local saved / postgres")).toBeVisible();
  });

  it("loads at most 200 rows when a table is opened from the tree", async () => {
    vi.spyOn(connectionApi, "listProfiles").mockResolvedValue([savedProfile]);
    vi.spyOn(connectionApi, "connectSaved").mockResolvedValue({
      sessionId: "session-1",
      database: "postgres",
      latencyMs: 12,
      serverVersion: "18.0",
      transport: "plain",
    });
    const disconnect = vi.spyOn(connectionApi, "disconnect").mockResolvedValue();
    vi.spyOn(databaseTreeApi, "getServerTree").mockResolvedValue({
      databases: [
        { name: "postgres", owner: "postgres", allowConnections: true },
      ],
      roles: [],
      tablespaces: [],
    });
    vi.spyOn(databaseTreeApi, "getDatabaseTree").mockResolvedValue([
      { kind: "schemas", count: 1 },
    ]);
    vi.spyOn(databaseTreeApi, "getDatabaseCollectionItems").mockResolvedValue([
      { name: "public" },
    ]);
    vi.spyOn(databaseTreeApi, "getSchemaObjects").mockResolvedValue([
      { name: "users", kind: "table" },
    ]);
    vi.mocked(queryExecutionApi.execute).mockImplementationOnce(
      async (request) => ({
        queryId: request.queryId,
        status: "succeeded",
        results: [
          {
            statementIndex: 0,
            status: "succeeded",
            kind: "rows",
            columns: [
              { name: "id", ordinal: 0, dataType: { kind: "simple" } },
            ],
            batches: [
              {
                offset: 0,
                rows: Array.from({ length: 201 }, (_, index) => [
                  String(index + 1),
                ]),
              },
            ],
            rowCount: 201,
            retainedRowCount: 201,
            truncated: false,
          },
        ],
      }),
    );

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    const connection = await screen.findByRole("button", {
      name: /^Local saved/,
    });
    fireEvent.click(connection);
    await screen.findByText("PostgreSQL 18.0");
    fireEvent.click(screen.getByRole("button", { name: /^Local saved/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Databases/ }));
    fireEvent.click(await screen.findByRole("button", { name: "postgres" }));
    fireEvent.click(await screen.findByRole("button", { name: "Schemas (1)" }));
    fireEvent.click(await screen.findByRole("button", { name: "public" }));
    fireEvent.click(await screen.findByRole("button", { name: "Tables (1)" }));
    fireEvent.doubleClick(await screen.findByRole("button", { name: "users" }));

    await waitFor(() => expect(queryExecutionApi.execute).toHaveBeenCalledOnce());
    await waitFor(() => expect(tableDataApi.getEditability).toHaveBeenCalledOnce());
    expect(queryHistoryApi.record).not.toHaveBeenCalled();
    expect(tableDataApi.getEditability).toHaveBeenCalledWith("session-1", {
      database: "postgres",
      schema: "public",
      table: "users",
    });
    expect(queryExecutionApi.execute).toHaveBeenCalledWith({
      queryId: expect.any(String),
      sessionId: "session-1",
      database: "postgres",
      sql: 'SELECT *\nFROM "public"."users"\nLIMIT 201\nOFFSET 0;',
      rowLimit: 201,
    });
    expect(screen.getByRole("tab", { name: "users" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByText("Page 1")).toBeVisible();
    expect(await screen.findByText("Editable")).toBeVisible();
    expect(screen.getByText("Primary key: id")).toBeVisible();
    expect(await screen.findByRole("grid", { name: "Result 1" })).toBeVisible();
    const addRow = screen.getByRole("button", { name: "Add row" });
    expect(addRow).toBeEnabled();
    fireEvent.click(addRow);
    expect(queryExecutionApi.execute).toHaveBeenCalledOnce();

    const beforeUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Close tab users" }));
    expect(screen.getByRole("dialog", { name: "Uncommitted data changes" })).toBeVisible();
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel" })[1]!);
    expect(screen.getByRole("tab", { name: "users" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Connection actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Disconnect" }));
    expect(screen.getByRole("dialog", { name: "Uncommitted data changes" })).toBeVisible();
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel" })[1]!);
    expect(disconnect).not.toHaveBeenCalled();

    const discardAll = screen.getByRole("button", {
      name: "Discard all changes",
    });
    expect(discardAll).toBeEnabled();
    fireEvent.click(discardAll);
    expect(screen.queryByText("Review changes")).toBeNull();
    expect(discardAll).toBeDisabled();
    expect(tableDataApi.commit).not.toHaveBeenCalled();
    expect(queryExecutionApi.execute).toHaveBeenCalledOnce();

    fireEvent.click(addRow);
    const nextPage = screen.getByRole("button", { name: "Next page" });
    expect(nextPage).toBeEnabled();
    fireEvent.click(nextPage);
    await waitFor(() => expect(queryExecutionApi.execute).toHaveBeenCalledTimes(2));
    expect(queryExecutionApi.execute).toHaveBeenLastCalledWith({
      queryId: expect.any(String),
      sessionId: "session-1",
      database: "postgres",
      sql: 'SELECT *\nFROM "public"."users"\nLIMIT 201\nOFFSET 200;',
      rowLimit: 201,
    });
    expect(await screen.findByText("Page 2")).toBeVisible();
    expect(nextPage).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeEnabled();

    fireEvent.change(screen.getByRole("combobox", { name: "Rows per page" }), {
      target: { value: "50" },
    });
    await waitFor(() => expect(queryExecutionApi.execute).toHaveBeenCalledTimes(3));
    expect(queryExecutionApi.execute).toHaveBeenLastCalledWith({
      queryId: expect.any(String),
      sessionId: "session-1",
      database: "postgres",
      sql: 'SELECT *\nFROM "public"."users"\nLIMIT 51\nOFFSET 0;',
      rowLimit: 51,
    });
    expect(await screen.findByText("Page 1")).toBeVisible();

    fireEvent.click(
      await screen.findByRole("columnheader", { name: /^value/ }),
    );
    await waitFor(() => expect(queryExecutionApi.execute).toHaveBeenCalledTimes(4));
    expect(queryExecutionApi.execute).toHaveBeenLastCalledWith({
      queryId: expect.any(String),
      sessionId: "session-1",
      database: "postgres",
      sql: 'SELECT *\nFROM "public"."users"\nORDER BY 1 ASC\nLIMIT 51\nOFFSET 0;',
      rowLimit: 51,
    });
    expect(screen.getByLabelText("Current sort")).toHaveTextContent("1. value");

    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.click(screen.getByRole("button", { name: "Add condition" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Filter value" }), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(queryExecutionApi.execute).toHaveBeenCalledTimes(5));
    expect(queryExecutionApi.execute).toHaveBeenLastCalledWith({
      queryId: expect.any(String),
      sessionId: "session-1",
      database: "postgres",
      sql:
        'SELECT "value"::text AS "value"\n' +
        'FROM "public"."users"\n' +
        'WHERE "value" = $1::text::"pg_catalog"."int4"\n' +
        'ORDER BY 1 ASC\nLIMIT 51\nOFFSET 0;',
      rowLimit: 51,
      parameters: ["10"],
      resultColumns: [
        {
          name: "value",
          ordinal: 0,
          dataType: {
            oid: 23,
            name: "int4",
            schema: "pg_catalog",
            kind: "simple",
          },
        },
      ],
    });

    const commitChanges = screen.getByRole("button", {
      name: "Commit all changes",
    });
    expect(commitChanges).toBeEnabled();
    vi.mocked(tableDataApi.commit).mockRejectedValueOnce({
      code: "query_failed",
      message: "duplicate key value violates unique constraint",
    });
    fireEvent.click(commitChanges);
    await waitFor(() => expect(tableDataApi.commit).toHaveBeenCalledOnce());
    expect(tableDataApi.commit).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        database: "postgres",
        schema: "public",
        table: "users",
        keyColumns: ["id"],
        insertedRows: [{ values: [{ kind: "default" }] }],
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "duplicate key value violates unique constraint",
    );
    expect(screen.getByText("Review changes")).toBeVisible();
    expect(commitChanges).toBeEnabled();
    expect(queryExecutionApi.execute).toHaveBeenCalledTimes(5);

    fireEvent.click(commitChanges);
    await waitFor(() => expect(tableDataApi.commit).toHaveBeenCalledTimes(2));
    expect(
      vi.mocked(tableDataApi.commit).mock.calls[1]![0].requestId,
    ).not.toBe(vi.mocked(tableDataApi.commit).mock.calls[0]![0].requestId);
    await waitFor(() => expect(queryExecutionApi.execute).toHaveBeenCalledTimes(6));
    expect(screen.queryByText("Review changes")).toBeNull();
    expect(commitChanges).toBeDisabled();

  });

  it("executes the cursor statement and all SQL with connection ownership", async () => {
    vi.spyOn(connectionApi, "listProfiles").mockResolvedValue([savedProfile]);
    vi.spyOn(connectionApi, "connectSaved").mockResolvedValue({
      sessionId: "session-1",
      database: "postgres",
      latencyMs: 12,
      serverVersion: "18.0",
      transport: "plain",
    });

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Local saved/ }));
    await screen.findByText("PostgreSQL 18.0");
    fireEvent.click(screen.getAllByRole("button", { name: "New query" })[0]!);
    const editor = await replaceEditorText("select 1;\nselect 2;");
    const rowLimit = screen.getByRole("combobox", {
      name: "Result row limit",
    });
    expect(rowLimit).toHaveValue("10000");
    const view = EditorView.findFromDOM(editor)!;
    act(() => {
      view.dispatch({ selection: { anchor: view.state.doc.length - 2 } });
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Run selection or current statement",
      }),
    );
    await waitFor(() => expect(queryExecutionApi.execute).toHaveBeenCalledTimes(1));
    expect(queryExecutionApi.execute).toHaveBeenLastCalledWith({
      queryId: expect.any(String),
      sessionId: "session-1",
      database: "postgres",
      sql: "select 2;",
      rowLimit: 10_000,
    });
    expect(await screen.findByText("Query completed")).toBeVisible();
    expect(screen.getByText("Rows returned 1")).toBeVisible();
    expect(screen.getByText(/^Duration /)).toBeVisible();
    expect(
      await screen.findByRole("grid", { name: "Result 1" }),
    ).toHaveTextContent("2");

    const resultResizer = screen.getByRole("separator", {
      name: "Resize query results",
    });
    expect(resultResizer).toHaveAttribute("aria-valuenow", "260");
    fireEvent.keyDown(resultResizer, { key: "ArrowDown" });
    expect(resultResizer).toHaveAttribute("aria-valuenow", "240");

    fireEvent.change(rowLimit, { target: { value: "500" } });
    expect(rowLimit).toHaveValue("500");
    fireEvent.click(screen.getByRole("button", { name: "Run all SQL" }));
    await waitFor(() => expect(queryExecutionApi.execute).toHaveBeenCalledTimes(2));
    expect(queryExecutionApi.execute).toHaveBeenLastCalledWith({
      queryId: expect.any(String),
      sessionId: "session-1",
      database: "postgres",
      sql: "select 1;\nselect 2;",
      rowLimit: 500,
    });
  });

  it("requires explicit confirmation before executing detected dangerous SQL", async () => {
    vi.spyOn(connectionApi, "listProfiles").mockResolvedValue([savedProfile]);
    vi.spyOn(connectionApi, "connectSaved").mockResolvedValue({
      sessionId: "session-1",
      database: "postgres",
      latencyMs: 12,
      serverVersion: "18.0",
      transport: "plain",
    });

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Local saved/ }));
    await screen.findByText("PostgreSQL 18.0");
    fireEvent.click(screen.getAllByRole("button", { name: "New query" })[0]!);
    await replaceEditorText("DELETE FROM public.sessions;");

    const run = screen.getByRole("button", {
      name: "Run selection or current statement",
    });
    fireEvent.click(run);

    const dialog = await screen.findByRole("alertdialog", {
      name: "Confirm dangerous SQL",
    });
    expect(dialog).toHaveTextContent("Local saved");
    expect(dialog).toHaveTextContent("localhost:5432");
    expect(dialog).toHaveTextContent("postgres");
    expect(dialog).toHaveTextContent("public");
    expect(dialog).toHaveTextContent("DELETE without WHERE");
    expect(queryExecutionApi.execute).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(queryExecutionApi.execute).not.toHaveBeenCalled();

    fireEvent.click(run);
    fireEvent.click(
      await screen.findByRole("button", { name: "Execute anyway" }),
    );
    await waitFor(() => expect(queryExecutionApi.execute).toHaveBeenCalledOnce());
    expect(queryExecutionApi.execute).toHaveBeenCalledWith({
      queryId: expect.any(String),
      sessionId: "session-1",
      database: "postgres",
      sql: "DELETE FROM public.sessions;",
      rowLimit: 10_000,
    });
  });

  it("applies the saved connection risk policy before prompting", async () => {
    vi.spyOn(connectionApi, "listProfiles").mockResolvedValue([
      { ...savedProfile, sqlRiskPolicy: "critical-only" },
    ]);
    vi.spyOn(connectionApi, "connectSaved").mockResolvedValue({
      sessionId: "session-1",
      database: "postgres",
      latencyMs: 12,
      serverVersion: "18.0",
      transport: "plain",
    });

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Local saved/ }));
    await screen.findByText("PostgreSQL 18.0");
    fireEvent.click(screen.getAllByRole("button", { name: "New query" })[0]!);
    const run = screen.getByRole("button", {
      name: "Run selection or current statement",
    });

    await replaceEditorText("DELETE FROM public.sessions;");
    fireEvent.click(run);
    await waitFor(() => expect(queryExecutionApi.execute).toHaveBeenCalledOnce());
    expect(screen.queryByRole("alertdialog")).toBeNull();

    await replaceEditorText("DROP TABLE public.logs;");
    fireEvent.click(run);
    expect(
      await screen.findByRole("alertdialog", { name: "Confirm dangerous SQL" }),
    ).toBeVisible();
    expect(queryExecutionApi.execute).toHaveBeenCalledOnce();
  });

  it("requires the exact database name for critical production SQL", async () => {
    vi.spyOn(connectionApi, "listProfiles").mockResolvedValue([
      {
        ...savedProfile,
        environment: "production",
        sqlRiskPolicy: "all",
      },
    ]);
    vi.spyOn(connectionApi, "connectSaved").mockResolvedValue({
      sessionId: "session-1",
      database: "postgres",
      latencyMs: 12,
      serverVersion: "18.0",
      transport: "plain",
    });

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Local saved/ }));
    await screen.findByText("PostgreSQL 18.0");
    fireEvent.click(screen.getAllByRole("button", { name: "New query" })[0]!);
    await replaceEditorText("TRUNCATE TABLE public.events;");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Run selection or current statement",
      }),
    );

    const execute = await screen.findByRole("button", { name: "Execute anyway" });
    const confirmation = screen.getByRole("textbox", {
      name: "Enter Database name",
    });
    expect(execute).toBeDisabled();
    expect(queryExecutionApi.execute).not.toHaveBeenCalled();
    fireEvent.change(confirmation, { target: { value: "Postgres" } });
    expect(execute).toBeDisabled();
    fireEvent.change(confirmation, { target: { value: "postgres" } });
    fireEvent.click(execute);

    await waitFor(() => expect(queryExecutionApi.execute).toHaveBeenCalledOnce());
    expect(queryExecutionApi.execute).toHaveBeenCalledWith(
      expect.objectContaining({ sql: "TRUNCATE TABLE public.events;" }),
    );
  });

  it("reports query errors without marking a healthy session disconnected", async () => {
    vi.spyOn(connectionApi, "listProfiles").mockResolvedValue([savedProfile]);
    vi.spyOn(connectionApi, "connectSaved").mockResolvedValue({
      sessionId: "session-1",
      database: "postgres",
      latencyMs: 12,
      serverVersion: "18.0",
      transport: "plain",
    });
    vi.mocked(queryExecutionApi.execute).mockRejectedValue({
      code: "query_failed",
      message: "syntax error at or near select",
      detail: "PostgreSQL detail",
      diagnostic: {
        sqlState: "42601",
        severity: "ERROR",
        hint: "Check the statement",
        position: 8,
      },
    });

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Local saved/ }));
    await screen.findByText("PostgreSQL 18.0");
    fireEvent.click(screen.getAllByRole("button", { name: "New query" })[0]!);
    const editor = await replaceEditorText("select from;");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Run selection or current statement",
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "syntax error at or near select",
    );
    expect(screen.getByText("42601")).toBeVisible();
    expect(screen.getByText("ERROR")).toBeVisible();
    expect(screen.getByText("PostgreSQL detail")).toBeVisible();
    expect(screen.getByText("Check the statement")).toBeVisible();
    await waitFor(() => {
      expect(EditorView.findFromDOM(editor)?.state.selection.main).toMatchObject({
        from: 7,
        to: 8,
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Copy error details" }));
    await waitFor(() =>
      expect(clipboardWrite).toHaveBeenCalledWith(
        [
          "Message: syntax error at or near select",
          "SQLSTATE: 42601",
          "Severity: ERROR",
          "Position: 8",
          "Detail: PostgreSQL detail",
          "Hint: Check the statement",
        ].join("\n"),
      ),
    );
    expect(
      screen.getByRole("button", { name: "Error details copied" }),
    ).toBeVisible();
    expect(screen.getByText(/Connected · localhost:5432/)).toBeVisible();
  });

  it("loads SQL completion metadata for the active session and database", async () => {
    vi.spyOn(connectionApi, "listProfiles").mockResolvedValue([savedProfile]);
    vi.spyOn(connectionApi, "connectSaved").mockResolvedValue({
      sessionId: "session-1",
      database: "postgres",
      latencyMs: 12,
      serverVersion: "18.0",
      transport: "plain",
    });

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Local saved/ }));
    await screen.findByText("PostgreSQL 18.0");
    fireEvent.click(screen.getAllByRole("button", { name: "New query" })[0]!);
    const editor = await replaceEditorText("select * from ite");
    const view = EditorView.findFromDOM(editor)!;

    act(() => {
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      startCompletion(view);
    });

    await waitFor(() =>
      expect(sqlCompletionApi.getCatalog).toHaveBeenCalledWith({
        sessionId: "session-1",
        database: "postgres",
        defaultSchema: "public",
      }),
    );
  });

  it("waits for PostgreSQL confirmation before showing a query as cancelled", async () => {
    vi.spyOn(connectionApi, "listProfiles").mockResolvedValue([savedProfile]);
    vi.spyOn(connectionApi, "connectSaved").mockResolvedValue({
      sessionId: "session-1",
      database: "postgres",
      latencyMs: 12,
      serverVersion: "18.0",
      transport: "plain",
    });
    let rejectExecution!: (error: unknown) => void;
    vi.mocked(queryExecutionApi.execute).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectExecution = reject;
        }),
    );

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Local saved/ }));
    await screen.findByText("PostgreSQL 18.0");
    fireEvent.click(screen.getAllByRole("button", { name: "New query" })[0]!);
    await replaceEditorText("select pg_sleep(10);");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Run selection or current statement",
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Cancel query" }));

    expect(queryExecutionApi.cancel).toHaveBeenCalledWith({
      queryId: expect.any(String),
      sessionId: "session-1",
      database: "postgres",
    });
    expect(
      await screen.findByText("Cancellation requested; waiting for PostgreSQL…"),
    ).toBeVisible();
    expect(screen.getByText(/^Elapsed /)).toBeVisible();
    expect(screen.queryByText("Query cancelled")).not.toBeInTheDocument();

    await act(async () => {
      rejectExecution({
        code: "query_cancelled",
        message: "The query was cancelled by PostgreSQL.",
      });
    });
    expect(await screen.findByText("Query cancelled")).toBeVisible();
    expect(screen.getByText(/^Duration /)).toBeVisible();
    expect(screen.getByText(/Connected · localhost:5432/)).toBeVisible();
  });
});
