/**
 * The projects-list row-action gates (iteration 252, MYS-2197) — the mobile
 * port of web's `ProjectRowActions` menu
 * (`packages/views/projects/components/projects-page.tsx:222-320`).
 *
 * Each case is a rule a plausible edit silently changes. The one that matters
 * most is the pin-direction gate, because it is the rule web does NOT have and
 * the one the round's own acceptance criteria call out:
 *
 *   - An unsettled pin list offers NO pin entry. Web reads `pinned` straight
 *     off its pin cache and renders a direction unconditionally, which on a
 *     phone states a fact from a read that never answered: an already-pinned
 *     project reads as 「置顶」 (inviting a duplicate write) and an unpinned one
 *     reads as 「取消置顶」 (offering to remove what is not there).
 *   - `delete` is gated on `canDelete` and nothing else — the same
 *     `isWorkspaceAdmin` the batch toolbar uses. A `canDelete: false` viewer
 *     keeps a menu iff there is still a pin entry to offer.
 */
import { describe, expect, it } from "vitest";
import {
  PROJECT_ROW_ACTION_LABEL_KEY,
  projectRowActions,
  projectRowActionsFor,
  type ProjectRowAction,
} from "./project-row-actions";

const ADMIN = { canDelete: true };
const MEMBER = { canDelete: false };

describe("projectRowActions", () => {
  it("offers the pin direction that matches a settled pin list", () => {
    expect(
      projectRowActions({ pinned: true, pinsResolved: true }, ADMIN),
    ).toEqual(["unpin", "delete"]);
    expect(
      projectRowActions({ pinned: false, pinsResolved: true }, ADMIN),
    ).toEqual(["pin", "delete"]);
  });

  it("withholds the pin entry entirely while the pin list has not settled", () => {
    // Both directions are unsupported here, not just the wrong one: an
    // unresolved read cannot tell a pinned project from an unpinned one, so
    // "offer pin instead" would be the same guess with the other sign.
    expect(
      projectRowActions({ pinned: false, pinsResolved: false }, ADMIN),
    ).toEqual(["delete"]);
    expect(
      projectRowActions({ pinned: true, pinsResolved: false }, ADMIN),
    ).toEqual(["delete"]);
  });

  it("gates delete on canDelete alone", () => {
    expect(
      projectRowActions({ pinned: false, pinsResolved: true }, MEMBER),
    ).toEqual(["pin"]);
    // …and not on the pin state: a pinned project is still deletable.
    expect(
      projectRowActions({ pinned: true, pinsResolved: true }, MEMBER),
    ).toEqual(["unpin"]);
  });

  it("returns nothing at all for a member whose pin list is unresolved", () => {
    // The empty answer is what hides the trigger. A caller that renders the
    // kebab unconditionally would open a sheet holding nothing but Cancel.
    expect(
      projectRowActions({ pinned: false, pinsResolved: false }, MEMBER),
    ).toEqual([]);
  });

  it("puts delete last, where web's separator sits", () => {
    // Menu order is user-visible: web separates the destructive entry from the
    // rest, so a reorder that moves delete into the middle changes what the
    // sheet reads like — and on a phone `delete` is also the red button.
    const actions: ProjectRowAction[] = projectRowActions(
      { pinned: false, pinsResolved: true },
      ADMIN,
    );
    expect(actions[actions.length - 1]).toBe("delete");
  });

  it("names one action with one key, shared with the batch toolbar", () => {
    // The destructive verb is the same action the long-press toolbar performs,
    // so it must read identically wherever it is reached from — the rule
    // `skill-row-menu.tsx` states for its own delete.
    expect(PROJECT_ROW_ACTION_LABEL_KEY.delete).toBe("projects.batchDelete");
    expect(PROJECT_ROW_ACTION_LABEL_KEY.pin).toBe("projects.pin");
    expect(PROJECT_ROW_ACTION_LABEL_KEY.unpin).toBe("projects.unpin");
  });
});

describe("projectRowActionsFor", () => {
  it("resolves the direction from the list's own pin set", () => {
    const pinnedIds = new Set(["p1"]);
    expect(
      projectRowActionsFor({ id: "p1" }, pinnedIds, true, ADMIN),
    ).toEqual(["unpin", "delete"]);
    expect(
      projectRowActionsFor({ id: "p2" }, pinnedIds, true, ADMIN),
    ).toEqual(["pin", "delete"]);
  });

  it("keeps an unresolved set from being read as 'nothing is pinned'", () => {
    // The exact fold this gate exists to prevent: an empty set is what a
    // loading pin query produces, and treating it as an answer pins every row.
    expect(
      projectRowActionsFor({ id: "p1" }, new Set(), false, ADMIN),
    ).toEqual(["delete"]);
  });
});
