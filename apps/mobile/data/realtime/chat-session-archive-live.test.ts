/**
 * Live replay (MYS-2183) — driven by `iter250-live-probe.py`, which captures a
 * real `chat:session_updated` frame from mu.zztweb.top and hands it in via env.
 *
 * Not part of the standing suite: with no `ITER250_FRAME` set it skips, so a
 * plain `vitest run` stays hermetic. When the env IS set it replays the captured
 * bytes through the app's own patcher and asserts the resulting row agrees with
 * what `GET /api/chat/sessions?status=all` reports for the same session — the
 * phone's row and the server's row saying the same thing, which is the whole
 * point of the fix.
 */
import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { ChatSession } from "@multica/core/types";
import { chatKeys, splitChatSessions } from "@/data/queries/chat";
import { patchSessionListAfterUpdate } from "./chat-ws-updaters";

// data/queries/chat.ts transitively imports the native fetch client; mock it so
// the Node lane never loads RN modules.
vi.mock("@/data/api", () => ({ api: {} }));

const FRAME = process.env.ITER250_FRAME;
const SERVER_ROW = process.env.ITER250_SERVER_ROW;
const WS = "ws-live";

function session(over: Partial<ChatSession> & { id: string }): ChatSession {
  return {
    workspace_id: WS,
    agent_id: "agent-1",
    creator_id: "user-1",
    title: over.id,
    status: "active",
    has_unread: false,
    unread_count: 0,
    pinned: false,
    created_at: "2026-10-15T00:00:00Z",
    updated_at: "2026-10-15T00:00:00Z",
    last_message: null,
    ...over,
  } as ChatSession;
}

describe.skipIf(!FRAME || !SERVER_ROW)("live archive frame replay", () => {
  it("the phone's row after the real frame matches the server's row", () => {
    const payload = JSON.parse(FRAME!) as { chat_session_id: string };
    const server = JSON.parse(SERVER_ROW!) as {
      status: string;
      unread_count: number;
      project_id: string | null;
    };

    const qc = new QueryClient();
    // Seed the cache the way the phone holds it BEFORE the other device acts:
    // the row is active, carrying unread replies.
    qc.setQueryData<ChatSession[]>(chatKeys.sessions(WS), [
      session({
        id: payload.chat_session_id,
        has_unread: true,
        unread_count: 3,
      }),
    ]);

    patchSessionListAfterUpdate(qc, WS, payload);

    const rows = qc.getQueryData<ChatSession[]>(chatKeys.sessions(WS))!;
    const row = rows[0]!;
    const buckets = splitChatSessions(rows);

    console.log("ITER250 replay — phone row:", JSON.stringify({
      status: row.status,
      unread_count: row.unread_count,
      has_unread: row.has_unread,
      bucket: buckets.archived.length === 1 ? "archived" : "history",
    }));
    console.log("ITER250 replay — server row:", JSON.stringify(server));

    expect(row.status).toBe(server.status);
    expect(row.unread_count).toBe(server.unread_count);
    expect(row.has_unread).toBe(false);
    // Server says archived → the row must have left the history bucket.
    expect(buckets.archived.map((s) => s.id)).toEqual([payload.chat_session_id]);
    expect(buckets.history).toHaveLength(0);
  });
});
