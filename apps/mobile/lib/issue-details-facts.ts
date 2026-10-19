/**
 * The three immutable facts about an issue that web's sidebar prints in its
 * collapsible "Details" block (iteration 259, MYS-2245).
 *
 * Web's block (`packages/views/issues/components/issue-detail.tsx:2337-2360`)
 * answers "who filed this, and when did it last move". Mobile had no
 * equivalent: `creator_id` was read in exactly two places (the duplicates list
 * and the table's creator column), and `created_at` / `updated_at` were only
 * ever rendered as relative time inside an activity row. So a reader on a phone
 * could see that something happened an hour ago but not when the issue itself
 * was filed, nor by whom.
 *
 * This module owns the two DECISIONS the block has to make, so both are
 * unit-testable in the Node lane where there is no RN renderer:
 *
 *   1. **What may be said about the creator.** It is an ASSERTION — the block
 *      reports a stored fact, not an echo of something the user just picked —
 *      so the 254–257 rule applies: an unread directory withholds, it never
 *      prints 「Unknown」. `lib/actor-name-state.ts` already encodes that
 *      decision; this module only feeds it the right inputs.
 *
 *   2. **How a timestamp reads.** Web's `shortDate` is
 *      `formatDateOnly(date, { month: "short", day: "numeric" }, "en-US")` and
 *      `—` for absent. `lib/autopilot-format.ts`'s `formatDateOnlyShort` is the
 *      same rendering over the ACTIVE app locale, which is the right call here:
 *      web hard-codes `en-US` in that helper because the web bundle has one
 *      locale per build, while mobile's language is a user setting
 *      (`lib/i18n`). Same shape, correct locale — not a divergence to fix.
 *
 * Why a separate module rather than inline JSX: the "unread directory must not
 * assert a name" rule has now been broken three times by a fresh call site
 * (MYS-2215 / 2227 / 2228). Putting the decision behind a function that the
 * test lane can call makes the fourth surface a wiring exercise instead of a
 * chance to re-derive the rule from memory.
 */
import type { Issue } from "@multica/core/types";
import {
  actorNameState,
  actorNameText,
  type ActorReadiness,
  type ActorType,
} from "./actor-name-state";

/** The creator line's text, or `null` when nothing may be asserted yet. */
export type CreatorLine =
  | { kind: "name"; text: string }
  /** The directory has not answered (loading or failed). The block renders a
   *  load mark — NOT 「Unknown」, and not an empty string either, because an
   *  empty creator row reads as "this issue has no creator", which is false. */
  | { kind: "unsettled" };

/** What the Details block may say about who filed the issue. */
export function creatorLine(
  issue: Pick<Issue, "creator_type" | "creator_id">,
  deps: {
    readiness: ActorReadiness;
    /** `useActorLookup().getName` — only consulted once the directory for the
     *  type has settled; see `actorNameState`'s ordering. Declared with the
     *  lookup's own (narrower) parameter types so the hook's function can be
     *  passed directly without a wrapper cast. */
    getName: (
      type: ActorType | null | undefined,
      id: string | null | undefined,
    ) => string;
  },
): CreatorLine {
  const state = actorNameState({
    type: issue.creator_type as ActorType | string | null | undefined,
    id: issue.creator_id,
    name: deps.getName(
      issue.creator_type as ActorType | null | undefined,
      issue.creator_id,
    ),
    readiness: deps.readiness,
  });
  if (state.kind === "unsettled") return { kind: "unsettled" };
  // `name` and `gone` both identify a row: the first by its name, the second by
  // the id fragment the rest of the app uses for a vanished actor
  // (`GONE_ID_FRAGMENT`). Web prints `getActorName` here, whose "Unknown" is
  // exactly the sentinel 254–257 removed from mobile — so a gone actor reads as
  // the fragment, which is more information and is never a false claim.
  return { kind: "name", text: actorNameText(state) };
}

/** A `YYYY-MM-DD…` timestamp as web's `shortDate` renders it, or `—`. */
export function detailsStamp(
  value: string | null | undefined,
  format: (iso: string | null | undefined) => string,
): string {
  return format(value);
}
