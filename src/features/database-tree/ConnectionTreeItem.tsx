import { useState, type ComponentType, type ReactNode } from "react";
import {
  Activity,
  Blocks,
  Braces,
  ChevronRight,
  CircleOff,
  Database,
  Diamond,
  Eye,
  FolderKey,
  FolderTree,
  Globe2,
  HardDrive,
  Languages,
  Layers3,
  Library,
  ListOrdered,
  LoaderCircle,
  MoreHorizontal,
  Network,
  PackageOpen,
  Pencil,
  Plug,
  PlugZap,
  Copy,
  RadioTower,
  RefreshCw,
  RotateCw,
  Shapes,
  Star,
  Table2,
  Trash2,
  UserRound,
  UsersRound,
  Webhook,
} from "lucide-react";
import type { LucideProps } from "lucide-react";
import { useI18n } from "../../i18n/I18nContext";
import type { TranslationKey } from "../../i18n/catalog";
import { toCommandError } from "../../platform/tauri";
import type {
  ConnectionProfile,
  SavedConnection,
} from "../connections/connection";
import type { ConnectionLifecycleState } from "../connections/connectionSession";
import {
  databaseObjectKinds,
  groupDatabaseObjects,
  type CatalogCollectionKind,
  type CatalogCollectionSummary,
  type DatabaseCollectionKind,
  type DatabaseCollectionSummary,
  type DatabaseObject,
  type DatabaseObjectKind,
  type DatabaseSummary,
  type LoadState,
  type NamedObject,
  type RoleSummary,
  type ServerOverview,
} from "./databaseTree";
import { databaseTreeApi } from "./databaseTreeApi";
import "./ConnectionTreeItem.css";

interface ConnectionTreeItemProps {
  connection: ConnectionProfile | SavedConnection;
  sessionId?: string;
  lifecycleState?: ConnectionLifecycleState;
  environmentClassName: string;
  selected: boolean;
  onSelect: () => void;
  onConnect?: () => void;
  onReconnect?: () => void;
  onDisconnect?: () => void;
  onCheckHealth?: () => void;
  onSessionError?: (message: string) => void;
  onEdit?: () => void;
  onDuplicate?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  onToggleFavorite?: () => void;
}

type TreeIcon = ComponentType<LucideProps>;

const databaseCollectionPresentation: Record<
  DatabaseCollectionKind,
  { icon: TreeIcon; label: TranslationKey }
> = {
  casts: { icon: Shapes, label: "tree.casts" },
  catalogs: { icon: Library, label: "tree.catalogs" },
  "event-triggers": { icon: Webhook, label: "tree.eventTriggers" },
  extensions: { icon: PackageOpen, label: "tree.extensions" },
  "foreign-data-wrappers": {
    icon: Network,
    label: "tree.foreignDataWrappers",
  },
  languages: { icon: Languages, label: "tree.languages" },
  publications: { icon: RadioTower, label: "tree.publications" },
  schemas: { icon: FolderTree, label: "tree.schemas" },
  subscriptions: { icon: RefreshCw, label: "tree.subscriptions" },
};

const catalogPresentation: Record<string, TranslationKey> = {
  information_schema: "tree.catalogAnsi",
  pg_catalog: "tree.catalogPostgresql",
  pgagent: "tree.catalogPgAgent",
};

const catalogCollectionPresentation: Record<
  CatalogCollectionKind,
  { icon: TreeIcon; label: TranslationKey }
> = {
  "catalog-objects": { icon: Table2, label: "tree.catalogObjects" },
  aggregates: { icon: Blocks, label: "tree.aggregates" },
  collations: { icon: Languages, label: "tree.collations" },
  domains: { icon: PackageOpen, label: "tree.domains" },
  "fts-configurations": { icon: Shapes, label: "tree.ftsConfigurations" },
  "fts-dictionaries": { icon: Library, label: "tree.ftsDictionaries" },
  "fts-parsers": { icon: Braces, label: "tree.ftsParsers" },
  "fts-templates": { icon: FolderTree, label: "tree.ftsTemplates" },
  "foreign-tables": { icon: Globe2, label: "tree.foreignTables" },
  functions: { icon: Braces, label: "tree.functions" },
  "materialized-views": { icon: Layers3, label: "tree.materializedViews" },
  operators: { icon: Network, label: "tree.operators" },
  procedures: { icon: Blocks, label: "tree.procedures" },
  sequences: { icon: ListOrdered, label: "tree.sequences" },
  tables: { icon: Table2, label: "tree.tables" },
  "trigger-functions": { icon: Webhook, label: "tree.triggerFunctions" },
  types: { icon: Shapes, label: "tree.types" },
  views: { icon: Eye, label: "tree.views" },
};

