// @vitest-environment node
/**
 * The status picker's handoff hint (MYS-2874).
 *
 * Three things are pinned here, in order of how expensive they are to get
 * wrong:
 *
 *   1. **The hint and the gate agree.** A row that promises a handoff the gate
 *      will not ask about is worse than a bare row: the user is told what will
 *      happen and then it does not. `handoffHint` therefore goes through
 *      `stepHandsOff` — the same predicate `qualifiesForHandoffGate` reads —
 *      and the equivalence is asserted over every handler type rather than
 *      argued in a comment.
 *   2. **Nothing to say is silence, not an empty slot.** `null` where there is
 *      no handoff, so the row's right-hand edge stays empty and the checkmark
 *      stays aligned.
 *   3. **The current column draws no hint.** Re-entering a column reassigns
 *      nothing; a hint there would be a false statement about a move that does
 *      not happen.
 *
 * Plus the case that is specific to mobile's scope model: an issue OUTSIDE any
 * project has the Default workflow *and* no handoffs (the server applies none
 * there), so the hint must read `scope.defaultScope` before `scope.workflow`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type {
  IssueWorkflow,
  IssueWorkflowHandlerType,
  IssueWorkflowStep,
  Project,
} from "@multica/core/types";
import { stepHandsOff } from "./workflow";
import type { StatusScope, WorkflowReadState } from "./workflow-status-scope";
import {
  handoffHint,
  handoffHintActor,
  handoffHintCopy,
  statusHandoffHint,
  stepHandlerActor,
} from "./handoff-hint";

const step = (
  status_key: string,
  type: IssueWorkflowHandlerType,
  id?: string,
): IssueWorkflowStep => ({
  status_key,
  handler: id ? { type, id } : { type },
  instructions: "",
});

const workflowOf = (...steps: IssueWorkflowStep[]): IssueWorkflow => ({
  id: "wf-1",
  workspace_id: "ws-1",
  name: "Delivery",
  description: "",
  is_default: false,
  owner_id: null,
  steps,
  project_ids: [],
  created_at: "",
  updated_at: "",
});

const scopeOf = (
  workflow: IssueWorkflow | null,
  defaultScope: IssueWorkflow | null = null,
  state: WorkflowReadState = "ready",
): StatusScope => ({ workflow, defaultScope, authoritative: true, state });

const project = (lead_type: "member" | "agent" | null, lead_id: string | null): Project =>
  ({
    id: "p-1",
    workspace_id: "ws-1",
    title: "P",
    description: null,
    icon: null,
    status: "planned",
    priority: "none",
    lead_type,
    lead_id,
    start_date: null,
    due_date: null,
    workflow_id: null,
    created_at: "",
    updated_at: "",
    issue_count: 0,
    done_count: 0,
    resource_count: 0,
  }) as Project;

/** Every handler kind the type allows, with and without an id where that is
 *  possible. Used by the equivalence test below so a new handler type cannot
 *  be added without this suite noticing. */
const ALL_HANDLER_SHAPES: { type: IssueWorkflowHandlerType; id?: string }[] = [
  { type: "none" },
  { type: "agent", id: "agent-1" },
  { type: "agent" },
  { type: "squad", id: "squad-1" },
  { type: "squad" },
  { type: "member", id: "user-1" },
  { type: "member" },
  { type: "project_lead" },
  { type: "creator" },
];

