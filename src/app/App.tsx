import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Braces,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  FileText,
  Globe2,
  KeyRound,
  ListStart,
  LoaderCircle,
  LockKeyhole,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  RefreshCw,
  Search,
  Save,
  Square,
  Table2,
  Undo2,
  X,
} from "lucide-react";
import plumeMark from "../assets/plume-mark.svg";
import { ConnectionDialog } from "../features/connections/ConnectionDialog";
import type {
  ActiveConnection,
  ConnectedDatabaseResult,
  ConnectionProfile,
} from "../features/connections/connection";
import { connectionApi } from "../features/connections/connectionApi";
import {
  connectionSessionReducer,
  getConnectionSession,
  type ConnectionLifecycleState,
} from "../features/connections/connectionSession";
import { ConnectionTreeItem } from "../features/database-tree/ConnectionTreeItem";
import { queryDraftApi } from "../features/drafts/queryDraftApi";
import {
  createQueryId,
  DEFAULT_QUERY_ROW_LIMIT,
  formatQueryDuration,
  QUERY_ROW_LIMIT_OPTIONS,
  summarizeQueryResult,
  type ExecuteQueryRequest,
  type QueryExecutionState,
  type QueryStatementResult,
} from "../features/query-execution/queryExecution";
import { queryExecutionApi } from "../features/query-execution/queryExecutionApi";
import { resolveQueryErrorRange } from "../features/query-execution/queryErrorPosition";
import type {
  SqlEditorController,
  SqlExecutionTarget,
} from "../features/sql-editor/SqlEditor";
import {
  createTableDataQuery,
  normalizeTableDataPage,
  TABLE_DATA_PAGE_SIZE_OPTIONS,
  type TableDataReference,
} from "../features/table-data/tableData";
import { tableDataApi } from "../features/table-data/tableDataApi";
import {
  TableDataChangePreview,
  type TableDataChangeTarget,
} from "../features/table-data/TableDataChangePreview";
import { TableDataFilterBar } from "../features/table-data/TableDataFilterBar";
import { TableDataLeaveDialog } from "../features/table-data/TableDataLeaveDialog";
import { createCommitTableDataRequest } from "../features/table-data/tableDataCommit";
import {
  createEmptyTableDataChangeSet,
  discardAllTableDataChanges,
  hasPendingTableDataChanges,
  stageTableRowInsert,
  type TableDataChangeSet,
} from "../features/table-data/tableDataChanges";
import { createTableDataGridEditing } from "../features/table-data/tableDataEditing";
import {
  createInitialWorkspaceTabsState,
  getActiveWorkspaceTab,
  getQueryExecution,
  workspaceTabsReducer,
  type ExecutableTab,
  type QueryTab,
  type TableDataTab,
  type WorkspaceTab,
} from "../features/tabs/workspaceTabs";
import { useI18n } from "../i18n/I18nContext";
import { isTauriRuntime, toCommandError } from "../platform/tauri";
import {
  destroyCurrentWindow,
  onWindowCloseRequested,
} from "../platform/window";
import { IconButton } from "../shared/IconButton";
import "./App.css";

const environmentClass: Record<ConnectionProfile["environment"], string> = {
  development: "environment-development",
  test: "environment-test",
  staging: "environment-staging",
  production: "environment-production",
};

const defaultSidebarWidth = 286;
const minimumSidebarWidth = 220;
const maximumSidebarWidth = 560;

type TableDataLeaveRequest =
  | { kind: "close-tab"; tabId: string; tabIds: string[] }
  | { kind: "disconnect"; profileId: string; tabIds: string[] }
  | { kind: "delete-profile"; profileId: string; tabIds: string[] }
  | { kind: "exit"; tabIds: string[] };
const sidebarKeyboardStep = 16;
const defaultQueryResultHeight = 260;
const minimumQueryResultHeight = 120;
const minimumQueryEditorHeight = 150;
const queryResultResizerSize = 7;
const queryResultKeyboardStep = 20;
const SqlEditor = lazy(() =>
  import("../features/sql-editor/SqlEditor").then((module) => ({
    default: module.SqlEditor,
  })),
);
const QueryResultPanel = lazy(
  () => import("../features/query-results/QueryResultPanel"),
);

function clampSidebarWidth(width: number) {
  return Math.min(
    maximumSidebarWidth,
    Math.max(minimumSidebarWidth, Math.round(width)),
  );
}

function clampQueryResultHeight(height: number, workspaceHeight: number) {
  const maximumHeight = Math.max(
    minimumQueryResultHeight,
    workspaceHeight - minimumQueryEditorHeight - queryResultResizerSize,
  );
  return Math.min(maximumHeight, Math.max(minimumQueryResultHeight, height));
}

