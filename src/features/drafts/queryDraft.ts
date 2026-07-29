export interface QueryDraft {
  id: string;
  profileId: string;
  database: string;
  schema?: string;
  title: string;
  sql: string;
  createdAt: number;
  updatedAt: number;
}

export type SaveQueryDraftRequest = Omit<
  QueryDraft,
  "createdAt" | "updatedAt"
>;
