import type { WorkspaceTabsState } from "../tabs/workspaceTabs";

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
