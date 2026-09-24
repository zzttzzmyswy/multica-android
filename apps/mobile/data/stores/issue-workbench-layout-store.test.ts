import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Native-module mocks (Node vitest lane) ────────────────────────────────
// Same in-memory File shim the downloads-store suite uses: the module is
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
import {
  defaultWorkbenchLayout,
  LIST_BUCKET,
  swimlaneBucket,
  useWorkbenchLayoutStore,
} from "./issue-workbench-layout-store";

const fsStore = (fs as unknown as { __fsStore: Map<string, string> })
  .__fsStore;
const FILE = "file:///doc/multica-workbench-layout-ws1.json";

/** Wait for the store's persist chain (a promise chain, not a timer). */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function reset() {
  fsStore.clear();
  useWorkbenchLayoutStore.setState({ byWorkspace: {}, hydrated: {} });
}

beforeEach(reset);

describe("workbench layout store — folding", () => {
  it("folds and unfolds a key in one bucket", () => {
    const { toggleCollapsed } = useWorkbenchLayoutStore.getState();
    toggleCollapsed("ws1", LIST_BUCKET, "todo");
    expect(
      useWorkbenchLayoutStore.getState().byWorkspace.ws1?.collapsed[LIST_BUCKET],
    ).toEqual(["todo"]);
    toggleCollapsed("ws1", LIST_BUCKET, "todo");
    expect(
      useWorkbenchLayoutStore.getState().byWorkspace.ws1?.collapsed[LIST_BUCKET],
    ).toBeUndefined();
  });

  it("keeps swimlane buckets independent per grouping", () => {
    const { toggleCollapsed } = useWorkbenchLayoutStore.getState();
    toggleCollapsed("ws1", swimlaneBucket("assignee"), "assignee:agent:a1");
    toggleCollapsed("ws1", swimlaneBucket("project"), "project:p1");
    const collapsed =
      useWorkbenchLayoutStore.getState().byWorkspace.ws1?.collapsed;
    expect(collapsed?.["swimlane:assignee"]).toEqual(["assignee:agent:a1"]);
    expect(collapsed?.["swimlane:project"]).toEqual(["project:p1"]);
  });

  it("does not touch another workspace's layout", () => {
    useWorkbenchLayoutStore
      .getState()
      .toggleCollapsed("ws1", LIST_BUCKET, "todo");
    expect(
      useWorkbenchLayoutStore.getState().byWorkspace.ws2,
    ).toBeUndefined();
  });
});

describe("workbench layout store — lane order", () => {
  it("stores one order per grouping", () => {
    const { setLaneOrder } = useWorkbenchLayoutStore.getState();
    setLaneOrder("ws1", "project", ["p2", "p1"]);
    setLaneOrder("ws1", "assignee", ["agent:a1"]);
    const orders = useWorkbenchLayoutStore.getState().byWorkspace.ws1?.laneOrders;
    expect(orders?.project).toEqual(["p2", "p1"]);
    expect(orders?.assignee).toEqual(["agent:a1"]);
    expect(orders?.parent).toBeUndefined();
  });

  it("copies the incoming array so later mutation cannot leak in", () => {
    const order = ["p1", "p2"];
    useWorkbenchLayoutStore.getState().setLaneOrder("ws1", "project", order);
    order.push("p3");
    expect(
      useWorkbenchLayoutStore.getState().byWorkspace.ws1?.laneOrders.project,
    ).toEqual(["p1", "p2"]);
  });
});

describe("workbench layout store — persistence", () => {
  it("writes the layout to the workspace's own file", async () => {
    useWorkbenchLayoutStore
      .getState()
      .toggleCollapsed("ws1", LIST_BUCKET, "todo");
    await flush();
    expect(JSON.parse(fsStore.get(FILE)!)).toEqual({
      collapsed: { [LIST_BUCKET]: ["todo"] },
      laneOrders: {},
    });
  });

  it("keeps one file per workspace", async () => {
    useWorkbenchLayoutStore
      .getState()
      .toggleCollapsed("ws1", LIST_BUCKET, "todo");
    useWorkbenchLayoutStore
      .getState()
      .toggleCollapsed("ws2", LIST_BUCKET, "done");
    await flush();
    expect([...fsStore.keys()].sort()).toEqual([
      "file:///doc/multica-workbench-layout-ws1.json",
      "file:///doc/multica-workbench-layout-ws2.json",
    ]);
  });

  it("hydrates a persisted layout back", async () => {
    fsStore.set(
      FILE,
      JSON.stringify({
        collapsed: { [LIST_BUCKET]: ["todo"] },
        laneOrders: { project: ["p2", "p1"] },
      }),
    );
    await useWorkbenchLayoutStore.getState().hydrate("ws1");
    const layout = useWorkbenchLayoutStore.getState().byWorkspace.ws1;
    expect(layout?.collapsed[LIST_BUCKET]).toEqual(["todo"]);
    expect(layout?.laneOrders.project).toEqual(["p2", "p1"]);
  });

  it("reads a corrupt file as the default layout", async () => {
    fsStore.set(FILE, "{not json");
    await useWorkbenchLayoutStore.getState().hydrate("ws1");
    expect(useWorkbenchLayoutStore.getState().byWorkspace.ws1).toEqual(
      defaultWorkbenchLayout(),
    );
  });

  it("drops unknown groupings from a persisted lane order", async () => {
    fsStore.set(
      FILE,
      JSON.stringify({ collapsed: {}, laneOrders: { nonsense: ["a"] } }),
    );
    await useWorkbenchLayoutStore.getState().hydrate("ws1");
    expect(
      useWorkbenchLayoutStore.getState().byWorkspace.ws1?.laneOrders,
    ).toEqual({});
  });

  it("keeps collapsed buckets it does not recognise", async () => {
    // A bucket written by a newer build must survive a downgrade rather than
    // be silently deleted — the bucket namespace is open by design.
    fsStore.set(
      FILE,
      JSON.stringify({ collapsed: { "swimlane:property:x": ["a"] } }),
    );
    await useWorkbenchLayoutStore.getState().hydrate("ws1");
    expect(
      useWorkbenchLayoutStore.getState().byWorkspace.ws1?.collapsed[
        "swimlane:property:x"
      ],
    ).toEqual(["a"]);
  });

  it("never clobbers a fold made while the file read was in flight", async () => {
    fsStore.set(FILE, JSON.stringify({ collapsed: { [LIST_BUCKET]: ["todo"] } }));
    const hydrate = useWorkbenchLayoutStore.getState().hydrate("ws1");
    // The read is async; a user fold lands before it resolves.
    useWorkbenchLayoutStore
      .getState()
      .toggleCollapsed("ws1", LIST_BUCKET, "done");
    await hydrate;
    expect(
      useWorkbenchLayoutStore.getState().byWorkspace.ws1?.collapsed[LIST_BUCKET],
    ).toEqual(["done"]);
  });

  it("dedupes a concurrent hydrate to one read", async () => {
    fsStore.set(FILE, JSON.stringify({ collapsed: { [LIST_BUCKET]: ["todo"] } }));
    await Promise.all([
      useWorkbenchLayoutStore.getState().hydrate("ws1"),
      useWorkbenchLayoutStore.getState().hydrate("ws1"),
    ]);
    expect(
      useWorkbenchLayoutStore.getState().byWorkspace.ws1?.collapsed[LIST_BUCKET],
    ).toEqual(["todo"]);
  });
});
