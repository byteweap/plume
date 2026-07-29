import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditorView } from "codemirror";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider";
import type { ConnectionProfile } from "../features/connections/connection";
import { connectionApi } from "../features/connections/connectionApi";
import { databaseTreeApi } from "../features/database-tree/databaseTreeApi";
import { queryDraftApi } from "../features/drafts/queryDraftApi";
import { queryExecutionApi } from "../features/query-execution/queryExecutionApi";
import { App } from "./App";

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
    vi.spyOn(queryDraftApi, "list").mockResolvedValue([]);
    vi.spyOn(queryDraftApi, "save").mockImplementation(async (request) => ({
      ...request,
      createdAt: 1,
      updatedAt: 2,
    }));
    vi.spyOn(queryDraftApi, "delete").mockResolvedValue();
    vi.spyOn(queryExecutionApi, "execute").mockImplementation(
      async (request) => ({
        queryId: request.queryId,
        status: "succeeded",
        results: [
          {
            kind: "rows",
            columns: [{ name: "value", ordinal: 0 }],
            rows: [["2"]],
            rowCount: 1,
            truncated: false,
          },
        ],
      }),
    );
  });

  afterEach(() => vi.restoreAllMocks());

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
    });
    expect(await screen.findByText("Query completed")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Run all SQL" }));
    await waitFor(() => expect(queryExecutionApi.execute).toHaveBeenCalledTimes(2));
    expect(queryExecutionApi.execute).toHaveBeenLastCalledWith({
      queryId: expect.any(String),
      sessionId: "session-1",
      database: "postgres",
      sql: "select 1;\nselect 2;",
    });
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
    });

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Local saved/ }));
    await screen.findByText("PostgreSQL 18.0");
    fireEvent.click(screen.getAllByRole("button", { name: "New query" })[0]!);
    await replaceEditorText("select from;");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Run selection or current statement",
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "syntax error at or near select",
    );
    expect(screen.getByText(/Connected · localhost:5432/)).toBeVisible();
  });
});
