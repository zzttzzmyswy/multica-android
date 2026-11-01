/**
 * Pins for the chat-history pagination helpers.
 *
 * The interesting cases are the two that decide whether the "load older" row
 * can spin forever (a page that claims more but carries no cursor) and
 * whether a redundant load re-renders the whole list (identity of the
 * returned array when nothing new arrived).
 */
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@multica/core/types";
import {
  EMPTY_CHAT_MESSAGES_PAGE_STATE,
  isSessionRunning,
  mergeNewestMessages,
  mergeOlderMessages,
  pageStateFrom,
} from "./chat-message-page";

function msg(id: string, createdAt = "2026-09-20T10:00:00+08:00"): ChatMessage {
  return {
    id,
    chat_session_id: "s1",
    role: "user",
    content: id,
    task_id: null,
    created_at: createdAt,
  };
}

describe("pageStateFrom", () => {
  it("follows a page that has more and hands back a cursor", () => {
    const state = pageStateFrom({
      has_more: true,
      next_cursor: { created_at: "2026-09-20T10:00:00+08:00", id: "a" },
    });
    expect(state.hasMore).toBe(true);
    expect(state.cursor).toEqual({
      created_at: "2026-09-20T10:00:00+08:00",
      id: "a",
    });
  });

  it("stops when the page is the oldest one", () => {
    const state = pageStateFrom({ has_more: false, next_cursor: null });
    expect(state).toEqual(EMPTY_CHAT_MESSAGES_PAGE_STATE);
  });

  it("refuses to follow has_more with no cursor — an unfollowable page", () => {
    // Otherwise the loading row would re-fire on every scroll-to-top against
    // a request that can never advance.
    const state = pageStateFrom({ has_more: true, next_cursor: null });
    expect(state.hasMore).toBe(false);
    expect(state.cursor).toBeNull();
  });

  it("treats an omitted cursor the same as a null one", () => {
    // The server omits `next_cursor` entirely (`omitempty`) rather than
    // sending null, so the wire shape has to be accepted too.
    const state = pageStateFrom({ has_more: false });
    expect(state).toEqual(EMPTY_CHAT_MESSAGES_PAGE_STATE);
  });
});

describe("mergeOlderMessages", () => {
  it("prepends the older page ahead of the live window", () => {
    const prev = [msg("c"), msg("d")];
    const older = [msg("a"), msg("b")];
    expect(mergeOlderMessages(prev, older).map((m) => m.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("drops rows already in the window — the cursor tie at the boundary", () => {
    const prev = [msg("b"), msg("c")];
    const older = [msg("a"), msg("b")];
    expect(mergeOlderMessages(prev, older).map((m) => m.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("returns the same array when the page adds nothing", () => {
    const prev = [msg("a")];
    expect(mergeOlderMessages(prev, [])).toBe(prev);
    expect(mergeOlderMessages(prev, [msg("a")])).toBe(prev);
  });

  it("does not mutate the window it was given", () => {
    const prev = [msg("b")];
    mergeOlderMessages(prev, [msg("a")]);
    expect(prev.map((m) => m.id)).toEqual(["b"]);
  });
});

describe("mergeNewestMessages", () => {
  it("appends the new tail while keeping already-loaded history", () => {
    // The regression this guards: a finished turn re-fetches the newest page,
    // which carries only the tail. Replacing would silently throw away every
    // page the reader had already pulled in.
    const loaded = [msg("a"), msg("b"), msg("c")];
    const page = [msg("b"), msg("c"), msg("d")];
    expect(mergeNewestMessages(loaded, page).map((m) => m.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("re-sorts when the tail interleaves with loaded history", () => {
    const loaded = [msg("a", "2026-09-20T10:00:00+08:00")];
    const page = [
      msg("c", "2026-09-20T10:02:00+08:00"),
      msg("b", "2026-09-20T10:01:00+08:00"),
    ];
    expect(mergeNewestMessages(loaded, page).map((m) => m.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("returns the same array when the page adds nothing", () => {
    const loaded = [msg("a")];
    expect(mergeNewestMessages(loaded, [])).toBe(loaded);
    expect(mergeNewestMessages(loaded, [msg("a")])).toBe(loaded);
  });

  // MYS-2534. The id-dedupe above treats "already known" as "nothing to do",
  // which is only sound for fields the cache cannot be behind on. Attachments
  // are exactly the opposite: they are bound to the message by a SECOND server
  // write (LinkAttachmentsToChatMessage) that commits after the row the
  // optimistic send + WS echo already put in the cache. So the cached copy of
  // a just-sent image message has `attachments: undefined` forever, and the
  // refetch that would have carried them is discarded here — the bubble renders
  // text only, while the agent (which reads them server-side) sees the image.
  it("refreshes a known row when the page carries data the cache lacks", () => {
    const attachment = {
      id: "att-1",
      filename: "photo.jpg",
      url: "https://example.test/photo.jpg",
      download_url: "/api/attachments/att-1/download",
      markdown_url: "https://example.test/photo.jpg",
      content_type: "image/jpeg",
      size_bytes: 1024,
    } as never;
    const cached: ChatMessage = { ...msg("a"), attachments: undefined };
    const fromServer: ChatMessage = { ...msg("a"), attachments: [attachment] };

    const merged = mergeNewestMessages([cached], [fromServer]);

    expect(merged).toHaveLength(1);
    expect(merged[0].attachments).toEqual([attachment]);
  });

  // The complement, and the reason this cannot be "always take the server
  // copy": an optimistic row carries client-only fields the server never
  // sends, and a refetch must not blank them.
  it("keeps cached client-only fields the page cannot know about", () => {
    const cached: ChatMessage = {
      ...msg("a"),
      elapsed_ms: 4200,
      message_kind: "message",
    };

    const merged = mergeNewestMessages([cached], [{ ...msg("a") }]);

    expect(merged[0].elapsed_ms).toBe(4200);
    expect(merged[0].message_kind).toBe("message");
  });

  it("still returns the same array when a known row brings nothing new", () => {
    const loaded = [{ ...msg("a"), attachments: [] }];
    expect(
      mergeNewestMessages(loaded, [{ ...msg("a"), attachments: [] }]),
    ).toBe(loaded);
  });
});

describe("isSessionRunning", () => {
  it("is true when the session has an in-flight task", () => {
    expect(isSessionRunning([{ chat_session_id: "s1" }], "s1")).toBe(true);
  });

  it("is false for a different session", () => {
    expect(isSessionRunning([{ chat_session_id: "s2" }], "s1")).toBe(false);
  });

  it("is false before the aggregate has loaded", () => {
    expect(isSessionRunning(undefined, "s1")).toBe(false);
    expect(isSessionRunning([], "s1")).toBe(false);
  });
});
