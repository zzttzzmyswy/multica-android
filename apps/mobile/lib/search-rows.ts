/**
 * Row model for the workspace search screen's single FlatList.
 *
 * Extracted from app/(app)/[workspace]/search.tsx so the ordering rules — in
 * particular the cross-type cancelled demotion (MUL-5824) — are unit-testable
 * without mounting the screen.
 */
import type {
  Issue,
  MemberWithUser,
  SearchIssueResult,
  SearchProjectResult,
} from "@multica/core/types";
import { partitionAggregatedSearchResults } from "@multica/core/search/cancelled-rank";
import type { SearchCommand, SearchPage } from "./search-commands";
import { translate } from "./i18n";

export type RowItem =
  | { kind: "header"; key: string; title: string }
  | { kind: "page"; key: string; page: SearchPage; query: string }
  | { kind: "command"; key: string; command: SearchCommand; query: string }
  | { kind: "issue"; key: string; issue: SearchIssueResult; query: string }
  | { kind: "project"; key: string; project: SearchProjectResult; query: string }
  | { kind: "member"; key: string; member: MemberWithUser; query: string }
  | { kind: "recent"; key: string; issue: Issue };

/**
 * Builds the flat row list. Empty query → the Recent section; otherwise the
 * search results in web Cmd+K order:
 *
 *   Pages → Commands → Members → Projects (live) → Issues (live)
 *   → Cancelled (projects then issues)
 *
 * The first two groups are action rows, not data rows: they arrive pre-matched
 * by `lib/search-commands.ts` and are inserted as-is. Web renders them above
 * every data group for the same reason — a reader who typed `settings` wants
 * the Settings row, not the project whose name happens to contain it.
 *
 * Projects and issues come from two independently ranked responses, and this
 * screen renders every project before every issue — so per-type ranking alone
 * let a single cancelled project be the first row of the list. One trailing
 * Cancelled section is the only arrangement in which no cancelled row of either
 * type can precede a live row of the other. Direct hits (exact identifier,
 * number, or title) stay in their live section.
 */
export function buildSearchRows({
  query,
  issues,
  projects,
  members,
  recentIssues,
  pages,
  commands,
}: {
  query: string;
  issues: SearchIssueResult[];
  projects: SearchProjectResult[];
  members?: MemberWithUser[];
  recentIssues: Issue[];
  /** Already filtered + translated — see `lib/search-commands.ts`. */
  pages?: SearchPage[];
  commands?: SearchCommand[];
}): RowItem[] {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    if (recentIssues.length === 0) return [];
    return [
      { kind: "header", key: "h-recent", title: translate("search.recent") },
      ...recentIssues.map<RowItem>((issue) => ({
        kind: "recent",
        key: `r-${issue.id}`,
        issue,
      })),
    ];
  }

  const parts = partitionAggregatedSearchResults({
    issues,
    projects,
    query: trimmedQuery,
  });

  const rows: RowItem[] = [];
  // Pages then Commands, above every data group — web's own order
  // (`search-command.tsx:673-720`). An action row is an *intent* match ("the
  // user typed `settings`"); the groups below are text matches over records.
  // An intent match that lost to a record whose title merely contains the same
  // word would bury the row the reader was actually reaching for.
  if (pages && pages.length > 0) {
    rows.push({ kind: "header", key: "h-pages", title: translate("search.groups.pages") });
    for (const page of pages) {
      rows.push({ kind: "page", key: `page-${page.key}`, page, query: trimmedQuery });
    }
  }
  if (commands && commands.length > 0) {
    rows.push({
      kind: "header",
      key: "h-commands",
      title: translate("search.groups.commands"),
    });
    for (const command of commands) {
      rows.push({
        kind: "command",
        key: `cmd-${command.key}`,
        command,
        query: trimmedQuery,
      });
    }
  }
  // Matched members (pre-filtered by the screen's filterMemberMatches) follow
  // the two action groups, mirroring web Cmd+K order: Pages → Commands →
  // Members → Projects → Issues → Cancelled.
  if (members && members.length > 0) {
    rows.push({ kind: "header", key: "h-members", title: translate("search.members") });
    for (const member of members) {
      rows.push({ kind: "member", key: `m-${member.id}`, member, query: trimmedQuery });
    }
  }
  if (parts.liveProjects.length > 0) {
    rows.push({ kind: "header", key: "h-projects", title: translate("search.projects") });
    for (const project of parts.liveProjects) {
      rows.push({ kind: "project", key: `p-${project.id}`, project, query: trimmedQuery });
    }
  }
  if (parts.liveIssues.length > 0) {
    rows.push({ kind: "header", key: "h-issues", title: translate("search.issues") });
    for (const issue of parts.liveIssues) {
      rows.push({ kind: "issue", key: `i-${issue.id}`, issue, query: trimmedQuery });
    }
  }
  if (parts.hasCancelled) {
    rows.push({ kind: "header", key: "h-cancelled", title: translate("search.cancelled") });
    for (const project of parts.cancelledProjects) {
      rows.push({ kind: "project", key: `p-${project.id}`, project, query: trimmedQuery });
    }
    for (const issue of parts.cancelledIssues) {
      rows.push({ kind: "issue", key: `i-${issue.id}`, issue, query: trimmedQuery });
    }
  }
  return rows;
}
