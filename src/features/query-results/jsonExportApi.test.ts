import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JsonExportProgress, JsonExportRequest } from "./jsonExport";
import { jsonExportApi } from "./jsonExportApi";

const mocks = vi.hoisted(() => ({
  invokeCommand: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
}));

vi.mock("../../platform/tauri", () => ({
  invokeCommand: mocks.invokeCommand,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}));

const request: JsonExportRequest = {
  taskId: "4f9e4878-4e75-4a0e-9f60-08e02f5bd706",
  suggestedFileName: "query-result.json",
  columns: ["id"],
  rows: [["1"]],
};

describe("jsonExportApi", () => {
  beforeEach(() => {
    mocks.invokeCommand.mockReset();
    mocks.listen.mockReset();
    mocks.unlisten.mockReset();
  });

  it("filters progress by task and removes its event listener", async () => {
    let listener:
      | ((event: { payload: JsonExportProgress }) => void)
      | undefined;
    mocks.listen.mockImplementation(
      async (_eventName: string, callback: typeof listener) => {
        listener = callback;
        return mocks.unlisten;
      },
    );
    mocks.invokeCommand.mockImplementation(async () => {
      listener?.({
        payload: { taskId: "another-task", completedRows: 1, totalRows: 1 },
      });
      listener?.({
        payload: { taskId: request.taskId, completedRows: 1, totalRows: 1 },
      });
      return { taskId: request.taskId, status: "completed", rowsWritten: 1 };
    });
    const onProgress = vi.fn();

    await expect(jsonExportApi.execute(request, onProgress)).resolves.toEqual({
      taskId: request.taskId,
      status: "completed",
      rowsWritten: 1,
    });
    expect(onProgress).toHaveBeenCalledOnce();
    expect(mocks.unlisten).toHaveBeenCalledOnce();
    expect(mocks.invokeCommand).toHaveBeenCalledWith("export_json", { request });
  });

  it("uses the shared cancellation command", async () => {
    mocks.invokeCommand.mockResolvedValue({
      taskId: request.taskId,
      status: "requested",
    });

    await jsonExportApi.cancel(request.taskId);

    expect(mocks.invokeCommand).toHaveBeenCalledWith("cancel_export", {
      request: { taskId: request.taskId },
    });
  });
});
