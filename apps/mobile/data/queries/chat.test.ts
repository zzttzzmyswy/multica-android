import { describe, expect, it, vi } from "vitest";
import type { ChatSession } from "@multica/core/types";
import { sortChatSessions, splitChatSessions } from "./chat";

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

  it("ranks by last_message.created_at when present (web parity), falling back to updated_at", () => {
    const olderUpdated = session({
      id: "a",
      updated_at: "2026-08-10T00:00:00Z",
      last_message: {
        content: "old",
        role: "assistant",
        created_at: "2026-08-01T00:00:00Z",
      },
    });
    const newerMessage = session({
      id: "b",
      updated_at: "2026-08-05T00:00:00Z",
      last_message: {
        content: "new",
        role: "assistant",
        created_at: "2026-08-08T00:00:00Z",
      },
    });
    const noMessage = session({
      id: "c",
      updated_at: "2026-08-12T00:00:00Z",
    });
    // c (no last_message, fallback updated_at 08-12) ranks first; b's message
    // (08-08) outranks a's message (08-01) even though a's updated_at is
    // newer — message time wins when present, exactly like web.
    expect(sortChatSessions([olderUpdated, newerMessage, noMessage]).map((s) => s.id)).toEqual([
      "c",
      "b",
      "a",
    ]);
  });
});

describe("splitChatSessions", () => {
  it("splits on status: active fills history, archived fills archived", () => {
    const active = session({ id: "act-1", status: "active" });
    const archived = session({ id: "arch-1", status: "archived" });
    const active2 = session({ id: "act-2", status: "active" });
    const out = splitChatSessions([active, archived, active2]);
    expect(out.history.map((s) => s.id)).toEqual(["act-1", "act-2"]);
    expect(out.archived.map((s) => s.id)).toEqual(["arch-1"]);
  });

  it("sorts each bucket (pinned first, then activity)", () => {
    const pinned = session({ id: "p", pinned: true, updated_at: "2026-01-01T00:00:00Z" });
    const newActive = session({ id: "n", updated_at: "2026-08-01T00:00:00Z" });
    const archivedPinned = session({
      id: "ap",
      status: "archived",
      pinned: true,
      updated_at: "2026-05-01T00:00:00Z",
    });
    const archivedOld = session({
      id: "ao",
      status: "archived",
      updated_at: "2026-04-01T00:00:00Z",
    });
    const out = splitChatSessions([newActive, archivedOld, pinned, archivedPinned]);
    expect(out.history.map((s) => s.id)).toEqual(["p", "n"]);
    expect(out.archived.map((s) => s.id)).toEqual(["ap", "ao"]);
  });
});