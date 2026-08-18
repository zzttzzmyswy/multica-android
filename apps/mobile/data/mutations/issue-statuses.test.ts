/**
 * Issue-status catalog mutation cache-patch tests (MUL-6243). The optimistic
 * three-step contract (snapshot → patch → settle invalidate) is covered at
 * the pure-function level here — the hooks only wire these to the query
 * cache, which the Node vitest lane has no renderer for.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/data/api", () => ({ api: {} }));
// The mutation module binds to the workspace store, which loads
// expo-secure-store at import time (no-op in the Node lane).
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

import type {
  IssueStatusCategory,
  IssueStatusEntry,
  ListIssueStatusesResponse,
} from "@multica/core/types";
import {
  appendStatusToList,
  patchStatusInList,
  reorderStatusesInList,
} from "./issue-statuses";

function entry(
  key: string,
  category: string,
  position: number,
  partial: Partial<IssueStatusEntry> = {},
): IssueStatusEntry {
  const id = partial.id ?? `id-${key}`;
  return {
    id,
    workspace_id: "ws-1",
    key,
    name: partial.name ?? key,
    description: "",
    category: (category as IssueStatusCategory) ?? "backlog",
    color: "#123456",
    is_system: false,
    position,
    archived_at: null,
    created_at: "2026-08-18T00:00:00Z",
    updated_at: "2026-08-18T00:00:00Z",
    ...partial,
  };
}

function response(...entries: IssueStatusEntry[]): ListIssueStatusesResponse {
  return { statuses: entries, categories: ["todo", "done"], total: entries.length };
}

describe("appendStatusToList", () => {
  it("appends a new entry and bumps the total", () => {
    const old = response(entry("todo", "todo", 0, { is_system: true }));
    const created = entry("qa", "todo", 1);
    const out = appendStatusToList(old, created);
    expect(out.statuses).toHaveLength(2);
    expect(out.statuses[1]).toBe(created);
    expect(out.total).toBe(2);
  });

  it("never duplicates an entry that is already in the cache", () => {
    const existing = entry("qa", "todo", 1);
    const old = response(existing);
    const out = appendStatusToList(old, { ...existing, name: "QA v2" });
    expect(out.statuses).toHaveLength(1);
    // The cache keeps its original row — append never replaces an id it knows.
    expect(out.statuses[0]!.name).toBe("qa");
    expect(out.total).toBe(1);
  });
});

describe("patchStatusInList", () => {
  it("merges only the given fields onto the matching row", () => {
    const old = response(
      entry("todo", "todo", 0, { is_system: true, name: "Todo" }),
      entry("qa", "todo", 1, { name: "QA" }),
    );
    const out = patchStatusInList(old, "id-qa", {
      name: "QA Review",
      color: "#ff0000",
    });
    expect(out.statuses[1]).toMatchObject({
      key: "qa",
      name: "QA Review",
      color: "#ff0000",
      category: "todo",
      is_system: false,
    });
    // The built-in row is untouched.
    expect(out.statuses[0]).toMatchObject({ key: "todo", name: "Todo" });
  });

  it("leaves the list unchanged for an unknown id", () => {
    const old = response(entry("todo", "todo", 0));
    expect(patchStatusInList(old, "nope", { name: "X" })).toEqual(old);
  });
});

describe("reorderStatusesInList", () => {
  it("assigns positions 1..n, leaves non-listed rows alone and re-sorts", () => {
    // done category already populated; reorder todo's customs.
    const todo1 = entry("second", "todo", 1, { name: "Second" });
    const todo2 = entry("first", "todo", 2, { name: "First" });
    const done1 = entry("done", "done", 0, { is_system: true });
    const old = response(todo1, done1, todo2);

    const out = reorderStatusesInList(old, [todo2, todo1]);
    // positions rewritten: first → 1, second → 2
    const positionOf = Object.fromEntries(
      out.statuses.map((s) => [s.key, s.position]),
    );
    expect(positionOf).toEqual({ second: 2, first: 1, done: 0 });
    // Whole list re-sorted by category rank, then position: todo(1) before done(2).
    expect(out.statuses.map((s) => s.key)).toEqual(["first", "second", "done"]);
  });

  it("keeps a category's built-in autonomous (position 0 preserved)", () => {
    const builtIn = entry("todo", "todo", 0, { is_system: true });
    const a = entry("a", "todo", 1);
    const b = entry("b", "todo", 2);
    const old = response(builtIn, a, b);
    const out = reorderStatusesInList(old, [b, a]);
    expect(out.statuses.map((s) => s.key)).toEqual(["todo", "b", "a"]);
    expect(out.statuses[0]!.position).toBe(0);
  });
});