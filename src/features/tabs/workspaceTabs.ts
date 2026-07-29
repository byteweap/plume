import type { CommandError } from "../../platform/tauri";
import type {
  CancelQueryResult,
  QueryExecutionResult,
  QueryExecutionState,
} from "../query-execution/queryExecution";
import type { SqlExecutionTarget } from "../sql-editor/SqlEditor";

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
  sql: string;
  draftState: "unsaved" | "saving" | "saved" | "error";
  updatedAt?: number;
  execution?: QueryExecutionState;
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
  | { type: "restore-queries"; tabs: QueryTab[] }
  | { type: "activate"; tabId: string }
  | { type: "rename"; tabId: string; title: string }
  | { type: "update-query"; tabId: string; sql: string }
  | { type: "draft-saving"; tabId: string }
  | {
      type: "draft-saved";
      tabId: string;
      title: string;
      sql: string;
      updatedAt: number;
    }
  | { type: "draft-failed"; tabId: string; title: string; sql: string }
  | {
      type: "query-started";
      tabId: string;
      queryId: string;
      target: SqlExecutionTarget;
    }
  | {
      type: "query-succeeded";
      tabId: string;
      result: QueryExecutionResult;
    }
  | {
      type: "query-failed";
      tabId: string;
      queryId: string;
      error: CommandError;
    }
  | { type: "query-cancelling"; tabId: string; queryId: string }
  | {
      type: "query-cancel-requested";
      tabId: string;
      result: CancelQueryResult;
    }
  | {
      type: "query-cancel-failed";
      tabId: string;
      queryId: string;
      error: CommandError;
    }
  | { type: "query-cancelled"; tabId: string; queryId: string }
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
        sql: "",
        draftState: "unsaved",
      };
      return {
        ...state,
        tabs: [...state.tabs, tab],
        activeTabId: tab.id,
        nextTabId: state.nextTabId + 1,
        nextQueryNumber: state.nextQueryNumber + 1,
      };
    }
    case "restore-queries": {
      const existingIds = new Set(state.tabs.map((tab) => tab.id));
      const restored = action.tabs.filter((tab) => !existingIds.has(tab.id));
      const tabs = [...state.tabs, ...restored];
      return {
        ...state,
        tabs,
        nextTabId: getNextTabId(tabs, state.nextTabId),
        nextQueryNumber: getNextQueryNumber(tabs, state.nextQueryNumber),
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
            ? {
                ...tab,
                title,
                ...(tab.kind === "query" ? { draftState: "unsaved" as const } : {}),
              }
            : tab,
        ),
      };
    }
    case "update-query": {
      const current = state.tabs.find((tab) => tab.id === action.tabId);
      if (!current || current.kind !== "query" || current.sql === action.sql) {
        return state;
      }
      return {
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.id === action.tabId && tab.kind === "query"
            ? { ...tab, sql: action.sql, draftState: "unsaved" }
            : tab,
        ),
      };
    }
    case "draft-saving":
      return updateQueryDraftState(state, action.tabId, () => ({
        draftState: "saving",
      }));
    case "draft-saved":
      return updateQueryDraftState(state, action.tabId, (tab) => ({
        draftState:
          tab.title === action.title && tab.sql === action.sql
            ? "saved"
            : "unsaved",
        updatedAt: action.updatedAt,
      }));
    case "draft-failed":
      return updateQueryDraftState(state, action.tabId, (tab) => ({
        draftState:
          tab.title === action.title && tab.sql === action.sql
            ? "error"
            : "unsaved",
      }));
    case "query-started":
      return updateQueryTab(state, action.tabId, () => ({
        execution: {
          status: "running",
          queryId: action.queryId,
          target: action.target,
        },
      }));
    case "query-succeeded":
      return updateActiveQuery(
        state,
        action.tabId,
        action.result.queryId,
        (execution) => ({
          execution: {
            status: "succeeded",
            queryId: action.result.queryId,
            target: execution.target,
            result: action.result,
          },
        }),
      );
    case "query-failed":
      return updateActiveQuery(
        state,
        action.tabId,
        action.queryId,
        (execution) => ({
          execution: {
            status: "failed",
            queryId: action.queryId,
            target: execution.target,
            error: action.error,
          },
        }),
      );
    case "query-cancelling":
      return updateActiveQuery(
        state,
        action.tabId,
        action.queryId,
        (execution) => ({
          execution: {
            status: "cancelling",
            queryId: action.queryId,
            target: execution.target,
            requestStatus: "requesting",
          },
        }),
      );
    case "query-cancel-requested":
      return updateCancellingQuery(
        state,
        action.tabId,
        action.result.queryId,
        (execution) => ({
          execution: {
            ...execution,
            requestStatus: action.result.status,
          },
        }),
      );
    case "query-cancel-failed":
      return updateCancellingQuery(
        state,
        action.tabId,
        action.queryId,
        (execution) => ({
          execution: {
            status: "running",
            queryId: action.queryId,
            target: execution.target,
            cancelError: action.error,
          },
        }),
      );
    case "query-cancelled":
      return updateActiveQuery(
        state,
        action.tabId,
        action.queryId,
        (execution) => ({
          execution: {
            status: "cancelled",
            queryId: action.queryId,
            target: execution.target,
          },
        }),
      );
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

