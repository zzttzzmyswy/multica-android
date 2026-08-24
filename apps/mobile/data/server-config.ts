/**
 * Mobile server-config — single source of truth for the API base URL.
 *
 * By default the base is the build-time `EXPO_PUBLIC_API_URL` (baked into
 * the JS bundle by Metro). Users who self-host Multica can instead point the
 * app at their own server at runtime: `setApiBaseUrl` persists the override
 * in SecureStore and flips the in-memory cache so every subsequent request
 * (HTTP + WebSocket + relative attachment URLs) targets the new host.
 *
 * Reads are synchronous (`getApiBaseUrl`) because it sits on the hot path of
 * ApiClient.fetch — no React, no await. The SecureStore-backed override is
 * loaded into the cache once at startup via `loadApiBaseUrl`.
 */
import * as SecureStore from "expo-secure-store";

const SERVER_URL_KEY = "multica_server_base_url";

/** Build-time default, never mutated at runtime. */
const ENV_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "";

/** Runtime override loaded from SecureStore on startup / set via
 *  `setApiBaseUrl`. Prefixed with "" so `hasCustomApiBaseUrl` can distinguish
 *  "explicitly reset to default" (null) from "never set" (also null) — we
 *  treat both as "use the env default". */
let customBaseUrl: string | null = null;

/** Change notification for the runtime override. Consumers that must react
 *  to a mid-session server switch (the realtime WebSocket, which derives its
 *  URL from the effective base and must re-establish the connection) subscribe
 *  here and re-read `getApiBaseUrl()` on change. */
const listeners = new Set<() => void>();

export function subscribeApiBaseUrl(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyApiBaseUrlChanged(): void {
  for (const listener of listeners) listener();
}

export function getEnvBaseUrl(): string {
  return ENV_BASE_URL;
}

/** Current effective base: the SecureStore override if present, else the
 *  build-time env default. Throws only if neither exists — this is the
 *  same hard failure ApiClient historically surfaced at module load. */
export function getApiBaseUrl(): string {
  if (customBaseUrl) return customBaseUrl;
  if (ENV_BASE_URL) return ENV_BASE_URL;
  throw new Error(
    "Multica server base URL is undefined. Set EXPO_PUBLIC_API_URL (" +
      "see apps/mobile/.env.development.local) or configure one in the app.",
  );
}

export function getCustomApiBaseUrl(): string | null {
  return customBaseUrl;
}

export function hasCustomApiBaseUrl(): boolean {
  return customBaseUrl !== null && customBaseUrl !== "";
}

/** Human-facing base for display in settings/UI: the override if present,
 *  else the build-time default. Does not throw — a missing env default shows
 *  as an empty/unset state rather than crashing a read-only UI. */
export function getDisplayBaseUrl(): string {
  return customBaseUrl ?? ENV_BASE_URL;
}

/** Build-time web origin for the "open on web" / "copy link" actions.
 *  A runtime server override wins — switching the app to a self-hosted
 *  server must switch every web link to that deployment's web origin, not a
 *  stale build-time default (e.g. api.mu.zztweb.top → mu.zztweb.top via the
 *  `api.` strip below). Otherwise prefer an explicit `EXPO_PUBLIC_WEB_URL`
 *  (official & hosted deployments serve the web UI on a different host than
 *  the API — e.g. api.multica.ai vs multica.ai), then derive from the
 *  *effective* API base. Self-hosters commonly put the API behind an `api.`
 *  subdomain while the web UI sits at the root domain, so a leading `api.`
 *  is stripped from the derived origin; a host without it is used verbatim.
 *  Never throws: callers treat an empty string as "no web link". */
export function getWebBaseUrl(): string {
  if (customBaseUrl) {
    return webOriginFrom(customBaseUrl);
  }
  if (process.env.EXPO_PUBLIC_WEB_URL) {
    return process.env.EXPO_PUBLIC_WEB_URL;
  }
  let apiBase: string;
  try {
    apiBase = getApiBaseUrl();
  } catch {
    return "";
  }
  return webOriginFrom(apiBase);
}

function webOriginFrom(apiBase: string): string {
  try {
    const url = new URL(apiBase);
    const host = url.hostname.startsWith("api.")
      ? url.hostname.slice(4)
      : url.hostname;
    return `${url.protocol}//${host}`;
  } catch {
    return "";
  }
}

/** Validate a user-entered server URL: must be a valid http(s) absolute URL
 *  with a host. Trailing slashes are stripped for the returned value. */
export function normalizeServerBaseUrl(input: string): string | null {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname) return null;
  return trimmed;
}

/** Persist a custom base URL override and make it effective immediately. */
export async function setApiBaseUrl(input: string): Promise<void> {
  const normalized = normalizeServerBaseUrl(input);
  if (!normalized) {
    throw new Error("Enter a valid server URL, e.g. https://api.example.com");
  }
  customBaseUrl = normalized;
  notifyApiBaseUrlChanged();
  await SecureStore.setItemAsync(SERVER_URL_KEY, normalized);
}

/** Restore a persisted override into the in-memory cache on cold start.
 *  Returns the restored base URL, or null if none was saved. */
export async function loadApiBaseUrl(): Promise<string | null> {
  const saved = await SecureStore.getItemAsync(SERVER_URL_KEY);
  if (saved) customBaseUrl = saved;
  return saved;
}

/** Clear any override and fall back to the build-time env default. */
export async function resetApiBaseUrl(): Promise<void> {
  customBaseUrl = null;
  notifyApiBaseUrlChanged();
  await SecureStore.deleteItemAsync(SERVER_URL_KEY);
}