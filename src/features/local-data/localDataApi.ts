import { invokeCommand } from "../../platform/tauri";
import type { LocalDataScope } from "./localData";

export const localDataApi = {
  clear(scope: LocalDataScope): Promise<void> {
    return invokeCommand<void>("clear_local_data", { scope });
  },
};
