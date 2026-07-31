import { beforeEach, describe, expect, it, vi } from "vitest";
import { localDataApi } from "./localDataApi";

const mocks = vi.hoisted(() => ({ invokeCommand: vi.fn() }));

vi.mock("../../platform/tauri", () => ({ invokeCommand: mocks.invokeCommand }));

describe("localDataApi", () => {
  beforeEach(() => mocks.invokeCommand.mockReset());

  it.each(["history", "drafts", "cache", "all"] as const)(
    "clears the %s scope through the privileged command",
    async (scope) => {
      mocks.invokeCommand.mockResolvedValue(undefined);

      await localDataApi.clear(scope);

      expect(mocks.invokeCommand).toHaveBeenCalledWith("clear_local_data", {
        scope,
      });
    },
  );
});
