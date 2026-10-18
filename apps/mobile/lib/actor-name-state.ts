/**
 * What a surface may say where it names an actor (member / agent / squad)
 * whose row lives in a workspace directory read.
 *
 * The defect (MYS-2215, iteration 254): `data/use-actor-name.ts`'s `getName`
 * folded two different facts into one string —
 *
 *     maps.members.get(id)?.name ?? "Unknown"        // :67
 *     maps.agents.get(id)?.name  ?? "Unknown Agent"  // :70
 *
 * — "the directory has not answered yet" and "it answered, and this actor is
 * genuinely gone". `useActorLookup` already computed the flag that separates
 * them (`resolved`), but for three rounds it had exactly ONE consumer: the
 * projects list's lead cell (`components/project/project-inline-cells.tsx`,
 * iteration 253). The issue table's assignee and creator columns printed
 * `Unknown` / `Unknown Agent` on every row of a cold start, and the same was
 * true of 40-odd other `getName` call sites.
 *
 * `lib/catalog-state.ts` states the rule this module applies: a read that has
 * not settled may paint its load state, but it may not assert a fact. A name
 * is a fact — the most confident one a row can carry, since a reader takes
 * 「Unknown Agent」 as "this agent was deleted", not "your request is in
 * flight".
 *
 * ## Readiness is per actor TYPE, not per lookup
 *
 * `useActorLookup().resolved` is `membersRead.isResolved && agentsRead.isResolved`
 * — both directories, because a *project lead* may be either. A surface that
 * only ever draws agents (run rows, the run timeline, usage breakdowns) must
 * not wait for the members read, and vice versa: gating on the pair would
 * blank agent names whenever the member list is slow, which is a new way to
 * lose information. So readiness here is keyed on the type being resolved:
 * `{ member, agent, squad }`, each one that directory's own settle flag.
 *
 * `squad` is included even though the projects list deliberately ignores it
 * (no `Project.lead_type` is ever a squad): `Issue.assignee_type` IS a squad
 * union member, so an issue row's assignee cell does read that directory.
 *
 * Three states, not two, because "gone" and "this client cannot name it" are
 * different facts and only the first is a measurement:
 *
 *   - `name`      — the directory answered and holds the row.
 *   - `gone`      — the directory answered and does NOT hold the row. Renders
 *                   the id fragment, matching web's convention and this app's
 *                   `lib/actor-profile.ts` ("a row must still identify *which*
 *                   member is missing").
 *   - `unsettled` — no answer yet (loading, or the read failed). Renders
 *                   nothing visible: a claim it cannot back.
 *
 * A failed read is deliberately folded into `unsettled` rather than given its
 * own sentence. For a per-cell claim the two are the same withholding — the
 * surface must not name an actor it could not look up — and the failure has
 * its own banner surfaces upstream. That is the same call
 * `lib/skill-supporting-data.ts` makes for its cells while treating the
 * banner separately.
 *
 * Kept DOM-free and framework-free so every branch is unit-testable in the
 * Node vitest lane, where there is no RN renderer to exercise a component.
 */

import type { CatalogState } from "./catalog-state";
import { isCatalogResolved } from "./catalog-state";

/** The three actor types a workspace directory can answer for. `system` is
 *  not one of them: it names no row and no read can fail it. */
export type ActorType = "member" | "agent" | "squad";

/** Every directory's settle flag, keyed by the actor type it answers for —
 *  what `useActorLookup()` returns as `resolvedBy`. */
export interface ActorReadiness {
  member: boolean;
  agent: boolean;
  squad: boolean;
}

/** Where a directory's readiness comes from, per type — the shape
 *  `catalogRead(...).isResolved` already has, one entry per directory. */
export function actorReadiness(read: {
  member: CatalogState | boolean;
  agent: CatalogState | boolean;
  squad: CatalogState | boolean;
}): ActorReadiness {
  const settled = (value: CatalogState | boolean) =>
    typeof value === "boolean" ? value : isCatalogResolved(value);
  return {
    member: settled(read.member),
    agent: settled(read.agent),
    squad: settled(read.squad),
  };
}

/** True when the directory that would answer for `type` has settled. An
 *  unknown type can never be settled — there is no read to trust. */
export function isActorTypeResolved(
  readiness: ActorReadiness,
  type: ActorType | string | null | undefined,
): boolean {
  if (type === "member" || type === "agent" || type === "squad") {
    return readiness[type];
  }
  return false;
}

