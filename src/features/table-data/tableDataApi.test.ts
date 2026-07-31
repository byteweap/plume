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
});
