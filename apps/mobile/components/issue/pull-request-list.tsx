/**
 * Linked pull-requests section on the issue detail page.
 *
 * Rows mirror web's `pull-request-list.tsx` (packages/views/issues/components/)
 * so mobile and web surface the same facts per PR:
 *   - leading state icon (open / draft / merged / closed) in the same hue web
 *     uses for that state;
 *   - title (one line, truncated) + `repo_owner/repo_name#number · state · @author`;
 *   - for non-terminal PRs, a secondary row with diff stats (`+a −d · N files`),
 *     the CI conclusion and the mergeability verdict — derived by
 *     `@/lib/pull-request-status` (never fabricated when the snapshot fields
 *     are absent), greyed out and annotated with the snapshot age when the
 *     snapshot is stale. Terminal (merged / closed) PRs get neither, matching
 *     web's `PullRequestRowDetails` gate that the leading icon already
 *     conveys terminal state.
 *   - a "show more / show less" toggle once the count reaches
 *     PR_LIMIT_BEFORE_COLLAPSE (web: 4), splitting into first 3 rows + tail.
 *
 * Tap opens `pr.html_url` in the browser (web opens the PR page in a new
 * tab). Empty / loading states show the section header with a muted line —
 * web renders the same surface (web's PullRequestList shows the empty copy
 * under the sidebar header; we keep that instead of hiding the section so a
 * user who links a PR later sees the guidance rather than a phantom block).
 */
