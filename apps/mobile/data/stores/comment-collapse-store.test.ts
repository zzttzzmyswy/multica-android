import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Native-module mocks (Node vitest lane) ────────────────────────────────
// Same in-memory File shim the workbench-layout suite uses: the module is
// mocked, so the app's real expo-file-system native module never loads.
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

import * as fs from "expo-file-system";
import { useCommentCollapseStore } from "./comment-collapse-store";

const fileFor = (wsId: string) =>
  `file:///doc/multica-comment-collapse-${wsId}.json`;

beforeEach(() => {
  (fs as unknown as { __fsStore: Map<string, string> }).__fsStore.clear();
  useCommentCollapseStore.setState({ byWorkspace: {}, hydrated: {} });
});

describe("comment collapse store", () => {
  it("toggle folds and unfolds a single comment", () => {
    const { toggle, isCollapsed } = useCommentCollapseStore.getState();

    toggle("ws-1", "issue-1", "c1");
    expect(isCollapsed("ws-1", "issue-1", "c1")).toBe(true);
    expect(isCollapsed("ws-1", "issue-1", "c2")).toBe(false);

    toggle("ws-1", "issue-1", "c1");
    expect(isCollapsed("ws-1", "issue-1", "c1")).toBe(false);
    // A fully-unfolded issue leaves no entry behind.
    expect(useCommentCollapseStore.getState().byWorkspace["ws-1"]).toEqual({});
  });

  it("keeps issues and workspaces apart", () => {
    const { toggle, isCollapsed } = useCommentCollapseStore.getState();

    toggle("ws-1", "issue-1", "c1");
    toggle("ws-2", "issue-1", "c1");

    expect(isCollapsed("ws-1", "issue-1", "c1")).toBe(true);
    expect(isCollapsed("ws-2", "issue-1", "c1")).toBe(true);
    expect(isCollapsed("ws-1", "issue-2", "c1")).toBe(false);
    expect(isCollapsed("ws-3", "issue-1", "c1")).toBe(false);
  });

  it("persists each workspace to its own file", async () => {
    useCommentCollapseStore.getState().toggle("ws-1", "issue-1", "c1");
    useCommentCollapseStore.getState().toggle("ws-2", "issue-9", "c9");
    // Writes are chained; drain the chain before reading.
    await new Promise((r) => setTimeout(r, 0));

    const store = (fs as unknown as { __fsStore: Map<string, string> }).__fsStore;
    expect(JSON.parse(store.get(fileFor("ws-1"))!)).toEqual({
      "issue-1": ["c1"],
    });
    expect(JSON.parse(store.get(fileFor("ws-2"))!)).toEqual({
      "issue-9": ["c9"],
    });
  });

  it("hydrate reads the persisted folds back", async () => {
    const store = (fs as unknown as { __fsStore: Map<string, string> }).__fsStore;
    store.set(fileFor("ws-1"), JSON.stringify({ "issue-1": ["c1"] }));

    await useCommentCollapseStore.getState().hydrate("ws-1");

    expect(
      useCommentCollapseStore.getState().isCollapsed("ws-1", "issue-1", "c1"),
    ).toBe(true);
  });

  it("hydrate reads corrupt json as nothing folded", async () => {
    const store = (fs as unknown as { __fsStore: Map<string, string> }).__fsStore;
    store.set(fileFor("ws-1"), "{ not json");

    await useCommentCollapseStore.getState().hydrate("ws-1");

    expect(useCommentCollapseStore.getState().byWorkspace["ws-1"]).toEqual({});
  });

  it("hydrate does not clobber a fold made while the read was in flight", async () => {
    const store = (fs as unknown as { __fsStore: Map<string, string> }).__fsStore;
    store.set(fileFor("ws-1"), JSON.stringify({ "issue-1": ["from-disk"] }));

    const pending = useCommentCollapseStore.getState().hydrate("ws-1");
    useCommentCollapseStore.getState().toggle("ws-1", "issue-2", "typed-now");
    await pending;

    const state = useCommentCollapseStore.getState();
    expect(state.isCollapsed("ws-1", "issue-2", "typed-now")).toBe(true);
    expect(state.isCollapsed("ws-1", "issue-1", "from-disk")).toBe(false);
  });

  it("hydrate runs once per workspace", async () => {
    const store = (fs as unknown as { __fsStore: Map<string, string> }).__fsStore;
    store.set(fileFor("ws-1"), JSON.stringify({ "issue-1": ["c1"] }));
    await useCommentCollapseStore.getState().hydrate("ws-1");

    store.set(fileFor("ws-1"), JSON.stringify({ "issue-2": ["c2"] }));
    await useCommentCollapseStore.getState().hydrate("ws-1");

    expect(useCommentCollapseStore.getState().byWorkspace["ws-1"]).toEqual({
      "issue-1": ["c1"],
    });
  });
});
