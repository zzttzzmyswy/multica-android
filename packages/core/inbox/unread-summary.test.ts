import { describe, expect, it } from "vitest";
import type { InboxWorkspaceUnread } from "../types";
import { hasOtherWorkspaceUnread, unreadWorkspaceIds } from "./unread-summary";

const summary = (entries: InboxWorkspaceUnread[]) => entries;

describe("hasOtherWorkspaceUnread", () => {
  it("is true when a workspace other than the active one has unread", () => {
    expect(
      hasOtherWorkspaceUnread(summary([{ workspace_id: "ws-2", count: 3 }]), "ws-1"),
    ).toBe(true);
  });

  it("excludes the active workspace's own unread", () => {
    expect(
      hasOtherWorkspaceUnread(summary([{ workspace_id: "ws-1", count: 5 }]), "ws-1"),
    ).toBe(false);
  });

  it("ignores other workspaces whose count is zero", () => {
    expect(
      hasOtherWorkspaceUnread(summary([{ workspace_id: "ws-2", count: 0 }]), "ws-1"),
    ).toBe(false);
  });

  it("is true when at least one non-active workspace has unread", () => {
    expect(
      hasOtherWorkspaceUnread(
        summary([
          { workspace_id: "ws-1", count: 4 },
          { workspace_id: "ws-2", count: 1 },
        ]),
        "ws-1",
      ),
    ).toBe(true);
  });

  it("is false for an empty summary", () => {
    expect(hasOtherWorkspaceUnread([], "ws-1")).toBe(false);
  });

  it("counts every workspace as 'other' when there is no active workspace", () => {
    expect(hasOtherWorkspaceUnread(summary([{ workspace_id: "ws-1", count: 2 }]), null)).toBe(
      true,
    );
  });
});

describe("unreadWorkspaceIds", () => {
  it("collects only workspaces with a non-zero count", () => {
    const ids = unreadWorkspaceIds([
      { workspace_id: "ws-1", count: 0 },
      { workspace_id: "ws-2", count: 3 },
      { workspace_id: "ws-3", count: 1 },
    ]);
    expect(ids.has("ws-1")).toBe(false);
    expect(ids.has("ws-2")).toBe(true);
    expect(ids.has("ws-3")).toBe(true);
    expect(ids.size).toBe(2);
  });

  it("returns an empty set for an empty summary", () => {
    expect(unreadWorkspaceIds([]).size).toBe(0);
  });
});

/**
 * The module must stay free of runtime imports: mobile imports it directly and
 * does NOT load the core ApiClient singleton or React Query. A stray
 * `import { api } from "../api"` here would drag both into the mobile bundle —
 * the failure this asserts against.
 */
describe("module purity", () => {
  it("imports nothing at runtime", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./unread-summary.ts", import.meta.url), "utf8"),
    );
    const runtimeImports = source
      .split("\n")
      .filter((line) => /^\s*import\s/.test(line))
      .filter((line) => !/^\s*import\s+type\s/.test(line));
    expect(runtimeImports).toEqual([]);
  });
});
