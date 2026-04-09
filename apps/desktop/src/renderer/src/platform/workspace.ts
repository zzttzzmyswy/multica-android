import { createWorkspaceStore, registerWorkspaceStore } from "@multica/core/workspace";
import { toast } from "sonner";
import { api } from "./api";
import { desktopStorage } from "./storage";

export const useWorkspaceStore = createWorkspaceStore(api, {
  storage: desktopStorage,
  onError: (msg) => toast.error(msg),
});

registerWorkspaceStore(useWorkspaceStore);
