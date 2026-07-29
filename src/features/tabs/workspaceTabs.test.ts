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
      expect.objectContaining({ title: "Query 1", ...context }),
      expect.objectContaining({
        title: "Query 2",
        profileId: "profile-2",
        database: "analytics",
      }),
    ]);
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