export function App() {
  const { locale, setLocale, t } = useI18n();
  const [dialogProfile, setDialogProfile] = useState<
    ConnectionProfile | null | undefined
  >(undefined);
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [sessions, dispatchSession] = useReducer(connectionSessionReducer, {});
  const [workspaceTabs, dispatchWorkspaceTabs] = useReducer(
    workspaceTabsReducer,
    undefined,
    createInitialWorkspaceTabsState,
  );
  const [selectedProfileId, setSelectedProfileId] = useState<string>();
  const [profileError, setProfileError] = useState<string>();
  const [draftError, setDraftError] = useState<string>();
  const [filter, setFilter] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(defaultSidebarWidth);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [queryRowLimit, setQueryRowLimit] = useState(DEFAULT_QUERY_ROW_LIMIT);
  const [leaveRequest, setLeaveRequest] = useState<TableDataLeaveRequest>();
  const [leaveStatus, setLeaveStatus] = useState<
    | { status: "idle" }
    | { status: "committing" }
    | { status: "failed"; message: string }
  >({ status: "idle" });
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const sidebarResizeStart = useRef<{
    pointerId: number;
    pointerX: number;
    width: number;
  } | null>(null);
  const draftSaveTimers = useRef(
    new Map<string, { timeout: number; title: string; sql: string }>(),
  );
  const discardedDraftIds = useRef(new Set<string>());
  const executingProfiles = useRef(new Set<string>());

  const activeTab = getActiveWorkspaceTab(workspaceTabs);
  const activeProfile =
    activeTab.kind === "welcome"
      ? undefined
      : profiles.find((profile) => profile.id === activeTab.profileId);
  const activeSession = activeProfile
    ? getConnectionSession(sessions, activeProfile.id)
    : undefined;
  const highlightedProfileId =
    activeTab.kind === "welcome" ? selectedProfileId : activeTab.profileId;
  const activeConnection = useMemo<ActiveConnection | undefined>(() => {
    if (!activeProfile) return undefined;
    const session = getConnectionSession(sessions, activeProfile.id);
    const usable = session.state === "connected" || session.state === "busy";
    return usable && session.sessionId && session.serverVersion
      ? {
          ...activeProfile,
          database:
            activeTab.kind === "welcome"
              ? activeProfile.database
              : activeTab.database,
          sessionId: session.sessionId,
          serverVersion: session.serverVersion,
        }
      : undefined;
  }, [activeProfile, activeTab, sessions]);
  const visibleConnections = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return profiles;
    return profiles.filter((connection) =>
      [connection.name, connection.host, connection.database].some((value) =>
        value.toLowerCase().includes(query),
      ),
    );
  }, [profiles, filter]);

  useEffect(() => {
    const pendingTabIds = workspaceTabs.tabs
      .filter(
        (tab): tab is TableDataTab =>
          tab.kind === "table-data" && hasPendingTableDataChanges(tab.changes),
      )
      .map((tab) => tab.id);
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (pendingTabIds.length === 0) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    let disposed = false;
    let unlisten: (() => void) | undefined;
    if (isTauriRuntime()) {
      void onWindowCloseRequested((event) => {
          if (pendingTabIds.length === 0) return;
          event.preventDefault();
          setLeaveStatus({ status: "idle" });
          setLeaveRequest({ kind: "exit", tabIds: pendingTabIds });
        }).then((removeListener) => {
          if (disposed) removeListener();
          else unlisten = removeListener;
        });
    }

    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [workspaceTabs.tabs]);

  const saveQueryDraft = useCallback(async (tab: QueryTab) => {
    if (discardedDraftIds.current.has(tab.id)) return;
    const pending = draftSaveTimers.current.get(tab.id);
    if (pending) window.clearTimeout(pending.timeout);
    draftSaveTimers.current.delete(tab.id);
    dispatchWorkspaceTabs({ type: "draft-saving", tabId: tab.id });
    try {
      const saved = await queryDraftApi.save({
        id: tab.id,
        profileId: tab.profileId,
        database: tab.database,
        schema: tab.schema,
        title: tab.title,
        sql: tab.sql,
      });
      if (discardedDraftIds.current.has(tab.id)) {
        try {
          await queryDraftApi.delete(tab.id);
        } catch (error) {
          const commandError = toCommandError(error);
          if (commandError.code !== "desktop_required") {
            setDraftError(commandError.message);
          }
        }
        return;
      }
      dispatchWorkspaceTabs({
        type: "draft-saved",
        tabId: tab.id,
        title: tab.title,
        sql: tab.sql,
        updatedAt: saved.updatedAt,
      });
      setDraftError(undefined);
    } catch (error) {
      if (discardedDraftIds.current.has(tab.id)) return;
      dispatchWorkspaceTabs({
        type: "draft-failed",
        tabId: tab.id,
        title: tab.title,
        sql: tab.sql,
      });
      const commandError = toCommandError(error);
      if (commandError.code !== "desktop_required") {
        setDraftError(commandError.message);
      }
    }
  }, []);

  const executeQuery = useCallback(
    async (
      tab: ExecutableTab,
      sessionId: string,
      target: SqlExecutionTarget,
      rowLimit: number,
      options?: Pick<ExecuteQueryRequest, "parameters" | "resultColumns">,
    ) => {
      if (executingProfiles.current.has(tab.profileId)) return;

      const queryId = createQueryId();
      executingProfiles.current.add(tab.profileId);
      dispatchWorkspaceTabs({
        type: "query-started",
        tabId: tab.id,
        queryId,
        target,
        startedAt: Date.now(),
      });
      dispatchSession({ type: "begin-work", profileId: tab.profileId });

      try {
        const result = await queryExecutionApi.execute({
          queryId,
          sessionId,
          database: tab.database,
          sql: target.sql,
          rowLimit,
          ...(options?.parameters?.length
            ? {
                parameters: options.parameters,
                resultColumns: options.resultColumns,
              }
            : {}),
        });
        const tablePage =
          tab.kind === "table-data"
            ? normalizeTableDataPage(result, tab.pageSize)
            : undefined;
        dispatchWorkspaceTabs({
          type: "query-succeeded",
          tabId: tab.id,
          result: tablePage?.result ?? result,
          finishedAt: Date.now(),
          hasNextPage: tablePage?.hasNextPage,
        });
        dispatchSession({ type: "ready", profileId: tab.profileId });
      } catch (error) {
        const commandError = toCommandError(error);
        if (commandError.code === "query_cancelled") {
          dispatchWorkspaceTabs({
            type: "query-cancelled",
            tabId: tab.id,
            queryId,
            finishedAt: Date.now(),
          });
        } else {
          dispatchWorkspaceTabs({
            type: "query-failed",
            tabId: tab.id,
            queryId,
            error: commandError,
            finishedAt: Date.now(),
          });
        }
        if (isConnectionQueryError(commandError.code)) {
          dispatchSession({
            type: "failed",
            profileId: tab.profileId,
            error: commandError.message,
          });
        } else {
          dispatchSession({ type: "ready", profileId: tab.profileId });
        }
      } finally {
        executingProfiles.current.delete(tab.profileId);
      }
    },
    [],
  );

  async function cancelQuery(tab: ExecutableTab, sessionId: string) {
    const execution = getQueryExecution(tab);
    if (execution.status !== "running") return;

    dispatchWorkspaceTabs({
      type: "query-cancelling",
      tabId: tab.id,
      queryId: execution.queryId,
    });
    try {
      const result = await queryExecutionApi.cancel({
        queryId: execution.queryId,
        sessionId,
        database: tab.database,
      });
      dispatchWorkspaceTabs({
        type: "query-cancel-requested",
        tabId: tab.id,
        result,
      });
    } catch (error) {
      dispatchWorkspaceTabs({
        type: "query-cancel-failed",
        tabId: tab.id,
        queryId: execution.queryId,
        error: toCommandError(error),
      });
    }
  }

  useEffect(() => {
    if (
      activeTab.kind !== "table-data" ||
      activeSession?.state !== "connected" ||
      !activeConnection ||
      (activeTab.editability.status !== "idle" &&
        activeTab.editability.sessionId === activeConnection.sessionId)
    ) {
      return;
    }

    const sessionId = activeConnection.sessionId;
    dispatchWorkspaceTabs({
      type: "table-data-editability-loading",
      tabId: activeTab.id,
      sessionId,
    });
    void tableDataApi
      .getEditability(sessionId, {
        database: activeTab.database,
        schema: activeTab.schema,
        table: activeTab.table,
      })
      .then((result) =>
        dispatchWorkspaceTabs({
          type: "table-data-editability-loaded",
          tabId: activeTab.id,
          sessionId,
          result,
        }),
      )
      .catch(() =>
        dispatchWorkspaceTabs({
          type: "table-data-editability-failed",
          tabId: activeTab.id,
          sessionId,
        }),
      );
  }, [activeConnection, activeSession?.state, activeTab]);

  useEffect(() => {
    if (
      activeTab.kind !== "table-data" ||
      activeSession?.state !== "connected" ||
      !activeConnection ||
      getQueryExecution(activeTab).status !== "idle"
    ) {
      return;
    }

    const query = createTableDataQuery(
      activeTab,
      activeTab,
      activeTab.sorts,
      activeTab.columns,
      activeTab.filters,
    );
    void executeQuery(
      activeTab,
      activeConnection.sessionId,
      query.target,
      activeTab.pageSize + 1,
      query,
    );
  }, [activeConnection, activeSession?.state, activeTab, executeQuery]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let savedProfiles: ConnectionProfile[];
      try {
        savedProfiles = await connectionApi.listProfiles();
      } catch (error) {
        const commandError = toCommandError(error);
        if (!cancelled && commandError.code !== "desktop_required") {
          setProfileError(commandError.message);
        }
        return;
      }
      if (cancelled) return;

      try {
        const knownProfiles = new Set(savedProfiles.map((profile) => profile.id));
        const drafts = await queryDraftApi.list();
        if (cancelled) return;
        setProfiles(savedProfiles);
        dispatchWorkspaceTabs({
          type: "restore-queries",
          tabs: drafts
            .filter((draft) => knownProfiles.has(draft.profileId))
            .map((draft) => ({
              id: draft.id,
              kind: "query" as const,
              profileId: draft.profileId,
              database: draft.database,
              schema: draft.schema,
              title: draft.title,
              sql: draft.sql,
              draftState: "saved" as const,
              updatedAt: draft.updatedAt,
            })),
        });
      } catch (error) {
        const commandError = toCommandError(error);
        if (cancelled) return;
        setProfiles(savedProfiles);
        if (commandError.code !== "desktop_required") setDraftError(commandError.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timers = draftSaveTimers.current;
    const queryTabs = workspaceTabs.tabs.filter(
      (tab): tab is QueryTab => tab.kind === "query",
    );
    const queryIds = new Set(queryTabs.map((tab) => tab.id));
    for (const [tabId, pending] of timers) {
      if (!queryIds.has(tabId)) {
        window.clearTimeout(pending.timeout);
        timers.delete(tabId);
      }
    }

    for (const tab of queryTabs) {
      const pending = timers.get(tab.id);
      if (tab.draftState !== "unsaved") {
        if (pending) window.clearTimeout(pending.timeout);
        timers.delete(tab.id);
        continue;
      }
      if (pending?.title === tab.title && pending.sql === tab.sql) continue;
      if (pending) window.clearTimeout(pending.timeout);
      timers.set(tab.id, {
        title: tab.title,
        sql: tab.sql,
        timeout: window.setTimeout(() => {
          timers.delete(tab.id);
          void saveQueryDraft(tab);
        }, 600),
      });
    }
  }, [saveQueryDraft, workspaceTabs.tabs]);

  useEffect(
    () => () => {
      for (const pending of draftSaveTimers.current.values()) {
        window.clearTimeout(pending.timeout);
      }
      draftSaveTimers.current.clear();
    },
    [],
  );

  const appContentStyle = {
    "--sidebar-width": `${sidebarCollapsed ? 0 : sidebarWidth}px`,
  } as CSSProperties;

  function startSidebarResize(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;

    sidebarResizeStart.current = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      width: sidebarWidth,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizingSidebar(true);
  }

  function resizeSidebar(event: PointerEvent<HTMLDivElement>) {
    const start = sidebarResizeStart.current;
    if (!start || start.pointerId !== event.pointerId) return;

    setSidebarWidth(
      clampSidebarWidth(start.width + event.clientX - start.pointerX),
    );
  }

  function stopSidebarResize(event: PointerEvent<HTMLDivElement>) {
    const start = sidebarResizeStart.current;
    if (!start || start.pointerId !== event.pointerId) return;

    sidebarResizeStart.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setResizingSidebar(false);
  }

  function resizeSidebarWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    const direction =
      event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (direction === 0) return;

    event.preventDefault();
    setSidebarWidth((width) =>
      clampSidebarWidth(width + direction * sidebarKeyboardStep),
    );
  }

  function updateProfile(profile: ConnectionProfile) {
    setProfiles((current) =>
      [...current.filter((item) => item.id !== profile.id), profile].sort(
        (left, right) =>
          Number(right.favorite) - Number(left.favorite) ||
          left.name.localeCompare(right.name),
      ),
    );
  }

  function handleProfileSaved(profile: ConnectionProfile) {
    updateProfile(profile);
    setDialogProfile(profile);
  }

  function openConnectionWorkspace(profile: ConnectionProfile) {
    dispatchWorkspaceTabs({
      type: "open-connection",
      profileId: profile.id,
      database: profile.database,
    });
  }

  function openQueryWorkspace(tab: WorkspaceTab = activeTab) {
    if (tab.kind === "welcome") return;
    const session = getConnectionSession(sessions, tab.profileId);
    if (session.state !== "connected" && session.state !== "busy") return;

    dispatchWorkspaceTabs({
      type: "open-query",
      profileId: tab.profileId,
      database: tab.database,
      schema: tab.schema,
      titlePrefix: t("workspace.query"),
    });
  }

  function openTableData(
    profile: ConnectionProfile,
    reference: TableDataReference,
  ) {
    const session = getConnectionSession(sessions, profile.id);
    if (session.state !== "connected" && session.state !== "busy") return;
    dispatchWorkspaceTabs({
      type: "open-table-data",
      profileId: profile.id,
      database: reference.database,
      schema: reference.schema,
      table: reference.table,
    });
  }

  function renameWorkspaceTab(tab: WorkspaceTab) {
    if (tab.kind === "welcome") return;
    const currentTitle = getWorkspaceTabTitle(
      tab,
      profiles,
      t("workspace.welcomeTab"),
    );
    const title = window.prompt(t("workspace.renameTabPrompt"), currentTitle);
    if (!title?.trim() || title.trim() === currentTitle) return;
    dispatchWorkspaceTabs({ type: "rename", tabId: tab.id, title });
  }

  function closeWorkspaceTab(tab: WorkspaceTab) {
    if (tab.kind === "table-data" && hasPendingTableDataChanges(tab.changes)) {
      setLeaveStatus({ status: "idle" });
      setLeaveRequest({ kind: "close-tab", tabId: tab.id, tabIds: [tab.id] });
      return;
    }
    closeWorkspaceTabImmediately(tab);
  }

  function closeWorkspaceTabImmediately(tab: WorkspaceTab) {
    const pending = draftSaveTimers.current.get(tab.id);
    if (pending) window.clearTimeout(pending.timeout);
    draftSaveTimers.current.delete(tab.id);
    dispatchWorkspaceTabs({ type: "close", tabId: tab.id });
    if (tab.kind === "query") {
      discardedDraftIds.current.add(tab.id);
      void queryDraftApi.delete(tab.id).catch((error) => {
        const commandError = toCommandError(error);
        if (commandError.code !== "desktop_required") {
          setDraftError(commandError.message);
        }
      });
    }
  }

  function navigateWorkspaceTabs(
    event: KeyboardEvent<HTMLButtonElement>,
    tab: WorkspaceTab,
  ) {
    if (event.key === "F2") {
      event.preventDefault();
      renameWorkspaceTab(tab);
      return;
    }

    const tabs = Array.from(
      event.currentTarget
        .closest('[role="tablist"]')
        ?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [],
    );
    const currentIndex = tabs.indexOf(event.currentTarget);
    let nextIndex: number | undefined;
    if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    }
    if (nextIndex === undefined) return;
    const nextTab = tabs[nextIndex];
    if (!nextTab) return;

    event.preventDefault();
    const nextTabId = nextTab.dataset.tabId;
    if (nextTabId) {
      dispatchWorkspaceTabs({ type: "activate", tabId: nextTabId });
      nextTab.focus();
    }
  }

  function handleConnected(
    profile: ConnectionProfile,
    result: ConnectedDatabaseResult,
    activateWorkspace = true,
  ) {
    updateProfile(profile);
    dispatchSession({ type: "connected", profileId: profile.id, result });
    setSelectedProfileId(profile.id);
    if (activateWorkspace) openConnectionWorkspace(profile);
    setDialogProfile(undefined);
    setProfileError(undefined);
  }

  async function connectProfile(
    profile: ConnectionProfile,
    activateWorkspace = true,
  ) {
    const session = getConnectionSession(sessions, profile.id);
    if (session.state === "connected" || session.state === "busy") {
      setSelectedProfileId(profile.id);
      openConnectionWorkspace(profile);
      return;
    }
    if (session.state === "error" && session.sessionId) {
      await reconnectProfile(profile, activateWorkspace);
      return;
    }
    if (isTransitioning(session.state)) return;

    dispatchSession({ type: "connect", profileId: profile.id });
    setSelectedProfileId(profile.id);
    setProfileError(undefined);
    try {
      handleConnected(
        profile,
        await connectionApi.connectSaved(profile.id),
        activateWorkspace,
      );
    } catch (error) {
      dispatchSession({
        type: "failed",
        profileId: profile.id,
        error: toCommandError(error).message,
      });
    }
  }

  async function reconnectProfile(
    profile: ConnectionProfile,
    activateWorkspace = true,
  ) {
    const session = getConnectionSession(sessions, profile.id);
    if (!session.sessionId) {
      await connectProfile(profile, activateWorkspace);
      return;
    }
    if (isTransitioning(session.state)) return;

    dispatchSession({ type: "reconnect", profileId: profile.id });
    setSelectedProfileId(profile.id);
    try {
      handleConnected(
        profile,
        await connectionApi.reconnectSaved(profile.id, session.sessionId),
        activateWorkspace,
      );
    } catch (error) {
      dispatchSession({
        type: "failed",
        profileId: profile.id,
        error: toCommandError(error).message,
      });
    }
  }

  async function disconnectProfile(profile: ConnectionProfile) {
    const pendingTabIds = workspaceTabs.tabs
      .filter(
        (tab): tab is TableDataTab =>
          tab.kind === "table-data" &&
          tab.profileId === profile.id &&
          hasPendingTableDataChanges(tab.changes),
      )
      .map((tab) => tab.id);
    if (pendingTabIds.length > 0) {
      setLeaveStatus({ status: "idle" });
      setLeaveRequest({ kind: "disconnect", profileId: profile.id, tabIds: pendingTabIds });
      return;
    }
    await disconnectProfileImmediately(profile);
  }

  async function disconnectProfileImmediately(profile: ConnectionProfile) {
    const session = getConnectionSession(sessions, profile.id);
    if (!session.sessionId || isTransitioning(session.state)) return;

    dispatchSession({ type: "disconnect", profileId: profile.id });
    try {
      await connectionApi.disconnect(session.sessionId);
      dispatchSession({ type: "disconnected", profileId: profile.id });
    } catch (error) {
      const commandError = toCommandError(error);
      if (commandError.code === "session_not_found") {
        dispatchSession({ type: "disconnected", profileId: profile.id });
      } else {
        dispatchSession({
          type: "failed",
          profileId: profile.id,
          error: commandError.message,
        });
      }
    }
  }

  async function completeTableDataLeave(request: TableDataLeaveRequest) {
    setLeaveRequest(undefined);
    setLeaveStatus({ status: "idle" });
    if (request.kind === "close-tab") {
      const tab = workspaceTabs.tabs.find((item) => item.id === request.tabId);
      if (tab) closeWorkspaceTabImmediately(tab);
      return;
    }
    if (request.kind === "disconnect") {
      const profile = profiles.find((item) => item.id === request.profileId);
      if (profile) await disconnectProfileImmediately(profile);
      return;
    }
    if (request.kind === "delete-profile") {
      const profile = profiles.find((item) => item.id === request.profileId);
      if (profile) await deleteProfileImmediately(profile);
      return;
    }
    if (isTauriRuntime()) {
      await destroyCurrentWindow();
    } else {
      window.close();
    }
  }

  async function commitTableDataBeforeLeave() {
    const request = leaveRequest;
    if (!request || leaveStatus.status === "committing") return;
    setLeaveStatus({ status: "committing" });
    try {
      for (const tabId of request.tabIds) {
        const tab = workspaceTabs.tabs.find(
          (item): item is TableDataTab =>
            item.id === tabId && item.kind === "table-data",
        );
        if (!tab || !hasPendingTableDataChanges(tab.changes)) continue;
        const session = getConnectionSession(sessions, tab.profileId);
        if (
          !session.sessionId ||
          (session.state !== "connected" && session.state !== "busy") ||
          tab.editability.status !== "editable"
        ) {
          throw new Error(t("tableData.leave.connectionUnavailable"));
        }
        await tableDataApi.commit(
          createCommitTableDataRequest(
            session.sessionId,
            tab,
            tab.columns,
            tab.editability.key,
            tab.changes,
          ),
        );
        dispatchWorkspaceTabs({
          type: "discard-table-data-changes",
          tabId: tab.id,
        });
      }
      await completeTableDataLeave(request);
    } catch (error) {
      setLeaveStatus({
        status: "failed",
        message: toCommandError(error).message,
      });
    }
  }

  function discardTableDataBeforeLeave() {
    const request = leaveRequest;
    if (!request || leaveStatus.status === "committing") return;
    for (const tabId of request.tabIds) {
      dispatchWorkspaceTabs({
        type: "discard-table-data-changes",
        tabId,
      });
    }
    void completeTableDataLeave(request);
  }

  async function checkProfileSession(profile: ConnectionProfile) {
    const session = getConnectionSession(sessions, profile.id);
    if (!session.sessionId || session.state !== "connected") return;

    dispatchSession({ type: "begin-work", profileId: profile.id });
    try {
      await connectionApi.checkSession(session.sessionId);
      dispatchSession({ type: "ready", profileId: profile.id });
    } catch (error) {
      dispatchSession({
        type: "failed",
        profileId: profile.id,
        error: toCommandError(error).message,
      });
    }
  }

  function markSessionFailed(profileId: string, message: string) {
    dispatchSession({ type: "failed", profileId, error: message });
  }

  async function toggleFavorite(profile: ConnectionProfile) {
    try {
      updateProfile(await connectionApi.setFavorite(profile.id, !profile.favorite));
    } catch (error) {
      setProfileError(toCommandError(error).message);
    }
  }

  async function duplicateProfile(profile: ConnectionProfile) {
    try {
      updateProfile(await connectionApi.duplicateProfile(profile.id));
    } catch (error) {
      setProfileError(toCommandError(error).message);
    }
  }

  async function renameProfile(profile: ConnectionProfile) {
    const name = window.prompt(t("connection.renamePrompt"), profile.name)?.trim();
    if (!name || name === profile.name) return;
    try {
      updateProfile(await connectionApi.renameProfile(profile.id, name));
    } catch (error) {
      setProfileError(toCommandError(error).message);
    }
  }

  async function deleteProfile(profile: ConnectionProfile) {
    if (!window.confirm(t("connection.deleteConfirm"))) return;
    const pendingTabIds = workspaceTabs.tabs
      .filter(
        (tab): tab is TableDataTab =>
          tab.kind === "table-data" &&
          tab.profileId === profile.id &&
          hasPendingTableDataChanges(tab.changes),
      )
      .map((tab) => tab.id);
    if (pendingTabIds.length > 0) {
      setLeaveStatus({ status: "idle" });
      setLeaveRequest({
        kind: "delete-profile",
        profileId: profile.id,
        tabIds: pendingTabIds,
      });
      return;
    }
    await deleteProfileImmediately(profile);
  }

  async function deleteProfileImmediately(profile: ConnectionProfile) {
    try {
      const sessionId = getConnectionSession(sessions, profile.id).sessionId;
      if (sessionId) {
        try {
          await connectionApi.disconnect(sessionId);
        } catch (error) {
          if (toCommandError(error).code !== "session_not_found") throw error;
        }
        dispatchSession({ type: "disconnected", profileId: profile.id });
      }
      await connectionApi.deleteProfile(profile.id);
      for (const tab of workspaceTabs.tabs) {
        if (tab.kind !== "query" || tab.profileId !== profile.id) continue;
        const pending = draftSaveTimers.current.get(tab.id);
        if (pending) window.clearTimeout(pending.timeout);
        draftSaveTimers.current.delete(tab.id);
        discardedDraftIds.current.add(tab.id);
      }
      setProfiles((current) => current.filter((item) => item.id !== profile.id));
      dispatchSession({ type: "remove", profileId: profile.id });
      dispatchWorkspaceTabs({ type: "close-profile", profileId: profile.id });
      if (selectedProfileId === profile.id) setSelectedProfileId(undefined);
    } catch (error) {
      setProfileError(toCommandError(error).message);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <img src={plumeMark} alt="" />
          </span>
          <strong>Plume</strong>
          <span className="brand-divider" />
          <span className="brand-tagline">{t("app.tagline")}</span>
        </div>

        <div className="topbar-actions">
          <button
            className="language-button"
            type="button"
            title={t("language.switch")}
            onClick={() => setLocale(locale === "zh-CN" ? "en-US" : "zh-CN")}
          >
            <Globe2 size={15} />
            {locale === "zh-CN" ? "中文" : "EN"}
          </button>
          <button
            className="button button-primary button-compact"
            type="button"
            onClick={() => setDialogProfile(null)}
          >
            <Plus size={15} />
            {t("workspace.newConnection")}
          </button>
        </div>
      </header>

      <div
        className={`app-content ${resizingSidebar ? "app-content-resizing" : ""} ${sidebarCollapsed ? "app-content-sidebar-collapsed" : ""}`}
        style={appContentStyle}
      >
        <aside
          className="sidebar"
          aria-hidden={sidebarCollapsed}
          inert={sidebarCollapsed}
        >
          <div className="sidebar-heading">
            <span>{t("sidebar.connections")}</span>
            <div className="sidebar-heading-actions">
              <IconButton
                label={t("workspace.newConnection")}
                onClick={() => setDialogProfile(null)}
              >
                <Plus size={16} />
              </IconButton>
              <IconButton
                label={t("sidebar.collapse")}
                onClick={() => setSidebarCollapsed(true)}
              >
                <PanelLeftClose size={16} />
              </IconButton>
            </div>
          </div>

          <label className="sidebar-search">
            <Search size={14} />
            <input
              aria-label={t("sidebar.search")}
              placeholder={t("sidebar.search")}
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </label>

          <div className="connection-tree" role="tree">
            {visibleConnections.map((connection) => (
              <ConnectionTreeItem
                key={`${connection.id}:${getConnectionSession(sessions, connection.id).sessionId ?? "none"}`}
                connection={connection}
                sessionId={getConnectionSession(sessions, connection.id).sessionId}
                lifecycleState={getConnectionSession(sessions, connection.id).state}
                environmentClassName={environmentClass[connection.environment]}
                selected={highlightedProfileId === connection.id}
                onSelect={() => setSelectedProfileId(connection.id)}
                onConnect={() => void connectProfile(connection)}
                onReconnect={() => void reconnectProfile(connection)}
                onDisconnect={() => void disconnectProfile(connection)}
                onCheckHealth={() => void checkProfileSession(connection)}
                onSessionError={(message) => markSessionFailed(connection.id, message)}
                onEdit={() => setDialogProfile(connection)}
                onDuplicate={() => void duplicateProfile(connection)}
                onRename={() => void renameProfile(connection)}
                onDelete={() => void deleteProfile(connection)}
                onToggleFavorite={() => void toggleFavorite(connection)}
                onOpenTable={(reference) => openTableData(connection, reference)}
              />
            ))}

            {profiles.length === 0 && (
              <div className="sidebar-empty">
                <Database size={20} strokeWidth={1.5} />
                <strong>{t("sidebar.emptyTitle")}</strong>
                <p>{t("sidebar.emptyBody")}</p>
              </div>
            )}
          </div>
        </aside>

        {!sidebarCollapsed && (
          <div
            className="sidebar-resizer"
            role="separator"
            aria-label={t("sidebar.resize")}
            aria-orientation="vertical"
            aria-valuemin={minimumSidebarWidth}
            aria-valuemax={maximumSidebarWidth}
            aria-valuenow={sidebarWidth}
            tabIndex={0}
            onDoubleClick={() => setSidebarWidth(defaultSidebarWidth)}
            onKeyDown={resizeSidebarWithKeyboard}
            onPointerDown={startSidebarResize}
            onPointerMove={resizeSidebar}
            onPointerUp={stopSidebarResize}
            onPointerCancel={stopSidebarResize}
          />
        )}

        <section className="workspace">
          <div className="tabbar">
            {sidebarCollapsed && (
              <IconButton
                className="sidebar-expand-button"
                label={t("sidebar.expand")}
                onClick={() => setSidebarCollapsed(false)}
              >
                <PanelLeftOpen size={16} />
              </IconButton>
            )}
            <div
              className="tab-list"
              role="tablist"
              aria-label={t("workspace.tabs")}
            >
              {workspaceTabs.tabs.map((tab) => {
                const active = tab.id === workspaceTabs.activeTabId;
                const title = getWorkspaceTabTitle(
                  tab,
                  profiles,
                  t("workspace.welcomeTab"),
                );
                return (
                  <div
                    className={`tab-shell ${active ? "tab-shell-active" : ""}`}
                    key={tab.id}
                  >
                    <button
                      id={`workspace-tab-${tab.id}`}
                      className="tab"
                      type="button"
                      role="tab"
                      aria-controls="workspace-tabpanel"
                      aria-selected={active}
                      data-tab-id={tab.id}
                      tabIndex={active ? 0 : -1}
                      title={title}
                      onClick={() =>
                        dispatchWorkspaceTabs({
                          type: "activate",
                          tabId: tab.id,
                        })
                      }
                      onDoubleClick={() => renameWorkspaceTab(tab)}
                      onKeyDown={(event) => navigateWorkspaceTabs(event, tab)}
                    >
                      <WorkspaceTabIcon tab={tab} />
                      <span>{title}</span>
                    </button>
                    {tab.kind !== "welcome" && (
                      <IconButton
                        className="tab-close"
                        label={`${t("workspace.closeTab")} ${title}`}
                        onClick={() => closeWorkspaceTab(tab)}
                      >
                        <X size={13} />
                      </IconButton>
                    )}
                  </div>
                );
              })}
            </div>
            <IconButton
              className="tabbar-new-query"
              label={t("app.newQuery")}
              disabled={
                activeTab.kind === "welcome" ||
                !activeSession ||
                (activeSession.state !== "connected" &&
                  activeSession.state !== "busy")
              }
              onClick={() => openQueryWorkspace()}
            >
              <Plus size={16} />
            </IconButton>
          </div>

          <div
            id="workspace-tabpanel"
            className="workspace-tabpanel"
            role="tabpanel"
            aria-labelledby={`workspace-tab-${activeTab.id}`}
          >
            {activeTab.kind === "welcome" || !activeProfile ? (
              <WelcomeWorkspace onNewConnection={() => setDialogProfile(null)} />
            ) : activeTab.kind === "query" ? (
              <QueryWorkspace
                tab={activeTab}
                profile={activeProfile}
                connection={activeConnection}
                state={activeSession?.state ?? "disconnected"}
                error={activeSession?.error}
                rowLimit={queryRowLimit}
                onReconnect={() => void connectProfile(activeProfile, false)}
                onSave={() => void saveQueryDraft(activeTab)}
                onRowLimitChange={setQueryRowLimit}
                onExecute={(target) => {
                  if (
                    !activeConnection ||
                    activeSession?.state !== "connected"
                  ) {
                    return;
                  }
                  void executeQuery(
                    activeTab,
                    activeConnection.sessionId,
                    target,
                    queryRowLimit,
                  );
                }}
                onCancel={() => {
                  if (activeConnection) {
                    void cancelQuery(activeTab, activeConnection.sessionId);
                  }
                }}
                onSqlChange={(sql) =>
                  dispatchWorkspaceTabs({
                    type: "update-query",
                    tabId: activeTab.id,
                    sql,
                  })
                }
              />
            ) : activeTab.kind === "table-data" ? (
              <TableDataWorkspace
                tab={activeTab}
                connection={activeConnection}
                state={activeSession?.state ?? "disconnected"}
                onReconnect={() => void connectProfile(activeProfile, false)}
                onReload={() => {
                  if (!activeConnection || activeSession?.state !== "connected") {
                    return;
                  }
                  const query = createTableDataQuery(
                    activeTab,
                    activeTab,
                    activeTab.sorts,
                    activeTab.columns,
                    activeTab.filters,
                  );
                  void executeQuery(
                    activeTab,
                    activeConnection.sessionId,
                    query.target,
                    activeTab.pageSize + 1,
                    query,
                  );
                }}
                onPageChange={(pageIndex, pageSize) =>
                  dispatchWorkspaceTabs({
                    type: "set-table-data-page",
                    tabId: activeTab.id,
                    pageIndex,
                    pageSize,
                  })
                }
                onSortsChange={(sorts) =>
                  dispatchWorkspaceTabs({
                    type: "set-table-data-sort",
                    tabId: activeTab.id,
                    sorts,
                  })
                }
                onFiltersChange={(filters) =>
                  dispatchWorkspaceTabs({
                    type: "set-table-data-filters",
                    tabId: activeTab.id,
                    filters,
                  })
                }
                onChangesChange={(changes) =>
                  dispatchWorkspaceTabs({
                    type: "stage-table-data-changes",
                    tabId: activeTab.id,
                    changes,
                  })
                }
                onCancel={() => {
                  if (activeConnection) {
                    void cancelQuery(activeTab, activeConnection.sessionId);
                  }
                }}
              />
            ) : activeSession?.state === "error" ? (
              <ConnectionErrorWorkspace
                message={activeSession.error ?? t("connection.state.error")}
                onReconnect={() => void reconnectProfile(activeProfile, false)}
              />
            ) : activeConnection ? (
              <ConnectedWorkspace
                connection={activeConnection}
                onNewQuery={() => openQueryWorkspace(activeTab)}
              />
            ) : (
              <UnavailableWorkspace
                state={activeSession?.state ?? "disconnected"}
                onReconnect={() => void connectProfile(activeProfile, false)}
              />
            )}
          </div>
        </section>
      </div>

      <footer className="statusbar">
        <span
          className={`status-dot ${activeSession?.state === "connected" ? "status-dot-online" : ""} ${activeSession?.state === "error" ? "status-dot-error" : ""}`}
        />
        {activeProfile && <EnvironmentBadge profile={activeProfile} compact />}
        <span>
          {profileError || draftError
            ? profileError ?? draftError
            : activeProfile && activeSession
            ? `${t(`connection.state.${activeSession.state}`)} · ${activeProfile.host}:${activeProfile.port} / ${activeTab.kind === "welcome" ? activeProfile.database : activeTab.database}`
            : t("status.disconnected")}
        </span>
        <span className="status-spacer" />
        <span>Plume 0.1.0</span>
      </footer>

      {dialogProfile !== undefined && (
        <ConnectionDialog
          profile={dialogProfile ?? undefined}
          currentSessionId={
            dialogProfile
              ? getConnectionSession(sessions, dialogProfile.id).sessionId
              : undefined
          }
          onClose={() => setDialogProfile(undefined)}
          onSaved={handleProfileSaved}
          onConnecting={(profile) => {
            const session = getConnectionSession(sessions, profile.id);
            dispatchSession({
              type: session.sessionId ? "reconnect" : "connect",
              profileId: profile.id,
            });
          }}
          onConnectionFailed={(profileId, message) =>
            dispatchSession({ type: "failed", profileId, error: message })
          }
          onConnected={handleConnected}
        />
      )}
      {leaveRequest && (
        <TableDataLeaveDialog
          items={leaveRequest.tabIds.flatMap((tabId) => {
            const tab = workspaceTabs.tabs.find(
              (item): item is TableDataTab =>
                item.id === tabId && item.kind === "table-data",
            );
            return tab
              ? [
                  {
                    id: tab.id,
                    database: tab.database,
                    schema: tab.schema,
                    table: tab.table,
                    changes: tab.changes,
                  },
                ]
              : [];
          })}
          status={leaveStatus.status}
          error={leaveStatus.status === "failed" ? leaveStatus.message : undefined}
          onCommit={() => void commitTableDataBeforeLeave()}
          onDiscard={discardTableDataBeforeLeave}
          onCancel={() => {
            setLeaveRequest(undefined);
            setLeaveStatus({ status: "idle" });
          }}
        />
      )}
    </main>
  );
}

