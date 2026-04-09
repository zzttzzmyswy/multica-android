import { createAuthStore, registerAuthStore } from "@multica/core/auth";
import { api } from "./api";
import {
  setLoggedInCookie,
  clearLoggedInCookie,
} from "../features/auth/auth-cookie";

export const useAuthStore = createAuthStore({
  api,
  storage: localStorage,
  onLogin: setLoggedInCookie,
  onLogout: clearLoggedInCookie,
});

registerAuthStore(useAuthStore);
