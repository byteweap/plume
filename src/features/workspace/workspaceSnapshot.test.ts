import { describe, expect, it } from "vitest";
import {
  createInitialWorkspaceTabsState,
  workspaceTabsReducer,
} from "../tabs/workspaceTabs";
import {
  createRestoredWorkspaceState,
  createWorkspaceSnapshotRequest,
  type WorkspaceSnapshot,
} from "./workspaceSnapshot";

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

describe("createRestoredWorkspaceState", () => {
  it("restores safe tab metadata, prefers snapshot SQL, and drops missing profiles", () => {
    const snapshot: WorkspaceSnapshot = {
      activeTabId: "workspace-2",
      nextTabId: 8,
      nextQueryNumber: 4,
      layout: { sidebarWidth: 320, sidebarCollapsed: true },
      updatedAt: 10,
      tabs: [
        { id: "welcome", kind: "welcome" },
        {
          id: "workspace-1",
          kind: "connection",
          profileId: "profile-1",
          database: "postgres",
        },
        {
          id: "workspace-2",
          kind: "query",
          profileId: "profile-1",
          database: "postgres",
          schema: "public",
          title: "Recovered query",
          sql: "select 'snapshot edit';",
        },
        {
          id: "workspace-3",
          kind: "table-data",
          profileId: "profile-1",
          database: "postgres",
          schema: "public",
          title: "users",
          table: "users",
        },
        {
          id: "workspace-4",
          kind: "query",
          profileId: "deleted-profile",
          database: "postgres",
          title: "Orphan",
          sql: "select 1;",
        },
      ],
    };
    const restored = createRestoredWorkspaceState(
      snapshot,
      [
        {
          id: "workspace-2",
          profileId: "profile-1",
          database: "postgres",
          schema: "public",
          title: "Recovered query",
          sql: "select 'older draft';",
          createdAt: 1,
          updatedAt: 2,
        },
        {
          id: "workspace-7",
          profileId: "profile-1",
          database: "postgres",
          title: "Saved draft",
          sql: "select 7;",
          createdAt: 3,
          updatedAt: 4,
        },
      ],
      new Set(["profile-1"]),
    );

    expect(restored.activeTabId).toBe("workspace-2");
    expect(restored.tabs.map((tab) => tab.id)).toEqual([
      "welcome",
      "workspace-1",
      "workspace-2",
      "workspace-3",
      "workspace-7",
    ]);
    expect(restored.tabs[2]).toMatchObject({
      kind: "query",
      sql: "select 'snapshot edit';",
      draftState: "unsaved",
    });
    expect(restored.tabs[3]).toEqual(
      expect.objectContaining({
        kind: "table-data",
        columns: [],
        changes: { updatedRows: [], insertedRows: [], deletedRows: [] },
        editability: { status: "idle" },
      }),
    );
    expect(JSON.stringify(restored.tabs[3])).not.toContain("execution");
    expect(restored.tabs[4]).toMatchObject({
      kind: "query",
      draftState: "saved",
    });
  });
});
