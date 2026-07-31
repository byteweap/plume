import { describe, expect, it } from "vitest";
import {
  createInitialWorkspaceTabsState,
  workspaceTabsReducer,
} from "../tabs/workspaceTabs";
import { createWorkspaceSnapshotRequest } from "./workspaceSnapshot";

describe("createWorkspaceSnapshotRequest", () => {
  it("keeps layout and unsaved SQL while excluding execution results", () => {
    let state = workspaceTabsReducer(createInitialWorkspaceTabsState(), {
      type: "open-query",
      titlePrefix: "Query",
      profileId: "profile-1",
      database: "postgres",
      schema: "public",
    });
    const tabId = state.activeTabId;
    state = workspaceTabsReducer(state, {
      type: "update-query",
      tabId,
      sql: "select secret_value from audit;",
    });
    state = workspaceTabsReducer(state, {
      type: "query-started",
      tabId,
      queryId: "7e26bd56-4818-4da0-8789-c3a9174db23e",
      target: {
        sql: "select secret_value from audit;",
        from: 0,
        to: 31,
        source: "document",
      },
      startedAt: 1,
    });
    state = workspaceTabsReducer(state, {
      type: "query-succeeded",
      tabId,
      finishedAt: 2,
      result: {
        queryId: "7e26bd56-4818-4da0-8789-c3a9174db23e",
        status: "succeeded",
        results: [
          {
            statementIndex: 0,
            status: "succeeded",
            kind: "rows",
            columns: [],
            batches: [{ offset: 0, rows: [["must-not-be-persisted"]] }],
            rowCount: 1,
            retainedRowCount: 1,
            truncated: false,
          },
        ],
      },
    });

    const snapshot = createWorkspaceSnapshotRequest(state, {
      sidebarWidth: 302,
      sidebarCollapsed: true,
    });

    expect(snapshot.layout).toEqual({
      sidebarWidth: 302,
      sidebarCollapsed: true,
    });
    expect(snapshot.tabs[1]).toEqual({
      id: tabId,
      kind: "query",
      profileId: "profile-1",
      database: "postgres",
      schema: "public",
      title: "Query 1",
      sql: "select secret_value from audit;",
    });
    expect(JSON.stringify(snapshot)).not.toContain("must-not-be-persisted");
    expect(JSON.stringify(snapshot)).not.toContain("execution");
  });
});
