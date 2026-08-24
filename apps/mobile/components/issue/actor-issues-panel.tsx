/**
 * Actor Issues panel — mobile port of web `common/actor-issues-panel.tsx`
 * (MYS-711). A section block on the member detail page and the agent detail
 * page showing the workspace issues belonging to that actor:
 *
 *  - scope segmented toggle: assigned（该 actor 负责）/ created（该 actor 创建）
 *  - search input filtering identifier/title client-side (web search input)
 *  - rows reuse `IssueRow` with `showStatus` — the list mixes statuses
 *  - empty states: per-scope copy (web actor_issues.empty.*) plus a dedicated
 *    search-no-match state
 *
 * Data comes from `actorIssuesListOptions` — `listIssues` + assignee_filters /
 * creator_filters serialized `type:id`, keyed under `issueKeys.actorAll(wsId)`
 * so WS realtime invalidates every mounted panel with one call.
 *
 * The panel is a static block inside the host page's scroller (member:
 * ScrollView, agent: FlatList ListHeaderComponent) — it must not nest scroll
 * views. Pull-to-refresh is the host page's job: its RefreshControl handler
 * invalidates `issueKeys.actorAll(wsId)` (same pattern as the agent activity
 * section). Mobile has no hover/right-click, so web's facet filtering stays a
 * workspace-wide issue-surface capability; this panel intentionally exposes
 * only scope + search.
 */
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { IssueRow } from "@/components/issue/issue-row";
import { actorIssuesListOptions } from "@/data/queries/actor-issues";
import {
  filterActorIssues,
  sortActorIssues,
  type ActorIssuesActorType,
  type ActorIssuesRelation,
} from "@/lib/actor-issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

const RELATIONS: { value: ActorIssuesRelation; labelKey: string }[] = [
  { value: "assigned", labelKey: "actorIssues.scopeAssigned" },
  { value: "created", labelKey: "actorIssues.scopeCreated" },
];

export function ActorIssuesPanel({
  actorType,
  actorId,
  sectionTitleKey,
}: {
  actorType: ActorIssuesActorType;
  actorId: string;
  /** Section heading shown above the panel — "members.detail.issues" or
   *  "agents.detail.workIssues" — so each host owns its wording. */
  sectionTitleKey: string;
}) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const [relation, setRelation] = useState<ActorIssuesRelation>("assigned");
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, refetch } = useQuery({
    ...actorIssuesListOptions(wsId, actorType, actorId, relation),
  });

  const issues = useMemo(
    () => sortActorIssues(filterActorIssues(data ?? [], search)),
    [data, search],
  );

  const openIssue = (issueId: string) => {
    if (wsSlug) router.push(`/${wsSlug}/issue/${issueId}`);
  };

  const searching = search.trim() !== "";

  return (
    <View className="border-t border-border">
      <Text className="px-4 pt-5 pb-2 text-xs uppercase tracking-wider text-muted-foreground font-medium">
        {t(sectionTitleKey)}
      </Text>

      {/* Toolbar: search + scope toggle, mirrors web's header row. */}
      <View className="flex-row items-center gap-2 px-4 pb-2">
        <View className="flex-1 min-w-0 flex-row items-center gap-1.5 rounded-lg border border-border bg-secondary/40 px-2.5 py-1.5">
          <Ionicons name="search-outline" size={15} color={theme.mutedForeground} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={t("actorIssues.searchPlaceholder")}
            placeholderTextColor={theme.mutedForeground}
            style={{ fontSize: 14, includeFontPadding: false, textAlignVertical: "center" }}
            className="flex-1 min-w-0 py-0 text-foreground"
            accessibilityLabel={t("actorIssues.searchPlaceholder")}
          />
        </View>
        <View className="flex-row items-center gap-1">
          {RELATIONS.map((s) => {
            const active = relation === s.value;
            return (
              <Button
                key={s.value}
                variant="outline"
                size="sm"
                onPress={() => setRelation(s.value)}
                className={active ? "bg-accent" : ""}
                accessibilityState={{ selected: active }}
              >
                <Text
                  numberOfLines={1}
                  className={cn(
                    active
                      ? "text-accent-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {t(s.labelKey)}
                </Text>
              </Button>
            );
          })}
        </View>
      </View>

      {isLoading ? (
        <View className="py-10 items-center justify-center">
          <ActivityIndicator color={theme.mutedForeground} />
        </View>
      ) : isError ? (
        <View className="py-10 items-center gap-2 px-4">
          <Ionicons name="alert-circle-outline" size={28} color={theme.mutedForeground} />
          <Text className="text-sm text-muted-foreground text-center">
            {t("issues.loadError")}
          </Text>
          <Pressable onPress={() => refetch()} accessibilityRole="button">
            <Text className="text-sm font-medium text-brand">
              {t("common.retry")}
            </Text>
          </Pressable>
        </View>
      ) : issues.length === 0 ? (
        searching ? (
          <View className="py-10 items-center gap-2 px-4">
            <Ionicons name="search-outline" size={28} color={theme.mutedForeground} />
            <Text className="text-sm text-muted-foreground text-center">
              {t("actorIssues.searchEmpty")}
            </Text>
          </View>
        ) : (
          <View className="py-10 items-center gap-2 px-4">
            <Ionicons name="list-outline" size={28} color={theme.mutedForeground} />
            <Text className="text-sm font-medium text-foreground text-center">
              {t(`actorIssues.empty.${relation}.title`)}
            </Text>
            <Text className="text-xs text-muted-foreground text-center">
              {t(`actorIssues.empty.${relation}.description`)}
            </Text>
          </View>
        )
      ) : (
        <View className="pb-2">
          {issues.map((issue) => (
            <IssueRow
              key={issue.id}
              issue={issue}
              showStatus
              onPress={() => openIssue(issue.id)}
            />
          ))}
        </View>
      )}
    </View>
  );
}