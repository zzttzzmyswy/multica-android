/**
 * "All views" directory — the mobile counterpart of web's `AllViewsPage`
 * (`packages/views/issue-views/all-views-page.tsx`, served at
 * `/:workspaceSlug/views`).
 *
 * Why this page had to exist: every other mobile saved-view surface
 * (`issue-view-bar`, the pins list) can only list the ONE scope it is mounted
 * on. A view hidden from its bar, or one shared from another scope, was
 * therefore unreachable from the phone — and a hidden view stays in the
 * database, so the phone reported it as gone while web still showed it.
 *
 * Scope pills mirror web's four buckets (all / built-in / mine / shared) with
 * their counts. Rows are phone-shaped cards rather than web's six-column
 * table (a phone has no room for columns), but each card carries the same
 * facts in the same priority: name, location, filter count, visibility,
 * owner — plus the built-in marker for rows that are not stored on the
 * server.
 *
 * Row tap opens the view on the surface that OWNS its scope and marks it
 * active there (`lib/all-views-target.ts`); web's row menu is reduced to the
 * one destructive action this screen must offer — delete, gated by the same
 * `canManageIssueView` rule the bar uses.
 *
 * Read states are kept distinct on purpose (`catalogRead`): a failed list
 * read is NOT "you have no views", and this codebase has already fixed that
 * exact substitution twice (MYS-1892 / MYS-1907).
 */
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { IssueView } from "@multica/core/api/schemas";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useAuthStore } from "@/data/auth-store";
import { memberListOptions } from "@/data/queries/members";
import { projectListOptions } from "@/data/queries/projects";
import {
  canManageIssueView,
  issueViewEverywhereOptions,
} from "@/data/queries/issue-views";
import { useDeleteIssueView } from "@/data/mutations/issue-views";
import { useActiveIssueViewStore } from "@/data/stores/active-issue-view-store";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { catalogRead } from "@/lib/catalog-read";
import {
  ALL_VIEWS_SCOPES,
  buildAllViewsRows,
  directoryScopeCounts,
  filterDirectoryRows,
  type DirectoryRow,
  type DirectoryScope,
} from "@/lib/all-views-directory";
import {
  issueViewDirectoryTarget,
  scopeOfView,
} from "@/lib/all-views-target";
import { cn } from "@/lib/utils";

/**
 * The four views every workspace has without saving anything — web's
 * `BUILTIN_VIEW_KEYS` (`packages/core/issue-views/sidebar-views.ts`).
 *
 * Only the two with a mobile destination are listed. Web also has
 * `my_agents` and `unread`: mobile has no My-agents surface and no unread
 * issue view, so listing them would put two rows on this page that cannot
 * open. Web's own navigation resolves them to `/my-agents` and an
 * unread-filtered issue list — neither route exists here.
 */
const BUILTIN_KEYS = ["my_issues", "all_issues"] as const;
type BuiltinKey = (typeof BUILTIN_KEYS)[number];

const BUILTIN_LABEL_KEY: Record<BuiltinKey, string> = {
  my_issues: "issueViews.directory.builtin.myIssues",
  all_issues: "issueViews.directory.builtin.allIssues",
};

const BUILTIN_ICON: Record<BuiltinKey, React.ComponentProps<typeof Ionicons>["name"]> = {
  my_issues: "person-circle-outline",
  all_issues: "list-outline",
};

/** One label per bucket, spelled out — see `scopeLabel` for why this is a
 *  table rather than an interpolated `scope${Capitalized}` id. */
const DIRECTORY_SCOPE_LABEL_KEY: Record<DirectoryScope, string> = {
  all: "issueViews.directory.scopeAll",
  builtin: "issueViews.directory.scopeBuiltin",
  mine: "issueViews.directory.scopeMine",
  shared: "issueViews.directory.scopeShared",
};

/** Where a built-in row goes. Built-ins are not saved views, so they carry no
 *  id to activate — the surface's own default tab is what they open. */
function builtinHref(slug: string, key: BuiltinKey): string {
  return key === "my_issues" ? `/${slug}/my-issues` : `/${slug}/more/issues`;
}

/**
 * Scope pills, horizontally scrollable.
 *
 * A four-way `SegmentedControl` was tried first and had to go: it splits the
 * row width evenly and renders each label with `numberOfLines={1}`, so
 * "Created by me" came out ellipsized as "Created by…" on a 1080px device —
 * observed on the emulator, not assumed. The idiom the squads list already
 * uses (a scrolling row of counting chips) has no width budget to blow, and
 * keeps web's full labels, so the page reuses it rather than inventing a
 * third pattern or shipping shortened copy web does not have.
 */
