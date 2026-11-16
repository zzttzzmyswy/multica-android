import { describe, expect, it } from "vitest";
import type { IssueWorkflowStep } from "@multica/core/types";
import {
  handoffAsksSaveScope,
  handoffDefaultNextStatus,
  handoffModeOf,
  handoffNeedsTarget,
  handoffSaveResultKind,
  handoffSharingProjects,
  handoffTargetStatusKeys,
  initialHandoffDraft,
  isHandoffDirty,
  sameHandoff,
  savedHandoff,
  type HandoffDraft,
} from "./workflow-handoff-edit";

/**
 * Editing one column's handoff (MYS-2889 follow-up).
 *
 * Every case below is transcribed from the upstream implementation it mirrors —
 * `packages/views/workflows/handoff-form.tsx` at `origin/main` — so this suite
 * is a parity check, not an invented spec. Where a case exists only because of
 * a mobile constraint (no hover, a phone-width sheet) the comment says so.
 */

/** A step builder: only the fields a case cares about are named. */
function step(
  status_key: string,
  handler: IssueWorkflowStep["handler"],
  extra: Partial<IssueWorkflowStep> = {},
): IssueWorkflowStep {
  return { status_key, handler, instructions: "", ...extra };
}

const NONE: IssueWorkflowStep["handler"] = { type: "none" };

describe("handoffModeOf — upstream handoff-form.tsx:39", () => {
  it("reopens a squad step in the agent mode, because that is the picker that can edit it", () => {
    // A squad is chosen from the agent picker's squad section (upstream
    // `HandlerPicker` `kind === "agent"`). Mapping it to "member" would reopen
    // a step holding a squad in a picker that cannot name one.
    expect(handoffModeOf({ type: "squad", id: "squad-1" })).toBe("agent");
    expect(handoffModeOf({ type: "agent", id: "agent-1" })).toBe("agent");
  });

  it("reopens a project-lead step in the member mode", () => {
    // Same reasoning in the other direction: `project_lead` is one of the
    // member picker's own rows, and it starts a run when the lead is an agent.
    expect(handoffModeOf({ type: "project_lead" })).toBe("member");
    expect(handoffModeOf({ type: "member", id: "user-1" })).toBe("member");
  });

  it("reads none and creator as no handoff", () => {
    // `creator` is resolved per issue and has nothing to pick; upstream falls
    // through to "none" for it, and so does the schema's enum degradation.
    expect(handoffModeOf(NONE)).toBe("none");
    expect(handoffModeOf({ type: "creator" })).toBe("none");
  });

  it("does not invent a mode for a handler type this build cannot render", () => {
    // The schema degrades unknown types to "none" before they get here, but the
    // predicate must be total anyway — a stale cache can still carry a string.
    expect(handoffModeOf({ type: "future_thing" as never })).toBe("none");
  });
});

