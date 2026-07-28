import { useMemo, useState } from "react";
import {
  Braces,
  Database,
  Feather,
  FileText,
  Globe2,
  Plus,
  Search,
  Table2,
} from "lucide-react";
import { ConnectionDialog } from "../features/connections/ConnectionDialog";
import type {
  ConnectedDatabaseResult,
  ConnectionFormValue,
  SavedConnection,
} from "../features/connections/connection";
import { ConnectionTreeItem } from "../features/database-tree/ConnectionTreeItem";
import { useI18n } from "../i18n/I18nContext";
import { IconButton } from "../shared/IconButton";
import "./App.css";

const environmentClass: Record<SavedConnection["environment"], string> = {
  development: "environment-development",
  test: "environment-test",
  staging: "environment-staging",
  production: "environment-production",
};

export function App() {
  const { locale, setLocale, t } = useI18n();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [connections, setConnections] = useState<SavedConnection[]>([]);
  const [activeConnectionId, setActiveConnectionId] = useState<string>();
  const [filter, setFilter] = useState("");

  const activeConnection = connections.find(
    (connection) => connection.id === activeConnectionId,
  );
  const visibleConnections = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return connections;
    return connections.filter((connection) =>
      [connection.name, connection.host, connection.database].some((value) =>
        value.toLowerCase().includes(query),
      ),
    );
  }, [connections, filter]);

  function handleConnected(
    value: ConnectionFormValue,
    result: ConnectedDatabaseResult,
  ) {
    const connection: SavedConnection = {
      id: crypto.randomUUID(),
      name: value.name,
      host: value.host,
      port: value.port,
      database: value.database,
      username: value.username,
      environment: value.environment,
      sslMode: value.sslMode,
      rootCertificatePath: value.rootCertificatePath || undefined,
      sessionId: result.sessionId,
      serverVersion: result.serverVersion,
    };

    setConnections((current) => [...current, connection]);
    setActiveConnectionId(connection.id);
    setDialogOpen(false);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Feather size={18} strokeWidth={1.8} />
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
            onClick={() => setDialogOpen(true)}
          >
            <Plus size={15} />
            {t("workspace.newConnection")}
          </button>
        </div>
      </header>

      <div className="app-content">
        <aside className="sidebar">
          <div className="sidebar-heading">
            <span>{t("sidebar.connections")}</span>
            <IconButton
              label={t("workspace.newConnection")}
              onClick={() => setDialogOpen(true)}
            >
              <Plus size={16} />
            </IconButton>
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
                environmentClassName={environmentClass[connection.environment]}
                selected={activeConnectionId === connection.id}
                onSelect={() => setActiveConnectionId(connection.id)}
              />
            ))}

            {connections.length === 0 && (
              <div className="sidebar-empty">
                <Database size={20} strokeWidth={1.5} />
                <strong>{t("sidebar.emptyTitle")}</strong>
                <p>{t("sidebar.emptyBody")}</p>
              </div>
            )}
          </div>
        </aside>

        <section className="workspace">
          <div className="tabbar" role="tablist">
            <button className="tab tab-active" type="button" role="tab">
              <FileText size={14} />
              {activeConnection?.name ?? "Welcome"}
            </button>
          </div>

          {activeConnection ? (
            <ConnectedWorkspace connection={activeConnection} />
          ) : (
            <WelcomeWorkspace onNewConnection={() => setDialogOpen(true)} />
          )}
        </section>
      </div>

      <footer className="statusbar">
        <span className={`status-dot ${activeConnection ? "status-dot-online" : ""}`} />
        <span>
          {activeConnection
            ? `${activeConnection.host}:${activeConnection.port} / ${activeConnection.database}`
            : t("status.disconnected")}
        </span>
        <span className="status-spacer" />
        <span>Plume 0.1.0</span>
      </footer>

      {dialogOpen && (
        <ConnectionDialog
          onClose={() => setDialogOpen(false)}
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

function ConnectedWorkspace({ connection }: { connection: SavedConnection }) {
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
