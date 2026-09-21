import { describe, expect, it } from "vitest";
import { PinnedItemSchema, PinListSchema } from "@/data/schemas";

/**
 * Pinned-item parsing (iteration 173, P1).
 *
 * The regression this pins: `item_type` was `enum(["issue","project"])
 * .catch("issue")`, so a `view` pin — which web creates and the backend
 * stores — parsed as an ISSUE. `PinnedScreen` then queried the view id as an
 * issue id, got a 404, rendered the "unavailable" row, and that row's single
 * tap DELETED the pin. Reading a pin correctly is the whole fix; everything
 * else is the guard around it.
 */
describe("PinnedItemSchema item_type", () => {
  const base = {
    id: "pin-1",
    item_id: "target-1",
    workspace_id: "ws-1",
    user_id: "user-1",
    position: 1,
    created_at: "2026-09-21T00:00:00Z",
  };

  it("keeps a view pin a view", () => {
    expect(PinnedItemSchema.parse({ ...base, item_type: "view" }).item_type).toBe(
      "view",
    );
  });

  it("keeps issue and project pins unchanged", () => {
    expect(
      PinnedItemSchema.parse({ ...base, item_type: "issue" }).item_type,
    ).toBe("issue");
    expect(
      PinnedItemSchema.parse({ ...base, item_type: "project" }).item_type,
    ).toBe("project");
  });

  it("downgrades an unknown type to issue rather than failing the item", () => {
    // Enum drift must not crash the row (root CLAUDE.md). The downgrade is
    // only tolerable because the row no longer deletes on a failed lookup —
    // see pinned-screen.tsx `MissingPinRow`.
    expect(
      PinnedItemSchema.parse({ ...base, item_type: "squad" }).item_type,
    ).toBe("issue");
  });

  it("keeps the WHOLE list when one item carries an unknown type", () => {
    // The failure mode this guards: a rejected element fails the array parse,
    // `fetchValidated` falls back to EMPTY_PIN_LIST, and every pin the user
    // ever made disappears at once.
    const parsed = PinListSchema.parse([
      { ...base, id: "a", item_type: "issue" },
      { ...base, id: "b", item_type: "view" },
      { ...base, id: "c", item_type: "something-new" },
    ]);
    expect(parsed.map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(parsed.map((p) => p.item_type)).toEqual(["issue", "view", "issue"]);
  });
});
