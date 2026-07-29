import { invokeCommand } from "../../platform/tauri";
import type { QueryDraft, SaveQueryDraftRequest } from "./queryDraft";

export const queryDraftApi = {
  list(): Promise<QueryDraft[]> {
    return invokeCommand<QueryDraft[]>("list_query_drafts");
  },
  save(request: SaveQueryDraftRequest): Promise<QueryDraft> {
    return invokeCommand<QueryDraft>("save_query_draft", { request });
  },
  delete(id: string): Promise<void> {
    return invokeCommand<void>("delete_query_draft", { request: { id } });
  },
};
