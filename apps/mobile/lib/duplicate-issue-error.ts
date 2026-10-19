/**
 * The structured 409 that `POST /api/issues` returns when the workspace
 * already holds an active issue with the same title (iteration 259, MYS-2245).
 *
 * Web's contract lives in `packages/core/api/schemas.ts:1908-1940`
 * (`DuplicateIssueErrorBodySchema`) and its consumption in
 * `packages/views/modals/create-issue.tsx:609-650`. The server's body is
 *
 *     { code: "active_duplicate_issue", error, issue: {id, identifier, title} }
 *
 * and web's whole point is that this is a GUARDED parse, not a cast: `code` is
 * a zod literal and `issue` is required, so a future server rename degrades to
 * the ordinary "create failed" toast instead of rendering a duplicate prompt
 * with nothing to point at. Mobile reached this round with **zero** references
 * to `active_duplicate_issue` anywhere in `app/`, `components/`, `lib/` or
 * `data/`: every 409 surfaced as the server's raw sentence
 * (`new-issue.tsx:355-360` → `Alert.alert(failedTitle, err.message)`), so the
 * one moment the client knows exactly which issue blocked the create was also
 * the moment it told the user nothing about it.
 *
 * ## Why the shared core schema rather than a mobile copy
 *
 * `DuplicateIssueErrorBodySchema` is already exported from
 * `@multica/core/api` and `apps/mobile` already depends on that package for
 * types and schemas (`data/api.ts` imports ~90 of them). Re-deriving the shape
 * here would create a second definition of a server contract that must drift
 * together — the exact class of bug `packages/core/api/schemas.test.ts:574`
 * exists to catch. So this module is a thin ADAPTER: it owns the decision
 * ("is this failure a duplicate?") and delegates the shape to core.
 *
 * ## Why the adapter is separate from the screen
 *
 * The rule has three parts that a screen is a bad place to hold:
 *
 *   1. only `ApiError` with `status === 409` is a candidate (a 400 carrying a
 *      `code` field must not be read as a duplicate);
 *   2. the body must parse (a drifted body is not a duplicate prompt);
 *   3. a parsed body with an empty `issue.id` is NOT navigable, so it must fall
 *      back — the "view existing" button would be a dead end.
 *
 * Point 3 is the one web's schema already enforces by requiring the field, but
 * web never has to check whether the id is EMPTY (`z.string()` accepts `""`).
 * Mobile's fallback is an alert the user can only dismiss, so a dead-end
 * button is worse there than no button. This module rejects an empty id.
 *
 * Framework-free (no react-native, no @tanstack) so the Node vitest lane can
 * exercise every branch — same constraint `lib/write-failure.ts` documents.
 */
import { DuplicateIssueErrorBodySchema } from "@multica/core/api";
import type { DuplicateIssueErrorBody } from "@multica/core/api";

/** The slice of a thrown failure this module inspects. `ApiError` from
 *  `data/api.ts` satisfies it structurally; so does a test double. */
export interface DuplicateCandidate {
  status?: number;
  body?: unknown;
}

/** What the screen should do with a failed create. */
export type CreateFailure =
  /** A duplicate the client can point at: show the duplicate prompt with a
   *  jump to `issue.id`. */
  | { kind: "duplicate"; issue: DuplicateIssueErrorBody["issue"] }
  /** Anything else — including a 409 whose body did not parse. The screen
   *  falls back to reporting the error itself. */
  | { kind: "other" };

/**
 * Classify a failed create.
 *
 * `DuplicateIssueErrorBodySchema.safeParse` never throws, which is what makes
 * this safe to call on an arbitrary server body: a 409 carrying HTML (a proxy
 * error page), an array, or a body with a renamed `code` all come back as
 * `{success: false}` and fall through to the generic failure path.
 */
export function classifyCreateFailure(
  error: DuplicateCandidate | null | undefined,
): CreateFailure {
  if (!error || error.status !== 409) return { kind: "other" };
  const parsed = DuplicateIssueErrorBodySchema.safeParse(error.body);
  if (!parsed.success) return { kind: "other" };
  // `z.string()` accepts an empty id; a jump target must not be empty, or the
  // "view existing issue" affordance leads nowhere.
  if (!parsed.data.issue.id) return { kind: "other" };
  return { kind: "duplicate", issue: parsed.data.issue };
}

/**
 * Which route the "view existing issue" affordance should push, or `null` when
 * the workspace slug is unknown (the app's issue routes are
 * `/[workspace]/issue/[id]`).
 *
 * Kept as a function rather than inlined at the call site so the "no slug → no
 * button" branch is testable: pushing `/undefined/issue/x` would be a crash,
 * and hiding the button is the honest alternative.
 */
export function duplicateIssueRoute(
  wsSlug: string | null | undefined,
  issueId: string,
): string | null {
  if (!wsSlug) return null;
  if (!issueId) return null;
  return `/${wsSlug}/issue/${issueId}`;
}

/**
 * The one-line description of the blocking issue, as web renders it
 * (`create-issue.tsx:629`: `{identifier} – {title}`).
 *
 * The en dash with spaces is web's separator, kept verbatim so the two clients
 * describe the same row identically. An issue with no title (possible for a
 * quick-created row the agent has not filled in yet) prints the identifier
 * alone rather than a dangling separator.
 */
export function duplicateIssueLine(issue: {
  identifier: string;
  title?: string | null;
}): string {
  const title = (issue.title ?? "").trim();
  return title ? `${issue.identifier} – ${title}` : issue.identifier;
}
