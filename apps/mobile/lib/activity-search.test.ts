/**
 * Unit tests for `lib/activity-search.ts` — the module that makes an activity
 * row's text both drawn and searchable from one producer (MYS-2109).
 *
 * What is pinned here, and why each one matters:
 *
 *   - **The row's text is the SAME text find indexes.** This is the module's
 *     entire reason to exist. A test that only checked "the formatter returns
 *     something" would stay green while the row and the haystack drifted apart,
 *     which is the bug class the module was written to prevent.
 *   - **Coalesced, not raw.** A merged activity renders no row of its own, and
 *     its sentence can change (`completed 3 tasks`). Indexing the raw list would
 *     count hits with no row to scroll to — the counter would promise steps the
 *     reader cannot take.
 *   - **Two runs, not one string.** Web draws the actor name and the verb as two
 *     sibling `<span>`s, so web cannot match across that boundary. Two blocks
 *     reproduces that confinement; one joined string would silently be MORE
 *     permissive than the browser it is ported from.
 *   - **The ×N chip and the timestamp are excluded.** They are derived from the
 *     viewing moment, so indexing them would put text in the haystack that
 *     changes under a stable query.
 */
import { describe, expect, it, vi } from "vitest";
import type { TimelineEntry } from "@multica/core/types";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

async function load() {
  return await import("./activity-search");
}
async function loadI18n() {
  return await import("./i18n");
}

/** A status_changed activity, the action that carries the words a reader
 *  cannot find any other way on this deployment. */
function statusChange(
  id: string,
  from: string,
  to: string,
  over: Partial<TimelineEntry> = {},
): TimelineEntry {
  return {
    type: "activity",
    id,
    actor_type: "member",
    actor_id: "u1",
    created_at: "2026-01-01T00:00:00Z",
    action: "status_changed",
    details: { from, to },
    ...over,
  };
}

const deps = {
  resolveActorName: (type: string | null | undefined, id: string | null | undefined) =>
    type && id ? (id === "u1" ? "Ada" : id) : "System",
  statusLabel: (key: string) =>
    ({
      todo: "Todo",
      in_progress: "In Progress",
      in_review: "In Review",
    })[key] ?? key,
};

describe("activityRowText", () => {
  it("returns the actor name and the verb as separate runs", async () => {
    const { activityRowText } = await load();
    const i18n = await loadI18n();
    i18n.resetI18nForTests();
    i18n.setLocale("en");

    const text = activityRowText(statusChange("a1", "todo", "in_progress"), deps);
    expect(text.actor).toBe("Ada");
    expect(text.verb).toBe("changed status: Todo → In Progress");
  });

  it("renders the status words this deployment can only see in an activity", async () => {
    // The measured gap: `in_progress` appears on a typical issue ONLY inside
    // this sentence. If the verb ever stopped carrying the status label, the
    // whole round would be indexing the wrong text and nothing else would
    // notice.
    const { activityRowText } = await load();
    const i18n = await loadI18n();
    i18n.resetI18nForTests();
    i18n.setLocale("en");

    const { verb } = activityRowText(statusChange("a1", "todo", "in_progress"), deps);
    expect(verb).toContain("In Progress");
    expect(verb).toContain("Todo");
  });

  it("localizes the verb with the active locale", async () => {
    // The row is drawn in the app locale, so the haystack has to follow it —
    // otherwise a Chinese reader searches Chinese text and find holds English.
    const { activityRowText } = await load();
    const i18n = await loadI18n();
    i18n.resetI18nForTests();
    i18n.setLocale("zh");

    const { verb } = activityRowText(statusChange("a1", "todo", "in_progress"), {
      ...deps,
      statusLabel: (key) => ({ todo: "待处理", in_progress: "进行中" })[key] ?? key,
    });
    expect(verb).toContain("进行中");

    i18n.setLocale("en");
  });

  it("survives an unknown action without throwing", async () => {
    const { activityRowText } = await load();
    const entry = statusChange("a1", "todo", "todo", {
      action: "some_future_action_the_server_added",
    });
    // API Response Compatibility: an older client must render a new enum, not
    // crash. The verb may be empty or the raw string; it must never throw.
    expect(() => activityRowText(entry, deps)).not.toThrow();
  });
});

