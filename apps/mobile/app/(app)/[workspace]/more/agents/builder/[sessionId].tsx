/**
 * One AI-builder creation conversation, addressed by its own session id
 * (more/agents/builder/[sessionId]). The id lives in the path so the
 * conversation survives a refresh and a back/forward — it is server-persisted
 * and only discarded explicitly.
 *
 * `?runtime=` carries the runtime the conversation was just started on, seen
 * only on the very first open (the drafts list answers on every later visit).
 */
import { useLocalSearchParams } from "expo-router";
import { BuilderWorkspace } from "@/components/agent/builder-workspace";

export default function BuilderSessionPage() {
  const params = useLocalSearchParams<{ sessionId: string; runtime?: string }>();
  const sessionId = Array.isArray(params.sessionId)
    ? params.sessionId[0]
    : params.sessionId;
  const startedRuntimeId = Array.isArray(params.runtime)
    ? params.runtime[0]
    : params.runtime;

  if (!sessionId) return null;
  return (
    <BuilderWorkspace
      // Remount per conversation: the draft, the applied-message marker and
      // the composer all belong to one conversation, and a remount is the
      // only reset that cannot forget a field (web builder-workspace.tsx).
      key={sessionId}
      sessionId={sessionId}
      startedRuntimeId={startedRuntimeId ?? ""}
    />
  );
}