import { beforeEach, describe, expect, it, vi } from "vitest";

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
import {
  defaultSquadsViewState,
  useSquadsViewStore,
} from "./squads-view-store";

const fsStore = (fs as unknown as { __fsStore: Map<string, string> })
  .__fsStore;
const FILE = "file:///doc/multica-squads-view-ws1.json";

/** Wait for the store's persist chain (a promise chain, not a timer). */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function reset() {
  fsStore.clear();
  useSquadsViewStore.setState({ byWorkspace: {}, hydrated: {} });
}

beforeEach(reset);

const view = () => useSquadsViewStore.getState().byWorkspace.ws1;

describe("squads view store", () => {
  it("defaults to name ascending with no filters", () => {
    expect(defaultSquadsViewState()).toEqual({
      sortField: "name",
      sortDirection: "asc",
      filters: { leaders: [], creators: [] },
    });
  });

  it("persists the chosen sort and reads it back on hydrate", async () => {
    useSquadsViewStore.getState().setSort("ws1", "members", "desc");
    await flush();
    expect(fsStore.get(FILE)).toContain("members");

    // Fresh session: same file, empty store.
    useSquadsViewStore.setState({ byWorkspace: {}, hydrated: {} });
    await useSquadsViewStore.getState().hydrate("ws1");
    expect(view()).toEqual({
      sortField: "members",
      sortDirection: "desc",
      filters: { leaders: [], creators: [] },
    });
  });

  it("toggles a filter value in and back out", () => {
    useSquadsViewStore.getState().toggleFilter("ws1", "leaders:agent-1");
    expect(view()?.filters.leaders).toEqual(["agent-1"]);
    useSquadsViewStore.getState().toggleFilter("ws1", "leaders:agent-1");
    expect(view()?.filters.leaders).toEqual([]);
  });

  it("keeps a filter value that contains a colon intact", () => {
    useSquadsViewStore.getState().toggleFilter("ws1", "creators:user:1");
    expect(view()?.filters.creators).toEqual(["user:1"]);
  });

  it("ignores an unknown dimension or an empty value", () => {
    useSquadsViewStore.getState().toggleFilter("ws1", "origins:github");
    useSquadsViewStore.getState().toggleFilter("ws1", "leaders:");
    useSquadsViewStore.getState().toggleFilter("ws1", "nocolon");
    expect(view()).toBeUndefined();
  });

  it("persists filters and survives a hydrate round trip", async () => {
    useSquadsViewStore.getState().toggleFilter("ws1", "leaders:agent-1");
    useSquadsViewStore.getState().toggleFilter("ws1", "creators:user-2");
    await flush();
    useSquadsViewStore.setState({ byWorkspace: {}, hydrated: {} });
    await useSquadsViewStore.getState().hydrate("ws1");
    expect(view()?.filters).toEqual({
      leaders: ["agent-1"],
      creators: ["user-2"],
    });
  });

  it("clears only the filters, keeping the sort", () => {
    useSquadsViewStore.getState().setSort("ws1", "created", "asc");
    useSquadsViewStore.getState().toggleFilter("ws1", "leaders:agent-1");
    useSquadsViewStore.getState().clearFilters("ws1");
    expect(view()).toEqual({
      sortField: "created",
      sortDirection: "asc",
      filters: { leaders: [], creators: [] },
    });
  });

  it("keeps workspaces independent", async () => {
    useSquadsViewStore.getState().setSort("ws1", "members", "asc");
    useSquadsViewStore.getState().setSort("ws2", "created", "desc");
    await flush();
    expect(useSquadsViewStore.getState().byWorkspace.ws1?.sortField).toBe(
      "members",
    );
    expect(useSquadsViewStore.getState().byWorkspace.ws2?.sortField).toBe(
      "created",
    );
    expect(fsStore.has("file:///doc/multica-squads-view-ws2.json")).toBe(true);
  });

  it("falls back to the default for an unknown persisted sort field", async () => {
    // A closed union: an unrecognised field would otherwise sort by the name
    // branch while the chip labelled it something else.
    fsStore.set(FILE, JSON.stringify({ sortField: "runs", sortDirection: "desc" }));
    await useSquadsViewStore.getState().hydrate("ws1");
    expect(view()?.sortField).toBe("name");
  });

  it("drops non-string filter entries and a malformed filter object", async () => {
    fsStore.set(
      FILE,
      JSON.stringify({
        sortField: "name",
        sortDirection: "asc",
        filters: { leaders: ["a", 3, null], creators: "nope" },
      }),
    );
    await useSquadsViewStore.getState().hydrate("ws1");
    expect(view()?.filters).toEqual({ leaders: ["a"], creators: [] });
  });

  it("survives a corrupt file without throwing", async () => {
    fsStore.set(FILE, "{ not json");
    await useSquadsViewStore.getState().hydrate("ws1");
    expect(view()).toEqual(defaultSquadsViewState());
  });

  it("does not clobber a value set while the read was in flight", async () => {
    fsStore.set(FILE, JSON.stringify({ sortField: "created", sortDirection: "asc" }));
    const hydration = useSquadsViewStore.getState().hydrate("ws1");
    useSquadsViewStore.getState().setSort("ws1", "members", "desc");
    await hydration;
    expect(view()?.sortField).toBe("members");
  });

  it("dedupes concurrent hydrations of the same workspace", async () => {
    const hydrate = useSquadsViewStore.getState().hydrate;
    await Promise.all([hydrate("ws1"), hydrate("ws1"), hydrate("ws1")]);
    expect(useSquadsViewStore.getState().hydrated.ws1).toBe(true);
  });
});
