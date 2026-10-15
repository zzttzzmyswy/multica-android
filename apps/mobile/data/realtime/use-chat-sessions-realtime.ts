/**
 * Chat sessions list-level realtime — Layer 3.
 *
 * Mounted globally in workspace `_layout.tsx` via `<RealtimeSubscriptions />`.
 * Keeps the chatKeys.sessions(wsId) cache fresh regardless of which tab
 * the user is on — so when they DO open Chat tab, the dropdown / sheet
 * already reflects reality (latest titles, has_unread flags, deletions).
 *
 * The subscription list itself lives in `chat-sessions-subscriptions.ts` so
 * it can be exercised by mobile's Node-only vitest lane; this file is only
 * the React lifecycle shell around it.
 *
 * Events handled here are listing-level only — per-session events
 * (chat:message, task:*) belong in `use-chat-session-realtime.ts` because
 * they target a specific session id known only inside the chat screen.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useWSSubscriptions } from "@/lib/use-ws-subscriptions";
import { planChatSessionsSubscriptions } from "./chat-sessions-subscriptions";

export function useChatSessionsRealtime() {
  const qc = useQueryClient();

  useWSSubscriptions(
    (ws, wsId) => planChatSessionsSubscriptions(qc, ws, wsId),
    [qc],
  );
}