/** What a surface may render for one actor reference. */
export type ActorNameState =
  | { kind: "name"; name: string }
  | { kind: "gone"; name: string }
  | { kind: "unsettled" };

/** How many characters of an unrunnable id stand in for its name. Web uses 8
 *  (`packages/views/members/member-profile-card.tsx` and this app's
 *  `lib/actor-profile.ts` agree on the number). */
export const GONE_ID_FRAGMENT = 8;

export interface ActorNameInput {
  type: ActorType | string | null | undefined;
  id: string | null | undefined;
  /** The raw lookup result — `getName`'s output. Only consulted when the
   *  directory for `type` settled; see `actorNameState`. */
  name: string;
  readiness: ActorReadiness;
  /** Resolved fallback for a `null`/absent actor (`system` rows, or a field
   *  that holds no actor at all). Surfaces that never render such a row pass
   *  nothing and get `unsettled` — which is honest, since there is nothing to
   *  name. */
  fallback?: { kind: "name"; name: string } | { kind: "absent" };
}

/**
 * Decide what to render for one actor reference.
 *
 * The order matters and is the whole point:
 *
 *   1. No `type` / no `id` → `absent` (via `fallback`) or `unsettled`. No
 *      directory read can answer for a reference that does not exist, so
 *      showing "Unassigned" here is not a claim about a read at all — the
 *      surface decides, and passes `fallback` when it knows it means empty.
 *   2. The directory for `type` has NOT settled → `unsettled`, and the
 *      `name` argument is never read. This is the branch whose absence was
 *      the bug: reading `name` first and comparing it against "Unknown" would
 *      still print 「Unknown」 for the whole time the read is in flight,
 *      because that is exactly what `getName` returns then.
 *   3. Settled, and `name` identifies a real actor → `name`.
 *   4. Settled, and `name` does not → `gone`, rendering the id fragment.
 */
export function actorNameState(input: ActorNameInput): ActorNameState {
  const { type, id, name, readiness, fallback } = input;

  if (!type || !id) {
    if (fallback?.kind === "name") return { kind: "name", name: fallback.name };
    return { kind: "unsettled" };
  }

  if (!isActorTypeResolved(readiness, type)) return { kind: "unsettled" };

  if (isResolvedActorName(name)) return { kind: "name", name };
  return { kind: "gone", name: id.slice(0, GONE_ID_FRAGMENT) };
}

/**
 * The sentinels `useActorLookup().getName` substitutes when it cannot resolve
 * an actor (`data/use-actor-name.ts`). Kept in one place because three
 * surfaces now need to ask "is this a real name?" — the projects list's lead
 * cell (`lib/project-inline-edit.ts`), the issue table's CSV export, and this
 * module's `gone` branch.
 *
 * Note `"Squad"`: `getName` returns it both for a squad it could not find AND
 * for any type it does not recognise, so it can never identify a squad named
 * "Squad" — the same reason web's pickers treat it as a fallback.
 */
export const UNRESOLVED_ACTOR_NAMES: ReadonlySet<string> = new Set([
  "Unknown",
  "Unknown Agent",
  "Unknown Squad",
  "Squad",
  "System",
]);

/**
 * The string form of a decision, for the call sites that fold several names
 * into one line (the issue table's actor-valued custom property joins its refs
 * with ", ") or hand the text to a parent <Text>.
 *
 * An unsettled reference contributes NOTHING. A comma-separated list that
 * silently gained the word "Unknown" between two commas is the same false
 * claim as a whole cell full of it, only harder to notice.
 *
 * Lives here rather than beside the components so the Node test lane can reach
 * it — `components/ui/actor-name.tsx` imports react-native, which that lane
 * cannot parse.
 */
export function actorNameText(state: ActorNameState): string {
  return state.kind === "unsettled" ? "" : state.name;
}

/** A name that identifies a real actor, as opposed to a lookup fallback. */
export function isResolvedActorName(name: string): boolean {
  return name.length > 0 && !UNRESOLVED_ACTOR_NAMES.has(name);
}

