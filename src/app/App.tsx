import {
  useEffect,
  useMemo,
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
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Table2,
} from "lucide-react";
import plumeMark from "../assets/plume-mark.svg";
import { ConnectionDialog } from "../features/connections/ConnectionDialog";
import type {
  ActiveConnection,
  ConnectedDatabaseResult,
  ConnectionProfile,
} from "../features/connections/connection";
import { connectionApi } from "../features/connections/connectionApi";
import { ConnectionTreeItem } from "../features/database-tree/ConnectionTreeItem";
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
  const [sessions, setSessions] = useState<
    Record<string, { sessionId: string; serverVersion: string }>
  >({});
  const [selectedProfileId, setSelectedProfileId] = useState<string>();
  const [connectingProfileId, setConnectingProfileId] = useState<string>();
  const [profileError, setProfileError] = useState<string>();
  const [filter, setFilter] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(defaultSidebarWidth);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const sidebarResizeStart = useRef<{
    pointerId: number;
    pointerX: number;
    width: number;
  } | null>(null);

  const selectedProfile = profiles.find(
    (profile) => profile.id === selectedProfileId,
  );
  const activeConnection = useMemo<ActiveConnection | undefined>(() => {
    if (!selectedProfile) return undefined;
    const session = sessions[selectedProfile.id];
    return session ? { ...selectedProfile, ...session } : undefined;
  }, [selectedProfile, sessions]);
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
    let cancelled = false;
    connectionApi
      .listProfiles()
      .then((savedProfiles) => {
        if (!cancelled) setProfiles(savedProfiles);
      })
      .catch((error) => {
        const commandError = toCommandError(error);
        if (!cancelled && commandError.code !== "desktop_required") {
          setProfileError(commandError.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  function handleConnected(
    profile: ConnectionProfile,
    result: ConnectedDatabaseResult,
  ) {
    updateProfile(profile);
    setSessions((current) => ({
      ...current,
      [profile.id]: {
        sessionId: result.sessionId,
        serverVersion: result.serverVersion,
      },
    }));
    setSelectedProfileId(profile.id);
    setDialogProfile(undefined);
    setProfileError(undefined);
  }

  async function connectProfile(profile: ConnectionProfile) {
    if (sessions[profile.id] || connectingProfileId) {
      setSelectedProfileId(profile.id);
      return;
    }
    setConnectingProfileId(profile.id);
    setProfileError(undefined);
    try {
      handleConnected(profile, await connectionApi.connectSaved(profile.id));
    } catch (error) {
      setProfileError(toCommandError(error).message);
    } finally {
      setConnectingProfileId(undefined);
    }
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
      await connectionApi.deleteProfile(profile.id);
      setProfiles((current) => current.filter((item) => item.id !== profile.id));
      setSessions((current) => {
        const next = { ...current };
        delete next[profile.id];
        return next;
      });
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
                key={connection.id}
                connection={connection}
                sessionId={sessions[connection.id]?.sessionId}
                environmentClassName={environmentClass[connection.environment]}
                selected={selectedProfileId === connection.id}
                connecting={connectingProfileId === connection.id}
                onSelect={() => setSelectedProfileId(connection.id)}
                onConnect={() => void connectProfile(connection)}
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
          <div className="tabbar" role="tablist">
            {sidebarCollapsed && (
              <IconButton
                className="sidebar-expand-button"
                label={t("sidebar.expand")}
                onClick={() => setSidebarCollapsed(false)}
              >
                <PanelLeftOpen size={16} />
              </IconButton>
            )}
            <button className="tab tab-active" type="button" role="tab">
              <FileText size={14} />
              {activeConnection?.name ?? "Welcome"}
            </button>
          </div>

          {activeConnection ? (
            <ConnectedWorkspace connection={activeConnection} />
          ) : (
            <WelcomeWorkspace onNewConnection={() => setDialogProfile(null)} />
          )}
        </section>
      </div>

      <footer className="statusbar">
        <span className={`status-dot ${activeConnection ? "status-dot-online" : ""}`} />
        <span>
          {profileError
            ? profileError
            : activeConnection
            ? `${activeConnection.host}:${activeConnection.port} / ${activeConnection.database}`
            : t("status.disconnected")}
        </span>
        <span className="status-spacer" />
        <span>Plume 0.1.0</span>
      </footer>

      {dialogProfile !== undefined && (
        <ConnectionDialog
          profile={dialogProfile ?? undefined}
          onClose={() => setDialogProfile(undefined)}
          onSaved={handleProfileSaved}
          onConnected={handleConnected}
        />
      )}
    </main>
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

function ConnectedWorkspace({ connection }: { connection: ActiveConnection }) {
  const { t } = useI18n();
  return (
    <div className="connected-workspace">
      <header className="connection-overview">
        <div>
          <span className="connection-eyebrow">{connection.host}:{connection.port}</span>
          <h1>{connection.database}</h1>
          <p>PostgreSQL {connection.serverVersion}</p>
        </div>
        <button className="button button-primary" type="button">
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
