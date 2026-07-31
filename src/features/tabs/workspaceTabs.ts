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

export interface TableDataTab extends WorkspaceContext {
  id: string;
  kind: "table-data";
  title: string;
  schema: string;
  table: string;
  pageIndex: number;
  pageSize: number;
  hasNextPage: boolean;
  execution?: QueryExecutionState;
}

export type ExecutableTab = QueryTab | TableDataTab;
export type WorkspaceTab = WelcomeTab | ConnectionTab | ExecutableTab;

export interface WorkspaceTabsState {
  tabs: WorkspaceTab[];
  activeTabId: string;
  nextTabId: number;
  nextQueryNumber: number;
}

export type WorkspaceTabsAction =
  | ({ type: "open-connection" } & WorkspaceContext)
  | ({ type: "open-query"; titlePrefix: string } & WorkspaceContext)
  | ({ type: "open-table-data"; table: string } & WorkspaceContext)
  | {
      type: "set-table-data-page";
      tabId: string;
      pageIndex: number;
      pageSize: number;
    }
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
      startedAt: number;
    }
  | {
      type: "query-succeeded";
      tabId: string;
      result: QueryExecutionResult;
      finishedAt: number;
      hasNextPage?: boolean;
    }
  | {
      type: "query-failed";
      tabId: string;
      queryId: string;
      error: CommandError;
      finishedAt: number;
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
  | {
      type: "query-cancelled";
      tabId: string;
      queryId: string;
      finishedAt: number;
    }
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
    case "open-table-data": {
      if (!action.schema) return state;
      const existing = state.tabs.find(
        (tab) =>
          tab.kind === "table-data" &&
          tab.profileId === action.profileId &&
          tab.database === action.database &&
          tab.schema === action.schema &&
          tab.table === action.table,
      );
      if (existing) return { ...state, activeTabId: existing.id };

      const tab: TableDataTab = {
        id: `workspace-${state.nextTabId}`,
        kind: "table-data",
        profileId: action.profileId,
        database: action.database,
        schema: action.schema,
        table: action.table,
        title: action.table,
        pageIndex: 0,
        pageSize: 200,
        hasNextPage: false,
      };
      return {
        ...state,
        tabs: [...state.tabs, tab],
        activeTabId: tab.id,
        nextTabId: state.nextTabId + 1,
      };
    }
    case "set-table-data-page":
      if (action.pageIndex < 0 || action.pageSize < 1) return state;
      return {
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.id === action.tabId && tab.kind === "table-data"
            ? {
                ...tab,
                pageIndex: action.pageIndex,
                pageSize: action.pageSize,
                hasNextPage: false,
                execution: undefined,
              }
            : tab,
        ),
      };
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
      return updateExecutableTab(state, action.tabId, () => ({
        execution: {
          status: "running",
          queryId: action.queryId,
          target: action.target,
          startedAt: action.startedAt,
        },
      }));
    case "query-succeeded": {
      const updated = updateActiveQuery(
        state,
        action.tabId,
        action.result.queryId,
        (execution) => ({
          execution: {
            status: "succeeded",
            queryId: action.result.queryId,
            target: execution.target,
            result: action.result,
            ...finishQueryTiming(execution, action.finishedAt),
          },
        }),
      );
      if (action.hasNextPage === undefined) return updated;
      return {
        ...updated,
        tabs: updated.tabs.map((tab) =>
          tab.id === action.tabId &&
          tab.kind === "table-data" &&
          tab.execution?.status === "succeeded" &&
          tab.execution.queryId === action.result.queryId
            ? { ...tab, hasNextPage: action.hasNextPage! }
            : tab,
        ),
      };
    }
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
            ...finishQueryTiming(execution, action.finishedAt),
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
            startedAt: execution.startedAt,
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
            startedAt: execution.startedAt,
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
            ...finishQueryTiming(execution, action.finishedAt),
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

export function getQueryExecution(tab: ExecutableTab): QueryExecutionState {
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
  ) => Partial<ExecutableTab>,
): WorkspaceTabsState {
  return updateExecutableTab(state, tabId, (tab) => {
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
  ) => Partial<ExecutableTab>,
): WorkspaceTabsState {
  return updateExecutableTab(state, tabId, (tab) => {
    const execution = getQueryExecution(tab);
    return execution.status === "cancelling" && execution.queryId === queryId
      ? update(execution)
      : {};
  });
}

function finishQueryTiming(
  execution: Extract<
    QueryExecutionState,
    { status: "running" | "cancelling" }
  >,
  finishedAt: number,
) {
  return {
    startedAt: execution.startedAt,
    durationMs: Math.max(0, finishedAt - execution.startedAt),
  };
}

function updateExecutableTab(
  state: WorkspaceTabsState,
  tabId: string,
  update: (tab: ExecutableTab) => Partial<ExecutableTab>,
): WorkspaceTabsState {
  return {
    ...state,
    tabs: state.tabs.map((tab) =>
      tab.id === tabId && (tab.kind === "query" || tab.kind === "table-data")
        ? ({ ...tab, ...update(tab) } as WorkspaceTab)
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
