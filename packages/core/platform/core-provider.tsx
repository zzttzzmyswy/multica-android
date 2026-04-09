"use client";

import { useMemo } from "react";
import { ApiClient } from "../api/client";
import { setApiInstance } from "../api";
import { createAuthStore, registerAuthStore } from "../auth";
import { createWorkspaceStore, registerWorkspaceStore } from "../workspace";
import { WSProvider } from "../realtime";
import { QueryProvider } from "../provider";
import { createLogger } from "../logger";
import { defaultStorage } from "./storage";
import { AuthInitializer } from "./auth-initializer";
import type { CoreProviderProps } from "./types";

// Module-level singletons — created once, shared across renders.
let initialized = false;
let authStore: ReturnType<typeof createAuthStore>;
let workspaceStore: ReturnType<typeof createWorkspaceStore>;

function initCore(apiBaseUrl: string) {
  if (initialized) return;

  const api = new ApiClient(apiBaseUrl, {
    logger: createLogger("api"),
    onUnauthorized: () => {
      defaultStorage.removeItem("multica_token");
      defaultStorage.removeItem("multica_workspace_id");
    },
  });
  setApiInstance(api);

  // Hydrate token from storage
  const token = defaultStorage.getItem("multica_token");
  if (token) api.setToken(token);
  const wsId = defaultStorage.getItem("multica_workspace_id");
  if (wsId) api.setWorkspaceId(wsId);

  authStore = createAuthStore({ api, storage: defaultStorage });
  registerAuthStore(authStore);

  workspaceStore = createWorkspaceStore(api, {
    storage: defaultStorage,
  });
  registerWorkspaceStore(workspaceStore);

  initialized = true;
}

export function CoreProvider({
  children,
  apiBaseUrl = "",
  wsUrl = "ws://localhost:8080/ws",
  onLogin,
  onLogout,
}: CoreProviderProps) {
  // Initialize singletons on first render
  useMemo(() => initCore(apiBaseUrl), [apiBaseUrl]);

  return (
    <QueryProvider>
      <AuthInitializer onLogin={onLogin} onLogout={onLogout}>
        <WSProvider
          wsUrl={wsUrl}
          authStore={authStore}
          workspaceStore={workspaceStore}
          storage={defaultStorage}
        >
          {children}
        </WSProvider>
      </AuthInitializer>
    </QueryProvider>
  );
}
