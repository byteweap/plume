export interface WorkspaceContext {
  profileId: string;
  database: string;
  schema?: string;
}

export interface WelcomeTab {
  id: "welcome";
  kind: "welcome";
}

export interface ConnectionTab extends WorkspaceContext {
  id: string;
  kind: "connection";
  title?: string;
}

export interface QueryTab extends WorkspaceContext {
  id: string;
  kind: "query";
  title: string;
}

export type WorkspaceTab = WelcomeTab | ConnectionTab | QueryTab;

export interface WorkspaceTabsState {
  tabs: WorkspaceTab[];
  activeTabId: string;
  nextTabId: number;
  nextQueryNumber: number;
}

export type WorkspaceTabsAction =
  | ({ type: "open-connection" } & WorkspaceContext)
  | ({ type: "open-query"; titlePrefix: string } & WorkspaceContext)
  | { type: "activate"; tabId: string }
  | { type: "rename"; tabId: string; title: string }
  | { type: "close"; tabId: string }
  | { type: "close-profile"; profileId: string };

const welcomeTab: WelcomeTab = { id: "welcome", kind: "welcome" };

export function createInitialWorkspaceTabsState(): WorkspaceTabsState {
  return {
    tabs: [welcomeTab],
    activeTabId: welcomeTab.id,
    nextTabId: 1,
    nextQueryNumber: 1,
  };
}

export function getActiveWorkspaceTab(
  state: WorkspaceTabsState,
): WorkspaceTab {
  return (
    state.tabs.find((tab) => tab.id === state.activeTabId) ??
    state.tabs[0] ??
    welcomeTab
  );
}

export function workspaceTabsReducer(
  state: WorkspaceTabsState,
  action: WorkspaceTabsAction,
): WorkspaceTabsState {
  switch (action.type) {
    case "open-connection": {
      const existing = state.tabs.find(
        (tab) =>
          tab.kind === "connection" &&
          tab.profileId === action.profileId &&
          tab.database === action.database &&
          tab.schema === action.schema,
      );
      if (existing) return { ...state, activeTabId: existing.id };

      const tab: ConnectionTab = {
        id: `workspace-${state.nextTabId}`,
        kind: "connection",
        profileId: action.profileId,
        database: action.database,
        schema: action.schema,
      };
      return {
        ...state,
        tabs: [...state.tabs, tab],
        activeTabId: tab.id,
        nextTabId: state.nextTabId + 1,
      };
    }
    case "open-query": {
      const tab: QueryTab = {
        id: `workspace-${state.nextTabId}`,
        kind: "query",
        profileId: action.profileId,
        database: action.database,
        schema: action.schema,
        title: `${action.titlePrefix} ${state.nextQueryNumber}`,
      };
      return {
        ...state,
        tabs: [...state.tabs, tab],
        activeTabId: tab.id,
        nextTabId: state.nextTabId + 1,
        nextQueryNumber: state.nextQueryNumber + 1,
      };
    }
    case "activate":
      return state.tabs.some((tab) => tab.id === action.tabId)
        ? { ...state, activeTabId: action.tabId }
        : state;
    case "rename": {
      const title = action.title.trim();
      if (!title) return state;
      return {
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.id === action.tabId && tab.kind !== "welcome"
            ? { ...tab, title }
            : tab,
        ),
      };
    }
    case "close":
      if (action.tabId === welcomeTab.id) return state;
      return removeTabs(state, (tab) => tab.id === action.tabId);
    case "close-profile":
      return removeTabs(
        state,
        (tab) => tab.kind !== "welcome" && tab.profileId === action.profileId,
      );
  }
}

function removeTabs(
  state: WorkspaceTabsState,
  shouldRemove: (tab: WorkspaceTab) => boolean,
): WorkspaceTabsState {
  const activeIndex = state.tabs.findIndex(
    (tab) => tab.id === state.activeTabId,
  );
  const activeTab = state.tabs[activeIndex];
  const removedActiveTab = activeTab ? shouldRemove(activeTab) : false;
  const tabs = state.tabs.filter((tab) => !shouldRemove(tab));

  if (!removedActiveTab) return { ...state, tabs };

  const nextActiveIndex = Math.min(Math.max(activeIndex, 0), tabs.length - 1);
  const nextActiveTab = tabs[nextActiveIndex] ?? welcomeTab;
  return {
    ...state,
    tabs,
    activeTabId: nextActiveTab.id,
  };
}
