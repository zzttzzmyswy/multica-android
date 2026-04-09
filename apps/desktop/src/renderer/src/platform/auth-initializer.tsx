import { useEffect, type ReactNode } from "react";
import { useAuthStore } from "./auth";
import { useWorkspaceStore } from "./workspace";
import { api } from "./api";
import { desktopStorage } from "./storage";
import { createLogger } from "@multica/core/logger";

const logger = createLogger("auth");

export function AuthInitializer({ children }: { children: ReactNode }) {
  useEffect(() => {
    const token = desktopStorage.getItem("multica_token");
    if (!token) {
      useAuthStore.setState({ isLoading: false });
      return;
    }

    api.setToken(token);
    const wsId = desktopStorage.getItem("multica_workspace_id");

    const mePromise = api.getMe();
    const wsPromise = api.listWorkspaces();

    Promise.all([mePromise, wsPromise])
      .then(([user, wsList]) => {
        useAuthStore.setState({ user, isLoading: false });
        useWorkspaceStore.getState().hydrateWorkspace(wsList, wsId);
      })
      .catch((err) => {
        logger.error("auth init failed", err);
        api.setToken(null);
        api.setWorkspaceId(null);
        desktopStorage.removeItem("multica_token");
        desktopStorage.removeItem("multica_workspace_id");
        useAuthStore.setState({ user: null, isLoading: false });
      });
  }, []);

  return <>{children}</>;
}
