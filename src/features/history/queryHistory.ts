export type QueryHistoryStatus = "succeeded" | "failed" | "cancelled";

export interface RecordQueryHistoryRequest {
  id: string;
  profileId: string;
  database: string;
  schema?: string;
  sql: string;
  durationMs: number;
  resultStatus: QueryHistoryStatus;
}

export interface QueryHistory
  extends Omit<RecordQueryHistoryRequest, "profileId"> {
  profileId?: string;
  executedAt: number;
}
