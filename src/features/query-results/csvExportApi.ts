import { listen } from "@tauri-apps/api/event";
import { invokeCommand } from "../../platform/tauri";
import type {
  CancelExportResult,
  CsvExportProgress,
  CsvExportRequest,
  CsvExportResult,
} from "./csvExport";

const csvExportProgressEvent = "csv-export-progress";

export const csvExportApi = {
  async execute(
    request: CsvExportRequest,
    onProgress: (progress: CsvExportProgress) => void,
  ): Promise<CsvExportResult> {
    const unlisten = await listen<CsvExportProgress>(
      csvExportProgressEvent,
      ({ payload }) => {
        if (payload.taskId === request.taskId) onProgress(payload);
      },
    );
    try {
      return await invokeCommand<CsvExportResult>("export_csv", { request });
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
