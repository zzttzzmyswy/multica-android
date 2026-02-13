import { getLocalAuth } from "./auth-store.js";

export const API_BASE_URL = "https://api-dev.copilothub.ai";

/**
 * Return auth headers for the proxy API.
 * Throws if the user is not logged in.
 */
export function getAuthHeaders(): Record<string, string> {
  const auth = getLocalAuth();
  if (!auth) {
    throw new Error(
      "Not logged in. Please sign in via the Desktop app.",
    );
  }
  return {
    sid: auth.sid,
    "device-id": auth.deviceId,
    "os-type": "3",
  };
}
