import { createWorkspaceStore, registerWorkspaceStore } from "@multica/core/workspace";
import { toast } from "sonner";
import { api } from "./api";

export const useWorkspaceStore = createWorkspaceStore(api, {
  storage: localStorage,
  onError: (msg) => toast.error(msg),
});

registerWorkspaceStore(useWorkspaceStore);