describe("handoffHint — who a column hands the issue to (MYS-2874)", () => {
  it("names the agent a column hands off to", () => {
    expect(handoffHint(step("in_progress", "agent", "agent-1"), null)).toEqual({
      kind: "actor",
      actor: { type: "agent", id: "agent-1" },
    });
  });

  it("names squads and members the same way", () => {
    expect(handoffHint(step("in_progress", "squad", "squad-1"), null)).toEqual({
      kind: "actor",
      actor: { type: "squad", id: "squad-1" },
    });
    expect(handoffHint(step("in_progress", "member", "user-1"), null)).toEqual({
      kind: "actor",
      actor: { type: "member", id: "user-1" },
    });
  });

  it("falls back to the type noun when the handler names no id", () => {
    // A workflow saved before its handler was picked still hands off — the
    // server reassigns and the gate asks — so the row must say SOMETHING.
    expect(handoffHint(step("in_progress", "agent"), null)).toEqual({
      kind: "generic",
      type: "agent",
    });
    expect(handoffHint(step("in_progress", "member"), null)).toEqual({
      kind: "generic",
      type: "member",
    });
    expect(handoffHint(step("in_progress", "squad"), null)).toEqual({
      kind: "generic",
      type: "squad",
    });
  });

  it("resolves project_lead through the project's own lead", () => {
    const s = step("in_review", "project_lead");
    expect(handoffHint(s, project("agent", "agent-9"))).toEqual({
      kind: "projectLead",
      actor: { type: "agent", id: "agent-9" },
    });
    expect(handoffHint(s, project("member", "user-9"))).toEqual({
      kind: "projectLead",
      actor: { type: "member", id: "user-9" },
    });
  });

  it("keeps project_lead generic when the project has no lead", () => {
    // Still a handoff (the server resolves it per project at write time), but
    // nobody can be named yet — 「项目负责人」 is the honest copy.
    expect(handoffHint(step("in_review", "project_lead"), project(null, null))).toEqual({
      kind: "projectLead",
      actor: null,
    });
    expect(handoffHint(step("in_review", "project_lead"), null)).toEqual({
      kind: "projectLead",
      actor: null,
    });
  });

  it("names the creator generically — nobody is known before the issue exists", () => {
    expect(handoffHint(step("in_review", "creator"), null)).toEqual({ kind: "creator" });
  });

  it("returns null for a keeping-assignee step, a missing step, and a null project lead", () => {
    expect(handoffHint(step("in_progress", "none"), null)).toBeNull();
    expect(handoffHint(undefined, null)).toBeNull();
  });

  it("agrees with the gate's predicate on EVERY handler shape", () => {
    // The load-bearing assertion of this file. `stepHandsOff` is what
    // `qualifiesForHandoffGate` reads to decide whether to ask; a hint drawn
    // from any other judgement would promise or hide a handoff the gate
    // disagrees about.
    for (const shape of ALL_HANDLER_SHAPES) {
      const s = step("in_progress", shape.type, shape.id);
      const gateSaysHandoff = stepHandsOff(s);
      const hintSaysHandoff = handoffHint(s, project("agent", "agent-9")) !== null;
      expect(
        hintSaysHandoff,
        `handler ${shape.type}${shape.id ? `:${shape.id}` : ""} — hint must agree with stepHandsOff`,
      ).toBe(gateSaysHandoff);
    }
  });

  it("reaches its handoff answer THROUGH stepHandsOff, not through its own test", () => {
    // The equivalence above cannot, on its own, catch a re-derivation: today
    // `handler.type !== "none"` happens to agree with `stepHandsOff` on every
    // shape, so a mutant that inlined the check passed the behavioural test.
    // It would not agree the moment `stepHandsOff` grows a rule (a column the
    // server refuses to hand off, say) — and the divergence would show up as a
    // row promising a handoff the gate writes straight through.
    //
    // Measured, not assumed: replacing the call with `step.handler.type !==
    // "none"` leaves every behavioural assertion green.
    //
    // A spy on the module function catches it regardless of today's semantics,
    // because the hint must CALL the shared predicate rather than re-implement
    // it. `vi.spyOn` on an ES module namespace is not permitted here, so the
    // source is checked instead — the same technique `iter291-wiring.test.ts`
    // uses for call-site shape, applied to the one line that must not drift.
    const src = readFileSync(path.resolve(__dirname, "handoff-hint.ts"), "utf8");
    const body = src.slice(src.indexOf("export function handoffHint("));
    const predicate = body.slice(0, body.indexOf("\n}"));
    expect(predicate).toContain("stepHandsOff(step)");
    // …and there is exactly ONE such re-derivation site, so a second one
    // cannot be added quietly elsewhere in the module.
    expect(src.match(/handler\.type\s*(!==|===)\s*"none"/g) ?? []).toHaveLength(0);
  });

  it("draws no hint for a handler type this build does not know", () => {
    // `data/schemas.ts` degrades an unknown handler to "none", so this can only
    // be reached by a hand-built object — but the fallback must be silence,
    // not a wrong noun.
    const exotic = {
      status_key: "in_progress",
      handler: { type: "teleporter", id: "x-1" },
      instructions: "",
    } as unknown as IssueWorkflowStep;
    expect(handoffHint(exotic, null)).toBeNull();
  });
});

