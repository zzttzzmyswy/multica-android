/**
 * Thin wrapper around expo-secure-store for the auth token.
 * Keyed identically to web/desktop ("multica_token") so logic stays aligned
 * with packages/core/auth/store.ts even though storage backends differ.
 */
import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "multica_token";

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

/**
 * Persist a token obtained from a RENEWAL (MYS-2538).
 *
 * Separate from `setToken` so the write is separately observable and testable,
 * and so the renewal path cannot accidentally be given a fresh-login semantic
 * (e.g. clearing other session state). Renewal replaces exactly one credential;
 * nothing else about the session changes.
 */
export async function commitRenewedToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}
