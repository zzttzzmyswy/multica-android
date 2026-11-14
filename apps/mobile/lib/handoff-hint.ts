/**
 * "Choosing this column hands the issue to <who>" — the inline hint web draws
 * on every status-picker row (MUL-7420, MYS-2874).
 *
 * ## Why this exists
 *
 * Iteration 290 taught the phone to *intercept* a handoff: picking a column
 * that reassigns first opens the confirmation sheet. That is the answer AFTER
 * the tap. The desktop also answers BEFORE it — `StepHandoffHint`
 * (`packages/views/issues/components/pickers/status-picker.tsx:218`) draws a
 * `CornerDownRight` glyph plus the handler's avatar or name on the right of
 * every row that reassigns, so a web user knows what a column does before
 * committing to it. On the phone the only way to find out was to pick the
 * column and get stopped.
 *
 * ## The one rule this module exists to enforce
 *
 * **The hint and the gate must be the same decision.** A row that says
 * 「交给某人」 while the gate answers `apply` (writes without asking) is worse
 * than no hint at all: the reader is told a handoff will happen and then it
 * silently does not, or vice versa. So the hint is derived from
 * `stepHandsOff` — the exact predicate `lib/handoff-gate.ts` uses to decide
 * whether to ask — and never from its own reading of `handler.type`. There is
 * one test asserting `handoffHint(step) !== null ⟺ stepHandsOff(step)` over
 * every handler type, and mutating either side breaks it.
 *
 * ## The second rule: a hint is an ASSERTION, so unknown is silent
 *
 * Which folder's state a status sits in is not knowable while the workflow read
 * is in flight or failed, and `resolveStatusScope` says so by returning a null
 * workflow. A null workflow yields no step, and a step-less column hands off
 * nothing as far as this client can prove — so the hint is withheld rather than
 * guessed. Same rule as `lib/actor-name-state.ts` for names, and the same
 * reason: a claim the client cannot back is worse than a blank.
 *
 * Outside any project there is a subtler version of it (MUL-8121): the Default
 * workflow still lists the columns and `resolveStatusScope` still names it, but
 * the server applies **no** handoffs there (`issueworkflow.OutsideProject` is
 * nil). `scope.defaultScope` is the field that marks that case, and
 * {@link statusHandoffHint} reads it before anything else — which is why this
 * module takes a `StatusScope` rather than a bare `IssueWorkflow`. Upstream
 * models it the same way, and wiring the hint to `scope.workflow` instead would
 * print 「交给 X」 on every row of every project-less issue while the gate
 * correctly writes straight through.
 *
 * ## What is a display concern, and what is not
 *
 * The DECISION ("does this column hand off, and to what kind of actor") is
 * here, framework-free, so the Node vitest lane can reach every branch. Turning
 * an actor id into a name needs the workspace directories and i18n, so that
 * half lives in `components/issue/handoff-hint.tsx`. Upstream splits it the
 * same way — `stepHandlerActor` is pure, `useStepHandlerLabel` is a hook — and
 * keeping the split means the gate and the hint never disagree about `none`.
 *
 * ## The divergence from web, stated once
 *
 * Web puts the sentence in a tooltip and draws only an avatar. A phone has no
 * hover, so the same row draws the glyph, the avatar AND the name, and puts the
 * whole sentence on the row's `accessibilityLabel`. Visible text is the
 * handler's name; the sentence is for the screen reader. See
 * `components/issue/handoff-hint.tsx`.
 */
import type { IssueWorkflow, IssueWorkflowStep, Project } from "@multica/core/types";
import { stepHandsOff, workflowStep } from "@/lib/workflow";
import type { StatusScope } from "@/lib/workflow-status-scope";

/** The three handler types that name one concrete actor row. */
export type HandoffActorType = "agent" | "squad" | "member";

/** A named actor a step hands the issue to. */
export interface HandoffActor {
  type: HandoffActorType;
  id: string;
}

/**
 * Who entering a column hands the issue to, as far as it can be named up front.
 *
 * Four shapes, because the four handler kinds need different copy and only two
 * of them can be resolved to an actor row:
 *
 *   - `actor` — an agent / squad / member with an id: name and avatar.
 *   - `generic` — the same three kinds with NO id (a workflow saved before one
 *     was picked): the row still hands off, the type noun is all there is.
 *   - `projectLead` — resolved per project; `actor` is the project's lead when
 *     one is set, else null and the copy stays generic.
 *   - `creator` — resolved per issue; nobody is known until the issue exists.
 */
