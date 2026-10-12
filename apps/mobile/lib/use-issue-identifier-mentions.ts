/**
 * Resolve the bare issue identifiers in one markdown string, so the read-only
 * renderer can make exactly those tappable — the mobile counterpart of web's
 * `useResolveIssueIdentifier` (`packages/views/issues/hooks/`).
 *
 * ## Why the render path needs this at all
 *
 * `lib/markdown/issue-identifiers.ts` detects identifiers syntactically. The
 * server 404s one that names no issue, and mobile's renderer cannot fall back
 * per-node the way web's `IdentifierIssueMentionLink` does — the string goes to
 * md4c whole and comes back as one attributed string with no leaf hook. So the
 * decision has to be made before preprocess, and only CONFIRMED identifiers may
 * be rewritten. A miss must render exactly as the author typed it.
 *
 * ## Why one query per identifier is the only shape available
 *
 * The server has no "resolve these identifiers" endpoint: `GET /api/issues/:id`
 * takes one id, and the list route has no identifiers filter. So the lookup is
 * one query per distinct identifier, and TanStack Query makes that cheap in the
 * two ways that matter:
 *
 *   - identical identifiers across many comments share one cache entry, so a
 *     body citing `MYS-2109` five times costs one request;
 *   - each entry is cached for 5 minutes, so re-reading the same issue — or
 *     scrolling back over it — costs nothing.
 *
 * The volume justifies it. Across 40 live issues of this deployment the
 * distinct identifiers per CONTENT BLOCK are median 1, p95 7, and only 52.5% of
 * blocks contain any at all. The single 45-identifier outlier is one long
 * iteration issue, and those 45 lookups are exactly the ones a reader wants to
 * be able to tap.
 *
 * The prefix gate (`issueIdentifierOptions`) does real work here too: `MYS-`
 * covers 340 of 380 identifier occurrences in the same sample, and the other 40
 * are part numbers and other products' tokens (`UTF-8`, `MT62F4G32D8DV-4`) that
 * could never resolve in this workspace and are never fetched.
 *
 * ## Why resolving is not a render-loop hazard
 *
 * A query that starts while rendering re-renders when it lands, which re-runs
 * the caller's memo. That terminates because the identifier scan is idempotent
 * over a rewritten string: `[MYS-2109](mention://issue/<uuid>)` is an existing
 * markdown link, so the next pass skips it and yields the same candidate set —
 * one extra memo run, then stable.
 */
import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { issueIdentifierOptions } from "@/data/queries/issues";
import { workspaceListOptions } from "@/data/queries/workspaces";
import { useWorkspaceStore } from "@/data/workspace-store";
import { collectIssueIdentifiers } from "@/lib/markdown/issue-identifiers";
import {
  serializeResolvedPairs,
  toResolvedMap,
  type ResolvedIssueIdentifiers,
} from "@/lib/issue-identifier-pairs";

export type { ResolvedIssueIdentifiers };

/**
 * Resolve every distinct bare issue identifier in `content`.
 *
 * `enabled` lets a caller skip the whole lookup on a surface that cannot need
 * it, keeping the pass out of the write path — where a rewrite would corrupt
 * the markdown saved back to the server.
 */
export function useResolvedIssueIdentifiers(
  content: string,
  enabled = true,
): ResolvedIssueIdentifiers {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { data: workspaces } = useQuery(workspaceListOptions());

  const identifiers = useMemo(
    () => (enabled ? collectIssueIdentifiers(content) : []),
    [content, enabled],
  );

  // This workspace's issue prefix, for the prefix gate. Unknown (list still
  // loading, or no match) leaves `undefined`, which gates nothing out — the
  // lookup is then the authority, matching web's fall-through.
  const issuePrefix = workspaces?.find((w) => w.slug === wsSlug)?.issue_prefix;

  const results = useQueries({
    queries: identifiers.map((identifier) =>
      issueIdentifierOptions(wsId, identifier, issuePrefix),
    ),
  });

  // `useQueries` hands back a new array every render, and the caller memoizes
  // its preprocess pass on this map's identity — so the map must only change
  // when the RESOLVED PAIRS change. Serializing the pairs and keying the map's
  // memo on that STRING gives it a stable identity for free: the stringify runs
  // each render (cheap, and unavoidable since `results` is a fresh array), but
  // an unchanged string makes the memo below bail out. Same device as
  // `issueParamsKey` in `data/queries/issue-keys.ts`.
  const pairsKey = serializeResolvedPairs(
    identifiers,
    results.map((result) => result.data ?? null),
  );

  return useMemo(() => toResolvedMap(pairsKey), [pairsKey]);
}
