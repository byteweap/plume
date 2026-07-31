import { beforeEach, describe, expect, it, vi } from "vitest";
import { tableDataApi } from "./tableDataApi";

const mocks = vi.hoisted(() => ({
  invokeCommand: vi.fn(),
}));

vi.mock("../../platform/tauri", () => ({
  invokeCommand: mocks.invokeCommand,
}));

describe("tableDataApi", () => {
  beforeEach(() => {
    mocks.invokeCommand.mockReset();
  });

  it("scopes editability metadata to the active session and qualified table", async () => {
    mocks.invokeCommand.mockResolvedValue({
      editable: false,
      reason: "no-reliable-key",
    });

    await expect(
      tableDataApi.getEditability("session-1", {
        database: "analytics",
        schema: "Sales Data",
        table: "order items",
      }),
    ).resolves.toMatchObject({ editable: false });
    expect(mocks.invokeCommand).toHaveBeenCalledWith(
      "get_table_data_editability",
      {
        sessionId: "session-1",
        database: "analytics",
        schema: "Sales Data",
        table: "order items",
      },
    );
  });

  it("commits a structured table-data transaction", async () => {
    const request = {
      requestId: "1138bb0e-cf61-4dbd-a723-6aa3ddd173ab",
      sessionId: "session-1",
      database: "plume",
      schema: "public",
      table: "items",
      columns: [],
      keyColumns: ["id"],
      updatedRows: [],
      insertedRows: [{ values: [] }],
      deletedRows: [],
    };
    mocks.invokeCommand.mockResolvedValue({
      requestId: request.requestId,
      insertedRows: 1,
      updatedRows: 0,
      deletedRows: 0,
    });

    await expect(tableDataApi.commit(request)).resolves.toEqual({
      requestId: request.requestId,
      insertedRows: 1,
      updatedRows: 0,
      deletedRows: 0,
    });
    expect(mocks.invokeCommand).toHaveBeenCalledWith(
      "commit_table_data_changes",
      { request },
    );
  });
});
