// @vitest-environment node
/**
 * The DEFERRED write must be addressed to the issue the gate was given
 * (MYS-2743 follow-up, found reviewing iteration 290's own v0.6.131 commit).
 *
 * ## The defect, and why the existing ratchets missed it
 *
 * `iter290-wiring.test.ts` asserts the table's status cell calls
 * `handoff.gate(` and passes `projectId={issue.project_id}`. Both remain true
 * under the bug, so the ratchet stayed green while the confirmed write went to
 * a URL with no issue id: they are assertions about the SOURCE TEXT of a call,
 * and the bug lives in a value that is not visible at the call site.
 *
 * ## Why this suite drives a real `MutationObserver`
 *
 * The failure is not "the wrong variable was read". It is a TIMING property of
 * TanStack Query that only shows up when the real machinery runs:
 *
 *   - `useMutation` creates the observer once and pushes the CURRENT options
 *     into it from an effect after every render (`observer.setOptions`).
 *   - the returned `mutate` is stable and, at CALL time, builds the mutation
 *     from `observer.options` (`mutationObserver.mutate` → `build(client,
 *     this.options)`).
 *
 * So an id that is re-derived from the sheet's `target` on each render is
 * correct while the sheet is open and EMPTY for the whole interval the gate
 * defers the write. A text-matching test cannot see that; these drive
 * `setOptions`/`mutate` across the same renders the component goes through and
 * read the URL that actually gets requested.
 */
import { describe, expect, it } from "vitest";
import { MutationObserver, QueryClient } from "@tanstack/query-core";
import { handoffSubjectIssueId } from "./handoff-gate";

/** One observed `PUT`, reduced to what identifies its destination. */
interface Write {
  url: string;
}

/**
 * Drives the same observer lifecycle `useMutation` drives.
 *
 * `render()` stands in for the effect that refills the observer; `mutate()` is
 * the stable callback a surface keeps in a closure — the held write.
 */
function harness() {
  const writes: Write[] = [];
  const client = new QueryClient();
  const optionsFor = (issueId: string) => ({
    mutationKey: ["updateIssue", issueId] as const,
    mutationFn: async (patch: { status: string }) => {
      writes.push({ url: `/api/issues/${issueId}` });
      return patch;
    },
  });
  const observer = new MutationObserver(client, optionsFor(""));
  const render = (issueId: string) => observer.setOptions(optionsFor(issueId));
  const mutate = (patch: { status: string }) => {
    observer.mutate(patch).catch(() => {});
  };
  return { writes, render, mutate, settle: () => new Promise((r) => setTimeout(r, 20)) };
}

describe("handoffSubjectIssueId", () => {
  it("prefers the live target, so a tap render before any state update is right", () => {
    // `setGateIssue` has not been applied yet on the render a tap happens on;
    // reading only remembered state made the first tap look like "no issue".
    expect(handoffSubjectIssueId("iss-tapped", null)).toBe("iss-tapped");
    expect(handoffSubjectIssueId("iss-tapped", "iss-stale")).toBe("iss-tapped");
  });

  it("falls back to the remembered issue once the sheet has closed", () => {
    // This is the defective window: `target` is null while the write is held.
    expect(handoffSubjectIssueId(null, "iss-tapped")).toBe("iss-tapped");
    expect(handoffSubjectIssueId(undefined, "iss-tapped")).toBe("iss-tapped");
  });

  it("reports emptiness only when NEITHER is known", () => {
    expect(handoffSubjectIssueId(null, null)).toBe("");
    expect(handoffSubjectIssueId(undefined, undefined)).toBe("");
  });
});

describe("a write deferred past the sheet's close still reaches its issue", () => {
  it("MUTATION GUARD: an id re-derived from the target alone loses the issue", async () => {
    // The DEFECT, reproduced. This is what the component did: the id was
    // `target?.issue.id ?? ""`, so closing the sheet (which the gated path
    // always does) blanked it for the whole confirmation.
    const h = harness();
    let targetId: string | null = "iss-real";
    const rememberedId: string | null = null; // never set, as in the defect
    const defectId = () => handoffSubjectIssueId(targetId, rememberedId);

    h.render(defectId()); // sheet open, row tapped
    targetId = null; // `commitStatus` closes the sheet
    h.render(defectId()); // ...and the effect refills the observer
    h.mutate({ status: "in_progress" }); // user confirms, held write runs
    await h.settle();

    // The symptom a user sees: a write that reached no issue at all.
    expect(h.writes).toEqual([{ url: "/api/issues/" }]);
  });

  it("the shipped rule keeps the issue across the close", async () => {
    const h = harness();
    let targetId: string | null = "iss-real";
    const rememberedId = "iss-real"; // `gateIssue`, set before `onClose()`
    const shippedId = () => handoffSubjectIssueId(targetId, rememberedId);

    h.render(shippedId());
    targetId = null;
    h.render(shippedId());
    h.mutate({ status: "in_progress" });
    await h.settle();

    expect(h.writes).toEqual([{ url: "/api/issues/iss-real" }]);
  });

  it("survives the row vanishing mid-confirmation (a realtime refresh)", async () => {
    // `table-view.tsx` derives `target` from the live row list, so a refresh
    // that drops the row clears the target for reasons unrelated to the pick.
    const h = harness();
    let targetId: string | null = "iss-real";
    const rememberedId = "iss-real";
    const shippedId = () => handoffSubjectIssueId(targetId, rememberedId);

    h.render(shippedId()); // sheet open
    targetId = null; // row disappeared from the list
    h.render(shippedId());
    h.mutate({ status: "done" });
    await h.settle();

    expect(h.writes).toEqual([{ url: "/api/issues/iss-real" }]);
  });
});
