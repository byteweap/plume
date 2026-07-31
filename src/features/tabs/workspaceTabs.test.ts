import { describe, expect, it } from "vitest";
import {
  createInitialWorkspaceTabsState,
  getActiveWorkspaceTab,
  getQueryExecution,
  workspaceTabsReducer,
} from "./workspaceTabs";

const context = {
  profileId: "profile-1",
  database: "postgres",
  schema: "public",
};

describe("workspaceTabsReducer", () => {
  it("opens one connection overview for the same context", () => {
    let state = createInitialWorkspaceTabsState();
    state = workspaceTabsReducer(state, { type: "open-connection", ...context });
    const connectionTabId = state.activeTabId;
    state = workspaceTabsReducer(state, { type: "activate", tabId: "welcome" });
    state = workspaceTabsReducer(state, { type: "open-connection", ...context });

    expect(state.tabs).toHaveLength(2);
    expect(state.activeTabId).toBe(connectionTabId);
    expect(getActiveWorkspaceTab(state)).toMatchObject({
      kind: "connection",
      ...context,
    });
  });

  it("creates independent, connection-bound query tabs", () => {
    let state = createInitialWorkspaceTabsState();
    state = workspaceTabsReducer(state, {
      type: "open-query",
      titlePrefix: "Query",
      ...context,
    });
    state = workspaceTabsReducer(state, {
      type: "open-query",
      titlePrefix: "Query",
      profileId: "profile-2",
      database: "analytics",
    });

    expect(state.tabs.slice(1)).toEqual([
      expect.objectContaining({
        title: "Query 1",
        sql: "",
        draftState: "unsaved",
        ...context,
      }),
      expect.objectContaining({
        title: "Query 2",
        profileId: "profile-2",
        database: "analytics",
      }),
    ]);
  });

  it("reuses a table-data tab for the same qualified table", () => {
    let state = createInitialWorkspaceTabsState();
    state = workspaceTabsReducer(state, {
      type: "open-table-data",
      table: "users",
      ...context,
    });
    const tableTabId = state.activeTabId;
    state = workspaceTabsReducer(state, { type: "activate", tabId: "welcome" });
    state = workspaceTabsReducer(state, {
      type: "open-table-data",
      table: "users",
      ...context,
    });

    expect(state.tabs).toHaveLength(2);
    expect(state.activeTabId).toBe(tableTabId);
    expect(getActiveWorkspaceTab(state)).toMatchObject({
      kind: "table-data",
      title: "users",
      table: "users",
      ...context,
    });

    state = workspaceTabsReducer(state, {
      type: "set-table-data-page",
      tabId: tableTabId,
      pageIndex: 3,
      pageSize: 50,
    });
    expect(getActiveWorkspaceTab(state)).toMatchObject({
      kind: "table-data",
      pageIndex: 3,
      pageSize: 50,
      hasNextPage: false,
    });

    state = workspaceTabsReducer(state, {
      type: "set-table-data-sort",
      tabId: tableTabId,
      sorts: [{ columnIndex: 1, columnName: "name", direction: "DESC" }],
    });
    expect(getActiveWorkspaceTab(state)).toMatchObject({
      kind: "table-data",
      pageIndex: 0,
      pageSize: 50,
      sorts: [{ columnIndex: 1, columnName: "name", direction: "DESC" }],
    });

    state = workspaceTabsReducer(state, {
      type: "set-table-data-filters",
      tabId: tableTabId,
      filters: [
        {
          columnIndex: 1,
          columnName: "name",
          dataType: { kind: "simple" },
          operator: "contains",
          value: "Ada",
        },
      ],
    });
    expect(getActiveWorkspaceTab(state)).toMatchObject({
      kind: "table-data",
      pageIndex: 0,
      filters: [
        { columnIndex: 1, operator: "contains", value: "Ada" },
      ],
    });
  });

  it("keeps SQL drafts isolated by query tab", () => {
    let state = createInitialWorkspaceTabsState();
    state = workspaceTabsReducer(state, {
      type: "open-query",
      titlePrefix: "Query",
      ...context,
    });
    const firstQueryId = state.activeTabId;
    state = workspaceTabsReducer(state, {
      type: "open-query",
      titlePrefix: "Query",
      ...context,
    });
    const secondQueryId = state.activeTabId;
    state = workspaceTabsReducer(state, {
      type: "update-query",
      tabId: firstQueryId,
      sql: "select * from users;",
    });

    expect(state.tabs.find((tab) => tab.id === firstQueryId)).toMatchObject({
      kind: "query",
      sql: "select * from users;",
    });
    expect(state.tabs.find((tab) => tab.id === secondQueryId)).toMatchObject({
      kind: "query",
      sql: "",
    });
  });

  it("restores saved drafts without activating them and advances counters", () => {
    const state = workspaceTabsReducer(createInitialWorkspaceTabsState(), {
      type: "restore-queries",
      tabs: [
        {
          id: "workspace-7",
          kind: "query",
          title: "Query 12",
          sql: "select 12;",
          draftState: "saved",
          updatedAt: 10,
          ...context,
        },
      ],
    });

    expect(state.activeTabId).toBe("welcome");
    expect(state.nextTabId).toBe(8);
    expect(state.nextQueryNumber).toBe(13);
    expect(state.tabs[1]).toMatchObject({
      id: "workspace-7",
      draftState: "saved",
    });
  });

  it("does not mark a newer edit saved when an older request completes", () => {
    let state = createInitialWorkspaceTabsState();
    state = workspaceTabsReducer(state, {
      type: "open-query",
      titlePrefix: "Query",
      ...context,
    });
    const tabId = state.activeTabId;
    state = workspaceTabsReducer(state, {
      type: "update-query",
      tabId,
      sql: "select 1;",
    });
    state = workspaceTabsReducer(state, { type: "draft-saving", tabId });
    state = workspaceTabsReducer(state, {
      type: "update-query",
      tabId,
      sql: "select 2;",
    });
    state = workspaceTabsReducer(state, {
      type: "draft-saved",
      tabId,
      title: "Query 1",
      sql: "select 1;",
      updatedAt: 20,
    });

    expect(state.tabs.find((tab) => tab.id === tabId)).toMatchObject({
      sql: "select 2;",
      draftState: "unsaved",
    });
  });

  it("keeps query execution state isolated and ignores stale responses", () => {
    let state = createInitialWorkspaceTabsState();
    state = workspaceTabsReducer(state, {
      type: "open-query",
      titlePrefix: "Query",
      ...context,
    });
    const tabId = state.activeTabId;
    const target = {
      sql: "select 1;",
      from: 0,
      to: 9,
      source: "statement" as const,
    };
    state = workspaceTabsReducer(state, {
      type: "query-started",
      tabId,
      queryId: "query-2",
      target,
      startedAt: 1_000,
    });
    state = workspaceTabsReducer(state, {
      type: "query-succeeded",
      tabId,
      result: { queryId: "query-1", status: "succeeded", results: [] },
      finishedAt: 1_500,
    });

    const runningTab = state.tabs.find(
      (tab) => tab.id === tabId && tab.kind === "query",
    );
    if (!runningTab || runningTab.kind !== "query") {
      throw new Error("Expected the running query tab");
    }
    expect(getQueryExecution(runningTab)).toMatchObject({
      status: "running",
      queryId: "query-2",
    });

    state = workspaceTabsReducer(state, {
      type: "query-failed",
      tabId,
      queryId: "query-2",
      error: { code: "query_failed", message: "syntax error" },
      finishedAt: 1_750,
    });
    const failedTab = state.tabs.find(
      (tab) => tab.id === tabId && tab.kind === "query",
    );
    if (!failedTab || failedTab.kind !== "query") {
      throw new Error("Expected the failed query tab");
    }
    expect(getQueryExecution(failedTab)).toMatchObject({
      status: "failed",
      queryId: "query-2",
      error: { code: "query_failed", message: "syntax error" },
      durationMs: 750,
    });
  });

  it("lets the execution result arbitrate cancellation races", () => {
    let state = createInitialWorkspaceTabsState();
    state = workspaceTabsReducer(state, {
      type: "open-query",
      titlePrefix: "Query",
      ...context,
    });
    const tabId = state.activeTabId;
    const target = {
      sql: "select pg_sleep(10);",
      from: 0,
      to: 20,
      source: "statement" as const,
    };
    state = workspaceTabsReducer(state, {
      type: "query-started",
      tabId,
      queryId: "query-1",
      target,
      startedAt: 1_000,
    });
    state = workspaceTabsReducer(state, {
      type: "query-cancelling",
      tabId,
      queryId: "query-1",
    });
    state = workspaceTabsReducer(state, {
      type: "query-cancel-requested",
      tabId,
      result: { queryId: "query-1", status: "requested" },
    });

    const cancellingTab = state.tabs.find(
      (tab) => tab.id === tabId && tab.kind === "query",
    );
    expect(cancellingTab).toMatchObject({
      execution: {
        status: "cancelling",
        requestStatus: "requested",
      },
    });

    state = workspaceTabsReducer(state, {
      type: "query-succeeded",
      tabId,
      result: { queryId: "query-1", status: "succeeded", results: [] },
      finishedAt: 1_300,
    });
    state = workspaceTabsReducer(state, {
      type: "query-cancelled",
      tabId,
      queryId: "query-1",
      finishedAt: 1_400,
    });
    const succeededTab = state.tabs.find(
      (tab) => tab.id === tabId && tab.kind === "query",
    );
    expect(succeededTab).toMatchObject({
      execution: { status: "succeeded", startedAt: 1_000, durationMs: 300 },
    });
  });

  it("shows confirmed and failed cancellation outcomes", () => {
    let state = createInitialWorkspaceTabsState();
    state = workspaceTabsReducer(state, {
      type: "open-query",
      titlePrefix: "Query",
      ...context,
    });
    const tabId = state.activeTabId;
    const target = {
      sql: "select pg_sleep(10);",
      from: 0,
      to: 20,
      source: "statement" as const,
    };
    state = workspaceTabsReducer(state, {
      type: "query-started",
      tabId,
      queryId: "query-1",
      target,
      startedAt: 1_000,
    });
    state = workspaceTabsReducer(state, {
      type: "query-cancelling",
      tabId,
      queryId: "query-1",
    });
    state = workspaceTabsReducer(state, {
      type: "query-cancel-failed",
      tabId,
      queryId: "query-1",
      error: { code: "query_cancellation_failed", message: "Send failed" },
    });
    const runningTab = state.tabs.find(
      (tab) => tab.id === tabId && tab.kind === "query",
    );
    expect(runningTab).toMatchObject({
      execution: {
        status: "running",
        cancelError: { message: "Send failed" },
      },
    });

    state = workspaceTabsReducer(state, {
      type: "query-cancelling",
      tabId,
      queryId: "query-1",
    });
    state = workspaceTabsReducer(state, {
      type: "query-cancelled",
      tabId,
      queryId: "query-1",
      finishedAt: 1_300,
    });
    const cancelledTab = state.tabs.find(
      (tab) => tab.id === tabId && tab.kind === "query",
    );
    expect(cancelledTab).toMatchObject({
      execution: { status: "cancelled", startedAt: 1_000, durationMs: 300 },
    });
  });

  it("renames tabs and selects an adjacent tab when closing the active tab", () => {
    let state = createInitialWorkspaceTabsState();
    state = workspaceTabsReducer(state, {
      type: "open-query",
      titlePrefix: "Query",
      ...context,
    });
    const firstQueryId = state.activeTabId;
    state = workspaceTabsReducer(state, {
      type: "open-query",
      titlePrefix: "Query",
      ...context,
    });
    const secondQueryId = state.activeTabId;
    state = workspaceTabsReducer(state, {
      type: "rename",
      tabId: secondQueryId,
      title: "  Audit users  ",
    });
    state = workspaceTabsReducer(state, {
      type: "close",
      tabId: secondQueryId,
    });

    expect(state.tabs.some((tab) => tab.id === secondQueryId)).toBe(false);
    expect(state.activeTabId).toBe(firstQueryId);
  });

  it("closes every tab owned by a deleted profile", () => {
    let state = createInitialWorkspaceTabsState();
    state = workspaceTabsReducer(state, { type: "open-connection", ...context });
    state = workspaceTabsReducer(state, {
      type: "open-query",
      titlePrefix: "Query",
      ...context,
    });
    state = workspaceTabsReducer(state, {
      type: "open-query",
      titlePrefix: "Query",
      profileId: "profile-2",
      database: "analytics",
    });
    const remainingTabId = state.activeTabId;
    state = workspaceTabsReducer(state, {
      type: "activate",
      tabId: state.tabs[1]!.id,
    });
    state = workspaceTabsReducer(state, {
      type: "close-profile",
      profileId: "profile-1",
    });

    expect(state.tabs).toHaveLength(2);
    expect(state.tabs.some((tab) => tab.id === remainingTabId)).toBe(true);
    expect(state.activeTabId).toBe(remainingTabId);
  });
});