function ConnectionErrorWorkspace({
  message,
  onReconnect,
}: {
  message: string;
  onReconnect: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="connection-error-workspace" role="alert">
      <Database size={24} strokeWidth={1.5} />
      <h1>{t("connection.state.error")}</h1>
      <p>{message}</p>
      <button className="button button-primary" type="button" onClick={onReconnect}>
        {t("connection.reconnect")}
      </button>
    </div>
  );
}

function isTransitioning(state: ConnectionLifecycleState) {
  return (
    state === "connecting" ||
    state === "reconnecting" ||
    state === "disconnecting" ||
    state === "busy"
  );
}

function WelcomeWorkspace({ onNewConnection }: { onNewConnection: () => void }) {
  const { t } = useI18n();
  return (
    <div className="welcome-workspace">
      <div className="welcome-symbol" aria-hidden="true">
        <Database size={28} strokeWidth={1.5} />
      </div>
      <h1>{t("workspace.welcome")}</h1>
      <p>{t("workspace.description")}</p>
      <button className="button button-primary" type="button" onClick={onNewConnection}>
        <Plus size={16} />
        {t("workspace.newConnection")}
      </button>
    </div>
  );
}

function ConnectedWorkspace({
  connection,
  onNewQuery,
}: {
  connection: ActiveConnection;
  onNewQuery: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="connected-workspace">
      <header className="connection-overview">
        <div>
          <div className="connection-overview-meta">
            <EnvironmentBadge profile={connection} />
            <span className="connection-eyebrow">{connection.host}:{connection.port}</span>
          </div>
          <h1>{connection.database}</h1>
          <p>PostgreSQL {connection.serverVersion}</p>
        </div>
        <button
          className="button button-primary"
          type="button"
          onClick={onNewQuery}
        >
          <Braces size={16} />
          {t("app.newQuery")}
        </button>
      </header>
      <div className="workspace-placeholder">
        <Table2 size={22} strokeWidth={1.5} />
        <span>{t("workspace.selectObject")}</span>
      </div>
    </div>
  );
}

