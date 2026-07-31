import type { QueryDraft } from "../drafts/queryDraft";
import { createEmptyTableDataChangeSet } from "../table-data/tableDataChanges";
import type {
  WorkspaceTab,
  WorkspaceTabsState,
} from "../tabs/workspaceTabs";

export interface WorkspaceLayoutSnapshot {
  sidebarWidth: number;
  sidebarCollapsed: boolean;
}

export type WorkspaceSnapshotTab =
  | { id: string; kind: "welcome" }
  | {
      id: string;
      kind: "connection";
      profileId: string;
      database: string;
      schema?: string;
      title?: string;
    }
  | {
      id: string;
      kind: "query";
      profileId: string;
      database: string;
      schema?: string;
      title: string;
      sql: string;
    }
  | {
      id: string;
      kind: "table-data";
      profileId: string;
      database: string;
      schema: string;
      title: string;
      table: string;
    };

export interface SaveWorkspaceSnapshotRequest {
  activeTabId: string;
  nextTabId: number;
  nextQueryNumber: number;
  layout: WorkspaceLayoutSnapshot;
  tabs: WorkspaceSnapshotTab[];
}

export interface WorkspaceSnapshot extends SaveWorkspaceSnapshotRequest {
  updatedAt: number;
}

export function createWorkspaceSnapshotRequest(
  state: WorkspaceTabsState,
  layout: WorkspaceLayoutSnapshot,
): SaveWorkspaceSnapshotRequest {
  return {
    activeTabId: state.activeTabId,
    nextTabId: state.nextTabId,
    nextQueryNumber: state.nextQueryNumber,
    layout,
    tabs: state.tabs.map((tab): WorkspaceSnapshotTab => {
      switch (tab.kind) {
        case "welcome":
          return { id: tab.id, kind: tab.kind };
        case "connection":
          return {
            id: tab.id,
            kind: tab.kind,
            profileId: tab.profileId,
            database: tab.database,
            schema: tab.schema,
            title: tab.title,
          };
        case "query":
          return {
            id: tab.id,
            kind: tab.kind,
            profileId: tab.profileId,
            database: tab.database,
            schema: tab.schema,
            title: tab.title,
            sql: tab.sql,
          };
        case "table-data":
          return {
            id: tab.id,
            kind: tab.kind,
            profileId: tab.profileId,
            database: tab.database,
            schema: tab.schema,
            title: tab.title,
            table: tab.table,
          };
      }
    }),
  };
}

export function createRestoredWorkspaceState(
  snapshot: WorkspaceSnapshot | null,
  drafts: QueryDraft[],
  knownProfileIds: ReadonlySet<string>,
): WorkspaceTabsState {
  const tabs: WorkspaceTab[] = [{ id: "welcome", kind: "welcome" }];
  const restoredIds = new Set(["welcome"]);
  const draftsById = new Map(drafts.map((draft) => [draft.id, draft]));

  for (const saved of snapshot?.tabs ?? []) {
    if (
      saved.kind === "welcome" ||
      restoredIds.has(saved.id) ||
      !knownProfileIds.has(saved.profileId)
    ) {
      continue;
    }
    switch (saved.kind) {
      case "connection":
        tabs.push({ ...saved });
        break;
      case "query": {
        const draft = draftsById.get(saved.id);
        tabs.push({
          ...saved,
          draftState:
            draft?.title === saved.title && draft.sql === saved.sql
              ? "saved"
              : "unsaved",
          updatedAt: draft?.updatedAt,
        });
        break;
      }
      case "table-data":
        tabs.push({
          ...saved,
          pageIndex: 0,
          pageSize: 200,
          hasNextPage: false,
          sorts: [],
          filters: [],
          editability: { status: "idle" },
          changes: createEmptyTableDataChangeSet(),
          columns: [],
        });
        break;
    }
    restoredIds.add(saved.id);
  }

  for (const draft of drafts) {
    if (!knownProfileIds.has(draft.profileId) || restoredIds.has(draft.id)) {
      continue;
    }
    tabs.push({
      id: draft.id,
      kind: "query",
      profileId: draft.profileId,
      database: draft.database,
      schema: draft.schema,
      title: draft.title,
      sql: draft.sql,
      draftState: "saved",
      updatedAt: draft.updatedAt,
    });
    restoredIds.add(draft.id);
  }

  return {
    tabs,
    activeTabId:
      snapshot && restoredIds.has(snapshot.activeTabId)
        ? snapshot.activeTabId
        : "welcome",
    nextTabId: snapshot?.nextTabId ?? 1,
    nextQueryNumber: snapshot?.nextQueryNumber ?? 1,
  };
}
