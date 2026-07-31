import type { ResultExportData } from "./csvExport";

export interface JsonExportRequest extends ResultExportData {
  taskId: string;
  suggestedFileName: string;
}

export interface JsonExportProgress {
  taskId: string;
  completedRows: number;
  totalRows: number;
}

export interface JsonExportResult {
  taskId: string;
  status: "completed" | "dismissed" | "cancelled";
  rowsWritten: number;
}
