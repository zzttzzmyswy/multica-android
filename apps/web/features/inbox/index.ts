// Inbox server state is managed by TanStack Query.
// See core/inbox/ for queries, mutations, and WS updaters.
export {
  inboxKeys,
  inboxListOptions,
  deduplicateInboxItems,
  useMarkInboxRead,
  useArchiveInbox,
  useMarkAllInboxRead,
  useArchiveAllInbox,
  useArchiveAllReadInbox,
  useArchiveCompletedInbox,
} from "@core/inbox";
