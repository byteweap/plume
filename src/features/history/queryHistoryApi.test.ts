import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryHistoryApi } from "./queryHistoryApi";

const mocks = vi.hoisted(() => ({ invokeCommand: vi.fn() }));

vi.mock("../../platform/tauri", () => ({ invokeCommand: mocks.invokeCommand }));

describe("queryHistoryApi", () => {
  beforeEach(() => mocks.invokeCommand.mockReset());

  it("records complete query execution metadata", async () => {
    const request = {
      id: "1138bb0e-cf61-4dbd-a723-6aa3ddd173ab",
      profileId: "profile-1",
      database: "postgres",
      schema: "public",
      sql: "select 1;",
      durationMs: 42,
      resultStatus: "succeeded" as const,
    };
    mocks.invokeCommand.mockResolvedValue({ ...request, executedAt: 1 });

    await expect(queryHistoryApi.record(request)).resolves.toMatchObject(request);
    expect(mocks.invokeCommand).toHaveBeenCalledWith("record_query_history", {
      request,
    });
  });
});
