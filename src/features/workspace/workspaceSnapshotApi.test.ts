import { beforeEach, describe, expect, it, vi } from "vitest";
import { workspaceSnapshotApi } from "./workspaceSnapshotApi";

const mocks = vi.hoisted(() => ({ invokeCommand: vi.fn() }));

vi.mock("../../platform/tauri", () => ({ invokeCommand: mocks.invokeCommand }));

describe("workspaceSnapshotApi", () => {
  beforeEach(() => mocks.invokeCommand.mockReset());

  it("saves and loads the current workspace through dedicated commands", async () => {
    const request = {
      activeTabId: "welcome",
      nextTabId: 1,
      nextQueryNumber: 1,
      layout: { sidebarWidth: 286, sidebarCollapsed: false },
      tabs: [{ id: "welcome", kind: "welcome" as const }],
    };
    mocks.invokeCommand
      .mockResolvedValueOnce({ ...request, updatedAt: 1 })
      .mockResolvedValueOnce(null);

    await workspaceSnapshotApi.save(request);
    await workspaceSnapshotApi.load();

    expect(mocks.invokeCommand).toHaveBeenNthCalledWith(
      1,
      "save_workspace_snapshot",
      { request },
    );
    expect(mocks.invokeCommand).toHaveBeenNthCalledWith(
      2,
      "load_workspace_snapshot",
    );
  });
});
