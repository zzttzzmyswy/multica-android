/**
 * Persistence guard for the restore ledger (#5219).
 *
 * The ledger's whole reason to be persisted: it must survive the app being
 * killed between "the composer took the prompt" and "the server confirmed the
 * consume". If it does not, a restart re-offers a prompt the user already sent.
 *
 * Same in-memory `expo-file-system` mock as issue-create-settings-store.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-file-system", () => {
  const store = new Map<string, string>();
  return {
    __fsStore: store,
    File: class MockFile {
      uri: string;
      exists: boolean;
      constructor(...uris: Array<{ uri?: string } | string>) {
        this.uri = uris
          .map((u) =>
            typeof u === "string" ? u : (u as { uri?: string }).uri ?? "",
          )
          .join("/");
        this.exists = store.has(this.uri);
      }
      text(): Promise<string> {
        return Promise.resolve(store.get(this.uri) ?? "");
      }
      write(content: string): void {
        store.set(this.uri, content);
      }
      delete(): void {
        store.delete(this.uri);
        this.exists = false;
      }
    },
    Paths: { document: { uri: "file:///doc" } },
  };
});

import * as expoFileSystemModule from "expo-file-system";
const fsModule = expoFileSystemModule as unknown as {
  __fsStore: Map<string, string>;
};
import { useChatDraftRestoreStore } from "./chat-draft-restore-store";

const WS = "ws-1";
const FILE = `file:///doc/multica-chat-draft-restore-${WS}.json`;

function readFile(): { applied: string[]; queue: Record<string, unknown> } | undefined {
  const raw = fsModule.__fsStore.get(FILE);
  return raw ? (JSON.parse(raw) as never) : undefined;
}

/** Let the fire-and-forget persist chain settle. */
async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  fsModule.__fsStore.clear();
  useChatDraftRestoreStore.setState({
    appliedByWorkspace: {},
    queueByWorkspace: {},
    hydrated: {},
  });
});

describe("applied-restore ledger", () => {
  it("records an applied restore and writes it through to disk", async () => {
    useChatDraftRestoreStore.getState().markApplied(WS, "msg-1");
    await flush();
    expect(useChatDraftRestoreStore.getState().appliedByWorkspace[WS]).toEqual([
      "msg-1",
    ]);
    expect(readFile()?.applied).toEqual(["msg-1"]);
  });

  it("survives a restart — the loaded ledger suppresses the re-offer", async () => {
    useChatDraftRestoreStore.getState().markApplied(WS, "msg-1");
    await flush();

    // Simulate a cold start: fresh store, same file on disk.
    useChatDraftRestoreStore.setState({
      appliedByWorkspace: {},
      queueByWorkspace: {},
      hydrated: {},
    });
    await useChatDraftRestoreStore.getState().hydrate(WS);
    expect(useChatDraftRestoreStore.getState().appliedByWorkspace[WS]).toEqual([
      "msg-1",
    ]);
  });

  it("drops the entry only when the consume is confirmed", async () => {
    useChatDraftRestoreStore.getState().markApplied(WS, "msg-1");
    await flush();
    useChatDraftRestoreStore.getState().forgetApplied(WS, "msg-1");
    await flush();
    expect(useChatDraftRestoreStore.getState().appliedByWorkspace[WS]).toEqual([]);
    expect(readFile()?.applied).toEqual([]);
  });

  it("does not re-hydrate over entries recorded since the first read", async () => {
    // A restore recorded while the file read was in flight must not be
    // clobbered by the (stale) file contents — that would re-arm a sent prompt.
    await useChatDraftRestoreStore.getState().hydrate(WS);
    useChatDraftRestoreStore.getState().markApplied(WS, "fresh");
    await useChatDraftRestoreStore.getState().hydrate(WS);
    expect(useChatDraftRestoreStore.getState().appliedByWorkspace[WS]).toEqual([
      "fresh",
    ]);
  });

  it("degrades a corrupt ledger to empty rather than throwing", async () => {
    fsModule.__fsStore.set(FILE, "{not json");
    await useChatDraftRestoreStore.getState().hydrate(WS);
    expect(useChatDraftRestoreStore.getState().appliedByWorkspace[WS]).toEqual([]);
  });

  it("drops malformed rows from a persisted queue but keeps the good ones", async () => {
    fsModule.__fsStore.set(
      FILE,
      JSON.stringify({
        applied: [],
        queue: {
          "session-a": [
            { id: "r1", content: "keep", sessionId: "session-a" },
            { id: "r2", content: "no session" },
            "junk",
          ],
        },
      }),
    );
    await useChatDraftRestoreStore.getState().hydrate(WS);
    expect(
      useChatDraftRestoreStore.getState().queueByWorkspace[WS]["session-a"].map(
        (r) => r.id,
      ),
    ).toEqual(["r1"]);
  });
});

describe("server-less restore queue", () => {
  const restore = (id: string) => ({
    id,
    content: `text-${id}`,
    sessionId: "session-a",
  });

  it("queues and persists, so a failed send survives a restart", async () => {
    useChatDraftRestoreStore.getState().enqueue(WS, restore("r1"));
    await flush();
    expect(readFile()?.queue["session-a"]).toEqual([restore("r1")]);

    useChatDraftRestoreStore.setState({
      appliedByWorkspace: {},
      queueByWorkspace: {},
      hydrated: {},
    });
    await useChatDraftRestoreStore.getState().hydrate(WS);
    expect(
      useChatDraftRestoreStore.getState().queueByWorkspace[WS]["session-a"],
    ).toEqual([restore("r1")]);
  });

  it("drops the entry once its text is in the draft", async () => {
    useChatDraftRestoreStore.getState().enqueue(WS, restore("r1"));
    await flush();
    useChatDraftRestoreStore.getState().dequeue(WS, "session-a", "r1");
    await flush();
    expect(useChatDraftRestoreStore.getState().queueByWorkspace[WS]).toEqual({});
    expect(readFile()?.queue).toEqual({});
  });

  it("keeps the ledger and the queue in one file without clobbering each other", async () => {
    useChatDraftRestoreStore.getState().markApplied(WS, "applied-1");
    useChatDraftRestoreStore.getState().enqueue(WS, restore("r1"));
    await flush();
    useChatDraftRestoreStore.getState().dequeue(WS, "session-a", "r1");
    await flush();
    expect(readFile()).toEqual({ applied: ["applied-1"], queue: {} });
  });
});

describe("workspace scoping", () => {
  it("keeps two workspaces' ledgers apart", async () => {
    useChatDraftRestoreStore.getState().markApplied(WS, "msg-1");
    useChatDraftRestoreStore.getState().markApplied("ws-2", "msg-2");
    await flush();
    expect(useChatDraftRestoreStore.getState().appliedByWorkspace[WS]).toEqual([
      "msg-1",
    ]);
    expect(
      useChatDraftRestoreStore.getState().appliedByWorkspace["ws-2"],
    ).toEqual(["msg-2"]);
  });
});
