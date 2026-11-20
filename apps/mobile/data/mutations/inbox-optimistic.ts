import type { QueryClient } from "@tanstack/react-query";
import type { InboxItem } from "@multica/core/types";
import { inboxKeys, mapArchivedInboxCache, type ArchivedInboxCache } from "@/data/queries/inbox";

/** A lock belongs to the query client, workspace, and affected field/group, not
 * a component instance. Acquire before the first await to close rapid-tap races. */
const pending = new WeakMap<QueryClient, Set<string>>();
export function acquireInboxWrite(qc: QueryClient, wsId: string | null, groups: string[]) {
  const locks = pending.get(qc) ?? new Set<string>();
  pending.set(qc, locks);
  const keys = groups.map((group) => JSON.stringify([wsId, group]));
  if (keys.some((key) => locks.has(key))) {
    throw Object.assign(new Error("Inbox action already pending"), {
      status: 409, body: { code: "inbox_action_pending" },
    });
  }
  keys.forEach((key) => locks.add(key));
  let released = false;
  return () => {
    if (released) return;
    released = true;
    keys.forEach((key) => locks.delete(key));
  };
}

export function resolveInboxIssue(qc: QueryClient, wsId: string | null, id: string) {
  const main = qc.getQueryData<InboxItem[]>(inboxKeys.list(wsId));
  let issueId = Array.isArray(main) ? main.find((item) => item.id === id)?.issue_id : undefined;
  for (const [, data] of qc.getQueriesData<ArchivedInboxCache>({ queryKey: inboxKeys.archived(wsId) })) {
    if (!data || issueId) continue;
    mapArchivedInboxCache(data, (items) => {
      issueId ??= items.find((item) => item.id === id)?.issue_id;
      return items;
    });
  }
  return issueId ?? null;
}

type Field = "archived" | "read";
interface Undo {
  key: readonly unknown[];
  field: Field;
  optimistic: boolean;
  values: Map<string, boolean>;
}

/** Capture only fields actually changed, not whole query snapshots. A rollback
 * patches current pages, retaining new fields/rows/cursors and never inserting
 * a missing notification at a guessed cursor position. */
export function patchInboxFields(
  qc: QueryClient,
  keys: readonly (readonly unknown[])[],
  field: Field,
  optimistic: boolean,
  matches: (item: InboxItem) => boolean,
): Undo[] {
  return keys.map((key) => {
    const values = new Map<string, boolean>();
    qc.setQueryData<ArchivedInboxCache>(key, (data) => data && mapArchivedInboxCache(data, (items) =>
      items.map((item) => {
        if (!matches(item) || item[field] === optimistic) return item;
        values.set(item.id, item[field]);
        return { ...item, [field]: optimistic };
      }),
    ));
    return { key, field, optimistic, values };
  });
}

export function rollbackInboxFields(qc: QueryClient, undo: Undo[] = []) {
  for (const { key, field, optimistic, values } of undo) {
    qc.setQueryData<ArchivedInboxCache>(key, (data) => data && mapArchivedInboxCache(data, (items) =>
      items.map((item) => values.has(item.id) && item[field] === optimistic
        ? { ...item, [field]: values.get(item.id)! }
        : item),
    ));
  }
}
