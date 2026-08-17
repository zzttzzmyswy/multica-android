import { describe, expect, it, vi } from "vitest";
import type { ChatSession } from "@multica/core/types";
import { sortChatSessions } from "./chat";

// chat.ts imports the native fetch client at module scope (chatSessionsOptions
// calls api.listChatSessions). Mock it so the Node test never loads RN
// modules — sortChatSessions itself is a pure function.
vi.mock("@/data/api", () => ({ api: {} }));

function session(over: Partial<ChatSession> & { id: string }): ChatSession {
  return {
    workspace_id: "ws-1",
    agent_id: "agent-1",
    creator_id: "user-1",
    title: "session",
    status: "active",
    has_unread: false,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...over,
  };
}

describe("sortChatSessions", () => {
  it("puts pinned sessions before unpinned ones regardless of activity", () => {
    const pinnedOld = session({ id: "pinned-old", pinned: true, updated_at: "2026-01-01T00:00:00Z" });
    const unpinnedNew = session({ id: "unpinned-new", pinned: false, updated_at: "2026-06-01T00:00:00Z" });
    expect(sortChatSessions([unpinnedNew, pinnedOld]).map((s) => s.id)).toEqual([
      "pinned-old",
      "unpinned-new",
    ]);
  });

  it("sorts unpinned sessions by most-recent activity (newest first)", () => {
    const a = session({ id: "a", updated_at: "2026-08-01T00:00:00Z" });
    const b = session({ id: "b", updated_at: "2026-08-05T00:00:00Z" });
    const c = session({ id: "c", updated_at: "2026-08-03T00:00:00Z" });
    expect(sortChatSessions([a, b, c]).map((s) => s.id)).toEqual(["b", "c", "a"]);
  });

  it("is stable for equal activity keys (server order preserved)", () => {
    const a = session({ id: "a", updated_at: "2026-08-01T00:00:00Z" });
    const b = session({ id: "b", updated_at: "2026-08-01T00:00:00Z" });
    const c = session({ id: "c", updated_at: "2026-08-01T00:00:00Z" });
    expect(sortChatSessions([c, a, b]).map((s) => s.id)).toEqual(["c", "a", "b"]);
  });

  it("returns a new array and never mutates the input", () => {
    const list = [
      session({ id: "old", updated_at: "2026-01-01T00:00:00Z" }),
      session({ id: "new", updated_at: "2026-08-01T00:00:00Z" }),
    ];
    const input = [...list];
    const out = sortChatSessions(list);
    expect(out).not.toBe(list);
    expect(list).toEqual(input);
  });

  it("defaults a missing pinned flag to false (older server rows)", () => {
    const a = session({ id: "a", updated_at: "2026-01-01T00:00:00Z" });
    const b = session({ id: "b", updated_at: "2026-06-01T00:00:00Z" });
    expect(sortChatSessions([a, b]).map((s) => s.id)).toEqual(["b", "a"]);
  });
});