const objectGroupPresentation: Record<
  DatabaseObjectKind,
  { icon: TreeIcon; label: TranslationKey }
> = {
  table: { icon: Table2, label: "tree.tables" },
  "foreign-table": { icon: Globe2, label: "tree.foreignTables" },
  view: { icon: Eye, label: "tree.views" },
  "materialized-view": {
    icon: Layers3,
    label: "tree.materializedViews",
  },
  sequence: { icon: ListOrdered, label: "tree.sequences" },
  function: { icon: Braces, label: "tree.functions" },
  procedure: { icon: Blocks, label: "tree.procedures" },
  type: { icon: Shapes, label: "tree.types" },
};

export function ConnectionTreeItem({
  connection,
  sessionId,
  lifecycleState,
  environmentClassName,
  selected,
  onSelect,
  onConnect,
  onReconnect,
  onDisconnect,
  onCheckHealth,
  onSessionError,
  onEdit,
  onDuplicate,
  onRename,
  onDelete,
  onToggleFavorite,
}: ConnectionTreeItemProps) {
  const { t } = useI18n();
  const candidateSessionId =
    sessionId ?? ("sessionId" in connection ? connection.sessionId : undefined);
  const state = lifecycleState ?? (candidateSessionId ? "connected" : "disconnected");
  const activeSessionId =
    state === "connected" || state === "busy" ? candidateSessionId : undefined;
  const transitioning =
    state === "connecting" ||
    state === "reconnecting" ||
    state === "disconnecting" ||
    state === "busy";
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const overviewLoader = useTreeLoader<ServerOverview>(() => {
    if (!activeSessionId) {
      throw new Error("The database connection is no longer available.");
    }
    return databaseTreeApi.getServerTree(activeSessionId);
  }, onSessionError);

  function toggleConnection() {
    onSelect();
    if (transitioning) return;
    if (state === "error") {
      onReconnect?.();
      return;
    }
    if (!activeSessionId) {
      onConnect?.();
      return;
    }
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded && overviewLoader.state.status === "idle") {
      void overviewLoader.load();
    }
  }

  function runMenuAction(action: () => void) {
    setMenuOpen(false);
    action();
  }

  const hasMenuActions = Boolean(
    onConnect ||
      onReconnect ||
      onDisconnect ||
      onCheckHealth ||
      onEdit ||
      onDuplicate ||
      onRename ||
      onDelete,
  );
  const hasActions = Boolean(
    activeSessionId || onToggleFavorite || hasMenuActions,
  );

  return (
    <div className="tree-connection" role="treeitem" aria-expanded={expanded}>
      <div className={`connection-item-line ${selected ? "connection-row-active" : ""}`}>
        <button className="connection-row" type="button" onClick={toggleConnection}>
          {transitioning ? (
            <LoaderCircle className="spin" size={13} />
          ) : (
            <TreeChevron expanded={expanded} />
          )}
          <Database size={15} />
          <span className="connection-row-copy">
            <strong>{connection.name}</strong>
            <small>
              {connection.host}:{connection.port}
              {` · ${t(`connection.state.${state}`)}`}
            </small>
          </span>
          <span
            className={`environment-dot ${environmentClassName}`}
            style={{ backgroundColor: connection.color }}
            title={t(`environment.${connection.environment}`)}
          />
        </button>
        {hasActions && (
          <div className="connection-menu-wrap">
            {activeSessionId && (
              <button
                className="connection-row-action tree-refresh-button"
                type="button"
                aria-label={`${t("tree.refreshConnection")} ${connection.name}`}
                title={t("tree.refreshConnection")}
                disabled={transitioning || overviewLoader.loading}
                onClick={() => void overviewLoader.load(true)}
              >
                <RefreshCw
                  className={overviewLoader.loading ? "spin" : ""}
                  size={13}
                />
              </button>
            )}
            {onToggleFavorite && (
              <button
                className="connection-row-action"
                type="button"
                aria-label={t(
                  connection.favorite
                    ? "connection.unfavorite"
                    : "connection.favorite",
                )}
                onClick={onToggleFavorite}
              >
                <Star size={13} fill={connection.favorite ? "currentColor" : "none"} />
              </button>
            )}
            {hasMenuActions && (
              <button
                className="connection-row-action"
                type="button"
                aria-label={t("connection.actions")}
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
              >
                <MoreHorizontal size={15} />
              </button>
            )}
            {hasMenuActions && menuOpen && (
              <div className="connection-menu" role="menu">
                {state === "disconnected" && onConnect && (
                  <MenuAction icon={PlugZap} label={t("connection.connect")} onClick={() => runMenuAction(onConnect)} />
                )}
                {state === "error" && onReconnect && (
                  <MenuAction icon={RotateCw} label={t("connection.reconnect")} onClick={() => runMenuAction(onReconnect)} />
                )}
                {state === "connected" && onCheckHealth && (
                  <MenuAction icon={Activity} label={t("connection.checkHealth")} onClick={() => runMenuAction(onCheckHealth)} />
                )}
                {(state === "connected" || state === "error") && onDisconnect && candidateSessionId && (
                  <MenuAction icon={Plug} label={t("connection.disconnect")} onClick={() => runMenuAction(onDisconnect)} />
                )}
                {onEdit && <MenuAction icon={Pencil} label={t("connection.edit")} onClick={() => runMenuAction(onEdit)} />}
                {onDuplicate && <MenuAction icon={Copy} label={t("connection.duplicate")} onClick={() => runMenuAction(onDuplicate)} />}
                {onRename && <MenuAction icon={Pencil} label={t("connection.rename")} onClick={() => runMenuAction(onRename)} />}
                {onDelete && <MenuAction icon={Trash2} label={t("connection.delete")} onClick={() => runMenuAction(onDelete)} danger />}
              </div>
            )}
          </div>
        )}
      </div>

      {expanded && activeSessionId && (
        <div className="tree-level" role="group">
          <AsyncTreeContent
            state={overviewLoader.state}
            onRetry={() => void overviewLoader.load(true)}
          >
            {(server) => (
              <>
                <StaticCollectionNode
                  icon={Database}
                  label={t("tree.databases")}
                  count={server.databases.length}
                >
                  {server.databases.map((database) => (
                    <DatabaseTreeItem
                      key={`${database.name}:${overviewLoader.revision}`}
                      database={database}
                      sessionId={activeSessionId}
                      onSessionError={onSessionError}
                    />
                  ))}
                </StaticCollectionNode>

                <StaticCollectionNode
                  icon={UsersRound}
                  label={t("tree.roles")}
                  count={server.roles.length}
                >
                  {server.roles.map((role) => (
                    <RoleLeaf key={role.name} role={role} />
                  ))}
                </StaticCollectionNode>

                <StaticCollectionNode
                  icon={HardDrive}
                  label={t("tree.tablespaces")}
                  count={server.tablespaces.length}
                >
                  {server.tablespaces.map((tablespace) => (
                    <LeafRow
                      key={tablespace.name}
                      icon={HardDrive}
                      label={tablespace.name}
                    />
                  ))}
                </StaticCollectionNode>
              </>
            )}
          </AsyncTreeContent>
        </div>
      )}
    </div>
  );
}

