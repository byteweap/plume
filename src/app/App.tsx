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
  Braces,
  Database,
  FileText,
  Globe2,
  ListStart,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  Search,
  Save,
  Table2,
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
  type QueryExecutionState,
} from "../features/query-execution/queryExecution";
import { queryExecutionApi } from "../features/query-execution/queryExecutionApi";
import type {
  SqlEditorController,
  SqlExecutionTarget,
} from "../features/sql-editor/SqlEditor";
import {
  createInitialWorkspaceTabsState,
  getActiveWorkspaceTab,
  getQueryExecution,
  workspaceTabsReducer,
  type QueryTab,
  type WorkspaceTab,
} from "../features/tabs/workspaceTabs";
import { useI18n } from "../i18n/I18nContext";
import { toCommandError } from "../platform/tauri";
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
const sidebarKeyboardStep = 16;
const SqlEditor = lazy(() =>
  import("../features/sql-editor/SqlEditor").then((module) => ({
    default: module.SqlEditor,
  })),
);

function clampSidebarWidth(width: number) {
  return Math.min(
    maximumSidebarWidth,
    Math.max(minimumSidebarWidth, Math.round(width)),
  );
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

  async function executeQuery(
    tab: QueryTab,
    sessionId: string,
    target: SqlExecutionTarget,
  ) {
    if (executingProfiles.current.has(tab.profileId)) return;

    const queryId = createQueryId();
    executingProfiles.current.add(tab.profileId);
    dispatchWorkspaceTabs({
      type: "query-started",
      tabId: tab.id,
      queryId,
      target,
    });
    dispatchSession({ type: "begin-work", profileId: tab.profileId });

    try {
      const result = await queryExecutionApi.execute({
        queryId,
        sessionId,
        database: tab.database,
        sql: target.sql,
      });
      dispatchWorkspaceTabs({
        type: "query-succeeded",
        tabId: tab.id,
        result,
      });
      dispatchSession({ type: "ready", profileId: tab.profileId });
    } catch (error) {
      const commandError = toCommandError(error);
      dispatchWorkspaceTabs({
        type: "query-failed",
        tabId: tab.id,
        queryId,
        error: commandError,
      });
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
  }

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
                onReconnect={() => void connectProfile(activeProfile, false)}
                onSave={() => void saveQueryDraft(activeTab)}
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
                  );
                }}
                onSqlChange={(sql) =>
                  dispatchWorkspaceTabs({
                    type: "update-query",
                    tabId: activeTab.id,
                    sql,
                  })
                }
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
          <span className="connection-eyebrow">{connection.host}:{connection.port}</span>
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

function QueryWorkspace({
  tab,
  profile,
  connection,
  state,
  error,
  onReconnect,
  onSave,
  onExecute,
  onSqlChange,
}: {
  tab: Extract<WorkspaceTab, { kind: "query" }>;
  profile: ConnectionProfile;
  connection?: ActiveConnection;
  state: ConnectionLifecycleState;
  error?: string;
  onReconnect: () => void;
  onSave: () => void;
  onExecute: (target: SqlExecutionTarget) => void;
  onSqlChange: (sql: string) => void;
}) {
  const { t } = useI18n();
  const editorRef = useRef<SqlEditorController>(null);
  const execution = getQueryExecution(tab);
  const transitioning = isTransitioning(state);
  const canExecute =
    Boolean(connection) &&
    state === "connected" &&
    execution.status !== "running" &&
    tab.sql.trim().length > 0;
  return (
    <div
      className={`query-workspace ${connection ? "" : "query-workspace-offline"} ${execution.status === "idle" ? "" : "query-workspace-with-execution"}`}
    >
      <header className="query-contextbar">
        <div className="query-context-title">
          <strong>{tab.title}</strong>
          <span>
            {profile.name} / {tab.database}
            {tab.schema ? ` / ${tab.schema}` : ""}
          </span>
        </div>
        <div className="query-context-actions">
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
        <QueryExecutionNotice execution={execution} />
      )}
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
          onChange={onSqlChange}
        />
      </Suspense>
    </div>
  );
}

function QueryExecutionNotice({
  execution,
}: {
  execution: Exclude<QueryExecutionState, { status: "idle" }>;
}) {
  const { t } = useI18n();
  const message =
    execution.status === "running"
      ? t("query.running")
      : execution.status === "succeeded"
        ? t("query.completed")
        : execution.error.message;

  return (
    <div
      className={`query-execution-notice query-execution-notice-${execution.status}`}
      role={execution.status === "failed" ? "alert" : "status"}
    >
      {message}
    </div>
  );
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
