import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CsvExportProgress, CsvExportRequest } from "./csvExport";
import { csvExportApi } from "./csvExportApi";

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

const request: CsvExportRequest = {
  taskId: "4f9e4878-4e75-4a0e-9f60-08e02f5bd706",
  suggestedFileName: "query-result.csv",
  columns: ["id"],
  rows: [["1"]],
  includeHeaders: true,
  delimiter: "comma",
  encoding: "utf-8-bom",
};

describe("csvExportApi", () => {
  beforeEach(() => {
    mocks.invokeCommand.mockReset();
    mocks.listen.mockReset();
    mocks.unlisten.mockReset();
  });

  it("filters progress by task and removes its event listener", async () => {
    let listener:
      | ((event: { payload: CsvExportProgress }) => void)
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

    await expect(csvExportApi.execute(request, onProgress)).resolves.toEqual({
      taskId: request.taskId,
      status: "completed",
      rowsWritten: 1,
    });
    expect(onProgress).toHaveBeenCalledOnce();
    expect(onProgress).toHaveBeenCalledWith({
      taskId: request.taskId,
      completedRows: 1,
      totalRows: 1,
    });
    expect(mocks.unlisten).toHaveBeenCalledOnce();
  });

  it("removes its event listener when the command fails", async () => {
    mocks.listen.mockResolvedValue(mocks.unlisten);
    mocks.invokeCommand.mockRejectedValue(new Error("write failed"));

    await expect(csvExportApi.execute(request, vi.fn())).rejects.toThrow(
      "write failed",
    );
    expect(mocks.unlisten).toHaveBeenCalledOnce();
  });
});
