import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Native-module mocks (Node vitest lane) ────────────────────────────────

vi.mock("expo-file-system", () => {
  // The in-memory backing store ships through the mocked module so tests can
  // seed / reset it (vi.mock factories are hoisted — no top-level refs).
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

vi.mock("expo-sharing", () => ({
  shareAsync: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/data/api", () => {
  class MockApiError extends Error {
    readonly status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  }
  class MockDownloadCancelledError extends Error {
    constructor() {
      super("Download cancelled");
      this.name = "DownloadCancelledError";
    }
  }
  return {
    ApiError: MockApiError,
    DownloadCancelledError: MockDownloadCancelledError,
    api: {
      createDownloadTask: vi.fn(),
    },
  };
});

import { api, DownloadCancelledError } from "@/data/api";
import * as Sharing from "expo-sharing";
import { useDownloadsStore } from "./downloads-store";

// `__fsStore` is a test-only export injected by the expo-file-system mock,
// so the import does not exist in the real module's typings.
// @ts-expect-error mock-only export
import { __fsStore as fileStore } from "expo-file-system";

const mockedCreate = vi.mocked(api.createDownloadTask);
const mockedShare = vi.mocked(Sharing.shareAsync);

interface DownloadHandle {
  done: Promise<{ uri: string; name: string }>;
  cancel: () => void;
}

function handleWith(done: DownloadHandle["done"]): DownloadHandle {
  return { done, cancel: vi.fn() };
}

/** Wait for microtasks + one macrotask so the native-task promise chain
 *  settles. */
async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

const URL = "https://mu.zztweb.top/api/attachments/abc/download";
const SOURCE = { kind: "issue", name: "修复登录" } as const;

beforeEach(() => {
  fileStore.clear();
  mockedCreate.mockReset();
  mockedShare.mockReset();
  useDownloadsStore.setState({ tasks: [], hydrated: false });
});

describe("downloads-store lifecycle", () => {
  it("begins a task, completes it and presents the share sheet", async () => {
    mockedCreate.mockReturnValue(
      handleWith(Promise.resolve({ uri: "file:///doc/x.pdf", name: "x.pdf" })),
    );

    const { id } = await useDownloadsStore.getState().downloadAndOpen(
      URL,
      "x.pdf",
      "application/pdf",
      SOURCE,
    );

    expect(mockedCreate).toHaveBeenCalledTimes(1);
    expect(mockedCreate.mock.calls[0][0]).toBe(URL);

    await flush();
    expect(useDownloadsStore.getState().tasks[0]).toMatchObject({
      id,
      status: "completed",
      progress: 1,
      filename: "x.pdf",
      localUri: "file:///doc/x.pdf",
    });
    expect(mockedShare).toHaveBeenCalledWith("file:///doc/x.pdf", {
      mimeType: "application/pdf",
    });
  });

  it("forwards progress updates into the task row", async () => {
    // A download that never settles — keeps the row in `downloading` so the
    // progress write is observable before a terminal transition.
    mockedCreate.mockImplementation((_url, _name, onProgress) => {
      onProgress?.({
        totalBytesWritten: 25,
        totalBytesExpectedToWrite: 100,
      });
      return handleWith(new Promise(() => {}));
    });

    await useDownloadsStore.getState().downloadAndOpen(URL, "x.pdf", undefined, SOURCE);
    expect(useDownloadsStore.getState().tasks[0]).toMatchObject({
      status: "downloading",
      progress: 0.25,
      totalBytes: 100,
    });
  });

  it("marks a failed download (ApiError message stored), no share sheet", async () => {
    mockedCreate.mockReturnValue(
      handleWith(Promise.reject(new Error("boom"))),
    );
    const { id } = await useDownloadsStore.getState().downloadAndOpen(
      URL,
      "x.pdf",
      undefined,
      SOURCE,
    );
    await flush();

    expect(useDownloadsStore.getState().tasks[0]).toMatchObject({
      id,
      status: "failed",
      error: "boom",
    });
    expect(mockedShare).not.toHaveBeenCalled();
  });

  it("records user cancellation as cancelled, not failed", async () => {
    let resolveDone!: (v: { uri: string; name: string }) => void;
    const cancel = vi.fn();
    mockedCreate.mockReturnValue({
      done: new Promise((r) => (resolveDone = r)),
      cancel,
    });

    const { id } = await useDownloadsStore.getState().downloadAndOpen(
      URL,
      "x.pdf",
      undefined,
      SOURCE,
    );
    await useDownloadsStore.getState().cancel(id);

    expect(cancel).toHaveBeenCalled();
    expect(useDownloadsStore.getState().tasks[0]).toMatchObject({
      id,
      status: "cancelled",
    });

    // The native task settles with a result afterwards — the store must not
    // flip the cancelled row.
    resolveDone({ uri: "file:///doc/x.pdf", name: "x.pdf" });
    await flush();
    expect(useDownloadsStore.getState().tasks[0].status).toBe("cancelled");
  });

  it("treats a native DownCancelled rejection as cancelled", async () => {
    mockedCreate.mockReturnValue(
      handleWith(Promise.reject(new DownloadCancelledError())),
    );
    const { id } = await useDownloadsStore.getState().downloadAndOpen(
      URL,
      "x.pdf",
      undefined,
      SOURCE,
    );
    await flush();

    expect(useDownloadsStore.getState().tasks[0]).toMatchObject({
      id,
      status: "cancelled",
    });
  });

  it("dedups a same-URL+name download already in flight", async () => {
    mockedCreate.mockReturnValue(
      handleWith(new Promise(() => {})), // stays downloading forever
    );

    const first = await useDownloadsStore.getState().downloadAndOpen(URL, "x.pdf");
    const second = await useDownloadsStore.getState().downloadAndOpen(URL, "x.pdf");

    expect(second.id).toBe(first.id);
    expect(mockedCreate).toHaveBeenCalledTimes(1);
    expect(useDownloadsStore.getState().tasks).toHaveLength(1);
  });

  it("retry re-enqueues a fresh downloading task with the same source", async () => {
    mockedCreate
      .mockReturnValueOnce(handleWith(Promise.reject(new Error("boom"))))
      .mockReturnValue(handleWith(new Promise(() => {}))); // stays downloading
    const first = await useDownloadsStore.getState().downloadAndOpen(
      URL,
      "y.txt",
      undefined,
      SOURCE,
    );
    await flush();
    expect(useDownloadsStore.getState().tasks[0].status).toBe("failed");

    await useDownloadsStore.getState().retry(first.id);
    await flush();

    const tasks = useDownloadsStore.getState().tasks;
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({ status: "downloading", source: SOURCE });
    expect(tasks[0].id).not.toBe(first.id);
    expect(mockedCreate).toHaveBeenCalledTimes(2);
  });

  it("removeTask drops the row", async () => {
    mockedCreate.mockReturnValue(
      handleWith(Promise.resolve({ uri: "file:///doc/z.png", name: "z.png" })),
    );
    const { id } = await useDownloadsStore.getState().downloadAndOpen(
      URL,
      "z.png",
      undefined,
      SOURCE,
    );
    await flush();
    await useDownloadsStore.getState().removeTask(id);
    expect(useDownloadsStore.getState().tasks).toHaveLength(0);
  });
});

describe("downloads-store persistence", () => {
  it("hydrates persisted history and downgrades mid-flight rows", async () => {
    const persisted = JSON.stringify([
      {
        id: "old-complete",
        filename: "a.pdf",
        url: URL,
        source: { kind: "chat" },
        status: "completed",
        progress: 1,
        totalBytes: 10,
        createdAt: 1,
        completedAt: 2,
        localUri: "file:///doc/a.pdf",
      },
      {
        id: "old-crashed",
        filename: "b.pdf",
        url: URL,
        source: { kind: "issue" },
        status: "downloading",
        progress: 0.4,
        totalBytes: 10,
        createdAt: 1,
      },
    ]);
    fileStore.set("file:///doc/download-store.json", persisted);

    useDownloadsStore.getState().hydrate();
    await flush();

    const tasks = useDownloadsStore.getState().tasks;
    expect(tasks).toHaveLength(2);
    const crashed = tasks.find((t) => t.id === "old-crashed");
    expect(crashed).toMatchObject({ status: "failed" });
    expect(crashed?.error).toBe("interrupted");
    const completed = tasks.find((t) => t.id === "old-complete");
    expect(completed).toMatchObject({ status: "completed" });
  });

  it("writes history to the file after mutations", async () => {
    mockedCreate.mockReturnValue(
      handleWith(Promise.resolve({ uri: "file:///doc/w.txt", name: "w.txt" })),
    );
    await useDownloadsStore.getState().downloadAndOpen(URL, "w.txt");
    await flush(); // let the persist chain flush

    const raw = fileStore.get("file:///doc/download-store.json");
    expect(raw).toBeTruthy();
    const tasks = JSON.parse(raw!);
    expect(tasks[0]).toMatchObject({ filename: "w.txt", status: "completed" });
  });

  it("rejects non-array / corrupt history gracefully", async () => {
    fileStore.set("file:///doc/download-store.json", "{not json");
    useDownloadsStore.getState().hydrate();
    await flush();
    expect(useDownloadsStore.getState().tasks).toEqual([]);
    expect(useDownloadsStore.getState().hydrated).toBe(true);
  });
});