import { useEffect } from "react";
import type { WSClient } from "@multica/sdk";
import { useIssueStore } from "@multica/store";
import { useInboxStore } from "@multica/store";
import type { IssueCreatedPayload, IssueUpdatedPayload, IssueDeletedPayload, InboxNewPayload } from "@multica/types";

export function useRealtime(ws: WSClient) {
  const { addIssue, updateIssue, removeIssue } = useIssueStore();
  const { addItem } = useInboxStore();

  useEffect(() => {
    const unsubscribers = [
      ws.on("issue:created", (payload) => {
        const { issue } = payload as IssueCreatedPayload;
        addIssue(issue);
      }),
      ws.on("issue:updated", (payload) => {
        const { issue } = payload as IssueUpdatedPayload;
        updateIssue(issue.id, issue);
      }),
      ws.on("issue:deleted", (payload) => {
        const { issue_id } = payload as IssueDeletedPayload;
        removeIssue(issue_id);
      }),
      ws.on("inbox:new", (payload) => {
        const { item } = payload as InboxNewPayload;
        addItem(item);
      }),
    ];

    return () => {
      for (const unsub of unsubscribers) {
        unsub();
      }
    };
  }, [ws, addIssue, updateIssue, removeIssue, addItem]);
}
