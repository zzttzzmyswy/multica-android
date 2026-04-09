import { createWorkspaceStore, registerWorkspaceStore } from "@multica/core/workspace";
import { api } from "./api";

export const useWorkspaceStore = createWorkspaceStore(api);

registerWorkspaceStore(useWorkspaceStore);
