import { useState, type ComponentType, type ReactNode } from "react";
import {
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
  Network,
  PackageOpen,
  RadioTower,
  RefreshCw,
  Shapes,
  Table2,
  UserRound,
  UsersRound,
  Webhook,
} from "lucide-react";
import type { LucideProps } from "lucide-react";
import { useI18n } from "../../i18n/I18nContext";
import type { TranslationKey } from "../../i18n/catalog";
import { toCommandError } from "../../platform/tauri";
import type { SavedConnection } from "../connections/connection";
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
  connection: SavedConnection;
  environmentClassName: string;
  selected: boolean;
  onSelect: () => void;
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
  environmentClassName,
  selected,
  onSelect,
}: ConnectionTreeItemProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [overview, setOverview] = useState<LoadState<ServerOverview>>({
    status: "idle",
  });

  async function loadOverview() {
    setOverview({ status: "loading" });
    try {
      setOverview({
        status: "success",
        value: await databaseTreeApi.getServerTree(connection.sessionId),
      });
    } catch (error) {
      setOverview({ status: "error", message: toCommandError(error).message });
    }
  }

  function toggleConnection() {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    onSelect();
    if (nextExpanded && overview.status === "idle") void loadOverview();
  }

  return (
    <div className="tree-connection" role="treeitem" aria-expanded={expanded}>
      <button
        className={`connection-row ${selected ? "connection-row-active" : ""}`}
        type="button"
        onClick={toggleConnection}
      >
        <TreeChevron expanded={expanded} />
        <Database size={15} />
        <span className="connection-row-copy">
          <strong>{connection.name}</strong>
          <small>{connection.host}:{connection.port}</small>
        </span>
        <span
          className={`environment-dot ${environmentClassName}`}
          title={t(`environment.${connection.environment}`)}
        />
      </button>

      {expanded && (
        <div className="tree-level" role="group">
          <AsyncTreeContent state={overview} onRetry={() => void loadOverview()}>
            {(server) => (
              <>
                <StaticCollectionNode
                  icon={Database}
                  label={t("tree.databases")}
                  count={server.databases.length}
                >
                  {server.databases.map((database) => (
                    <DatabaseTreeItem
                      key={database.name}
                      database={database}
                      sessionId={connection.sessionId}
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

function DatabaseTreeItem({
  database,
  sessionId,
}: {
  database: DatabaseSummary;
  sessionId: string;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [collections, setCollections] = useState<
    LoadState<DatabaseCollectionSummary[]>
  >({ status: "idle" });

  async function loadCollections() {
    setCollections({ status: "loading" });
    try {
      setCollections({
        status: "success",
        value: await databaseTreeApi.getDatabaseTree(sessionId, database.name),
      });
    } catch (error) {
      setCollections({ status: "error", message: toCommandError(error).message });
    }
  }

  function toggleDatabase() {
    if (!database.allowConnections) return;
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded && collections.status === "idle") void loadCollections();
  }

  return (
    <div className="tree-node" role="treeitem" aria-expanded={expanded}>
      <ToggleRow
        icon={database.allowConnections ? Database : CircleOff}
        label={database.name}
        expanded={expanded}
        onToggle={toggleDatabase}
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
            state={collections}
            onRetry={() => void loadCollections()}
          >
            {(loadedCollections) => (
              <>
                {loadedCollections.map((collection) => (
                  <DatabaseCollectionNode
                    key={collection.kind}
                    collection={collection}
                    database={database.name}
                    sessionId={sessionId}
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
}: {
  collection: DatabaseCollectionSummary;
  database: string;
  sessionId: string;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [items, setItems] = useState<LoadState<NamedObject[]>>({
    status: "idle",
  });
  const presentation = databaseCollectionPresentation[collection.kind];

  async function loadItems() {
    if (collection.count === 0) {
      setItems({ status: "success", value: [] });
      return;
    }

    setItems({ status: "loading" });
    try {
      setItems({
        status: "success",
        value: await databaseTreeApi.getDatabaseCollectionItems(
          sessionId,
          database,
          collection.kind,
        ),
      });
    } catch (error) {
      setItems({ status: "error", message: toCommandError(error).message });
    }
  }

  function toggleCollection() {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded && items.status === "idle") void loadItems();
  }

  return (
    <div className="tree-node" role="treeitem" aria-expanded={expanded}>
      <ToggleRow
        icon={presentation.icon}
        label={t(presentation.label)}
        count={collection.count}
        expanded={expanded}
        onToggle={toggleCollection}
      />
      {expanded && (
        <div className="tree-level" role="group">
          <AsyncTreeContent state={items} onRetry={() => void loadItems()}>
            {(loadedItems) =>
              loadedItems.length === 0 ? (
                <TreeEmpty />
              ) : collection.kind === "catalogs" ? (
                <>
                  {loadedItems.map((catalog) => (
                    <CatalogTreeItem
                      key={catalog.name}
                      catalog={catalog}
                      database={database}
                      sessionId={sessionId}
                    />
                  ))}
                </>
              ) : collection.kind === "schemas" ? (
                <>
                  {loadedItems.map((schema) => (
                    <SchemaTreeItem
                      key={schema.name}
                      database={database}
                      schema={schema}
                      sessionId={sessionId}
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
}: {
  catalog: NamedObject;
  database: string;
  sessionId: string;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [collections, setCollections] = useState<
    LoadState<CatalogCollectionSummary[]>
  >({ status: "idle" });
  const labelKey = catalogPresentation[catalog.name];

  async function loadCollections() {
    setCollections({ status: "loading" });
    try {
      setCollections({
        status: "success",
        value: await databaseTreeApi.getCatalogTree(
          sessionId,
          database,
          catalog.name,
        ),
      });
    } catch (error) {
      setCollections({ status: "error", message: toCommandError(error).message });
    }
  }

  function toggleCatalog() {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded && collections.status === "idle") void loadCollections();
  }

  return (
    <div className="tree-node" role="treeitem" aria-expanded={expanded}>
      <ToggleRow
        icon={Diamond}
        label={labelKey ? t(labelKey) : catalog.name}
        expanded={expanded}
        onToggle={toggleCatalog}
      />
      {expanded && (
        <div className="tree-level" role="group">
          <AsyncTreeContent
            state={collections}
            onRetry={() => void loadCollections()}
          >
            {(loadedCollections) =>
              loadedCollections.map((collection) => (
                <CatalogCollectionNode
                  key={collection.kind}
                  catalog={catalog.name}
                  collection={collection}
                  database={database}
                  sessionId={sessionId}
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
}: {
  catalog: string;
  collection: CatalogCollectionSummary;
  database: string;
  sessionId: string;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [items, setItems] = useState<LoadState<NamedObject[]>>({ status: "idle" });
  const presentation = catalogCollectionPresentation[collection.kind];

  async function loadItems() {
    if (collection.count === 0) {
      setItems({ status: "success", value: [] });
      return;
    }

    setItems({ status: "loading" });
    try {
      setItems({
        status: "success",
        value: await databaseTreeApi.getCatalogCollectionItems(
          sessionId,
          database,
          catalog,
          collection.kind,
        ),
      });
    } catch (error) {
      setItems({ status: "error", message: toCommandError(error).message });
    }
  }

  function toggleCollection() {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded && items.status === "idle") void loadItems();
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
      />
      {expanded && (
        <div className="tree-level" role="group">
          <AsyncTreeContent state={items} onRetry={() => void loadItems()}>
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
}: {
  database: string;
  schema: NamedObject;
  sessionId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [objects, setObjects] = useState<LoadState<DatabaseObject[]>>({
    status: "idle",
  });

  async function loadObjects() {
    setObjects({ status: "loading" });
    try {
      setObjects({
        status: "success",
        value: await databaseTreeApi.getSchemaObjects(
          sessionId,
          database,
          schema.name,
        ),
      });
    } catch (error) {
      setObjects({ status: "error", message: toCommandError(error).message });
    }
  }

  function toggleSchema() {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded && objects.status === "idle") void loadObjects();
  }

  return (
    <div className="tree-node" role="treeitem" aria-expanded={expanded}>
      <ToggleRow
        icon={FolderKey}
        label={schema.name}
        expanded={expanded}
        onToggle={toggleSchema}
      />
      {expanded && (
        <div className="tree-level" role="group">
          <AsyncTreeContent state={objects} onRetry={() => void loadObjects()}>
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
  muted = false,
  showZeroCount = false,
  title,
}: {
  icon: TreeIcon;
  label: string;
  count?: number;
  expanded: boolean;
  onToggle: () => void;
  muted?: boolean;
  showZeroCount?: boolean;
  title?: string;
}) {
  const visibleCount =
    count !== undefined && (showZeroCount || count > 0) ? count : undefined;

  return (
    <button
      className={`tree-row tree-toggle-row ${muted ? "tree-row-muted" : ""}`}
      type="button"
      onClick={onToggle}
      title={title}
      aria-label={visibleCount === undefined ? label : `${label} (${visibleCount})`}
    >
      <TreeChevron expanded={expanded} />
      <Icon size={14} />
      <span className="tree-row-label">{label}</span>
      {visibleCount !== undefined && <small>({visibleCount})</small>}
    </button>
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

  if (state.status === "error") {
    return (
      <div className="tree-error" role="alert">
        <span>{state.message}</span>
        <button type="button" onClick={onRetry}>
          <RefreshCw size={12} />
          {t("tree.retry")}
        </button>
      </div>
    );
  }

  return children(state.value);
}