describe("savedHandoff — what a draft actually writes", () => {
  it("keeps instructions and next/back for an agent step", () => {
    const draft: HandoffDraft = {
      status_key: "in_progress",
      handler: { type: "agent", id: "agent-1" },
      instructions: "Write the tests first.",
      next_status_key: "in_review",
      back_status_key: "todo",
    };
    expect(savedHandoff(draft)).toEqual(draft);
  });

  it("keeps them for a squad step too, because the squad leader reads the same brief", () => {
    const draft: HandoffDraft = {
      status_key: "in_progress",
      handler: { type: "squad", id: "squad-1" },
      instructions: "Dispatch to whoever is free.",
      next_status_key: "in_review",
    };
    expect(savedHandoff(draft)).toEqual(draft);
  });

  it("CLEARS instructions and targets for a member handoff", () => {
    // Not merely ignored: the server stores what it is sent, and `isHandoffDirty`
    // compares this shape — so leftover text on a member step would make an
    // untouched form read as permanently dirty and send fields the step does
    // not own.
    const draft: HandoffDraft = {
      status_key: "in_review",
      handler: { type: "member", id: "user-1" },
      instructions: "This text must not survive.",
      next_status_key: "done",
      back_status_key: "todo",
    };
    expect(savedHandoff(draft)).toEqual({
      status_key: "in_review",
      handler: { type: "member", id: "user-1" },
      instructions: "",
      next_status_key: undefined,
      back_status_key: undefined,
    });
  });

  it("clears them for project_lead and creator as well", () => {
    for (const handler of [{ type: "project_lead" }, { type: "creator" }] as const) {
      const out = savedHandoff({
        status_key: "in_review",
        handler: handler as IssueWorkflowStep["handler"],
        instructions: "dropped",
        next_status_key: "done",
      });
      expect(out.instructions, handler.type).toBe("");
      expect(out.next_status_key, handler.type).toBeUndefined();
    }
  });

  it("leaves a none step with nothing but the handler", () => {
    const out = savedHandoff({
      status_key: "todo",
      handler: NONE,
      instructions: "stale",
      next_status_key: "done",
      back_status_key: "backlog",
    });
    expect(out).toEqual({ status_key: "todo", handler: NONE, instructions: "", next_status_key: undefined, back_status_key: undefined });
  });
});

describe("sameHandoff / isHandoffDirty", () => {
  const saved: HandoffDraft = {
    status_key: "in_progress",
    handler: { type: "agent", id: "agent-1" },
    instructions: "Do the work.",
    next_status_key: "in_review",
  };

  it("treats absent and empty optional keys as the same", () => {
    // The server drops them; a response-rebuilt draft therefore has them absent
    // where a form-built one has them undefined. Reading that as a change would
    // make every refreshed form dirty.
    expect(
      sameHandoff(
        { ...saved, back_status_key: undefined },
        { ...saved, back_status_key: undefined },
      ),
    ).toBe(true);
    expect(
      sameHandoff(
        { ...saved, next_status_key: "in_review", back_status_key: undefined },
        { ...saved, next_status_key: "in_review" },
      ),
    ).toBe(true);
  });

  it("does not depend on key ORDER", () => {
    // A draft rebuilt from JSON can order its keys differently; comparing
    // serialised strings would then report a change that is not there.
    const reordered: HandoffDraft = {
      instructions: saved.instructions,
      handler: saved.handler,
      status_key: saved.status_key,
      next_status_key: saved.next_status_key,
    };
    expect(isHandoffDirty(reordered, saved)).toBe(false);
  });

  it("sees a changed handler id as dirty", () => {
    expect(
      isHandoffDirty({ ...saved, handler: { type: "agent", id: "agent-2" } }, saved),
    ).toBe(true);
  });

  it("sees a changed NEXT status as dirty", () => {
    expect(isHandoffDirty({ ...saved, next_status_key: "done" }, saved)).toBe(true);
  });

  it("does NOT see leftover instructions on a member step as dirty", () => {
    // The specific false positive `savedHandoff` exists to remove: switching an
    // agent step to a member clears what gets SAVED, so the form is not dirty
    // even though the textarea still holds the old text.
    const memberSaved = savedHandoff({
      status_key: "in_progress",
      handler: { type: "member", id: "user-1" },
      instructions: "",
    });
    const memberDraft: HandoffDraft = {
      ...memberSaved,
      instructions: "left over from when this step had an agent",
      next_status_key: "in_review",
    };
    expect(isHandoffDirty(memberDraft, memberSaved)).toBe(false);
  });

  it("still reports a real change on a member step", () => {
    const memberSaved = savedHandoff({
      status_key: "in_progress",
      handler: { type: "member", id: "user-1" },
      instructions: "",
    });
    expect(
      isHandoffDirty({ ...memberSaved, handler: { type: "member", id: "user-2" } }, memberSaved),
    ).toBe(true);
  });
});

