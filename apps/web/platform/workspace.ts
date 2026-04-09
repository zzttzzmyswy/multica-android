import { createWorkspaceStore } from "@multica/core/workspace";
import { api } from "./api";

export const useWorkspaceStore = createWorkspaceStore(api);