export type HandoffHint =
  | { kind: "actor"; actor: HandoffActor }
  | { kind: "generic"; type: HandoffActorType }
  | { kind: "projectLead"; actor: HandoffActor | null }
  | { kind: "creator" };

/**
 * The concrete actor a step hands off to, when one can be named up front.
 *
 * A line-for-line transcription of upstream's `stepHandlerActor`
 * (`packages/views/workflows/step-handler.ts`), which the handoff hint uses to
 * decide between an avatar and a bare name. `project_lead` resolves through the
 * PROJECT's own lead fields; every other type either names its actor directly
 * or names none.
 */
export function stepHandlerActor(
  step: IssueWorkflowStep | undefined,
  project: Pick<Project, "lead_type" | "lead_id"> | null | undefined,
): HandoffActor | null {
  if (!step) return null;
  const { type, id } = step.handler;
  if ((type === "agent" || type === "squad" || type === "member") && id) {
    return { type, id };
  }
  if (type === "project_lead" && project?.lead_type && project.lead_id) {
    // `Project.lead_type` is "member" | "agent" | null, so the narrowing is
    // exact — a squad can never lead a project.
    return { type: project.lead_type, id: project.lead_id };
  }
  return null;
}

/**
 * What entering `step` hands the issue to, or null when it hands off nothing.
 *
 * `null` is the answer for a step that keeps the assignee (`handler.type ===
 * "none"`), for a missing step, and — through `stepHandsOff` — for anything
 * this build cannot read as a handoff. The caller renders NOTHING in that case,
 * not an empty slot: a blank right-hand column on every non-handoff row would
 * break the alignment the checkmark relies on, and upstream's `if (!handler)
 * return null` makes the same call.
 *
 * The `default` arm is unreachable while the handler union holds, and returns
 * null so that a server inventing a handler type degrades to "no hint" rather
 * than to a wrong one — the same way `data/schemas.ts` degrades an unknown
 * handler to `"none"`.
 */
export function handoffHint(
  step: IssueWorkflowStep | undefined,
  project: Pick<Project, "lead_type" | "lead_id"> | null | undefined,
): HandoffHint | null {
  // The ONE predicate the handoff gate also uses. Never re-read
  // `handler.type` here — see the module doc.
  if (!step || !stepHandsOff(step)) return null;

  const { type, id } = step.handler;
  switch (type) {
    case "agent":
    case "squad":
    case "member":
      return id ? { kind: "actor", actor: { type, id } } : { kind: "generic", type };
    case "project_lead":
      return { kind: "projectLead", actor: stepHandlerActor(step, project) };
    case "creator":
      return { kind: "creator" };
    default:
      return null;
  }
}

/** The actor a hint can draw an avatar for, when it has one. */
export function handoffHintActor(hint: HandoffHint): HandoffActor | null {
  return hint.kind === "actor" ? hint.actor : hint.kind === "projectLead" ? hint.actor : null;
}

/** Every noun the hint can fall back to. Literal keys, not built from the
 *  handler type, so a renamed key is a type error rather than a blank row. */
export type HandoffNounKey =
  | "workflow.handler.agent"
  | "workflow.handler.squad"
  | "workflow.handler.member"
  | "workflow.handler.project_lead"
  | "workflow.handler.creator";

const NOUN_KEY: Record<HandoffActorType | "project_lead" | "creator", HandoffNounKey> = {
  agent: "workflow.handler.agent",
  squad: "workflow.handler.squad",
  member: "workflow.handler.member",
  project_lead: "workflow.handler.project_lead",
  creator: "workflow.handler.creator",
};