describe("handoffNeedsTarget — upstream handoff-form.tsx:167", () => {
  it("blocks save when an agent was chosen but not named", () => {
    expect(handoffNeedsTarget({ type: "agent" })).toBe(true);
    expect(handoffNeedsTarget({ type: "squad" })).toBe(true);
    expect(handoffNeedsTarget({ type: "member" })).toBe(true);
  });

  it("allows the kinds that legitimately carry no id", () => {
    // Deriving this from "an id is missing" would block all three of these.
    expect(handoffNeedsTarget({ type: "none" })).toBe(false);
    expect(handoffNeedsTarget({ type: "creator" })).toBe(false);
    expect(handoffNeedsTarget({ type: "project_lead" })).toBe(false);
  });

  it("allows a named actor of every kind", () => {
    expect(handoffNeedsTarget({ type: "agent", id: "a" })).toBe(false);
    expect(handoffNeedsTarget({ type: "squad", id: "s" })).toBe(false);
    expect(handoffNeedsTarget({ type: "member", id: "m" })).toBe(false);
  });
});

describe("initialHandoffDraft", () => {
  const steps = [step("todo", NONE), step("in_progress", { type: "agent", id: "a1" })];

  it("returns the workflow's own row for a listed status", () => {
    expect(initialHandoffDraft(steps, "in_progress")).toBe(steps[1]);
  });

  it("builds an empty draft for a status the workflow does not list", () => {
    // Reachable: the card can draw a column the workflow has since dropped.
    // Throwing here would take the whole detail screen down.
    expect(initialHandoffDraft(steps, "in_review")).toEqual({
      status_key: "in_review",
      handler: { type: "none" },
      instructions: "",
    });
  });
});

describe("handoffAsksSaveScope — upstream askScope, handoff-form.tsx:169", () => {
  const base = {
    canEdit: true,
    canCopyForProject: true,
    dirty: true,
    isDefaultWorkflow: false,
    otherProjectCount: 1,
    hasProject: true,
  };

  it("asks when a shared named workflow was edited for real by someone who can switch projects", () => {
    expect(handoffAsksSaveScope(base)).toBe(true);
  });

  it("does not ask a reader — they cannot save at all", () => {
    expect(handoffAsksSaveScope({ ...base, canEdit: false })).toBe(false);
  });

  it("does not ask when the caller may not switch this project's workflow", () => {
    // The project-scoped answer COPIES the workflow and repoints the project,
    // which is `canManageProject`. Offering it to someone who cannot switch
    // would offer a write the server answers 403 to.
    expect(handoffAsksSaveScope({ ...base, canCopyForProject: false })).toBe(false);
  });

  it("does not ask when nothing changed", () => {
    expect(handoffAsksSaveScope({ ...base, dirty: false })).toBe(false);
  });

  it("does not ask about Default — it belongs to the workspace, not a project", () => {
    expect(handoffAsksSaveScope({ ...base, isDefaultWorkflow: true })).toBe(false);
  });

  it("does not ask when no other project uses the workflow — one option is not a question", () => {
    expect(handoffAsksSaveScope({ ...base, otherProjectCount: 0 })).toBe(false);
  });

  it("does not ask when the form was opened outside a project", () => {
    // The copy needs a project to repoint; without one there is no second
    // answer to offer.
    expect(handoffAsksSaveScope({ ...base, hasProject: false })).toBe(false);
  });
});

