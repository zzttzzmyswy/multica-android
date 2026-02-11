/**
 * Financial Datasets API client.
 *
 * Base URL: https://api.financialdatasets.ai
 * Auth: X-API-KEY header
 * All endpoints use GET with query parameters.
 */

import { credentialManager } from "../../../credentials.js";

const BASE_URL = "https://api.financialdatasets.ai";
const TIMEOUT_MS = 30_000;

function getApiKey(): string {
  const key = credentialManager.getEnv("FINANCIAL_DATASETS_API_KEY");
  if (!key) {
    throw new Error(
      "FINANCIAL_DATASETS_API_KEY not configured. " +
        "Set it in ~/.super-multica/skills.env.json5 under env, or as an environment variable.",
    );
  }
  return key;
}

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
  const apiKey = getApiKey();

  const url = new URL(path, BASE_URL);
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
      "X-API-KEY": apiKey,
      Accept: "application/json",
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