/**
 * The NAME half of 「交给 X」, before it becomes a string.
 *
 * A descriptor rather than text, because the name needs two things a pure
 * module does not have: the workspace directories (an id → a name) and i18n (a
 * noun). Splitting it here keeps the interesting decision testable — including
 * the one that is easy to get wrong:
 *
 * **An unresolved name degrades to the ROLE, never to a blank or to
 * 「Unknown」.** The directory not having answered is not a fact about the
 * workflow: the workflow *does* say "hand to an agent", and only the agent's
 * name is pending. So the row says 「智能体」 and switches to the real name when
 * the read lands, the same way `lib/actor-name-state.ts` distinguishes an
 * unread directory from a measured absence. Rendering `actorNameText`'s `""`
 * here would produce 「交给 」 — a sentence with its object missing, which reads
 * as a bug rather than as loading.
 *
 * ## Why the role is a separate piece and not a suffix
 *
 * The piece that separates a project-lead row from a plain-agent row is the
 * role. Composed into the name as upstream's 「（项目负责人）」 suffix, it is the
 * FIRST thing a narrow row cuts: measured on a Pixel 5, the project-lead row
 * and the plain agent row above it BOTH rendered 「Multica安卓开发…」, so two
 * different hints read identically exactly where the difference is the point.
 * So the caller draws the role FIRST and the name second, and truncation eats
 * the name instead of the qualifier. `named` keeps the same shape with an empty
 * role, so every caller has one layout to render.
 */
export type HandoffHintCopy =
  | { kind: "named"; name: string; role: "" }
  | { kind: "noun"; nounKey: HandoffNounKey; role: "" }
  | { kind: "leadNamed"; name: string; roleKey: "workflow.handler.project_lead" };

/**
 * The copy for one hint. `actorName` is the resolved directory name for
 * {@link handoffHintActor}, or null when it is not settled yet (or when the
 * hint names no actor at all).
 */
export function handoffHintCopy(hint: HandoffHint, actorName: string | null): HandoffHintCopy {
  switch (hint.kind) {
    case "actor":
      return actorName
        ? { kind: "named", name: actorName, role: "" }
        : { kind: "noun", nounKey: NOUN_KEY[hint.actor.type], role: "" };
    case "generic":
      return { kind: "noun", nounKey: NOUN_KEY[hint.type], role: "" };
    case "projectLead":
      // A project lead with no lead row is `noun`; one with a row but no name
      // yet is also `noun` — the role is what is known in both cases.
      return hint.actor && actorName
        ? {
            kind: "leadNamed",
            name: actorName,
            roleKey: "workflow.handler.project_lead",
          }
        : { kind: "noun", nounKey: NOUN_KEY.project_lead, role: "" };
    case "creator":
      return { kind: "noun", nounKey: NOUN_KEY.creator, role: "" };
  }
}

export interface StatusHandoffHintInput {
  /** The scope `useIssueStatusOptions` resolved for this issue. */
  scope: Pick<StatusScope, "workflow" | "defaultScope">;
  /** The project the issue is in, for a `project_lead` handler. */
  project: Pick<Project, "lead_type" | "lead_id"> | null | undefined;
  /** The row being drawn. */
  statusKey: string;
  /** The issue's current status — its own row draws no hint. */
  currentStatus: string | null | undefined;
}

/**
 * The hint for ONE picker row, or null when that row draws none.
 *
 * Three ways to get null, each with its own reason and its own test:
 *
 *   1. **Outside any project** (`scope.defaultScope` set) — the Default
 *      workflow lists the columns but the server applies no handoffs there.
 *   2. **The row is the issue's current status** — entering the column it is
 *      already in reassigns nothing, so 「交给 X」 would be false. Upstream's
 *      `option.key !== status` guard (`status-picker.tsx:191`).
 *   3. **Nothing is known** — a null workflow (read pending or failed, or a
 *      surface spanning projects) has no step to read, and a step that is not
 *      there cannot be shown to hand off.
 */
export function statusHandoffHint(input: StatusHandoffHintInput): HandoffHint | null {
  const { scope, project, statusKey, currentStatus } = input;
  // 1 — see `issueworkflow.OutsideProject`; `scope.workflow` still names the
  // Default here, so this test cannot be folded into the null check below.
  if (scope.defaultScope) return null;
  const workflow: IssueWorkflow | null = scope.workflow;
  // 3 — a read that has not answered names no workflow, which is the whole
  // reason this is silent rather than optimistic.
  if (!workflow) return null;
  // 2 — the current column reassigns nothing by being re-entered.
  if (currentStatus != null && statusKey === currentStatus) return null;
  return handoffHint(workflowStep(workflow, statusKey), project);
}
