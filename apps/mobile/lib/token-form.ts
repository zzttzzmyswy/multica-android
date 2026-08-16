/**
 * Pure helpers for the API Tokens screen — mapping between the expiry chip
 * value ("30" | "90" | "365" | "never") and the wire body. Mirrors web
 * tokens-tab.tsx:82: "never" omits `expires_in_days` so the server creates a
 * non-expiring token. Kept framework-free for unit testing.
 */
import type { CreatePersonalAccessTokenRequest } from "@multica/core/types";

export const TOKEN_EXPIRY_VALUES = ["30", "90", "365", "never"] as const;

export type TokenExpiryValue = (typeof TOKEN_EXPIRY_VALUES)[number];

export const TOKEN_EXPIRY_LABEL_KEYS: Record<
  TokenExpiryValue,
  string
> = {
  "30": "tokens.expiry30",
  "90": "tokens.expiry90",
  "365": "tokens.expiry365",
  never: "tokens.expiryNever",
};

export function tokenCreateRequest(
  name: string,
  expiry: TokenExpiryValue,
): CreatePersonalAccessTokenRequest {
  const req: CreatePersonalAccessTokenRequest = { name: name.trim() };
  if (expiry !== "never") req.expires_in_days = Number(expiry);
  return req;
}

export function isTokenExpiryValue(v: string): v is TokenExpiryValue {
  return (TOKEN_EXPIRY_VALUES as readonly string[]).includes(v);
}