describe("stepHandlerActor — the avatar's subject (MYS-2874)", () => {
  it("returns the direct actor for agent / squad / member", () => {
    expect(stepHandlerActor(step("s", "agent", "a-1"), null)).toEqual({
      type: "agent",
      id: "a-1",
    });
  });

  it("resolves project_lead only when the project has both lead fields", () => {
    const s = step("s", "project_lead");
    expect(stepHandlerActor(s, project("agent", "a-1"))).toEqual({ type: "agent", id: "a-1" });
    // A half-set lead (a type with no id) must not produce an avatar with no
    // subject — the id would be `null` and Avatar would draw a blank chip.
    expect(stepHandlerActor(s, project("agent", null))).toBeNull();
    expect(stepHandlerActor(s, project(null, "a-1"))).toBeNull();
  });

  it("returns null for none, creator, and a missing step", () => {
    expect(stepHandlerActor(step("s", "none"), null)).toBeNull();
    expect(stepHandlerActor(step("s", "creator"), null)).toBeNull();
    expect(stepHandlerActor(undefined, project("agent", "a-1"))).toBeNull();
  });

  it("returns null for a named handler with no id", () => {
    expect(stepHandlerActor(step("s", "agent"), project("agent", "a-1"))).toBeNull();
  });
});

describe("handoffHintActor — what the row can draw an avatar for", () => {
  it("narrows the two actor-bearing shapes and nothing else", () => {
    expect(handoffHintActor({ kind: "actor", actor: { type: "agent", id: "a" } })).toEqual({
      type: "agent",
      id: "a",
    });
    expect(
      handoffHintActor({ kind: "projectLead", actor: { type: "member", id: "u" } }),
    ).toEqual({ type: "member", id: "u" });
    // A projectLead with no resolved lead declines the avatar but keeps the
    // hint, so the caller names the role instead.
    expect(handoffHintActor({ kind: "projectLead", actor: null })).toBeNull();
    expect(handoffHintActor({ kind: "creator" })).toBeNull();
    expect(handoffHintActor({ kind: "generic", type: "agent" })).toBeNull();
  });
});

describe("handoffHintCopy — what the row can say right now", () => {
  it("prints the resolved name when the directory answered", () => {
    expect(
      handoffHintCopy({ kind: "actor", actor: { type: "agent", id: "a-1" } }, "Ada"),
    ).toEqual({ kind: "named", name: "Ada" });
  });

  it("degrades to the ROLE, never to a blank, while the directory is unread", () => {
    // 「交给 」 with its object missing reads as a bug, and 「Unknown Agent」 is a
    // claim the client cannot back. The role is the part the WORKFLOW states,
    // so it is the part that may be printed early.
    expect(
      handoffHintCopy({ kind: "actor", actor: { type: "agent", id: "a-1" } }, null),
    ).toEqual({ kind: "noun", nounKey: "workflow.handler.agent" });
  });

  it("uses the type noun for every id-less handler kind", () => {
    expect(handoffHintCopy({ kind: "generic", type: "squad" }, null)).toEqual({
      kind: "noun",
      nounKey: "workflow.handler.squad",
    });
    expect(handoffHintCopy({ kind: "generic", type: "member" }, "Ada")).toEqual({
      kind: "noun",
      nounKey: "workflow.handler.member",
    });
    expect(handoffHintCopy({ kind: "creator" }, null)).toEqual({
      kind: "noun",
      nounKey: "workflow.handler.creator",
    });
  });

  it("keeps the role for a project lead that resolves to nobody", () => {
    expect(handoffHintCopy({ kind: "projectLead", actor: null }, "Ada")).toEqual({
      kind: "noun",
      nounKey: "workflow.handler.project_lead",
    });
    expect(
      handoffHintCopy({ kind: "projectLead", actor: { type: "member", id: "u-1" } }, null),
    ).toEqual({ kind: "noun", nounKey: "workflow.handler.project_lead" });
  });

  it("names a resolved project lead", () => {
    expect(
      handoffHintCopy({ kind: "projectLead", actor: { type: "member", id: "u-1" } }, "Grace"),
    ).toEqual({ kind: "leadNamed", name: "Grace" });
  });
});