import { useState } from "react";
import { Linking, Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import type { GitHubPullRequest, GitHubPullRequestState } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n/react";
import { useTimeAgo } from "@/lib/time-ago";
import { useColorScheme } from "@/lib/use-color-scheme";
import { issuePullRequestsOptions } from "@/data/queries/github";
import {
  deriveChecksStatus,
  deriveMergeStatus,
  shouldShowPullRequestStats,
  type PullRequestChecksStatus,
  type PullRequestMergeStatus,
} from "@/lib/pull-request-status";

// Keep the same collapse threshold as web's PR_LIMIT_BEFORE_COLLAPSE
// (packages/views/issues/components/pull-request-list.tsx:26): show the
// first (LIMIT - 1) rows inline, fold the rest behind the toggle.
const PR_LIMIT_BEFORE_COLLAPSE = 4;

type IoniconName = ComponentProps<typeof Ionicons>["name"];

const STATE_ICON: Record<GitHubPullRequestState, IoniconName> = {
  open: "git-pull-request",
  draft: "git-pull-request-outline",
  merged: "git-merge",
  closed: "git-pull-request",
};

/** Web's lucide hues for each element, mapped to light/dark tokens:
 *  emerald-600/400, rose-600/400, violet-600/400, amber-600/400 and
 *  zinc-500/400 for muted. */
function usePrColors() {
  const { isDarkColorScheme } = useColorScheme();
  return {
    success: isDarkColorScheme ? "#34d399" : "#059669",
    danger: isDarkColorScheme ? "#fb7185" : "#e11d48",
    violet: isDarkColorScheme ? "#a78bfa" : "#7c3aed",
    warning: isDarkColorScheme ? "#fbbf24" : "#d97706",
    muted: isDarkColorScheme ? "#a1a1aa" : "#71717a",
  };
}

export function PullRequestList({ issueId }: { issueId: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const { data, isLoading } = useQuery(issuePullRequestsOptions(issueId));
  const prs = data?.pull_requests ?? [];

  // Render rule (web-identical): < LIMIT → every row visible; >= LIMIT →
  // first (LIMIT - 1) rows visible, remainder behind the toggle.
  const useCollapse = prs.length >= PR_LIMIT_BEFORE_COLLAPSE;
  const expandedHead = useCollapse ? prs.slice(0, PR_LIMIT_BEFORE_COLLAPSE - 1) : prs;
  const collapsedTail = useCollapse ? prs.slice(PR_LIMIT_BEFORE_COLLAPSE - 1) : [];

  return (
    <View className="border-t border-border">
      <View className="px-4 pt-2 pb-1">
        <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          {t("pullRequest.sectionTitle")}
        </Text>
      </View>
      {isLoading ? (
        <Text className="px-4 pb-2 text-[11px] text-muted-foreground">
          {t("pullRequest.loading")}
        </Text>
      ) : prs.length === 0 ? (
        <Text className="px-4 pb-2 text-[11px] leading-4 text-muted-foreground">
          {t("pullRequest.empty")}
        </Text>
      ) : (
        <View className="pb-2">
          {expandedHead.map((pr) => (
            <PullRequestRow key={pr.id} pr={pr} />
          ))}
          {useCollapse ? (
            <View>
              {expanded ? collapsedTail.map((pr) => <PullRequestRow key={pr.id} pr={pr} />) : null}
              <Pressable
                onPress={() => setExpanded((v) => !v)}
                hitSlop={6}
                className="px-4 py-1.5"
                accessibilityRole="button"
              >
                <Text className="text-[11px] text-muted-foreground">
                  {expanded
                    ? t("pullRequest.showLess")
                    : t("pullRequest.showMore", { count: collapsedTail.length })}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

function PullRequestRow({ pr }: { pr: GitHubPullRequest }) {
  const { t } = useTranslation();
  const c = usePrColors();
  const isDraft = pr.state === "draft";

  const stateColor = getStateColor(pr.state, c);

  const onOpen = async () => {
    if (!pr.html_url) return;
    const ok = await Linking.canOpenURL(pr.html_url);
    if (ok) void Linking.openURL(pr.html_url);
  };

  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="link"
      accessibilityLabel={`${pr.title}`}
      className={`flex-row items-start gap-2 px-4 py-1.5 active:bg-secondary ${
        isDraft ? "opacity-80" : ""
      }`}
    >
      <Ionicons name={STATE_ICON[pr.state] ?? "git-pull-request"} size={14} color={stateColor} style={{ marginTop: 2 }} />
      <View className="min-w-0 flex-1">
        <Text className="text-[13px] text-foreground font-medium" numberOfLines={1}>
          {pr.title}
        </Text>
        <Text className="text-[11px] text-muted-foreground" numberOfLines={1}>
          {pr.repo_owner}/{pr.repo_name}#{pr.number} · {getStateLabel(pr.state, t)}
          {pr.author_login ? ` · @${pr.author_login}` : ""}
        </Text>
        <PullRequestRowDetails pr={pr} />
      </View>
    </Pressable>
  );
}

function PullRequestRowDetails({ pr }: { pr: GitHubPullRequest }) {
  const { t } = useTranslation();
  const timeAgo = useTimeAgo();
  const c = usePrColors();

  const showStats = shouldShowPullRequestStats({
    additions: pr.additions,
    deletions: pr.deletions,
    changed_files: pr.changed_files,
  });

  // Neither status element is shown for terminal PRs — the leading state
  // icon already conveys merged / closed, and CI / mergeability are no
  // longer actionable there (web-identical gate).
  const isTerminal = pr.state === "merged" || pr.state === "closed";
  const checksBadge = isTerminal ? null : getChecksBadge(deriveChecksStatus(pr), c, t);
  const mergeBadge = isTerminal ? null : getMergeBadge(deriveMergeStatus(pr), c, t);

  // A stale snapshot (GitHub outage / revoked key) greys out both elements
  // and shows the snapshot age instead of pretending the data is fresh.
  const stale = !isTerminal && pr.snapshot_stale === true;
  const staleText = stale
    ? pr.snapshot_fetched_at
      ? t("pullRequest.snapshotStale", { time: timeAgo(pr.snapshot_fetched_at) })
      : t("pullRequest.snapshotStaleUnknown")
    : null;

  if (!showStats && !checksBadge && !mergeBadge) return null;

  return (
    <View className="mt-0.5 flex-row flex-wrap items-center gap-x-2 gap-y-0.5">
      {showStats ? (
        <Text className="text-[11px] text-muted-foreground tabular-nums">
          <Text className="text-[11px] font-medium" style={{ color: c.success }}>
            +{pr.additions ?? 0}
          </Text>{" "}
          <Text className="text-[11px] font-medium" style={{ color: c.danger }}>
            −{pr.deletions ?? 0}
          </Text>{" "}
          · {t("pullRequest.filesCount", { count: pr.changed_files ?? 0 })}
        </Text>
      ) : null}
      {checksBadge ? (
        <PullRequestBadge
          badge={checksBadge}
          colors={c}
          stale={stale}
          staleText={staleText}
        />
      ) : null}
      {mergeBadge ? (
        <PullRequestBadge badge={mergeBadge} colors={c} stale={stale} staleText={staleText} />
      ) : null}
      {stale && staleText ? (
        <Text className="text-[11px] text-muted-foreground">{staleText}</Text>
      ) : null}
    </View>
  );
}

interface BadgeConfig {
  icon: IoniconName;
  label: string;
  color: string;
}

function PullRequestBadge({
  badge,
  colors,
  stale,
  staleText,
}: {
  badge: BadgeConfig;
  colors: ReturnType<typeof usePrColors>;
  stale?: boolean;
  staleText?: string | null;
}) {
  return (
    <View
      className="flex-row items-center gap-1"
      style={stale ? { opacity: 0.6 } : undefined}
      accessibilityHint={staleText ?? undefined}
    >
      <Ionicons name={badge.icon} size={12} color={badge.color} />
      <Text className="text-[11px] text-muted-foreground">{badge.label}</Text>
    </View>
  );
}

// CI element. A current snapshot with a null rollup renders "no checks yet";
// an unavailable/disabled snapshot renders nothing.
function getChecksBadge(
  status: PullRequestChecksStatus,
  c: ReturnType<typeof usePrColors>,
  t: (key: string, params?: Record<string, string | number>) => string,
): BadgeConfig | null {
  switch (status.kind) {
    case "failed":
      return {
        icon: "close-circle",
        color: c.danger,
        label: checksFailedLabel(status, t),
      };
    case "pending":
      return {
        icon: "ellipse-outline",
        color: c.warning,
        label: t("pullRequest.checksRunning", {
          passed: status.passed,
          total: status.total,
          running: status.running,
        }),
      };
    case "passed":
      return {
        icon: "checkmark-circle",
        color: c.success,
        label: t("pullRequest.checksAllPassed", { total: status.total }),
      };
    case "none":
      return {
        icon: "ellipse-outline",
        color: c.muted,
        label: t("pullRequest.checksNone"),
      };
    case "unavailable":
      return null;
  }
}

function checksFailedLabel(
  status: Extract<PullRequestChecksStatus, { kind: "failed" }>,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  const shown = status.names.slice(0, 2);
  if (shown.length === 0) {
    return t("pullRequest.checksFailedCount", {
      failed: status.failed,
      total: status.total,
    });
  }
  const remaining = status.names.length - shown.length;
  const parts = [...shown];
  if (remaining > 0) {
    parts.push(t("pullRequest.checksMore", { count: remaining }));
  }
  return t("pullRequest.checksFailedNamed", {
    failed: status.failed,
    total: status.total,
    names: parts.join(", "),
  });
}

// Mergeability element. Returns null for the "none" state — when GitHub has
// not decided, the card asserts neither "conflict" nor "ready".
function getMergeBadge(
  status: PullRequestMergeStatus,
  c: ReturnType<typeof usePrColors>,
  t: (key: string, params?: Record<string, string | number>) => string,
): BadgeConfig | null {
  switch (status.kind) {
    case "conflicting":
      return { icon: "alert-circle", color: c.warning, label: t("pullRequest.mergeConflicting") };
    case "ready":
      return { icon: "checkmark-circle", color: c.success, label: t("pullRequest.mergeReady") };
    case "blocked":
      return { icon: "ban-outline", color: c.muted, label: t("pullRequest.mergeBlocked") };
    case "behind":
      return { icon: "ban-outline", color: c.muted, label: t("pullRequest.mergeBehind") };
    case "unstable":
      return { icon: "ban-outline", color: c.muted, label: t("pullRequest.mergeUnstable") };
    case "has_hooks":
      return { icon: "ban-outline", color: c.muted, label: t("pullRequest.mergeHasHooks") };
    case "none":
      return null;
  }
}

function getStateColor(
  state: GitHubPullRequestState,
  c: ReturnType<typeof usePrColors>,
): string {
  switch (state) {
    case "open":
      return c.success;
    case "merged":
      return c.violet;
    case "closed":
      return c.danger;
    case "draft":
    default:
      return c.muted;
  }
}

function getStateLabel(
  state: GitHubPullRequestState,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  switch (state) {
    case "open":
      return t("pullRequest.stateOpen");
    case "draft":
      return t("pullRequest.stateDraft");
    case "merged":
      return t("pullRequest.stateMerged");
    case "closed":
      return t("pullRequest.stateClosed");
    default:
      return state;
  }
}