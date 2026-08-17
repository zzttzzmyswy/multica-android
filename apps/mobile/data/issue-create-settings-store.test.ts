import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Native-module mock (Node vitest lane) — in-memory File backing store,
// same pattern as downloads-store.test.ts. Seeding / reset goes through the
// exported __fsStore map.
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

// `__fsStore` is a test-only export injected by the expo-file-system mock
// (same contrast as downloads-store.test.ts) so tests can seed / inspect
// the persisted file store.
import * as expoFileSystemModule from "expo-file-system";
const fsModule = expoFileSystemModule as unknown as { __fsStore: Map<string, string> };
import {
  useIssueCreateSettingsStore,
  DEFAULT_QUICK_CREATE_FIELDS,
  DEFAULT_MANUAL_CREATE_FIELDS,
  QUICK_CREATE_FIELDS,
  MANUAL_CREATE_FIELDS,
} from "./issue-create-settings-store";

function readPersistedFile(wsId: string): unknown {
  const uri = `file:///doc/multica-issue-create-settings-${wsId}.json`;
  const raw = fsModule.__fsStore.get(uri);
  return raw ? (JSON.parse(raw) as unknown) : undefined;
}

/** Wait for microtasks + one macrotask so the fire-and-forget persist
 *  chain settles (same helper as downloads-store.test.ts). */
async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

const WS_A = "ws-aaa";
const WS_B = "ws-bbb";

describe("issue-create-settings-store", () => {
  beforeEach(() => {
    fsModule.__fsStore.clear();
    useIssueCreateSettingsStore.setState({
      byWorkspace: {},
      hydrated: {},
    });
  });

  it("exposes web-aligned field constants and defaults", () => {
    expect(QUICK_CREATE_FIELDS).toEqual(["project", "priority", "due-date"]);
    expect(MANUAL_CREATE_FIELDS).toEqual([
      "status",
      "priority",
      "assignee",
      "labels",
      "project",
      "due-date",
      "start-date",
    ]);
    // Web mirrors its toolbar defaults (quick = project only; manual = the
    // classic five plus labels, while due/start date live in the overflow —
    // same shape as web DEFAULT_MANUAL_CREATE_FIELDS).
    expect(DEFAULT_QUICK_CREATE_FIELDS).toEqual(["project"]);
    expect(DEFAULT_MANUAL_CREATE_FIELDS).toEqual([
      "status",
      "priority",
      "assignee",
      "labels",
      "project",
    ]);
  });

  it("hydrates missing file to defaults", async () => {
    const s = useIssueCreateSettingsStore.getState();
    await s.hydrate(WS_A);
    const state = useIssueCreateSettingsStore.getState();
    expect(state.byWorkspace[WS_A]).toEqual({
      quick: ["project"],
      manual: ["status", "priority", "assignee", "labels", "project"],
    });
    expect(state.hydrated[WS_A]).toBe(true);
  });

  it("toggles a quick-create field on and persists per-workspace", async () => {
    const s = useIssueCreateSettingsStore.getState();
    await s.hydrate(WS_A);
    s.setQuickCreateFieldVisible(WS_A, "priority", true);
    expect(useIssueCreateSettingsStore.getState().byWorkspace[WS_A]?.quick).toEqual([
      "project",
      "priority",
    ]);
    // Persisted under the workspace-scoped file name.
    await flush();
    expect(readPersistedFile(WS_A)).toEqual({
      quick: ["project", "priority"],
      manual: ["status", "priority", "assignee", "labels", "project"],
    });
    expect(readPersistedFile(WS_B)).toBeUndefined();
  });

  it("normalizes persisted arrays back onto the canonical field order", async () => {
    fsModule.__fsStore.set(
      "file:///doc/multica-issue-create-settings-ws-aaa.json",
      JSON.stringify({ quick: ["due-date", "project"], manual: ["project", "status", "assignee"] }),
    );
    const s = useIssueCreateSettingsStore.getState();
    await s.hydrate(WS_A);
    expect(useIssueCreateSettingsStore.getState().byWorkspace[WS_A]).toEqual({
      quick: ["project", "due-date"],
      manual: ["status", "assignee", "project"],
    });
  });

  it("drops unknown fields and falls back per-field on corrupt files", async () => {
    fsModule.__fsStore.set(
      "file:///doc/multica-issue-create-settings-ws-aaa.json",
      JSON.stringify({ quick: ["project", "labels", 42], manual: "nonsense" }),
    );
    const s = useIssueCreateSettingsStore.getState();
    await s.hydrate(WS_A);
    const state = useIssueCreateSettingsStore.getState();
    expect(state.byWorkspace[WS_A]?.quick).toEqual(["project"]);
    expect(state.byWorkspace[WS_A]?.manual).toEqual(DEFAULT_MANUAL_CREATE_FIELDS);

    // Totally unparseable file → both groups fall back to defaults.
    fsModule.__fsStore.set(
      "file:///doc/multica-issue-create-settings-ws-bbb.json",
      "{not json",
    );
    await state.hydrate(WS_B);
    expect(useIssueCreateSettingsStore.getState().byWorkspace[WS_B]).toEqual({
      quick: ["project"],
      manual: ["status", "priority", "assignee", "labels", "project"],
    });
  });

  it("isolates settings per workspace", async () => {
    const s = useIssueCreateSettingsStore.getState();
    await s.hydrate(WS_A);
    await s.hydrate(WS_B);
    s.setQuickCreateFieldVisible(WS_A, "due-date", true);
    s.setManualCreateFieldVisible(WS_B, "due-date", true);
    const state = useIssueCreateSettingsStore.getState();
    expect(state.byWorkspace[WS_A]?.quick).toEqual(["project", "due-date"]);
    expect(state.byWorkspace[WS_A]?.manual).toEqual(DEFAULT_MANUAL_CREATE_FIELDS);
    expect(state.byWorkspace[WS_B]?.quick).toEqual(["project"]);
    expect(state.byWorkspace[WS_B]?.manual).toEqual([
      "status",
      "priority",
      "assignee",
      "labels",
      "project",
      "due-date",
    ]);
  });

  it("a round-trip persists and rehydrates identically", async () => {
    const s = useIssueCreateSettingsStore.getState();
    await s.hydrate(WS_A);
    s.setQuickCreateFieldVisible(WS_A, "priority", true);
    s.setManualCreateFieldVisible(WS_A, "due-date", true);
    s.setManualCreateFieldVisible(WS_A, "assignee", false);
    await flush();

    // Fresh store instance (simulated restart): clear state, rehydrate from disk.
    useIssueCreateSettingsStore.setState({ byWorkspace: {}, hydrated: {} });
    const s2 = useIssueCreateSettingsStore.getState();
    await s2.hydrate(WS_A);
    expect(useIssueCreateSettingsStore.getState().byWorkspace[WS_A]).toEqual({
      quick: ["project", "priority"],
      manual: ["status", "priority", "labels", "project", "due-date"],
    });
  });

  it("hydrate never clobbers a value the user already set", async () => {
    const s = useIssueCreateSettingsStore.getState();
    await s.hydrate(WS_A);
    s.setQuickCreateFieldVisible(WS_A, "priority", true);
    // A late duplicate hydrate (async file read resolving after a toggle)
    // must not overwrite the in-memory value.
    await s.hydrate(WS_A);
    expect(useIssueCreateSettingsStore.getState().byWorkspace[WS_A]?.quick).toEqual([
      "project",
      "priority",
    ]);
  });
});