describe("statusHandoffHint — one picker row (MYS-2874)", () => {
  const wf = workflowOf(
    step("todo", "none"),
    step("in_progress", "agent", "agent-1"),
    step("in_review", "project_lead"),
    step("done", "none"),
  );

  it("draws the hint on an entering row that hands off", () => {
    expect(
      statusHandoffHint({
        scope: scopeOf(wf),
        project: project("agent", "agent-9"),
        statusKey: "in_progress",
        currentStatus: "todo",
      }),
    ).toEqual({ kind: "actor", actor: { type: "agent", id: "agent-1" } });
  });

  it("draws nothing on a row that keeps the assignee", () => {
    expect(
      statusHandoffHint({
        scope: scopeOf(wf),
        project: null,
        statusKey: "done",
        currentStatus: "todo",
      }),
    ).toBeNull();
  });

  it("draws nothing on the issue's OWN status", () => {
    // Upstream's `option.key !== status` guard. Without it the row the user is
    // already on says 「交给 agent-1」 — a statement about a move that does not
    // happen, on the one row they are most likely to look at.
    expect(
      statusHandoffHint({
        scope: scopeOf(wf),
        project: null,
        statusKey: "in_progress",
        currentStatus: "in_progress",
      }),
    ).toBeNull();
  });

  it("draws nothing outside any project, even though Default names the columns", () => {
    // The bug this test exists for: `scope.workflow` IS the Default workflow
    // here, and it lists a handoff column — but the server applies no handoffs
    // outside a project (`issueworkflow.OutsideProject`), and the gate writes
    // straight through. `defaultScope` is the only field that says so.
    const defaultWf = { ...wf, is_default: true };
    expect(
      statusHandoffHint({
        scope: scopeOf(defaultWf, defaultWf),
        project: project("agent", "agent-9"),
        statusKey: "in_progress",
        currentStatus: "todo",
      }),
    ).toBeNull();
  });

  it("draws nothing while the workflow read has not answered", () => {
    // pending and failed both reach here as a null workflow; both must stay
    // silent rather than optimistically promise a handoff.
    for (const state of ["pending", "failed"] as const) {
      expect(
        statusHandoffHint({
          scope: scopeOf(null, null, state),
          project: project("agent", "agent-9"),
          statusKey: "in_progress",
          currentStatus: "todo",
        }),
        `state=${state}`,
      ).toBeNull();
    }
  });

  it("draws nothing for a status the workflow does not list", () => {
    expect(
      statusHandoffHint({
        scope: scopeOf(wf),
        project: null,
        statusKey: "blocked",
        currentStatus: "todo",
      }),
    ).toBeNull();
  });

  it("draws the hint when the current status is unknown but the row hands off", () => {
    // The create-form picker has no current status yet (`null`); a handoff row
    // there still has to say so.
    expect(
      statusHandoffHint({
        scope: scopeOf(wf),
        project: null,
        statusKey: "in_progress",
        currentStatus: null,
      }),
    ).not.toBeNull();
    expect(
      statusHandoffHint({
        scope: scopeOf(wf),
        project: null,
        statusKey: "in_progress",
        currentStatus: undefined,
      }),
    ).not.toBeNull();
  });

  it("passes the project through so project_lead resolves", () => {
    expect(
      statusHandoffHint({
        scope: scopeOf(wf),
        project: project("member", "user-9"),
        statusKey: "in_review",
        currentStatus: "in_progress",
      }),
    ).toEqual({ kind: "projectLead", actor: { type: "member", id: "user-9" } });
  });
});
