/**
 * Renders a token row's metadata caption (`prefix… · Created d · Last used d
 * · Expires d`), mirroring web tokens-tab.tsx:205-217. Injected i18n labels so
 * it stays framework-free and unit-testable; `last_used_at` (null → "never")
 * and `expires_at` (null → omitted) follow web exactly.
 */
import type { PersonalAccessToken } from "@multica/core/types";

export interface TokenMetaLabels {
  fmtDate: (iso: string) => string;
  created: (date: string) => string;
  lastUsedWithDate: (date: string) => string;
  lastUsedNever: string;
  expiresWithDate: (date: string) => string;
}

export function tokenRowMeta(
  token: Pick<
    PersonalAccessToken,
    "token_prefix" | "created_at" | "last_used_at" | "expires_at"
  >,
  labels: TokenMetaLabels,
): string {
  const created = labels.created(labels.fmtDate(token.created_at));
  const lastUsed = token.last_used_at
    ? labels.lastUsedWithDate(labels.fmtDate(token.last_used_at))
    : labels.lastUsedNever;
  const parts = [`${token.token_prefix}…`, created, lastUsed];
  if (token.expires_at) {
    parts.push(labels.expiresWithDate(labels.fmtDate(token.expires_at)));
  }
  return parts.join(" · ");
}