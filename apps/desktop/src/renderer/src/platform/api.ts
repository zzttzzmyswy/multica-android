import { ApiClient } from "@multica/core/api/client";
import { setApiInstance } from "@multica/core/api";
import { createLogger } from "@multica/core/logger";
import { desktopStorage } from "./storage";

const API_BASE_URL = "http://localhost:8080";

export const api = new ApiClient(API_BASE_URL, {
  logger: createLogger("api"),
  onUnauthorized: () => {
    desktopStorage.removeItem("multica_token");
    desktopStorage.removeItem("multica_workspace_id");
  },
});

setApiInstance(api);

const token = desktopStorage.getItem("multica_token");
if (token) api.setToken(token);
const wsId = desktopStorage.getItem("multica_workspace_id");
if (wsId) api.setWorkspaceId(wsId);
