/**
 * "Mark as duplicate" picker route for an existing issue (MUL-7349).
 *
 * Opens the shared searchable issue picker pre-seeded with candidates — issues
 * whose title matches this one's (the same bug filed twice) and the issues
 * viewed most recently, since the original is usually the one that prompted the
 * mark — and, on select, marks THIS issue as a duplicate of it:
 * `updateIssue(id, { status: "cancelled", duplicate_of_issue_id: selected.id })`.
 *
 * Web parity: `packages/views/modals/mark-duplicate-issue.tsx`. The rules that
 * module applies, and this route keeps:
 *
 *   - the issue itself and its own duplicates are excluded, because neither can
 *     be an original and the server rejects both;
 *   - candidates that are themselves duplicates are dropped from suggestions AND
 *     search results alike (`canBeDuplicateOriginal`), so nothing is offered
 *     that the write would refuse;
 *   - the two refusal codes get their own sentences rather than a generic
 *     failure — the mutation classifies them (see `useMarkDuplicate`).
 *
 * The write goes through `useMarkDuplicate`, whose settle path invalidates the
 * whole duplicate-relation prefix, so both ends refetch: this issue gains an
 * original, and that original gains a duplicate.
 */
import { useMemo } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { Issue } from "@multica/core/types";
import { IssuePickerBody } from "@/components/issue/pickers/issue-picker-body";
import {
  issueDetailOptions,
  issueDuplicatesOptions,
} from "@/data/queries/issues";
import { useMarkDuplicate } from "@/data/mutations/issues";
import { api } from "@/data/api";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  selectViewedIssueIds,
  useViewedIssuesStore,
} from "@/data/viewed-issues-store";
import { useTranslation } from "@/lib/i18n/react";
import {
  DUPLICATE_SUGGESTION_LIMIT,
  canBeDuplicateOriginal,
  duplicateSuggestionGroups,
  markDuplicateExcludeIds,
} from "@/lib/issue-duplicates";

/** How many stored recents to consult. Web slices its recents store at the
 *  same limit before resolving them (`modals/mark-duplicate-issue.tsx:66`). */
const RECENT_LIMIT = DUPLICATE_SUGGESTION_LIMIT;

export default function IssueMarkDuplicateRoute() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const markDuplicate = useMarkDuplicate(id);

  // The issue's own duplicate relation. Both halves feed the exclusions: the
  // issue itself never counts, and neither does anything already marked as a
  // duplicate OF it (the server refuses that target with
  // `issue_has_duplicates`, and the reader's remedy is the other direction).
  const { data: relations } = useQuery(issueDuplicatesOptions(wsId, id));
  const excludeIds = useMemo(
    () => markDuplicateExcludeIds(id, relations),
    [id, relations],
  );

  // Title-similar candidates: the same bug filed twice, which is the common
  // case this feature exists for. The source title comes from the cached
  // detail read the screen underneath already made, so opening the picker
  // costs no request until this one fires.
  const { data: issue } = useQuery(issueDetailOptions(wsId, id));
  const title = issue?.title.trim() ?? "";
  const { data: sameTitle } = useQuery({
    // Keyed on the title as well as the id: the search is a function of both,
    // and an issue retitled while the sheet is open must not keep the old
    // results. Namespaced under the issue prefix so the shared WS invalidation
    // surface reaches it like every other issue query.
    queryKey: [...issueDetailOptions(wsId, id).queryKey, "duplicate-candidates", title],
    queryFn: ({ signal }) =>
      api.searchIssues(
        { q: title, limit: DUPLICATE_SUGGESTION_LIMIT, include_closed: true },
        { signal },
      ),
    enabled: !!wsId && title !== "",
    staleTime: 60_000,
  });

  // Recently viewed. A list of IDS — and the picker draws whole issues — so
  // they are resolved through the detail cache rather than fetched: an issue
  // the user reached from this app is already there, and the rest simply do
  // not appear. That is the honest outcome for a *suggestion*: six requests to
  // fill a list whose only value is being instant is the wrong trade, and web
  // makes the same one by reading its own cache.
  const viewedIds = useViewedIssuesStore(selectViewedIssueIds(wsId));
  const recentIds = useMemo(
    () => viewedIds.filter((v) => v !== id).slice(0, RECENT_LIMIT),
    [viewedIds, id],
  );
  const recentQueries = useQueries({
    queries: recentIds.map((recentId) => issueDetailOptions(wsId, recentId)),
  });
  const recentIssues = useMemo<Issue[]>(
    () =>
      recentQueries
        .map((q) => q.data)
        .filter((i): i is Issue => !!i),
    [recentQueries],
  );

  const suggestions = useMemo(() => {
    const groups = duplicateSuggestionGroups(sameTitle?.issues ?? [], recentIssues, {
      excludeIds,
    });
    return groups
      .filter((group) => group.issues.length > 0)
      .map((group) => ({
        key: group.key,
        heading: t(
          group.key === "similar"
            ? "duplicates.suggestedSimilar"
            : "duplicates.suggestedRecent",
        ),
        issues: group.issues,
      }));
  }, [sameTitle, recentIssues, excludeIds, t]);

  // Reporting lives on the hook (its write-failure title, plus "duplicates.
  // markSuccess" on the happy path) — a per-call `onError` would be a second
  // alert for one failure, and the one that never fires: this sheet pops on the
  // next frame, and `mutationObserver.js:77` gates per-call handlers on
  // `hasListeners()`.
  const onSelect = (selected: Issue) => {
    markDuplicate.mutate(selected);
    router.back();
  };

  return (
    <IssuePickerBody
      title={t("duplicates.markTitle")}
      description={t("duplicates.markDescription")}
      excludeIds={excludeIds}
      isSelectable={canBeDuplicateOriginal}
      suggestions={suggestions}
      onSelect={onSelect}
    />
  );
}
