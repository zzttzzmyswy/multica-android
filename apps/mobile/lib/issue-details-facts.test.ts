import { describe, expect, it } from "vitest";
import {
  creatorLine,
  detailsStamp,
} from "./issue-details-facts";
import type { ActorReadiness } from "./actor-name-state";

const READY: ActorReadiness = { member: true, agent: true, squad: true };
const UNREAD: ActorReadiness = { member: false, agent: false, squad: false };

const issue = {
  creator_type: "member" as const,
  creator_id: "u-1",
};

describe("creatorLine", () => {
  it("names the creator once the directory has answered", () => {
    expect(
      creatorLine(issue, {
        readiness: READY,
        getName: () => "Ada Lovelace",
      }),
    ).toEqual({ kind: "name", text: "Ada Lovelace" });
  });

  it("withholds while the directory is unread — the whole point of the module", () => {
    // `getName` returns its sentinel here; the state must not read it at all.
    expect(
      creatorLine(issue, {
        readiness: UNREAD,
        getName: () => "Unknown",
      }),
    ).toEqual({ kind: "unsettled" });
  });

  it("withholds even when getName would have produced a plausible name", () => {
    // A stale cache could hand back a real-looking name while the read is in
    // flight; it still may not be asserted (MYS-2215's ordering).
    expect(
      creatorLine(issue, {
        readiness: UNREAD,
        getName: () => "Grace Hopper",
      }),
    ).toEqual({ kind: "unsettled" });
  });

  it("waits only for the creator's OWN directory, not all three", () => {
    // An agent creator must not wait on the member list.
    expect(
      creatorLine(
        { creator_type: "agent", creator_id: "a-1" },
        {
          readiness: { member: false, agent: true, squad: false },
          getName: () => "Reviewer",
        },
      ),
    ).toEqual({ kind: "name", text: "Reviewer" });
  });

  it("renders the id fragment for a gone actor rather than a sentinel", () => {
    expect(
      creatorLine(issue, {
        readiness: READY,
        getName: () => "Unknown",
      }),
    ).toEqual({ kind: "name", text: "u-1" });
  });

  it("truncates the gone fragment to the shared 8 characters", () => {
    const result = creatorLine(
      { creator_type: "member", creator_id: "abcdefghijkl" },
      { readiness: READY, getName: () => "Unknown Agent" },
    );
    expect(result).toEqual({ kind: "name", text: "abcdefgh" });
  });

  it("withholds for an actor type no directory answers for", () => {
    // `system` creators have no row; `isActorTypeResolved` is false, so the
    // block waits rather than printing the raw type.
    expect(
      creatorLine(
        { creator_type: "system" as never, creator_id: "s-1" },
        { readiness: READY, getName: () => "Multica" },
      ),
    ).toEqual({ kind: "unsettled" });
  });
});

describe("detailsStamp", () => {
  it("delegates to the formatter so the locale decision stays in one place", () => {
    expect(detailsStamp("2026-10-19T00:00:00Z", () => "Oct 19")).toBe("Oct 19");
  });

  it("passes null through — the formatter owns the em-dash fallback", () => {
    const seen: Array<string | null | undefined> = [];
    detailsStamp(null, (v) => {
      seen.push(v);
      return "—";
    });
    expect(seen).toEqual([null]);
  });
});