/**
 * What a `system` actor is called.
 *
 * The platform writes timeline entries and comments with
 * `actor_type: "system"` (`server/migrations/001_init.up.sql` has it in the
 * CHECK constraint; a child-done comment and a failed-run notice are the two
 * a reader meets most). No workspace directory answers for it — there is no
 * row to be missing — so its name is a constant, not a read result, and it may
 * be stated at any time.
 *
 * `"Multica"` for the same reason web's `buildActorNameResolver`
 * (`packages/core/workspace/hooks.ts`) returns it: the name is the product's,
 * not a person's, so it is not translated.
 *
 * This constant matters beyond cosmetics: without it, a system row reaching a
 * read-state-aware resolver falls through `isActorTypeResolved` as "no
 * directory can answer" and is withheld forever — i.e. wiring a surface to
 * the primitive would silently blank every platform notice. `getName` already
 * conflates the case, answering "Squad" for a system reference (its final
 * `return` is the squad fallback), which is a wrong name rather than a
 * withheld one.
 */
export const SYSTEM_ACTOR_NAME = "Multica";

/** The `ActorNameState` for a `system` reference. A frozen constant so a
 *  memoised resolver can return one stable object. */
export const SYSTEM_ACTOR_STATE: ActorNameState = {
  kind: "name",
  name: SYSTEM_ACTOR_NAME,
};

/** How a folded thread's author list spells its "and N more" tail. Matches the
 *  `+N` both mobile bars already use, and web's `bar_authors_more` carries the
 *  same count in prose. */
export function authorsMoreSuffix(remaining: number): string {
  return remaining > 0 ? `+${remaining}` : "";
}

/**
 * The author line the two folded-thread bars draw: up to `maxNamed` resolved
 * names, joined with ", ", plus ` +N` for the rest.
 *
 * Two failure modes this exists to rule out, both of which the pre-255 bars
 * had once names could be withheld:
 *
 *   1. **Empty segments.** Those bars mapped every author through
 *      `actorNameText(...).join(", ")`. With an `unsettled` author the result is
 *      `"Ada, , Grace"` — a separator with no word on either side of the gap,
 *      which a reader takes for a name they are expected to know. An unsettled
 *      author contributes NOTHING and its separator goes with it.
 *   2. **`+N` counting authors it never named.** `remaining` was
 *      `ordered.length - MAX_NAMED`, computed over the full author list before
 *      any name was withheld — so "Ada, +3" could stand for three people of
 *      whom the line named none. The tail counts what is genuinely left out of
 *      the string.
 *
 * `unsettled` and `gone` are counted differently on purpose. A `gone` author is
 * a *measured* participant (the directory answered and does not hold them), so
 * they fill one of the named slots with their id fragment — exactly what
 * `actorNameState`'s `gone` branch decides for a whole cell. An `unsettled`
 * author is not yet known to have taken part at all, so they name nothing and
 * are not counted in the tail either: that tail's job is to account for
 * participants the line chose to abbreviate, and there is nothing to abbreviate
 * about a name nobody has read.
 *
 * The empty-string case is therefore reachable and correct: a thread whose
 * authors are all unsettled has nothing to say about who took part yet. `""` —
 * not a bare "+5" — is what lets the bars withhold the whole clause and fall
 * back to a sentence that names nobody, the same call
 * `components/inbox/detail-label.tsx` makes for a name embedded mid-sentence.
 */
export function joinedActorNames(
  entries: readonly { type: ActorType | string | null | undefined; id: string | null | undefined }[],
  resolve: (
    type: ActorType | string | null | undefined,
    id: string | null | undefined,
  ) => ActorNameState,
  maxNamed: number,
): string {
  // Distinct by the reference, first-seen order — the dedupe both bars did
  // before calling this, moved in so the count and the list come from one walk.
  const seen = new Set<string>();
  const unique: { type: ActorType | string | null | undefined; id: string | null | undefined }[] = [];
  for (const entry of entries) {
    const key = `${entry.type}:${entry.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }

  const named: string[] = [];
  let abbreviated = 0;
  for (const entry of unique) {
    const state = resolve(entry.type, entry.id);
    // Not known to have taken part yet: no name, and nothing for `+N` to
    // stand for. See the docblock.
    if (state.kind === "unsettled") continue;
    const text = actorNameText(state);
    if (named.length < maxNamed) named.push(text);
    else abbreviated += 1;
  }

  const head = named.join(", ");
  // No name at all means no clause at all: " +3" on its own states a count of
  // people the line cannot identify, which is the same unbacked claim in a
  // shorter form.
  if (head.length === 0) return "";
  return head + (abbreviated > 0 ? ` +${abbreviated}` : "");
}
