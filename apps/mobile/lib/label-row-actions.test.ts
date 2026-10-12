/**
 * The labels-list row actions (iteration 231, MYS-2102) — the mobile port of
 * web's row menu (`packages/views/settings/components/labels-tab.tsx:186-211`).
 *
 * There is only one rule here, and it is a rule about NOT having a rule: the
 * menu is unconditional. That is worth a test precisely because the three
 * surfaces next to it (properties, members, squads) all gate their menus, so
 * "add a `canManage` here for consistency" is the plausible edit this pins
 * down — and it would be a regression against web, not a parity choice.
 */
import { describe, expect, it } from "vitest";
import type { Label } from "@multica/core/types";
import { labelRowActions } from "./label-row-actions";

function label(overrides: Partial<Label> = {}): Label {
  return {
    id: "l1",
    workspace_id: "w1",
    resource_type: "issue",
    name: "bugfix",
    description: null as unknown as string,
    color: "#3b82f6",
    usage_count: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    ...overrides,
  } as Label;
}

describe("labelRowActions", () => {
  it("offers edit then delete, in web's menu order", () => {
    expect(labelRowActions(label())).toEqual(["edit", "delete"]);
  });

  it("is unconditional — there is no permission input to vary", () => {
    // Web's labels tab carries no `canManage` anywhere, and the
    // `DropdownMenu` is rendered unconditionally inside the row map. The
    // helper's signature is the assertion: it takes a row and nothing else, so
    // a reader cannot "fix" this by passing a role in without changing the
    // signature the wiring ratchet pins.
    expect(labelRowActions.length).toBe(1);
    for (const row of [
      label({ usage_count: 0 }),
      label({ usage_count: 42 }),
      label({ name: "" }),
      label({ resource_type: "skill" }),
      label({ resource_type: undefined }),
      label({ description: "something" }),
    ]) {
      expect(labelRowActions(row)).toEqual(["edit", "delete"]);
    }
  });

  it("returns a fresh array so a caller cannot mutate the menu order", () => {
    // A shared constant returned by reference would let one screen's sort
    // reorder every other screen's menu.
    const first = labelRowActions(label());
    first.push("delete");
    expect(labelRowActions(label())).toEqual(["edit", "delete"]);
  });

  it("does not depend on the row's identity at all", () => {
    // Usage count and scope are display data; neither changes what the row
    // offers. Pinned because "archive a heavily-used label" is exactly the kind
    // of thing a later round might decide to block, and web does not.
    expect(labelRowActions(label({ usage_count: 1_000_000 }))).toEqual(
      labelRowActions(label({ usage_count: 0 })),
    );
  });
});
