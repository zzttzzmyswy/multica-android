import * as SecureStore from "expo-secure-store";

/**
 * Last-viewed chat session id, persisted via SecureStore (small KV — reused
 * the session-token backend rather than pulling in a storage dependency).
 *
 * Restoring the *previous* conversation instead of always opening the first
 * list row is the chat tab's open-on-launch contract (MYS-…): pick up where
 * the user left off, and fall forward to the most recently updated session
 * when another conversation has newer activity.
 */
const LAST_SESSION_KEY = "multica.chat.lastSessionId";

export async function loadLastChatSessionId(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(LAST_SESSION_KEY);
  } catch {
    // SecureStore can throw (rare platform state); degrade to no-memory.
    return null;
  }
}

export async function saveLastChatSessionId(id: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(LAST_SESSION_KEY, id);
  } catch {
    // Non-fatal — losing the restore pointer only costs a default open.
  }
}

export async function clearLastChatSessionId(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(LAST_SESSION_KEY);
  } catch {
    // Non-fatal.
  }
}