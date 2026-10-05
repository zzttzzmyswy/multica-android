/**
 * Write guard for the view-bar preference document (MYS-1916).
 *
 * `PUT /api/issue-view-preferences` is a whole-document upsert: the `hidden`
 * and `order` arrays in the body become the scope's entire preference, they do
 * not merge into what the server already holds. The mobile bar composed that
 * body out of two reads and used `EMPTY_VIEW_BAR_PREFS` / `views ?? []` as its
 * fallbacks, so either read had a failure mode that silently destroyed real
 * customization:
 *
 *   · preference read not settled → `prefs` is empty → hiding one view writes
 *     `hidden: [that one]`, dropping every view hidden earlier. The bar looks
 *     right until another client (or the next launch) reads the doc back.
 *   · views read not settled → the stale-id prune is handed `[]`, so every id
 *     in `order` is judged deleted → the write carries `{hidden: [], order:
 *     []}`, zeroing the whole bar.
 *
 * Web has the equivalent guard on one flag: `if (!viewsReady) return;`
 * (`packages/views/issues/components/view-bar.tsx:305-317`) fed by
 * `viewsReady: listQuery.isSuccess` (`packages/core/issue-views/
 * use-active-view.ts:62`). One flag suffices there because web's prefs doc is
 * not the prune's input; on mobile the document being written is built from the
 * preference read *and* the prune reads the views list, so both reads gate the
 * write.
 *
 * The gate is the read's success, not "not loading": a failed read leaves the
 * data undefined, which is precisely the state that reads as "no prefs" / "no
 * views". Dropping the write is safe — hide/reveal/reorder is re-doable a
 * moment later, whereas the overwrite it would have sent is not recoverable
 * from the client.
 *
 * Kept DOM-free and framework-free so the decision is unit-testable in the Node
 * vitest lane, alongside `canSaveCustomArgs` (`lib/custom-args.ts`), which
 * guards the same class of whole-document write for the agent-args editor.
 */

export interface ViewBarPrefsWriteGate {
  /** The preference doc came out of a read that SUCCEEDED, so the doc is the
   *  server's real one rather than the empty fallback. False while the read is
   *  in flight or has failed. */
  prefsSettled: boolean;
  /** The views list came out of a read that SUCCEEDED, so the stale-id prune
   *  sees every id that still exists. False while in flight or failed. */
  viewsSettled: boolean;
}

/** Whether the bar may persist a preference document right now. */
export function canWriteViewBarPrefs({
  prefsSettled,
  viewsSettled,
}: ViewBarPrefsWriteGate): boolean {
  return prefsSettled && viewsSettled;
}