function ScopeBar({
  scope,
  counts,
  onChange,
}: {
  scope: DirectoryScope;
  counts: Record<DirectoryScope, number>;
  onChange: (next: DirectoryScope) => void;
}) {
  const { t } = useTranslation();
  return (
    <View className="pt-3 pb-1">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 6, alignItems: "center" }}
      >
        {ALL_VIEWS_SCOPES.map((value) => {
          const active = value === scope;
          return (
            <Button
              key={value}
              variant="outline"
              size="sm"
              onPress={() => onChange(value)}
              className={active ? "bg-accent" : ""}
              accessibilityState={{ selected: active }}
            >
              <Text
                numberOfLines={1}
                className={active ? "text-accent-foreground" : "text-muted-foreground"}
              >
                {t(DIRECTORY_SCOPE_LABEL_KEY[value])}
              </Text>
              <Text
                className={cn(
                  "text-caption tabular-nums",
                  active ? "text-accent-foreground" : "text-muted-foreground",
                )}
              >
                {counts[value]}
              </Text>
            </Button>
          );
        })}
      </ScrollView>
    </View>
  );
}

export default function AllViewsPage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const user = useAuthStore((s) => s.user);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  const viewsQuery = useQuery(issueViewEverywhereOptions(wsId));
  const viewsRead = catalogRead(viewsQuery);
  const views = viewsRead.items;

  const projects = useQuery(projectListOptions(wsId)).data ?? [];
  const members = useQuery(memberListOptions(wsId)).data ?? [];

  const currentRole =
    members.find((m) => m.user_id === user?.id)?.role ?? null;
  const memberName = useMemo(
    () => new Map(members.map((m) => [m.user_id, m.name])),
    [members],
  );
  const projectTitle = useMemo(
    () => new Map(projects.map((p) => [p.id, p.title])),
    [projects],
  );

  const [scope, setScope] = useState<DirectoryScope>("all");

  const builtins = useMemo(
    () =>
      BUILTIN_KEYS.map((key) => ({
        key,
        name: t(BUILTIN_LABEL_KEY[key]),
        rowId: `builtin:${key}`,
      })),
    [t],
  );

  const counts = useMemo(
    () => directoryScopeCounts(builtins.length, views, user?.id),
    [builtins.length, views, user?.id],
  );

  const rows = useMemo(
    () =>
      buildAllViewsRows(
        builtins,
        views,
        projectTitle,
        {
          myIssues: t("issueViews.directory.builtin.myIssues"),
          allIssues: t("issueViews.directory.builtin.allIssues"),
          project: t("issueViews.directory.locationProject"),
        },
        scope,
        user?.id,
      ),
    [builtins, views, projectTitle, scope, user?.id, t],
  );

  // The delete write is scoped to the view's OWN container, not the screen's
  // current pill: the optimistic patch has to land in the list the owning
  // surface reads, or the row would come back the moment the list refetches.
  // `useDeleteIssueView` takes one scope, so the scope is resolved per row at
  // call time through a small map — one hook per scope would be a hook inside
  // a list.
  const deleteWorkspaceScope = useDeleteIssueView(wsId, { scope_type: "workspace" });
  const deleteMyScope = useDeleteIssueView(wsId, { scope_type: "my" });
  const [projectDeleteScopeId, setProjectDeleteScopeId] = useState<string | null>(null);
  const deleteProjectScope = useDeleteIssueView(
    wsId,
    projectDeleteScopeId
      ? { scope_type: "project", scope_id: projectDeleteScopeId }
      : { scope_type: "workspace" },
  );

  const openView = useCallback(
    (view: IssueView) => {
      const target = issueViewDirectoryTarget(wsId, wsSlug, view);
      if (!target) return;
      // Mark active BEFORE pushing: the destination surface reads the store on
      // mount and adopts the view through `useApplyExternallyActivatedView`,
      // so a push that lands first would render one frame of unfiltered list.
      useActiveIssueViewStore.getState().setActive(target.containerKey, view.id);
      router.push(target.href);
    },
    [wsId, wsSlug],
  );

  const confirmDelete = useCallback(
    (view: IssueView) => {
      if (!canManageIssueView(view, user?.id, currentRole)) return;
      Alert.alert(
        t("issueViews.deleteConfirmTitle"),
        t("issueViews.deleteConfirmMessage", { name: view.name }),
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("issueViews.delete"),
            style: "destructive",
            onPress: () => {
              const viewScope = scopeOfView(view);
              if (viewScope.scope_type === "my") {
                deleteMyScope.mutate(view.id);
                return;
              }
              if (viewScope.scope_type === "project" && viewScope.scope_id) {
                setProjectDeleteScopeId(viewScope.scope_id);
                deleteProjectScope.mutate(view.id);
                return;
              }
              deleteWorkspaceScope.mutate(view.id);
            },
          },
        ],
        { cancelable: true },
      );
    },
    [
      currentRole,
      deleteMyScope,
      deleteProjectScope,
      deleteWorkspaceScope,
      t,
      user?.id,
    ],
  );

  const openBuiltin = useCallback(
    (key: BuiltinKey) => {
      if (!wsSlug) return;
      router.push(builtinHref(wsSlug, key));
    },
    [wsSlug],
  );

  // Explicit map, not an interpolated key: `lib/i18n/dynamic-families.ts`
  // requires every runtime-built id family to be declared, and a four-entry
  // map is both cheaper to read and impossible to typo into a missing leaf.
  const scopeLabel = useCallback(
    (value: DirectoryScope) => t(DIRECTORY_SCOPE_LABEL_KEY[value]),
    [t],
  );

  const renderRow = ({ item }: { item: DirectoryRow }) => {
    const isBuiltin = item.kind === "builtin";
    const view = item.view;
    const shared = view?.visibility === "workspace";
    const manageable = view ? canManageIssueView(view, user?.id, currentRole) : false;

    return (
      <Pressable
        className={cn(
          "flex-row items-start gap-3 px-4 py-3 active:bg-secondary",
        )}
        accessibilityRole="button"
        accessibilityLabel={item.name}
        onPress={() => {
          if (isBuiltin) {
            const key = item.rowId.replace("builtin:", "") as BuiltinKey;
            openBuiltin(key);
          } else if (view) {
            openView(view);
          }
        }}
      >
        <View className="pt-0.5">
          <Ionicons
            name={
              isBuiltin
                ? BUILTIN_ICON[item.rowId.replace("builtin:", "") as BuiltinKey]
                : "layers-outline"
            }
            size={18}
            color={theme.mutedForeground}
          />
        </View>
        <View className="flex-1 gap-1">
          <Text className="text-body text-foreground" numberOfLines={1}>
            {item.name || t("issueViews.directory.unnamed")}
          </Text>
          <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
            {item.location ? (
              <Text
                className="text-caption text-muted-foreground"
                numberOfLines={1}
              >
                {item.location}
              </Text>
            ) : null}
            {!isBuiltin && item.filterCount > 0 ? (
              <Text className="text-caption tabular-nums text-muted-foreground">
                {t("issueViews.directory.columnFilters")} {item.filterCount}
              </Text>
            ) : null}
            <View
              className={cn(
                "rounded px-1.5 py-0.5",
                shared ? "bg-secondary" : "bg-transparent",
              )}
            >
              <Text className="text-caption text-muted-foreground">
                {isBuiltin
                  ? t("issueViews.directory.ownerBuiltin")
                  : shared
                    ? t("issueViews.visibilityWorkspace")
                    : t("issueViews.visibilityPrivate")}
              </Text>
            </View>
            {!isBuiltin && view ? (
              <Text className="text-caption text-muted-foreground" numberOfLines={1}>
                {memberName.get(view.owner_id) ?? ""}
              </Text>
            ) : null}
          </View>
        </View>
        {manageable ? (
          <Pressable
            className="h-8 w-8 items-center justify-center rounded-md active:bg-secondary"
            accessibilityRole="button"
            accessibilityLabel={t("issueViews.directory.rowActions", { name: item.name })}
            onPress={() => view && confirmDelete(view)}
          >
            <Ionicons name="trash-outline" size={17} color={theme.mutedForeground} />
          </Pressable>
        ) : null}
      </Pressable>
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: t("issueViews.directory.title") }} />
      <View className="flex-1 bg-background">
        {viewsQuery.isLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator />
          </View>
        ) : viewsRead.state === "error" ? (
          <View className="px-4 gap-3 pt-4">
            <Text className="text-body text-destructive">
              {t("issueViews.directory.loadError")}
            </Text>
            <Button variant="outline" onPress={() => viewsQuery.refetch()}>
              <Text>{t("workspace.retry")}</Text>
            </Button>
          </View>
        ) : (
          <View className="flex-1">
            <View className="px-4 pb-2">
              <ScopeBar scope={scope} counts={counts} onChange={setScope} />
            </View>
            {rows.length === 0 ? (
              <View className="flex-1 items-center justify-center px-6 gap-1">
                <Ionicons name="layers-outline" size={32} color={theme.mutedForeground} />
                <Text className="text-body text-muted-foreground text-center mt-2">
                  {t("issueViews.directory.emptyTitle")}
                </Text>
                <Text className="text-caption text-muted-foreground/70 text-center">
                  {t("issueViews.directory.emptyDescription")}
                </Text>
                {scope !== "all" ? (
                  <Button
                    variant="outline"
                    className="mt-3"
                    onPress={() => setScope("all")}
                  >
                    <Text>{scopeLabel("all")}</Text>
                  </Button>
                ) : null}
              </View>
            ) : (
              <FlatList
                data={rows}
                keyExtractor={(item) => item.rowId}
                ItemSeparatorComponent={() => <View className="h-px bg-border ml-4" />}
                contentContainerClassName="pb-6"
                renderItem={renderRow}
              />
            )}
          </View>
        )}
      </View>
    </>
  );
}
