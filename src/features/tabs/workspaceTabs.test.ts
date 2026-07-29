import { describe, expect, it } from "vitest";
import {
  createInitialWorkspaceTabsState,
  getActiveWorkspaceTab,
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
