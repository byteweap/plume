import { invokeCommand } from "../../platform/tauri";
import type {
  SaveWorkspaceSnapshotRequest,
  WorkspaceSnapshot,
} from "./workspaceSnapshot";

export const workspaceSnapshotApi = {
  save(request: SaveWorkspaceSnapshotRequest): Promise<WorkspaceSnapshot> {
    return invokeCommand<WorkspaceSnapshot>("save_workspace_snapshot", {
      request,
    });
  },
  load(): Promise<WorkspaceSnapshot | null> {
    return invokeCommand<WorkspaceSnapshot | null>("load_workspace_snapshot");
  },
};
