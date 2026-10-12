/**
 * The pure decision behind the identifier lookup: which candidates became
 * linkable, and what each link should point at.
 *
 * Split out of `use-issue-identifier-mentions.ts` deliberately. The hook
 * transitively imports React Native (workspace store → expo-secure-store), and
 * mobile's vitest lane is Node-only with no RN transform — so anything left in
 * the hook is untestable here. The rule this module encodes IS the correctness
 * rule (an unresolved identifier must stay the author's plain text, and the
 * link target must be the UUID), so it belongs in a module the Node lane can
 * reach.
 *
 * PURE — no React, no native modules, no network.
 */

/** Identifier → issue UUID, for the identifiers that resolved to a real issue.
 *  This is exactly the shape `preprocessIssueIdentifiers` accepts. */
export type ResolvedIssueIdentifiers = Map<string, string>;

/** The `[identifier, issueId]` pairs a resolution produced — `null` for any
 *  identifier that did not resolve.
 *
 *  The string form is also what the hook memoizes on. `useQueries` returns a
 *  fresh array every render, so keying the returned Map's memo on that array
 *  would give it a new identity every render and invalidate the caller's
 *  preprocess memo forever. Serializing makes the identity depend on the
 *  CONTENT, so an unchanged resolution bails out. Same device as
 *  `issueParamsKey` in `data/queries/issue-keys.ts`. */
export function serializeResolvedPairs(
  identifiers: readonly string[],
  issues: ReadonlyArray<{ id: string } | null | undefined>,
): string {
  return JSON.stringify(
    identifiers.map((identifier, i) => {
      const issue = issues[i];
      return issue ? [identifier, issue.id] : null;
    }),
  );
}

/** Inverse of {@link serializeResolvedPairs}: only the pairs that resolved,
 *  which is exactly the set `preprocessIssueIdentifiers` may rewrite. */
export function deserializeResolvedPairs(
  pairsKey: string,
): Array<[string, string]> {
  return (JSON.parse(pairsKey) as Array<[string, string] | null>).flatMap(
    (pair) => (pair ? [pair] : []),
  );
}

/** The Map `preprocessIssueIdentifiers` consumes, from the pairs. */
export function toResolvedMap(pairsKey: string): ResolvedIssueIdentifiers {
  return new Map(deserializeResolvedPairs(pairsKey));
}
