/**
 * Row model for the subscriber picker sheet
 * (`components/issue/subscriber-picker-sheet.tsx`). Kept out of the component
 * so the four rules below are unit-testable without a renderer:
 *
 *   - **Members are deduped by `user_id`** before anything else. Web does the
 *     same (`issue-detail.tsx:176`): a workspace can surface one user twice
 *     through joined rows, which would draw two checkboxes for one person and
 *     make them look independently toggleable.
 *   - **Group headers are suppressed when their group is empty.** Web renders
 *     each `CommandGroup` conditionally (`:193` / `:209`), so a search that
 *     matches no agents must not leave a bare "Agents" heading.
 *   - **Members precede agents**, matching web's group order.
 *   - **An empty query matches everything** — the caller passes the raw
 *     search box value straight through.
 *
 * `matchesMember` (name / email / role prefix / pinyin) and
 * `matchesAgentSearch` (name / description / pinyin) are the app's existing
 * predicates, reused rather than re-derived. Note `matchesMember` returns
 * false for an empty query (it is a search-command predicate, where "" means
 * "no match yet"), so the empty-query case is handled here explicitly;
 * `matchesAgentSearch` already treats "" as "match all".
 */
import type { Agent, MemberWithUser } from "@multica/core/types";
import { matchesMember } from "./member-search";
import { matchesAgentSearch } from "./filter-agents";

export type SubscriberPickerRow =
  | { kind: "header"; key: string; label: string }
  | { kind: "member"; key: string; member: MemberWithUser }
  | { kind: "agent"; key: string; agent: Agent };

export function buildSubscriberPickerRows({
  members,
  agents,
  query,
  membersLabel,
  agentsLabel,
}: {
  members: MemberWithUser[] | undefined;
  agents: Agent[] | undefined;
  query: string;
  membersLabel: string;
  agentsLabel: string;
}): SubscriberPickerRow[] {
  const q = query.trim();

  const seen = new Set<string>();
  const uniqueMembers = (members ?? []).filter((m) => {
    if (seen.has(m.user_id)) return false;
    seen.add(m.user_id);
    return true;
  });

  const filteredMembers = q
    ? uniqueMembers.filter((m) => matchesMember(m, q))
    : uniqueMembers;
  // `matchesAgentSearch` matches all on an empty query, so one call covers
  // both cases. The list is already archived-free (`agentListOptions`).
  const filteredAgents = (agents ?? []).filter((a) =>
    matchesAgentSearch(a, q),
  );

  const rows: SubscriberPickerRow[] = [];
  if (filteredMembers.length > 0) {
    rows.push({ kind: "header", key: "h:members", label: membersLabel });
    for (const member of filteredMembers) {
      rows.push({ kind: "member", key: `m:${member.user_id}`, member });
    }
  }
  if (filteredAgents.length > 0) {
    rows.push({ kind: "header", key: "h:agents", label: agentsLabel });
    for (const agent of filteredAgents) {
      rows.push({ kind: "agent", key: `a:${agent.id}`, agent });
    }
  }
  return rows;
}
