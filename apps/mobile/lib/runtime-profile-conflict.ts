/**
 * 409 bounded-agents conflict parsing for runtime-profile delete
 * (iteration-82, A2.3). Mirrors parseRuntimeProfileBoundConflict in
 * packages/core/runtimes/profiles.ts. The server refuses a profile delete
 * while active agents are still bound; we surface its message verbatim so
 * the confirm dialog can explain the refusal without re-deriving it.
 */
import { ApiError } from "@/data/api";

export interface RuntimeProfileBoundConflict {
  message: string;
}

export function parseRuntimeProfileBoundConflict(
  err: unknown,
): RuntimeProfileBoundConflict | null {
  if (!(err instanceof ApiError)) return null;
  if (err.status !== 409) return null;
  const body = err.body;
  const fallback = err.message;
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const message =
      typeof record.message === "string" && record.message.trim()
        ? record.message
        : typeof record.error === "string" && record.error.trim()
          ? record.error
          : fallback;
    return { message };
  }
  return { message: fallback };
}