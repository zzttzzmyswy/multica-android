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
  // 1. credentials.json5 → tools.data.apiKey (preferred)
  const toolConfig = credentialManager.getToolConfig("data");
  if (toolConfig?.apiKey) return toolConfig.apiKey;

  // 2. Fallback: env var (skills.env.json5 or process.env)
  const envKey = credentialManager.getEnv("FINANCIAL_DATASETS_API_KEY");
  if (envKey) return envKey;

  throw new Error(
    "Financial Datasets API key not configured. " +
      'Set it in ~/.super-multica/credentials.json5 under tools.data.apiKey, ' +
      "or set FINANCIAL_DATASETS_API_KEY in ~/.super-multica/skills.env.json5.",
  );
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