describe("activityBlockIndex", () => {
  it("keys blocks by the row's own entry id", async () => {
    const { activityBlockIndex } = await load();
    const index = activityBlockIndex([statusChange("row-1", "todo", "in_progress")], deps);
    expect([...index.keys()]).toEqual(["row-1"]);
    expect(index.get("row-1")).toEqual(["Ada", "changed status: Todo → In Progress"]);
  });

  it("indexes the COALESCED rows, not the raw entries", async () => {
    // Two identical activities 30s apart render as ONE row carrying the NEWER
    // id. Indexing the raw list would add a second target for an id that has no
    // row, and `TimelineList`'s find effect would silently refuse to scroll to
    // it — the reader's "next" button would appear dead.
    const { activityBlockIndex } = await load();
    const older = statusChange("older", "todo", "in_progress", {
      created_at: "2026-01-01T00:00:00Z",
    });
    const newer = statusChange("newer", "todo", "in_progress", {
      created_at: "2026-01-01T00:00:30Z",
    });

    const index = activityBlockIndex([older, newer], deps);
    expect([...index.keys()]).toEqual(["newer"]);
    expect(index.has("older")).toBe(false);
  });

  it("carries the coalesced count into the verb the row draws", async () => {
    // The sentence itself changes when rows merge ("completed 3 tasks"), so the
    // haystack has to be built from the merged entry or it would hold a sentence
    // that is nowhere on screen.
    const { activityBlockIndex } = await load();
    const i18n = await loadI18n();
    i18n.resetI18nForTests();
    i18n.setLocale("en");

    const one = {
      type: "activity",
      id: "t1",
      actor_type: "agent",
      actor_id: "a1",
      created_at: "2026-01-01T00:00:00Z",
      action: "task_completed",
    } as TimelineEntry;
    const two = { ...one, id: "t2", created_at: "2026-01-01T00:00:30Z" } as TimelineEntry;

    const index = activityBlockIndex([one, two], deps);
    // `task_completed` has no time limit, so these always merge.
    expect([...index.keys()]).toEqual(["t2"]);
    expect(index.get("t2")).toContain("completed 2 tasks");
  });

  it("keeps a non-coalescing action's rows separate", async () => {
    // `squad_leader_evaluated` never merges — each carries its own audit data
    // (`lib/timeline-coalesce.ts`). Two of them must stay two targets.
    const { activityBlockIndex } = await load();
    const mk = (id: string, at: string): TimelineEntry => ({
      type: "activity",
      id,
      actor_type: "agent",
      actor_id: "a1",
      created_at: at,
      action: "squad_leader_evaluated",
      details: { outcome: "action" },
    });
    const index = activityBlockIndex(
      [mk("s1", "2026-01-01T00:00:00Z"), mk("s2", "2026-01-01T00:00:10Z")],
      deps,
    );
    expect([...index.keys()].sort()).toEqual(["s1", "s2"]);
  });

  it("ignores comments and the divider-class entries it is not asked about", async () => {
    const { activityBlockIndex } = await load();
    const index = activityBlockIndex(
      [
        statusChange("a1", "todo", "in_progress"),
        {
          type: "comment",
          id: "c1",
          actor_type: "member",
          actor_id: "u1",
          created_at: "2026-01-01T00:00:00Z",
          content: "a comment",
        } as TimelineEntry,
      ],
      deps,
    );
    expect([...index.keys()]).toEqual(["a1"]);
  });

  it("handles an absent or empty timeline", async () => {
    const { activityBlockIndex } = await load();
    expect(activityBlockIndex(undefined, deps).size).toBe(0);
    expect(activityBlockIndex([], deps).size).toBe(0);
  });

  it("drops an empty run rather than indexing a blank block", async () => {
    // An entry with no action renders nothing after the name. An empty string
    // in the index is harmless to find (it skips empty text) but pinning it
    // keeps the invariant "every block has text" true at the source.
    const { activityBlockIndex } = await load();
    const blank = {
      type: "activity",
      id: "a1",
      actor_type: "member",
      actor_id: "u1",
      created_at: "2026-01-01T00:00:00Z",
    } as TimelineEntry;
    const blocks = activityBlockIndex([blank], deps).get("a1");
    expect(blocks).toEqual(["Ada"]);
    expect(blocks).not.toContain("");
  });

  it("gives each row its own target, so a hit lands on that row", async () => {
    const { activityBlockIndex } = await load();
    // Different actions, so the two do NOT coalesce — the point here is that two
    // rendered rows are two targets, each naming itself. (Two identical
    // `status_changed`s seconds apart would merge; that case is pinned above.)
    const index = activityBlockIndex(
      [
        statusChange("a1", "todo", "in_progress"),
        {
          type: "activity",
          id: "a2",
          actor_type: "member",
          actor_id: "u1",
          created_at: "2026-01-01T00:01:00Z",
          action: "description_updated",
        } as TimelineEntry,
      ],
      deps,
    );
    expect(index.get("a1")).toEqual(["Ada", "changed status: Todo → In Progress"]);
    expect(index.get("a2")).toEqual(["Ada", "updated description"]);
  });
});
