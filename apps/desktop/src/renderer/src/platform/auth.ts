import { createAuthStore, registerAuthStore } from "@multica/core/auth";
import { api } from "./api";
import { desktopStorage } from "./storage";

export const useAuthStore = createAuthStore({
  api,
  storage: desktopStorage,
});

registerAuthStore(useAuthStore);
