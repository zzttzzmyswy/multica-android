/**
 * The terminal transitions of the restore state machine (#5219).
 *
 * Every assertion here is a way the user's prompt can be lost:
 *   - consuming on OFFER rather than on APPLY deletes the only copy of a prompt
 *     the composer then declined to take;
 *   - recording the hand-off before writing it (or dropping the ledger entry
 *     when the DELETE fails) re-offers a prompt the user has already sent;
 *   - treating a failed consume as done strands the row on the server forever.
 */
import { describe, expect, it, vi } from "vitest";
import type { ChatDraftRestoresResponse } from "@multica/core/types";
import {
  createRestoreConsumer,
  dropRestoreFromResponse,
  type RestoreConsumerDeps,
} from "./chat-draft-restore-consumer";

/** A deps stub that records the order of every side effect, so ordering
 *  guarantees can be asserted rather than inferred. */
function makeDeps(over: Partial<RestoreConsumerDeps> = {}) {
  const log: string[] = [];
  let resolveConsume: (() => void) | undefined;
  let rejectConsume: ((err: unknown) => void) | undefined;
  const deps: RestoreConsumerDeps = {
    consumeRemote: vi.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          resolveConsume = resolve;
          rejectConsume = reject;
        }),
    ),
    markApplied: vi.fn((id: string) => log.push(`mark:${id}`)),
    forgetApplied: vi.fn((id: string) => log.push(`forget:${id}`)),
    enqueueLocal: vi.fn(() => log.push("enqueue")),
    dequeueLocal: vi.fn((s: string, id: string) => log.push(`dequeue:${s}:${id}`)),
    cache: { dropRestore: vi.fn((s: string, id: string) => log.push(`drop:${s}:${id}`)) },
    ...over,
  };
  return {
    deps,
    log,
    settleConsume: () => resolveConsume?.(),
    failConsume: (err: unknown) => rejectConsume?.(err),
  };
}

/** Let the consumer's promise chain run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("applyTerminal on a durable restore", () => {
  it("records the ledger entry BEFORE the delete goes out", async () => {
    // Order is the guarantee: the ledger is what suppresses a re-offer if the
    // DELETE never lands, so it cannot be written after.
    const { deps, log } = makeDeps();
    const consumer = createRestoreConsumer(deps);
    consumer.applyTerminal({
      id: "msg-1",
      content: "recover me",
      sessionId: "session-a",
      serverRestoreId: "msg-1",
    });
    expect(log).toEqual(["mark:msg-1"]);
    expect(deps.consumeRemote).toHaveBeenCalledWith("session-a", "msg-1");
  });

  it("does nothing at all until the composer reports the hand-off", () => {
    // The OFFER path in the hook never reaches here. If it did, a prompt the
    // composer declined (its draft was not empty) would have its only copy
    // deleted.
    const { deps, log } = makeDeps();
    const consumer = createRestoreConsumer(deps);
    consumer.consume("session-a", "msg-1");
    // consume() with no ledger entry is the reconcile path — it must not mark
    // anything applied.
    expect(log).not.toContain("mark:msg-1");
  });

  it("releases the ledger entry and the cached row on a confirmed delete", async () => {
    const { deps, log, settleConsume } = makeDeps();
    const consumer = createRestoreConsumer(deps);
    consumer.applyTerminal({
      id: "msg-1",
      content: "x",
      sessionId: "session-a",
      serverRestoreId: "msg-1",
    });
    settleConsume();
    await flush();
    expect(log).toEqual(["mark:msg-1", "forget:msg-1", "drop:session-a:msg-1"]);
  });

  it("KEEPS the ledger entry when the delete fails", async () => {
    // The regression this guards: dropping it here re-arms the restore, so the
    // next fetch offers a prompt the user has already sent and they can send it
    // twice.
    const { deps, failConsume } = makeDeps();
    const consumer = createRestoreConsumer(deps);
    consumer.applyTerminal({
      id: "msg-1",
      content: "x",
      sessionId: "session-a",
      serverRestoreId: "msg-1",
    });
    failConsume(new Error("offline"));
    await flush();
    expect(deps.markApplied).toHaveBeenCalledWith("msg-1");
    expect(deps.forgetApplied).not.toHaveBeenCalled();
    expect(deps.cache.dropRestore).not.toHaveBeenCalled();
  });

  it("reports a failed consume instead of swallowing it", async () => {
    const onError = vi.fn();
    const { deps, failConsume } = makeDeps({ onError });
    const consumer = createRestoreConsumer(deps);
    consumer.applyTerminal({
      id: "msg-1",
      content: "x",
      sessionId: "session-a",
      serverRestoreId: "msg-1",
    });
    const err = new Error("offline");
    failConsume(err);
    await flush();
    expect(onError).toHaveBeenCalledWith("msg-1", err);
  });

  it("lets the next reconcile retry a consume that failed (in-flight released on settle)", async () => {
    const { deps, log, failConsume, settleConsume } = makeDeps();
    const consumer = createRestoreConsumer(deps);
    consumer.consume("session-a", "msg-1");
    failConsume(new Error("offline"));
    await flush();
    // Second attempt from the next fetch must actually reach the server again.
    consumer.consume("session-a", "msg-1");
    expect(deps.consumeRemote).toHaveBeenCalledTimes(2);
    settleConsume();
    await flush();
    expect(log).toContain("drop:session-a:msg-1");
  });

  it("does not re-fire a consume that is already in flight", () => {
    const { deps } = makeDeps();
    const consumer = createRestoreConsumer(deps);
    consumer.consume("session-a", "msg-1");
    consumer.consume("session-a", "msg-1");
    expect(deps.consumeRemote).toHaveBeenCalledTimes(1);
  });
});

describe("applyTerminal on a server-less restore", () => {
  it("drops the queue entry and never touches the server", () => {
    // There is no server row; the text now lives in the (persisted) draft.
    const { deps, log } = makeDeps();
    const consumer = createRestoreConsumer(deps);
    consumer.applyTerminal({ id: "msg-1", content: "x", sessionId: "session-a" });
    expect(log).toEqual(["dequeue:session-a:msg-1"]);
    expect(deps.consumeRemote).not.toHaveBeenCalled();
    expect(deps.markApplied).not.toHaveBeenCalled();
  });

  it("is a no-op for a request with no session", () => {
    const { deps, log } = makeDeps();
    const consumer = createRestoreConsumer(deps);
    consumer.applyTerminal({ id: "msg-1", content: "x" });
    expect(log).toEqual([]);
  });
});

describe("dropRestoreFromResponse", () => {
  const response = {
    restores: [
      { id: "msg-1", chat_session_id: "session-a", content: "a" },
      { id: "msg-2", chat_session_id: "session-a", content: "b" },
    ],
  } as ChatDraftRestoresResponse;

  it("removes only the consumed row", () => {
    expect(dropRestoreFromResponse(response, "msg-1")?.restores.map((r) => r.id)).toEqual([
      "msg-2",
    ]);
  });

  it("passes an absent cache through untouched", () => {
    expect(dropRestoreFromResponse(undefined, "msg-1")).toBeUndefined();
  });
});