const idleQueryExecution: QueryExecutionState = { status: "idle" };

export function getQueryExecution(tab: QueryTab): QueryExecutionState {
  return tab.execution ?? idleQueryExecution;
}

function updateActiveQuery(
  state: WorkspaceTabsState,
  tabId: string,
  queryId: string,
  update: (
    execution: Extract<
      QueryExecutionState,
      { status: "running" | "cancelling" }
    >,
  ) => Partial<QueryTab>,
): WorkspaceTabsState {
  return updateQueryTab(state, tabId, (tab) => {
    const execution = getQueryExecution(tab);
    return (execution.status === "running" || execution.status === "cancelling") &&
      execution.queryId === queryId
      ? update(execution)
      : {};
  });
}

function updateCancellingQuery(
  state: WorkspaceTabsState,
  tabId: string,
  queryId: string,
  update: (
    execution: Extract<QueryExecutionState, { status: "cancelling" }>,
  ) => Partial<QueryTab>,
): WorkspaceTabsState {
  return updateQueryTab(state, tabId, (tab) => {
    const execution = getQueryExecution(tab);
    return execution.status === "cancelling" && execution.queryId === queryId
      ? update(execution)
      : {};
  });
}

function updateQueryTab(
  state: WorkspaceTabsState,
  tabId: string,
  update: (tab: QueryTab) => Partial<QueryTab>,
): WorkspaceTabsState {
  return {
    ...state,
    tabs: state.tabs.map((tab) =>
      tab.id === tabId && tab.kind === "query"
        ? { ...tab, ...update(tab) }
        : tab,
    ),
  };
}

function updateQueryDraftState(
  state: WorkspaceTabsState,
  tabId: string,
  update: (tab: QueryTab) => Pick<QueryTab, "draftState"> & Partial<QueryTab>,
): WorkspaceTabsState {
  return {
    ...state,
    tabs: state.tabs.map((tab) =>
      tab.id === tabId && tab.kind === "query"
        ? { ...tab, ...update(tab) }
        : tab,
    ),
  };
}

function getNextTabId(tabs: WorkspaceTab[], minimum: number) {
  return tabs.reduce((next, tab) => {
    const match = /^workspace-(\d+)$/.exec(tab.id);
    return match ? Math.max(next, Number(match[1]) + 1) : next;
  }, minimum);
}

function getNextQueryNumber(tabs: WorkspaceTab[], minimum: number) {
  return tabs.reduce((next, tab) => {
    const match = tab.kind === "query" ? /\s(\d+)$/.exec(tab.title) : null;
    return match ? Math.max(next, Number(match[1]) + 1) : next;
  }, minimum);
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
