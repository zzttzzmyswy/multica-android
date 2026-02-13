/**
 * Financial Datasets API client.
 *
 * Proxied through api-dev.copilothub.ai with auth headers (sid / device-id / os-type).
 * All endpoints use GET with query parameters.
 */

import { getLocalAuth } from "../../../../hub/auth-store.js";

const BASE_URL = "https://api-dev.copilothub.ai";
const PATH_PREFIX = "/api/v1/financial";
const TIMEOUT_MS = 30_000;

/**
 * Fetch data from the Financial Datasets API.
 *
 * @param path - API path (e.g., "/prices/snapshot")
 * @param params - Query parameters. Arrays are sent as repeated params (e.g., item=1A&item=1B).
 * @param signal - Optional AbortSignal for cancellation.
 */
export async function financeFetch<T = Record<string, unknown>>(
  path: string,
  params: Record<string, string | string[] | number | boolean | undefined>,
  signal?: AbortSignal,
): Promise<{ data: T; url: string }> {
  const auth = getLocalAuth();
  if (!auth) {
    throw new Error(
      "Not logged in. Please sign in via the Desktop app to use financial data tools.",
    );
  }

  const url = new URL(PATH_PREFIX + path, BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const v of value) {
        url.searchParams.append(key, String(v));
      }
    } else {
      url.searchParams.set(key, String(value));
    }
  }

  const timeoutSignal = AbortSignal.timeout(TIMEOUT_MS);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      sid: auth.sid,
      "device-id": auth.deviceId,
      "os-type": "3",
    },
    signal: combinedSignal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Financial Datasets API error (${res.status}): ${body || res.statusText}`,
    );
  }

  const data = (await res.json()) as T;
  return { data, url: url.toString() };
}
