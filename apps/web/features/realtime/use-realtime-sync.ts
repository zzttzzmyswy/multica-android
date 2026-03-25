"use client";

import { useEffect } from "react";
import type { WSClient } from "@multica/sdk";
import { useIssueStore, useInboxStore, useAgentStore } from "@multica/store";
import { useWorkspaceStore } from "@/features/workspace";
import { api } from "@/shared/api";
import type {
  IssueCreatedPayload,
  IssueUpdatedPayload,
  IssueDeletedPayload,
  AgentStatusPayload,
  AgentCreatedPayload,
  InboxNewPayload,
  InboxReadPayload,
  InboxArchivedPayload,
} from "@multica/types";

/**
 * Centralized WS → store sync. Called once from WSProvider.
 * Subscribes to all global WS events and dispatches to Zustand stores.
 * Comment events are NOT handled here — they stay per-page on issue detail.
 */
export function useRealtimeSync(ws: WSClient | null) {
  // Issue events → useIssueStore
  useEffect(() => {
    if (!ws) return;

    const unsubs = [
      ws.on("issue:created", (p) => {
        const { issue } = p as IssueCreatedPayload;
        useIssueStore.getState().addIssue(issue);
      }),
      ws.on("issue:updated", (p) => {
        const { issue } = p as IssueUpdatedPayload;
        useIssueStore.getState().updateIssue(issue.id, issue);
      }),
      ws.on("issue:deleted", (p) => {
        const { issue_id } = p as IssueDeletedPayload;
        useIssueStore.getState().removeIssue(issue_id);
      }),
    ];

    return () => unsubs.forEach((u) => u());
  }, [ws]);

  // Inbox events → useInboxStore
  useEffect(() => {
    if (!ws) return;

    const unsubs = [
      ws.on("inbox:new", (p) => {
        const { item } = p as InboxNewPayload;
        useInboxStore.getState().addItem(item);
      }),
      ws.on("inbox:read", (p) => {
        const { item_id } = p as InboxReadPayload;
        useInboxStore.getState().markRead(item_id);
      }),
      ws.on("inbox:archived", (p) => {
        const { item_id } = p as InboxArchivedPayload;
        useInboxStore.getState().archive(item_id);
      }),
    ];

    return () => unsubs.forEach((u) => u());
  }, [ws]);

  // Agent events → useAgentStore / workspace refresh
  useEffect(() => {
    if (!ws) return;

    const unsubs = [
      ws.on("agent:status", (p) => {
        const { agent } = p as AgentStatusPayload;
        useAgentStore.getState().updateAgent(agent.id, agent);
      }),
      ws.on("agent:created", (p) => {
        const { agent } = p as AgentCreatedPayload;
        const agents = useAgentStore.getState().agents;
        if (!agents.find((a) => a.id === agent.id)) {
          useAgentStore.getState().setAgents([...agents, agent]);
        }
      }),
      ws.on("agent:deleted", () => {
        // Refresh agents list since we don't have removeAgent in store
        useWorkspaceStore.getState().refreshAgents();
      }),
    ];

    return () => unsubs.forEach((u) => u());
  }, [ws]);

  // Reconnect → refetch all data to recover missed events
  useEffect(() => {
    if (!ws) return;

    const unsub = ws.onReconnect(async () => {
      try {
        const [issuesRes, inboxItems, agents] = await Promise.all([
          api.listIssues({ limit: 200 }),
          api.listInbox(),
          api.listAgents(),
        ]);
        useIssueStore.getState().setIssues(issuesRes.issues);
        useInboxStore.getState().setItems(inboxItems);
        useAgentStore.getState().setAgents(agents);
      } catch {
        // Silently fail; next reconnect will retry
      }
    });

    return unsub;
  }, [ws]);
}