function TableDataWorkspace({
  tab,
  connection,
  state,
  onReconnect,
  onReload,
  onPageChange,
  onSortsChange,
  onFiltersChange,
  onChangesChange,
  onCancel,
}: {
  tab: TableDataTab;
  connection?: ActiveConnection;
  state: ConnectionLifecycleState;
  onReconnect: () => void;
  onReload: () => void;
  onPageChange: (pageIndex: number, pageSize: number) => void;
  onSortsChange: (sorts: TableDataTab["sorts"]) => void;
  onFiltersChange: (filters: TableDataTab["filters"]) => void;
  onChangesChange: (changes: TableDataChangeSet) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [changeTarget, setChangeTarget] = useState<
    (TableDataChangeTarget & { requestId: number }) | undefined
  >();
  const nextChangeTargetId = useRef(0);
  const [commitState, setCommitState] = useState<
    | { status: "idle" }
    | { status: "committing" }
    | { status: "failed"; message: string }
  >({ status: "idle" });
  const execution = getQueryExecution(tab);
  const loading =
    execution.status === "idle" ||
    execution.status === "running" ||
    execution.status === "cancelling";
  const pageLabel = t("tableData.page").replace(
    "{page}",
    (tab.pageIndex + 1).toLocaleString(),
  );
  const rowStatement =
    execution.status === "succeeded"
      ? execution.result.results.find(
          (statement): statement is QueryStatementResult => statement.kind === "rows",
        )
      : undefined;
  const editing =
    rowStatement &&
    tab.editability.status === "editable" &&
    commitState.status !== "committing"
      ? createTableDataGridEditing(
          {
            pageIndex: tab.pageIndex,
            key: tab.editability.key,
            changes: tab.changes,
          },
          rowStatement,
          handleChangesChange,
        )
      : undefined;

  function handleChangesChange(changes: TableDataChangeSet) {
    setCommitState({ status: "idle" });
    onChangesChange(changes);
  }

  async function commitChanges() {
    if (
      !connection ||
      loading ||
      commitState.status === "committing" ||
      tab.editability.status !== "editable" ||
      !hasPendingTableDataChanges(tab.changes)
    ) {
      return;
    }

    const request = createCommitTableDataRequest(
      connection.sessionId,
      tab,
      tab.columns,
      tab.editability.key,
      tab.changes,
    );
    setCommitState({ status: "committing" });
    try {
      await tableDataApi.commit(request);
      onChangesChange(createEmptyTableDataChangeSet());
      setCommitState({ status: "idle" });
      onReload();
    } catch (error) {
      setCommitState({ status: "failed", message: toCommandError(error).message });
    }
  }

  function navigateToChange(target: TableDataChangeTarget) {
    nextChangeTargetId.current += 1;
    setChangeTarget({ ...target, requestId: nextChangeTargetId.current });
    if (target.pageIndex !== tab.pageIndex) {
      onPageChange(target.pageIndex, tab.pageSize);
    }
  }

  if (!connection) {
    return <UnavailableWorkspace state={state} onReconnect={onReconnect} />;
  }

  return (
    <section
      className={`table-data-workspace ${
        hasPendingTableDataChanges(tab.changes)
          ? "table-data-workspace-with-change-preview"
          : ""
      }`}
      aria-label={t("tableData.workspace")}
    >
      <header className="table-data-header">
        <div className="table-data-title">
          <div className="table-data-title-meta">
            {connection && <EnvironmentBadge profile={connection} />}
            <span className="table-data-context">
              {tab.database} / {tab.schema}
            </span>
          </div>
          <h1>{tab.table}</h1>
          <TableEditabilityStatus editability={tab.editability} />
        </div>
        <div className="table-data-toolbar">
          {tab.sorts.length === 0 ? (
            <span className="table-data-order-warning">
              <AlertTriangle size={12} />
              {t("tableData.unstableOrder")}
            </span>
          ) : (
            <div
              className="table-data-sort-summary"
              aria-label={t("tableData.currentSort")}
            >
              {tab.sorts.map((sort, index) => (
                <span key={`${sort.columnIndex}:${sort.direction}`}>
                  {sort.direction === "ASC" ? (
                    <ArrowUp size={11} />
                  ) : (
                    <ArrowDown size={11} />
                  )}
                  {index + 1}. {sort.columnName}
                </span>
              ))}
            </div>
          )}
          <IconButton
            label={t("tableData.addRow")}
            disabled={
              loading ||
              !editing ||
              tab.columns.length === 0
            }
            onClick={() =>
              handleChangesChange(
                stageTableRowInsert(
                  tab.changes,
                  crypto.randomUUID(),
                  tab.columns.length,
                  tab.pageIndex,
                ),
              )
            }
          >
            <Plus size={14} />
          </IconButton>
          <IconButton
            label={t("tableData.commit")}
            disabled={
              loading ||
              commitState.status === "committing" ||
              tab.editability.status !== "editable" ||
              !hasPendingTableDataChanges(tab.changes)
            }
            onClick={() => void commitChanges()}
          >
            {commitState.status === "committing" ? (
              <LoaderCircle className="spin" size={14} />
            ) : (
              <Save size={14} />
            )}
          </IconButton>
          <IconButton
            label={t("tableData.discardAll")}
            disabled={
              commitState.status === "committing" ||
              !hasPendingTableDataChanges(tab.changes)
            }
            onClick={() =>
              handleChangesChange(discardAllTableDataChanges(tab.changes))
            }
          >
            <Undo2 size={14} />
          </IconButton>
          <label className="table-data-page-size">
            <span>{t("tableData.pageSize")}</span>
            <select
              value={tab.pageSize}
              disabled={loading}
              onChange={(event) =>
                onPageChange(0, Number(event.currentTarget.value))
              }
            >
              {TABLE_DATA_PAGE_SIZE_OPTIONS.map((pageSize) => (
                <option key={pageSize} value={pageSize}>
                  {pageSize}
                </option>
              ))}
            </select>
          </label>
          <div className="table-data-pager" aria-label={t("tableData.pagination")}>
            <IconButton
              label={t("tableData.previousPage")}
              disabled={loading || tab.pageIndex === 0}
              onClick={() => onPageChange(tab.pageIndex - 1, tab.pageSize)}
            >
              <ChevronLeft size={14} />
            </IconButton>
            <span aria-live="polite">{pageLabel}</span>
            <IconButton
              label={t("tableData.nextPage")}
              disabled={loading || !tab.hasNextPage}
              onClick={() => onPageChange(tab.pageIndex + 1, tab.pageSize)}
            >
              <ChevronRight size={14} />
            </IconButton>
          </div>
          {execution.status === "running" ? (
            <IconButton label={t("query.cancel")} onClick={onCancel}>
              <Square size={12} fill="currentColor" />
            </IconButton>
          ) : (
            <IconButton
              label={t("tableData.reload")}
              disabled={loading}
              onClick={onReload}
            >
              {execution.status === "cancelling" ? (
                <LoaderCircle className="spin" size={14} />
              ) : (
                <RefreshCw size={14} />
              )}
            </IconButton>
          )}
        </div>
      </header>

      <TableDataFilterBar
        columns={tab.columns}
        filters={tab.filters}
        disabled={loading}
        onApply={onFiltersChange}
      />

      <TableDataChangePreview
        changes={tab.changes}
        columns={tab.columns}
        onNavigate={navigateToChange}
        commitStatus={commitState.status}
        commitError={
          commitState.status === "failed" ? commitState.message : undefined
        }
      />

      <div className="table-data-content">
        {execution.status === "succeeded" ? (
          <Suspense
            fallback={
              <div className="query-result-loading" role="status">
                <LoaderCircle className="spin" size={15} />
                {t("query.results.loading")}
              </div>
            }
          >
            <QueryResultPanel
              result={execution.result}
              sorts={tab.sorts}
              editing={editing}
              focusTarget={
                changeTarget?.pageIndex === tab.pageIndex
                  ? {
                      requestId: changeTarget.requestId,
                      rowIndex: changeTarget.rowIndex,
                      insertedId: changeTarget.localId,
                      columnIndex: changeTarget.columnIndex,
                    }
                  : undefined
              }
              onFocusTargetApplied={(requestId) =>
                setChangeTarget((current) =>
                  current?.requestId === requestId ? undefined : current,
                )
              }
              onSortsChange={(sorts) => {
                onSortsChange(
                  sorts.map((sort) => ({
                    ...sort,
                    columnName:
                      rowStatement?.columns[sort.columnIndex]?.name ??
                      String(sort.columnIndex + 1),
                  })),
                );
              }}
            />
          </Suspense>
        ) : execution.status === "failed" ? (
          <div className="table-data-error" role="alert">
            <strong>{t("tableData.failed")}</strong>
            <span>{execution.error.message}</span>
            <button
              className="button button-quiet button-compact"
              type="button"
              onClick={onReload}
            >
              <RefreshCw size={13} />
              {t("tableData.retry")}
            </button>
          </div>
        ) : execution.status === "cancelled" ? (
          <div className="table-data-error" role="status">
            <strong>{t("query.cancelled")}</strong>
            <button
              className="button button-quiet button-compact"
              type="button"
              onClick={onReload}
            >
              <RefreshCw size={13} />
              {t("tableData.retry")}
            </button>
          </div>
        ) : (
          <div className="table-data-loading" role="status">
            <LoaderCircle className="spin" size={16} />
            <span>
              {execution.status === "cancelling"
                ? t("query.cancelling.requesting")
                : t("tableData.loading")}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

export function TableEditabilityStatus({
  editability,
}: {
  editability: TableDataTab["editability"];
}) {
  const { t } = useI18n();
  if (editability.status === "idle" || editability.status === "loading") {
    return (
      <span className="table-data-editability" role="status">
        <LoaderCircle className="spin" size={10} />
        {t("tableData.editabilityChecking")}
      </span>
    );
  }
  if (editability.status === "editable") {
    const keyLabel =
      editability.key.kind === "primary-key"
        ? t("tableData.primaryKey")
        : t("tableData.uniqueKey");
    const detail = `${keyLabel}: ${editability.key.columns.join(", ")}`;
    return (
      <span className="table-data-editability table-data-editable" title={detail}>
        <KeyRound size={10} />
        <strong>{t("tableData.editable")}</strong>
        <span>{detail}</span>
      </span>
    );
  }
  const reason =
    editability.reason === "no-reliable-key"
      ? t("tableData.noReliableKey")
      : t("tableData.editabilityUnavailable");
  return (
    <span className="table-data-editability table-data-read-only" title={reason}>
      <LockKeyhole size={10} />
      <strong>{t("tableData.readOnly")}</strong>
      <span>{reason}</span>
    </span>
  );
}

export function EnvironmentBadge({
  profile,
  compact = false,
}: {
  profile: Pick<ConnectionProfile, "environment" | "color">;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const label = t(`environment.${profile.environment}`);
  const description = t("environment.current").replace("{environment}", label);
  return (
    <span
      className={`workspace-environment workspace-environment-${profile.environment} ${compact ? "workspace-environment-compact" : ""}`}
      style={{ "--connection-accent": profile.color } as CSSProperties}
      aria-label={description}
      title={description}
    >
      <span aria-hidden="true" />
      {label}
    </span>
  );
}

function QueryWorkspace({
  tab,
  profile,
  connection,
  state,
  error,
  rowLimit,
  onReconnect,
  onSave,
  onRowLimitChange,
  onExecute,
  onCancel,
  onSqlChange,
}: {
  tab: Extract<WorkspaceTab, { kind: "query" }>;
  profile: ConnectionProfile;
  connection?: ActiveConnection;
  state: ConnectionLifecycleState;
  error?: string;
  rowLimit: number;
  onReconnect: () => void;
  onSave: () => void;
  onRowLimitChange: (rowLimit: number) => void;
  onExecute: (target: SqlExecutionTarget) => void;
  onCancel: () => void;
  onSqlChange: (sql: string) => void;
}) {
  const { locale, t } = useI18n();
  const editorRef = useRef<SqlEditorController>(null);
  const workspaceMainRef = useRef<HTMLDivElement>(null);
  const resultResizeStart = useRef<{
    pointerId: number;
    pointerY: number;
    height: number;
  } | null>(null);
  const [resultHeight, setResultHeight] = useState(defaultQueryResultHeight);
  const [workspaceHeight, setWorkspaceHeight] = useState(0);
  const [resizingResult, setResizingResult] = useState(false);
  const execution = getQueryExecution(tab);
  const result = execution.status === "succeeded" ? execution.result : undefined;
  const transitioning = isTransitioning(state);
  const canExecute =
    Boolean(connection) &&
    state === "connected" &&
    execution.status !== "running" &&
    execution.status !== "cancelling" &&
    tab.sql.trim().length > 0;

  useEffect(() => {
    if (execution.status !== "failed") return;

    const position = execution.error.diagnostic?.position;
    if (position === undefined) return;

    const range = resolveQueryErrorRange(tab.sql, execution.target, position);
    if (range) editorRef.current?.revealError(range);
  }, [execution, tab.sql]);

  useEffect(() => {
    const element = workspaceMainRef.current;
    if (!element || !result) return;

    const updateHeight = () => setWorkspaceHeight(element.clientHeight);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, [result]);

  function currentWorkspaceHeight() {
    const measuredHeight =
      workspaceHeight || workspaceMainRef.current?.clientHeight || 0;
    return measuredHeight > 0
      ? measuredHeight
      : minimumQueryEditorHeight +
          queryResultResizerSize +
          defaultQueryResultHeight;
  }

  function startResultResize(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;

    resultResizeStart.current = {
      pointerId: event.pointerId,
      pointerY: event.clientY,
      height: effectiveResultHeight,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizingResult(true);
  }

  function resizeResult(event: PointerEvent<HTMLDivElement>) {
    const start = resultResizeStart.current;
    if (!start || start.pointerId !== event.pointerId) return;

    setResultHeight(
      clampQueryResultHeight(
        start.height + start.pointerY - event.clientY,
        currentWorkspaceHeight(),
      ),
    );
  }

  function stopResultResize(event: PointerEvent<HTMLDivElement>) {
    const start = resultResizeStart.current;
    if (!start || start.pointerId !== event.pointerId) return;

    resultResizeStart.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setResizingResult(false);
  }

  function resizeResultWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    const direction =
      event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
    if (direction === 0) return;

    event.preventDefault();
    setResultHeight(
      clampQueryResultHeight(
        effectiveResultHeight + direction * queryResultKeyboardStep,
        currentWorkspaceHeight(),
      ),
    );
  }

  const renderedWorkspaceHeight =
    workspaceHeight ||
    minimumQueryEditorHeight +
      queryResultResizerSize +
      defaultQueryResultHeight;
  const effectiveResultHeight = clampQueryResultHeight(
    resultHeight,
    renderedWorkspaceHeight,
  );
  const workspaceMainStyle = {
    "--query-result-height": `${effectiveResultHeight}px`,
  } as CSSProperties;

  return (
    <div
      className={`query-workspace ${connection ? "" : "query-workspace-offline"} ${execution.status === "idle" ? "" : "query-workspace-with-execution"}`}
    >
      <header className="query-contextbar">
        <div className="query-context-title">
          <div className="query-context-heading">
            <strong>{tab.title}</strong>
            <EnvironmentBadge profile={profile} compact />
          </div>
          <span>
            {profile.name} / {tab.database}
            {tab.schema ? ` / ${tab.schema}` : ""}
          </span>
        </div>
        <div className="query-context-actions">
          <label className="query-row-limit-control">
            <span>{t("query.rowLimit")}</span>
            <select
              aria-label={t("query.rowLimit")}
              value={rowLimit}
              disabled={
                execution.status === "running" ||
                execution.status === "cancelling"
              }
              onChange={(event) =>
                onRowLimitChange(Number(event.currentTarget.value))
              }
            >
              {QUERY_ROW_LIMIT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option.toLocaleString(locale)}
                </option>
              ))}
            </select>
          </label>
          <IconButton
            className="query-run-button"
            label={t("query.runCurrent")}
            disabled={!canExecute}
            onClick={() => {
              const target = editorRef.current?.getExecutionTarget();
              if (target) onExecute(target);
            }}
          >
            <Play size={14} />
          </IconButton>
          <IconButton
            className="query-run-button"
            label={t("query.runAll")}
            disabled={!canExecute}
            onClick={() => {
              const target = editorRef.current?.getExecutionTarget("all");
              if (target) onExecute(target);
            }}
          >
            <ListStart size={14} />
          </IconButton>
          <span
            className={`query-draft-state query-draft-state-${tab.draftState}`}
            role="status"
          >
            {t(`workspace.draft.${tab.draftState}`)}
          </span>
          <IconButton
            className="query-save-button"
            label={t("workspace.saveDraft")}
            disabled={tab.draftState === "saved" || tab.draftState === "saving"}
            onClick={onSave}
          >
            <Save size={14} />
          </IconButton>
          <span className="query-connection-state">
            <span
              className={`status-dot ${connection ? "status-dot-online" : state === "error" ? "status-dot-error" : ""}`}
            />
            {connection ? t("status.ready") : t(`connection.state.${state}`)}
          </span>
        </div>
      </header>
      {!connection && (
        <div className="query-offline-notice" role="status">
          <span>{error ?? t("workspace.offlineEditing")}</span>
          <button
            className="button button-secondary button-compact"
            type="button"
            disabled={transitioning}
            onClick={onReconnect}
          >
            {transitioning
              ? t(`connection.state.${state}`)
              : t("connection.reconnect")}
          </button>
        </div>
      )}
      {execution.status !== "idle" && (
        <QueryExecutionNotice execution={execution} onCancel={onCancel} />
      )}
      <div
        ref={workspaceMainRef}
        className={`query-workspace-main ${result ? "query-workspace-main-with-results" : ""} ${resizingResult ? "query-workspace-main-resizing" : ""}`}
        style={workspaceMainStyle}
      >
        <Suspense
          fallback={
            <div
              className="sql-editor-loading"
              role="status"
              aria-label={t("workspace.editorLoading")}
            />
          }
        >
          <SqlEditor
            ref={editorRef}
            label={t("workspace.queryArea")}
            value={tab.sql}
            completionConnection={
              connection
                ? {
                    sessionId: connection.sessionId,
                    database: tab.database,
                    defaultSchema: tab.schema ?? "public",
                  }
                : undefined
            }
            onChange={onSqlChange}
          />
        </Suspense>
        {result && (
          <>
            <div
              className="query-result-resizer"
              role="separator"
              aria-label={t("query.results.resize")}
              aria-orientation="horizontal"
              aria-valuemin={minimumQueryResultHeight}
              aria-valuemax={Math.max(
                minimumQueryResultHeight,
                renderedWorkspaceHeight -
                  minimumQueryEditorHeight -
                  queryResultResizerSize,
              )}
              aria-valuenow={effectiveResultHeight}
              tabIndex={0}
              onKeyDown={resizeResultWithKeyboard}
              onPointerDown={startResultResize}
              onPointerMove={resizeResult}
              onPointerUp={stopResultResize}
              onPointerCancel={stopResultResize}
            />
            <Suspense
              fallback={
                <div
                  className="query-result-loading"
                  role="status"
                  aria-label={t("query.results.loading")}
                />
              }
            >
              <QueryResultPanel key={result.queryId} result={result} />
            </Suspense>
          </>
        )}
      </div>
    </div>
  );
}

function QueryExecutionNotice({
  execution,
  onCancel,
}: {
  execution: Exclude<QueryExecutionState, { status: "idle" }>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const durationMs = useQueryElapsedMs(execution);
  const message =
    execution.status === "running"
      ? execution.cancelError?.message ?? t("query.running")
      : execution.status === "cancelling"
        ? t(`query.cancelling.${execution.requestStatus}`)
        : execution.status === "cancelled"
          ? t("query.cancelled")
      : execution.status === "succeeded"
        ? t("query.completed")
        : execution.error.message;
  const details = [
    `${t(
      execution.status === "running" || execution.status === "cancelling"
        ? "query.elapsed"
        : "query.duration",
    )} ${formatQueryDuration(durationMs)}`,
  ];
  if (execution.status === "succeeded") {
    const summary = summarizeQueryResult(execution.result);
    if (summary.returnedRows !== undefined) {
      details.push(`${t("query.rowsReturned")} ${summary.returnedRows}`);
    }
    if (summary.affectedRows !== undefined) {
      details.push(`${t("query.rowsAffected")} ${summary.affectedRows}`);
    }
    if (summary.truncated) details.push(t("query.truncated"));
  }

  return (
    <div
      className={`query-execution-notice query-execution-notice-${execution.status}`}
      role={
        execution.status === "failed" ||
        (execution.status === "running" && execution.cancelError)
          ? "alert"
          : "status"
      }
    >
      <div className="query-execution-content">
        <span className="query-execution-message">{message}</span>
        <span className="query-execution-details">
          {details.map((detail) => (
            <span key={detail}>{detail}</span>
          ))}
        </span>
        {execution.status === "failed" &&
          (execution.error.detail || execution.error.diagnostic) && (
            <QueryErrorDetails
              key={execution.queryId}
              error={execution.error}
            />
          )}
      </div>
      {execution.status === "running" && (
        <IconButton
          className="query-cancel-button"
          label={t("query.cancel")}
          onClick={onCancel}
        >
          <Square size={12} fill="currentColor" />
        </IconButton>
      )}
    </div>
  );
}

function QueryErrorDetails({
  error,
}: {
  error: Extract<QueryExecutionState, { status: "failed" }>["error"];
}) {
  const { t } = useI18n();
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const diagnostic = error.diagnostic;
  const fields = [
    diagnostic && {
      label: t("query.error.sqlState"),
      value: diagnostic.sqlState,
    },
    diagnostic && {
      label: t("query.error.severity"),
      value: diagnostic.severity,
    },
    diagnostic?.position !== undefined && {
      label: t("query.error.position"),
      value: String(diagnostic.position),
    },
    error.detail && {
      label: t("query.error.detail"),
      value: error.detail,
    },
    diagnostic?.hint && {
      label: t("query.error.hint"),
      value: diagnostic.hint,
    },
  ].filter((field): field is { label: string; value: string } => Boolean(field));
  const copyLabel =
    copyStatus === "copied"
      ? t("query.error.copied")
      : copyStatus === "failed"
        ? t("query.error.copyFailed")
        : t("query.error.copy");

  async function copyDetails() {
    const text = [
      `${t("query.error.message")}: ${error.message}`,
      ...fields.map((field) => `${field.label}: ${field.value}`),
    ].join("\n");

    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  return (
    <div className="query-error-technical">
      <dl className="query-error-fields">
        {fields.map((field) => (
          <div key={field.label}>
            <dt>{field.label}</dt>
            <dd>{field.value}</dd>
          </div>
        ))}
      </dl>
      <IconButton
        className="query-error-copy-button"
        label={copyLabel}
        onClick={() => void copyDetails()}
      >
        {copyStatus === "copied" ? <Check size={13} /> : <Copy size={13} />}
      </IconButton>
    </div>
  );
}

function useQueryElapsedMs(
  execution: Exclude<QueryExecutionState, { status: "idle" }>,
) {
  const active = execution.status === "running" || execution.status === "cancelling";
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (!active) return;
    const interval = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, [active, execution.queryId]);

  return active
    ? Math.max(0, now - execution.startedAt)
    : execution.durationMs;
}

function UnavailableWorkspace({
  state,
  onReconnect,
}: {
  state: ConnectionLifecycleState;
  onReconnect: () => void;
}) {
  const { t } = useI18n();
  const transitioning = isTransitioning(state);
  return (
    <div className="connection-error-workspace workspace-unavailable">
      <Database size={24} strokeWidth={1.5} />
      <h1>{t("workspace.connectionUnavailable")}</h1>
      <p>{t("workspace.connectionUnavailableBody")}</p>
      <button
        className="button button-primary"
        type="button"
        disabled={transitioning}
        onClick={onReconnect}
      >
        {transitioning
          ? t(`connection.state.${state}`)
          : t("connection.reconnect")}
      </button>
    </div>
  );
}

function WorkspaceTabIcon({ tab }: { tab: WorkspaceTab }) {
  if (tab.kind === "connection") return <Database size={14} />;
  if (tab.kind === "query") return <Braces size={14} />;
  if (tab.kind === "table-data") return <Table2 size={14} />;
  return <FileText size={14} />;
}

function getWorkspaceTabTitle(
  tab: WorkspaceTab,
  profiles: ConnectionProfile[],
  welcomeTitle: string,
) {
  if (tab.kind === "welcome") return welcomeTitle;
  if (tab.title) return tab.title;
  return (
    profiles.find((profile) => profile.id === tab.profileId)?.name ??
    tab.database
  );
}

function isConnectionQueryError(code: string) {
  return [
    "connection_failed",
    "session_not_found",
    "ssh_tunnel_disconnected",
  ].includes(code);
}