function MenuAction({
  icon: Icon,
  label,
  onClick,
  danger = false,
}: {
  icon: TreeIcon;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      className={danger ? "connection-menu-danger" : ""}
      type="button"
      role="menuitem"
      onClick={onClick}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}

function DatabaseTreeItem({
  database,
  sessionId,
  onSessionError,
}: {
  database: DatabaseSummary;
  sessionId: string;
  onSessionError?: (message: string) => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const collectionsLoader = useTreeLoader<DatabaseCollectionSummary[]>(
    () => databaseTreeApi.getDatabaseTree(sessionId, database.name),
    onSessionError,
  );

  function toggleDatabase() {
    if (!database.allowConnections) return;
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded && collectionsLoader.state.status === "idle") {
      void collectionsLoader.load();
    }
  }

  return (
    <div className="tree-node" role="treeitem" aria-expanded={expanded}>
      <ToggleRow
        icon={database.allowConnections ? Database : CircleOff}
        label={database.name}
        expanded={expanded}
        onToggle={toggleDatabase}
        onRefresh={
          database.allowConnections
            ? () => void collectionsLoader.load(true)
            : undefined
        }
        refreshing={collectionsLoader.loading}
        muted={!database.allowConnections}
        title={
          database.allowConnections
            ? `${database.name} · ${database.owner}`
            : t("tree.connectionDisabled")
        }
      />
      {expanded && (
        <div className="tree-level" role="group">
          <AsyncTreeContent
            state={collectionsLoader.state}
            onRetry={() => void collectionsLoader.load(true)}
          >
            {(loadedCollections) => (
              <>
                {loadedCollections.map((collection) => (
                  <DatabaseCollectionNode
                    key={`${collection.kind}:${collectionsLoader.revision}`}
                    collection={collection}
                    database={database.name}
                    sessionId={sessionId}
                    onSessionError={onSessionError}
                  />
                ))}
              </>
            )}
          </AsyncTreeContent>
        </div>
      )}
    </div>
  );
}

function DatabaseCollectionNode({
  collection,
  database,
  sessionId,
  onSessionError,
}: {
  collection: DatabaseCollectionSummary;
  database: string;
  sessionId: string;
  onSessionError?: (message: string) => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const presentation = databaseCollectionPresentation[collection.kind];
  const itemsLoader = useTreeLoader<NamedObject[]>(
    () =>
      collection.count === 0
        ? Promise.resolve([])
        : databaseTreeApi.getDatabaseCollectionItems(
            sessionId,
            database,
            collection.kind,
          ),
    onSessionError,
  );

  function toggleCollection() {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded && itemsLoader.state.status === "idle") {
      void itemsLoader.load();
    }
  }

  return (
    <div className="tree-node" role="treeitem" aria-expanded={expanded}>
      <ToggleRow
        icon={presentation.icon}
        label={t(presentation.label)}
        count={collection.count}
        expanded={expanded}
        onToggle={toggleCollection}
        onRefresh={() => void itemsLoader.load(true)}
        refreshing={itemsLoader.loading}
      />
      {expanded && (
        <div className="tree-level" role="group">
          <AsyncTreeContent
            state={itemsLoader.state}
            onRetry={() => void itemsLoader.load(true)}
          >
            {(loadedItems) =>
              loadedItems.length === 0 ? (
                <TreeEmpty />
              ) : collection.kind === "catalogs" ? (
                <>
                  {loadedItems.map((catalog) => (
                    <CatalogTreeItem
                      key={`${catalog.name}:${itemsLoader.revision}`}
                      catalog={catalog}
                      database={database}
                      sessionId={sessionId}
                      onSessionError={onSessionError}
                    />
                  ))}
                </>
              ) : collection.kind === "schemas" ? (
                <>
                  {loadedItems.map((schema) => (
                    <SchemaTreeItem
                      key={`${schema.name}:${itemsLoader.revision}`}
                      database={database}
                      schema={schema}
                      sessionId={sessionId}
                      onSessionError={onSessionError}
                    />
                  ))}
                </>
              ) : (
                <>
                  {loadedItems.map((item) => (
                    <LeafRow key={item.name} label={item.name} />
                  ))}
                </>
              )
            }
          </AsyncTreeContent>
        </div>
      )}
    </div>
  );
}

function CatalogTreeItem({
  catalog,
  database,
  sessionId,
  onSessionError,
}: {
  catalog: NamedObject;
  database: string;
  sessionId: string;
  onSessionError?: (message: string) => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const labelKey = catalogPresentation[catalog.name];
  const collectionsLoader = useTreeLoader<CatalogCollectionSummary[]>(
    () => databaseTreeApi.getCatalogTree(sessionId, database, catalog.name),
    onSessionError,
  );

  function toggleCatalog() {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded && collectionsLoader.state.status === "idle") {
      void collectionsLoader.load();
    }
  }

  return (
    <div className="tree-node" role="treeitem" aria-expanded={expanded}>
      <ToggleRow
        icon={Diamond}
        label={labelKey ? t(labelKey) : catalog.name}
        expanded={expanded}
        onToggle={toggleCatalog}
        onRefresh={() => void collectionsLoader.load(true)}
        refreshing={collectionsLoader.loading}
      />
      {expanded && (
        <div className="tree-level" role="group">
          <AsyncTreeContent
            state={collectionsLoader.state}
            onRetry={() => void collectionsLoader.load(true)}
          >
            {(loadedCollections) =>
              loadedCollections.map((collection) => (
                <CatalogCollectionNode
                  key={`${collection.kind}:${collectionsLoader.revision}`}
                  catalog={catalog.name}
                  collection={collection}
                  database={database}
                  sessionId={sessionId}
                  onSessionError={onSessionError}
                />
              ))
            }
          </AsyncTreeContent>
        </div>
      )}
    </div>
  );
}

function CatalogCollectionNode({
  catalog,
  collection,
  database,
  sessionId,
  onSessionError,
}: {
  catalog: string;
  collection: CatalogCollectionSummary;
  database: string;
  sessionId: string;
  onSessionError?: (message: string) => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const presentation = catalogCollectionPresentation[collection.kind];
  const itemsLoader = useTreeLoader<NamedObject[]>(
    () =>
      collection.count === 0
        ? Promise.resolve([])
        : databaseTreeApi.getCatalogCollectionItems(
            sessionId,
            database,
            catalog,
            collection.kind,
          ),
    onSessionError,
  );

  function toggleCollection() {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded && itemsLoader.state.status === "idle") {
      void itemsLoader.load();
    }
  }

  return (
    <div className="tree-node" role="treeitem" aria-expanded={expanded}>
      <ToggleRow
        icon={presentation.icon}
        label={t(presentation.label)}
        count={collection.count}
        showZeroCount
        expanded={expanded}
        onToggle={toggleCollection}
        onRefresh={() => void itemsLoader.load(true)}
        refreshing={itemsLoader.loading}
      />
      {expanded && (
        <div className="tree-level" role="group">
          <AsyncTreeContent
            state={itemsLoader.state}
            onRetry={() => void itemsLoader.load(true)}
          >
            {(loadedItems) =>
              loadedItems.length === 0 ? (
                <TreeEmpty />
              ) : (
                <>
                  {loadedItems.map((item) => (
                    <LeafRow key={item.name} label={item.name} />
                  ))}
                </>
              )
            }
          </AsyncTreeContent>
        </div>
      )}
    </div>
  );
}

function SchemaTreeItem({
  database,
  schema,
  sessionId,
  onSessionError,
}: {
  database: string;
  schema: NamedObject;
  sessionId: string;
  onSessionError?: (message: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const objectsLoader = useTreeLoader<DatabaseObject[]>(
    () => databaseTreeApi.getSchemaObjects(sessionId, database, schema.name),
    onSessionError,
  );

  function toggleSchema() {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded && objectsLoader.state.status === "idle") {
      void objectsLoader.load();
    }
  }

  return (
    <div className="tree-node" role="treeitem" aria-expanded={expanded}>
      <ToggleRow
        icon={FolderKey}
        label={schema.name}
        expanded={expanded}
        onToggle={toggleSchema}
        onRefresh={() => void objectsLoader.load(true)}
        refreshing={objectsLoader.loading}
      />
      {expanded && (
        <div className="tree-level" role="group">
          <AsyncTreeContent
            state={objectsLoader.state}
            onRetry={() => void objectsLoader.load(true)}
          >
            {(loadedObjects) =>
              loadedObjects.length === 0 ? (
                <TreeEmpty />
              ) : (
                <ObjectGroups objects={loadedObjects} />
              )
            }
          </AsyncTreeContent>
        </div>
      )}
    </div>
  );
}

function ObjectGroups({ objects }: { objects: DatabaseObject[] }) {
  const { t } = useI18n();
  const groups = groupDatabaseObjects(objects);

  return databaseObjectKinds.map((kind) => {
    const group = groups[kind];
    if (group.length === 0) return null;
    const presentation = objectGroupPresentation[kind];

    return (
      <StaticCollectionNode
        key={kind}
        icon={presentation.icon}
        label={t(presentation.label)}
        count={group.length}
      >
        {group.map((object) => (
          <LeafRow key={`${kind}:${object.name}`} label={object.name} />
        ))}
      </StaticCollectionNode>
    );
  });
}

function StaticCollectionNode({
  icon,
  label,
  count,
  children,
}: {
  icon: TreeIcon;
  label: string;
  count: number;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="tree-node" role="treeitem" aria-expanded={expanded}>
      <ToggleRow
        icon={icon}
        label={label}
        count={count}
        expanded={expanded}
        onToggle={() => setExpanded((value) => !value)}
      />
      {expanded && (
        <div className="tree-level" role="group">
          {count === 0 ? <TreeEmpty /> : children}
        </div>
      )}
    </div>
  );
}

function RoleLeaf({ role }: { role: RoleSummary }) {
  const title = [role.canLogin ? "LOGIN" : "NOLOGIN", role.superuser ? "SUPERUSER" : null]
    .filter(Boolean)
    .join(" · ");
  return <LeafRow icon={UserRound} label={role.name} title={title} />;
}

function ToggleRow({
  icon: Icon,
  label,
  count,
  expanded,
  onToggle,
  onRefresh,
  refreshing = false,
  muted = false,
  showZeroCount = false,
  title,
}: {
  icon: TreeIcon;
  label: string;
  count?: number;
  expanded: boolean;
  onToggle: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  muted?: boolean;
  showZeroCount?: boolean;
  title?: string;
}) {
  const visibleCount =
    count !== undefined && (showZeroCount || count > 0) ? count : undefined;

  const { t } = useI18n();

  return (
    <div className="tree-row-wrap">
      <button
        className={`tree-row tree-toggle-row ${muted ? "tree-row-muted" : ""}`}
        type="button"
        disabled={muted}
        onClick={onToggle}
        title={title}
        aria-label={
          visibleCount === undefined ? label : `${label} (${visibleCount})`
        }
      >
        <TreeChevron expanded={expanded} />
        <Icon size={14} />
        <span className="tree-row-label">{label}</span>
        {visibleCount !== undefined && <small>({visibleCount})</small>}
      </button>
      {onRefresh && (
        <button
          className="tree-node-refresh"
          type="button"
          aria-label={`${t("tree.refresh")} ${label}`}
          title={t("tree.refresh")}
          disabled={refreshing}
          onClick={onRefresh}
        >
          <RefreshCw className={refreshing ? "spin" : ""} size={12} />
        </button>
      )}
    </div>
  );
}

function LeafRow({
  icon: Icon,
  label,
  title,
}: {
  icon?: TreeIcon;
  label: string;
  title?: string;
}) {
  return (
    <div className="tree-row tree-leaf-row" title={title ?? label}>
      {Icon ? <Icon size={13} /> : <span className="tree-leaf-bullet" />}
      <span className="tree-row-label">{label}</span>
    </div>
  );
}

function TreeChevron({ expanded }: { expanded: boolean }) {
  return (
    <ChevronRight
      className={`tree-chevron ${expanded ? "tree-chevron-expanded" : ""}`}
      size={13}
    />
  );
}

function TreeEmpty() {
  const { t } = useI18n();
  return <div className="tree-message">{t("tree.emptyCollection")}</div>;
}

function AsyncTreeContent<Value>({
  state,
  onRetry,
  children,
}: {
  state: LoadState<Value>;
  onRetry: () => void;
  children: (value: Value) => ReactNode;
}) {
  const { t } = useI18n();

  if (state.status === "idle" || state.status === "loading") {
    return (
      <div className="tree-message">
        <LoaderCircle className="spin" size={13} />
        <span>{t("tree.loading")}</span>
      </div>
    );
  }

  if (state.status === "refreshing") {
    return children(state.value);
  }

  if (state.status === "error") {
    return (
      <>
        {state.value !== undefined && children(state.value)}
        <div className="tree-error" role="alert">
          <span>{state.message}</span>
          <button type="button" onClick={onRetry}>
            <RefreshCw size={12} />
            {t("tree.retry")}
          </button>
        </div>
      </>
    );
  }

  return children(state.value);
}

const sessionUnavailableCodes = new Set([
  "connection_failed",
  "session_not_found",
  "ssh_connection_failed",
  "ssh_tunnel_disconnected",
]);

function useTreeLoader<Value>(
  loadValue: () => Promise<Value>,
  onSessionError?: (message: string) => void,
) {
  const [state, setState] = useState<LoadState<Value>>({ status: "idle" });
  const [revision, setRevision] = useState(0);
  const loading = state.status === "loading" || state.status === "refreshing";

  async function load(refresh = false) {
    if (loading) return;

    const cachedValue = getLoadStateValue(state);
    setState(
      refresh && cachedValue !== undefined
        ? { status: "refreshing", value: cachedValue }
        : { status: "loading" },
    );

    try {
      setState({ status: "success", value: await loadValue() });
      if (refresh) setRevision((current) => current + 1);
    } catch (error) {
      const commandError = toCommandError(error);
      setState({
        status: "error",
        message: commandError.message,
        value: cachedValue,
      });
      if (sessionUnavailableCodes.has(commandError.code)) {
        onSessionError?.(commandError.message);
      }
    }
  }

  return { state, load, loading, revision };
}

function getLoadStateValue<Value>(state: LoadState<Value>) {
  return "value" in state ? state.value : undefined;
}
