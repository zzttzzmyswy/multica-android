/**
 * A failed write must say so — the write-side twin of `catalog-state.ts`.
 *
 * Earlier rounds in this defect family closed *reads* that lied: a failed fetch
 * painted as 「该工作区还没有…」 (MYS-1892 / MYS-1907), as 「…不存在」 (MYS-1908),
 * and finally as 「此工作区中没有智能体」 with the chat composer disabled
 * (MYS-1924). They shared one read shape — default the rows to `[]`, then branch
 * on `length === 0`.
 *
 * The write side has the mirror-image defect and it is worse in one way: it is
 * *silent* rather than wrong. Every mutation in `data/mutations/` pairs an
 * optimistic patch with an `onError` that only restores the cache. That rollback
 * is correct, but on its own it tells the user nothing: they tap 「进行中」, the
 * sheet closes, the detail page still reads 「待办」, and there is no way to learn
 * a request failed, let alone retry it. Web's equivalent write path raises a
 * `toast.error`; mobile had no equivalent.
 *
 * The reporting channel has to outlive the surface that started the write. Every
 * picker route calls `mutate(patch)` and then `router.back()`s on the next
 * frame, while a real failure arrives up to `FETCH_TIMEOUT_MS` (30s, api.ts)
 * later. A per-call `onError` does NOT survive that: `mutationObserver.js:77`
 * guards the per-call options with `hasListeners()`, and unmounting the
 * component unsubscribes the observer, so the handler never runs. Hence the
 * alert is driven from the QueryClient's `MutationCache` (see
 * `write-failure-alert.ts`), which is called directly by `mutation.js:148` with
 * no listener gate.
 *
 * That channel cannot see a per-call `meta` (it only reads
 * `mutation.options.meta`, i.e. the hook's own options), so the title travels on
 * the HOOK's `meta` under `WRITE_FAILURE_TITLE_KEY`. This module owns the key
 * and the message rules; it stays free of `react-native` and `@tanstack/*` so
 * the decision is unit-testable in the Node vitest lane, where there is no RN
 * renderer (see `vitest.config.ts`).
 */

/**
 * Meta key carrying the i18n id of the line to show when this mutation fails.
 *
 * Lives on the mutation's own options (the `useMutation({...})` call), never on
 * the per-call options passed to `mutate` — the global handler reads
 * `mutation.options.meta` and cannot see per-call meta, so a title placed there
 * would be silently dropped.
 */
export const WRITE_FAILURE_TITLE_KEY = "writeFailureTitleKey";

/** The slice of a mutation this module needs: its meta, and nothing else. */
export interface WriteFailureMutationLike {
  options?: { meta?: Record<string, unknown> | null } | null;
}

/**
 * The i18n id to raise for a failed mutation, or `null` when the write opted out
 * of reporting.
 *
 * Returning `null` is a first-class outcome, not an error: plenty of writes are
 * background bookkeeping (marking a chat session read, marking an inbox item
 * read) where an alert would be pure noise — the user did not ask for them and
 * cannot act on the failure. Those simply carry no meta.
 *
 * A non-string meta value is treated as absent rather than coerced: only a
 * translator-produced id is meaningful here, and `String(undefined)` would put
 * the literal "undefined" on screen.
 */
export function writeFailureTitleKey(
  mutation: WriteFailureMutationLike | null | undefined,
): string | null {
  const value = mutation?.options?.meta?.[WRITE_FAILURE_TITLE_KEY];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** The server's own message for a failed write, or `undefined` when it had none.
 *
 *  The API's messages are written for users (a validation rule, a changed
 *  permission) and are strictly more useful than any static line. A blank
 *  message is treated as absent: `Error("")` carries no information, and passing
 *  it through would give the alert an empty body where `undefined` correctly
 *  renders the title alone — the same distinction `Alert.alert(title)` makes. */
export function writeFailureDetail(error: unknown): string | undefined {
  if (error instanceof Error) {
    const message = error.message?.trim();
    if (message) return message;
  }
  return undefined;
}

/** The minimal shape of `Alert.alert` this module needs. */
export type WriteFailureAlerter = (
  title: string,
  message: string | undefined,
) => void;

/** Report a failed write, if the mutation asked to be reported.
 *
 *  Both the translator and the alerter are injected rather than imported, so
 *  this file stays free of `react-native` and of the i18n module's SecureStore
 *  dependency — which is what lets its rules run in the Node vitest lane.
 *  `data/query-client.ts` binds `translate` and `Alert.alert`.
 *
 *  A mutation carrying no `WRITE_FAILURE_TITLE_KEY` in its hook-level meta stays
 *  silent on purpose — see `writeFailureTitleKey`. */
export function reportWriteFailure(
  error: unknown,
  mutation: WriteFailureMutationLike | null | undefined,
  translate: (id: string) => string,
  alert: WriteFailureAlerter,
): void {
  const titleKey = writeFailureTitleKey(mutation);
  if (!titleKey) return;
  alert(translate(titleKey), writeFailureDetail(error));
}
