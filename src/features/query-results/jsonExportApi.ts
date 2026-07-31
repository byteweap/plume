import { listen } from "@tauri-apps/api/event";
import { invokeCommand } from "../../platform/tauri";
import type { CancelExportResult } from "./csvExport";
import type {
  JsonExportProgress,
  JsonExportRequest,
  JsonExportResult,
} from "./jsonExport";

const jsonExportProgressEvent = "json-export-progress";

export const jsonExportApi = {
  async execute(
    request: JsonExportRequest,
    onProgress: (progress: JsonExportProgress) => void,
  ): Promise<JsonExportResult> {
    const unlisten = await listen<JsonExportProgress>(
      jsonExportProgressEvent,
      ({ payload }) => {
        if (payload.taskId === request.taskId) onProgress(payload);
      },
    );
    try {
      return await invokeCommand<JsonExportResult>("export_json", { request });
    } finally {
      unlisten();
    }
  },

  cancel(taskId: string): Promise<CancelExportResult> {
    return invokeCommand<CancelExportResult>("cancel_export", {
      request: { taskId },
    });
  },
};
