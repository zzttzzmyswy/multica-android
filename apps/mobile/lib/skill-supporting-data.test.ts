/**
 * MYS-2192: a skills row's cells must not restate a failed read as a fact.
 *
 * The defect these pin is one failure producing a confident conclusion on the
 * phone — 「未使用」 off an unanswered agents read, a read-only lock off an
 * unanswered members read — while web, under the same failure, additionally
 * puts a warning strip on screen naming creator attribution / runtime names /
 * edit permissions as possibly incomplete. Web gets away with the cells
 * because the strip is there; mobile had neither the strip nor a hover-revealed
 * tooltip (the lock's explanation went into an `accessibilityLabel`, which a
 * sighted user never sees).
 *
 * The four gates are deliberately NOT one predicate, and the suites below say
 * so: the banner fires on FAILURE only (a banner over a loading read would
 * flash on every cold open), the cells stop asserting on anything UNSETTLED
 * (loading included — a claim needs a settled directory, not just a
 * non-failed one).
 */
import { describe, expect, it } from "vitest";
import type { CatalogState } from "./catalog-state";
import {
  skillLockCell,
  supportingDataWarningVisible,
  usedByCell,
  usedByCount,
  usedBySection,
} from "./skill-supporting-data";

const STATES: CatalogState[] = ["loading", "error", "empty", "ready"];

describe("supportingDataWarningVisible", () => {
  it("fires when either supporting read failed", () => {
    expect(
      supportingDataWarningVisible({ agents: "error", members: "ready" }),
    ).toBe(true);
    expect(
      supportingDataWarningVisible({ agents: "ready", members: "error" }),
    ).toBe(true);
    expect(
      supportingDataWarningVisible({ agents: "error", members: "error" }),
    ).toBe(true);
  });

  it("stays quiet when both reads answered — including settled-empty", () => {
    // `empty` means the request succeeded and the workspace really has none;
    // warning there would be the same "unknown vs none" collapse this round
    // removes, mirrored.
    for (const agents of ["ready", "empty"] as CatalogState[]) {
      for (const members of ["ready", "empty"] as CatalogState[]) {
        expect(supportingDataWarningVisible({ agents, members })).toBe(false);
      }
    }
  });

  it("stays quiet while the reads are still arriving", () => {
    // Loading is self-explanatory (the rows are still coming) and a banner
    // over it would flash on every cold open — web's gate is failure-only too.
    expect(
      supportingDataWarningVisible({ agents: "loading", members: "loading" }),
    ).toBe(false);
    expect(
      supportingDataWarningVisible({ agents: "loading", members: "empty" }),
    ).toBe(false);
  });
});

describe("usedByCell", () => {
  it("says 「未使用」 only once the agents read settled", () => {
    expect(usedByCell(0, true)).toBe("unused");
  });

  it("refuses the absence while the agents read is unsettled", () => {
    // The exact defect: a zero-length `items` array is what `catalogRead`
    // returns in EVERY non-ready state, so `length === 0` is not evidence of
    // anything until the directory settled.
    expect(usedByCell(0, false)).toBe("unknown");
  });

  it("still renders the agents that did arrive under a degraded read", () => {
    // One directory's state never un-renders rows that are in hand — hiding
    // them would be a second way to lose information (the asymmetry
    // `unsettledCatalogStatus` documents for pickers).
    expect(usedByCell(1, false)).toBe("agents");
    expect(usedByCell(3, true)).toBe("agents");
  });
});

describe("skillLockCell", () => {
  it("keeps the pencil whenever the viewer may edit", () => {
    // canEdit true is trustworthy regardless of the members read: it comes
    // either from a role the read produced or from `created_by === userId`,
    // and the second half holds whatever the read did.
    for (const resolved of [true, false]) {
      expect(skillLockCell(true, resolved)).toBe("pencil");
    }
  });

  it("keeps the lock when the members read settled — it is a real denial", () => {
    expect(skillLockCell(false, true)).toBe("lock");
  });

  it("draws nothing when the members read has not answered", () => {
    // `canEditSkill` collapses to creator-only on a null role, so a failed
    // member read locks every skill the viewer did not create. Drawing the
    // lock would keep asserting that; drawing the pencil would advertise an
    // edit the server may reject. Neither glyph is the honest answer.
    expect(skillLockCell(false, false)).toBe("none");
  });
});

describe("usedBySection / usedByCount", () => {
  it("shows the rows that arrived", () => {
    expect(usedBySection(2, false)).toBe("agents");
    expect(usedByCount(2, false)).toBe(2);
  });

  it("claims 「not assigned yet」 only from a settled read", () => {
    expect(usedBySection(0, true)).toBe("empty");
    expect(usedByCount(0, true)).toBe(0);
  });

  it("paints the load state instead of claiming an absence", () => {
    // The detail page's own false-absence sentence — 「还未分配给任何智能体。
    // 打开某个智能体的 Skills 标签页进行分配。」 — was rendered from
    // `usedByAgents.length === 0`, which a failed read also produces.
    expect(usedBySection(0, false)).toBe("status");
  });

  it("refuses to print a count it did not measure", () => {
    expect(usedByCount(0, false)).toBeNull();
  });

  it("agrees with usedBySection on every state — one read, one verdict", () => {
    // The header count and the section below it read the same directory; a
    // pair that disagreed would put 「被 0 个智能体使用」 over a failure notice.
    for (const state of STATES) {
      const resolved = state === "ready" || state === "empty";
      for (const count of [0, 1, 5]) {
        const section = usedBySection(count, resolved);
        const total = usedByCount(count, resolved);
        if (section === "status") expect(total).toBeNull();
        else expect(total).toBe(count);
      }
    }
  });
});