describe("handoffSharingProjects — upstream useWorkflowSharing, handoff-form.tsx:81", () => {
  const PROJECTS = [
    { id: "p-pay", title: "Payments" },
    { id: "p-orders", title: "Orders" },
    { id: "p-cart", title: "Cart" },
    { id: "p-checkout", title: "Checkout" },
    { id: "p-refunds", title: "Refunds" },
  ];

  it("excludes the project the form was opened from", () => {
    const out = handoffSharingProjects({
      projectIds: ["p-pay", "p-orders"],
      projectId: "p-pay",
      projects: PROJECTS,
    });
    expect(out.others.map((p) => p.id)).toEqual(["p-orders"]);
  });

  it("spells out at most three names and counts the rest beyond them", () => {
    const out = handoffSharingProjects({
      projectIds: ["p-pay", "p-orders", "p-cart", "p-checkout", "p-refunds"],
      projectId: "p-pay",
      projects: PROJECTS,
    });
    expect(out.shown.map((p) => p.title)).toEqual(["Orders", "Cart", "Checkout"]);
    // The count is the REAL total beyond the shown ones, so
    // 「A、B、C 以及另外 1 个」 adds up to four.
    expect(out.more).toBe(1);
    expect(out.others.length).toBe(4);
  });

  it("DROPS a project id the caller's list does not know, instead of counting it", () => {
    // Counting it would print 「以及另外 2 个」 beside one name — a number the
    // reader cannot reconcile.
    const out = handoffSharingProjects({
      projectIds: ["p-pay", "p-orders", "gone"],
      projectId: "p-pay",
      projects: PROJECTS,
    });
    expect(out.others.map((p) => p.id)).toEqual(["p-orders"]);
    expect(out.more).toBe(0);
  });

  it("handles a workflow used by this project alone", () => {
    const out = handoffSharingProjects({
      projectIds: ["p-pay"],
      projectId: "p-pay",
      projects: PROJECTS,
    });
    expect(out.others).toEqual([]);
    expect(out.more).toBe(0);
  });
});

describe("handoffTargetStatusKeys / handoffDefaultNextStatus", () => {
  const steps = [
    step("backlog", NONE),
    step("todo", NONE),
    step("in_progress", { type: "agent", id: "a1" }),
    step("in_review", NONE),
    step("blocked", NONE),
    step("done", NONE),
  ];

  it("offers every column except the step's own", () => {
    const keys = handoffTargetStatusKeys(steps, "in_progress");
    expect(keys).toEqual(["backlog", "todo", "in_review", "blocked", "done"]);
    expect(keys).not.toContain("in_progress");
  });

  it("defaults the next column to the following one, skipping blocked", () => {
    // blocked is a parking column, never a default destination — the same rule
    // `workflowNextStatus` applies for the card and the brief.
    expect(handoffDefaultNextStatus(steps, "in_progress")).toBe("in_review");
    expect(handoffDefaultNextStatus(steps, "in_review")).toBe("done");
  });

  it("has no default at the end of the pipeline", () => {
    expect(handoffDefaultNextStatus(steps, "done")).toBe("");
  });

  it("has no default for a status the workflow does not list", () => {
    expect(handoffDefaultNextStatus(steps, "cancelled")).toBe("");
  });

  it("ignores each step's OWN saved next_status_key when computing the default", () => {
    // Upstream strips them first (handoff-form.tsx:388). Echoing the saved
    // choice back as "the default" would make the unset row claim the step
    // already points somewhere it does not.
    const withOwn = steps.map((s) =>
      s.status_key === "in_progress" ? { ...s, next_status_key: "done" } : s,
    );
    expect(handoffDefaultNextStatus(withOwn, "in_progress")).toBe("in_review");
  });
});

describe("handoffSaveResultKind", () => {
  it("reports a plain save when the answered workflow is the one edited", () => {
    expect(
      handoffSaveResultKind({ editedWorkflowId: "wf-1", saved: { id: "wf-1" } }),
    ).toBe("same");
  });

  it("reports a copy when the answer is a different workflow row", () => {
    // The project-only scope copies the workflow; that new row is not in the
    // cache and the project now points at it.
    expect(
      handoffSaveResultKind({ editedWorkflowId: "wf-1", saved: { id: "wf-2" } }),
    ).toBe("copy");
  });

  it("falls back to 'same' when the answer carries no workflow at all", () => {
    // Nothing to patch — the caller invalidates instead. Reading this as
    // "copy" would claim a project repoint that did not happen.
    expect(handoffSaveResultKind({ editedWorkflowId: "wf-1", saved: null })).toBe("same");
    expect(handoffSaveResultKind({ editedWorkflowId: "wf-1", saved: { id: "" } })).toBe("same");
  });
});
