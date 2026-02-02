import { getConsoleUrl } from "./config"

export class HttpError extends Error {
  constructor(
    public status: number,
    public statusText: string,
  ) {
    super(`HTTP ${status}: ${statusText}`)
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${getConsoleUrl()}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new HttpError(res.status, res.statusText)
  return res.json()
}

/** Console REST API */
export const consoleApi = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
}
