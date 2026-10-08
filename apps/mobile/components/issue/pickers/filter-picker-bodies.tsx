/**
 * Multi-select picker bodies for the ISSUE FILTER dimensions:
 *
 *   - `FilterActorPickerBody` — member / agent / squad rows, multi-select,
 *     used for both `assignee` and `creator` dimensions (web ActorFilterValue
 *     semantics). Row identity is `{type, id}`; an `unassigned` row is NOT
 *     offered — the filter panel owns the includeNoAssignee toggle.
 *   - `FilterProjectPickerBody` — projects multi-select by id, plus an
 *     optional "No project" row backing includeNoProject.
 *   - `FilterLabelPickerBody` — labels multi-select by id (no inline create;
 *     the filter is not a label-editing surface).
 *
 * These intentionally differ from the single-select issue-attribute pickers
 * (assignee-picker-body / project-picker-body) which swap ONE value. Filter
 * dimensions are positive-selection SETS (web view-store FilterSnapshot), so
 * every toggle keeps the sheet open.
 *
 * Android-safe search: each body owns a local TextInput filter. The
 * attribute pickers reach the same place differently — their route hands
 * the search input to the iOS native UISearchController only where the
 * sheet keeps a nav header, and body-renders it everywhere else
 * (`usePickerSearch`), because Expo does not render
 * `headerSearchBarOptions` on Android at all. Same search semantics.
 */
import { useMemo, useState } from "react";
import { FlatList, Pressable, TextInput, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useColorScheme } from "nativewind";
import type {
  Agent,
  IssueProperty,
  MemberWithUser,
  Project,
  Squad,
} from "@multica/core/types";
import { isActorPropertyType } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { ProjectIcon } from "@/components/ui/project-icon";
import { MOBILE_PLACEHOLDER_COLOR } from "@/components/ui/input-tokens";
import { CatalogEmptySlot } from "@/components/catalog/catalog-status";
import { memberListOptions } from "@/data/queries/members";
import { agentListOptions } from "@/data/queries/agents";
import { squadListOptions } from "@/data/queries/squads";
import { projectListOptions } from "@/data/queries/projects";
import { labelListOptions } from "@/data/queries/labels";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useAuthStore } from "@/data/auth-store";
import { catalogRead, retryCatalogs } from "@/lib/catalog-read";
import { matchesNameOrPinyin } from "@/lib/name-search";
import { propertyFilterOptions } from "@/lib/filter-issues";
import type { ActorFilterValue } from "@/data/stores/issue-filter-slice";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/react";
import { NO_VALUE_KEY } from "@/lib/issue-facet-counts";
import { useColorScheme as useSystemColorScheme } from "@/lib/use-color-scheme";

/** One row rendered by `FilterPropertyPickerBody` — a filterable property
 *  option (or the true/false pseudo-options of a checkbox definition). */
interface FilterPropertyOption {
  id: string;
  name: string;
  color?: string;
}

const AVATAR_SIZE = 36;

/**
 * The "N issues" badge web puts on the right of a filter option
 * (`packages/views/issues/components/issues-header.tsx:1272`,
 * `$.filters.issue_count`). One component for all four bodies so the wording
 * and the visibility rule cannot drift between them.
 *
 * Renders NOTHING when the count is unknown (`undefined`) or zero — web's
 * `count > 0 &&` guard. Unknown matters as much as zero: these numbers come
 * from a server facet that may still be in flight or may have failed, and
 * printing "0 issues" there would state something the server never said.
 */
function OptionCountBadge({
  count,
}: {
  count: number | undefined;
}) {
  const { t } = useTranslation();
  if (count === undefined || count <= 0) return null;
  return (
    <Text className="text-xs text-muted-foreground">
      {t(count === 1 ? "filter.issueCount_one" : "filter.issueCount_other", {
        count,
      })}
    </Text>
  );
}

function useCheckColor() {
  const { colorScheme } = useColorScheme();
  return colorScheme === "dark" ? THEME.dark.primary : THEME.light.primary;
}

/** Header search box — plain TextInput row, cross-platform. */
function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (text: string) => void;
  placeholder: string;
}) {
  const { colorScheme } = useSystemColorScheme();
  return (
    <View className="px-4 pt-2 pb-1">
      <View
        className="flex-row items-center gap-2 rounded-xl px-3 py-2 border border-border bg-secondary/40"
      >
        <Ionicons
          name="search"
          size={16}
          color={THEME[colorScheme].mutedForeground}
        />
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={THEME[colorScheme].mutedForeground}
          autoCapitalize="none"
          autoCorrect={false}
          className="flex-1 text-sm text-foreground py-0"
          clearButtonMode="while-editing"
        />
        {value ? (
          <Pressable onPress={() => onChange("")} hitSlop={8}>
            <Ionicons
              name="close-circle"
              size={16}
              color={THEME[colorScheme].mutedForeground}
            />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/** Multi-select an actor from members + agents + squads. */
export function FilterActorPickerBody({
  selected,
  onToggle,
  searchPlaceholder,
  counts,
}: {
  selected: ActorFilterValue[];
  onToggle: (value: ActorFilterValue) => void;
  searchPlaceholder: string;
  /** Server facet `key -> count`, or undefined when there is nothing exact to
   *  show. Keys are the server's own (`member:<uuid>`, `agent:<uuid>`,
   *  `squad:<uuid>`, `__none__`) — the same strings `ActorFilterValue`
   *  stringifies to. See `lib/issue-facet-counts.ts`. */
  counts?: ReadonlyMap<string, number>;
}) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useTranslation();
  const membersRead = catalogRead(useQuery(memberListOptions(wsId)));
  const agentsRead = catalogRead(useQuery(agentListOptions(wsId)));
  const squadsRead = catalogRead(useQuery(squadListOptions(wsId)));
  const members = membersRead.items;
  const agents = agentsRead.items;
  const squads = squadsRead.items;
  const [query, setQuery] = useState("");
  const checkColor = useCheckColor();

  const selectedKeys = useMemo(
    () => new Set(selected.map((s) => `${s.type}:${s.id}`)),
    [selected],
  );

  const rows = useMemo(() => {
    // Pinyin-aware, matching web's ActorSubContent
    // (issues/components/issues-header.tsx:335-343), which backs both the
    // assignee and creator filter dimensions.
    const memberRows: { kind: "member"; member: MemberWithUser }[] =
      [...members]
        .filter((m) => matchesNameOrPinyin(m.name, query))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((member) => ({ kind: "member" as const, member }));
    const agentRows: { kind: "agent"; agent: Agent }[] = [...agents]
      .filter((a) => matchesNameOrPinyin(a.name, query))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((agent) => ({ kind: "agent" as const, agent }));
    const squadRows: { kind: "squad"; squad: Squad }[] = [...squads]
      .filter((s) => !s.archived_at && matchesNameOrPinyin(s.name, query))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((squad) => ({ kind: "squad" as const, squad }));
    return [...memberRows, ...agentRows, ...squadRows];
  }, [members, agents, squads, query]);

  return (
    <View className="flex-1">
      <SearchBox
        value={query}
        onChange={setQuery}
        placeholder={searchPlaceholder}
      />
      <FlatList
        data={rows}
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        keyExtractor={(row) =>
          `${row.kind}:${
            row.kind === "member"
              ? row.member.user_id
              : row.kind === "agent"
                ? row.agent.id
                : row.squad.id
          }`
        }
        renderItem={({ item }) => {
          const value: ActorFilterValue =
            item.kind === "member"
              ? { type: "member", id: item.member.user_id }
              : item.kind === "agent"
                ? { type: "agent", id: item.agent.id }
                : { type: "squad", id: item.squad.id };
          const isSelected = selectedKeys.has(`${value.type}:${value.id}`);
          return (
            <Pressable
              onPress={() => onToggle(value)}
              className={cn(
                "flex-row items-center gap-3 px-4 py-3 active:bg-secondary",
                isSelected && "bg-secondary/60",
              )}
            >
              <ActorAvatar type={value.type} id={value.id} size={AVATAR_SIZE} />
              <Text className="flex-1 text-base text-foreground">
                {item.kind === "member"
                  ? item.member.name
                  : item.kind === "agent"
                    ? item.agent.name
                    : item.squad.name}
              </Text>
              {item.kind === "agent" ? (
                <Text className="text-sm text-muted-foreground">
                  {t("picker.agent")}
                </Text>
              ) : item.kind === "squad" ? (
                <Text className="text-sm text-muted-foreground">
                  {t("picker.squad")}
                </Text>
              ) : null}
              <OptionCountBadge count={counts?.get(`${value.type}:${value.id}`)} />
              {isSelected ? (
                <Ionicons name="checkmark" size={20} color={checkColor} />
              ) : null}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <CatalogEmptySlot
            states={[
              membersRead.state,
              agentsRead.state,
              squadsRead.state,
            ]}
            onRetry={() => retryCatalogs(membersRead, agentsRead, squadsRead)}
            emptyMessage={t("picker.noMembersAgents")}
            query={query}
          />
        }
      />
    </View>
  );
}

/** Multi-select projects by id with a "No project" header row. */
export function FilterProjectPickerBody({
  selected,
  includeNoProject,
  onToggle,
  onToggleNoProject,
  counts,
}: {
  selected: string[];
  includeNoProject: boolean;
  onToggle: (projectId: string) => void;
  onToggleNoProject: () => void;
  /** Facet counts by project id; `undefined` renders no badges (see
   *  `lib/issue-facet-counts.ts`). */
  counts?: ReadonlyMap<string, number>;
}) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useTranslation();
  const projectsRead = catalogRead(useQuery(projectListOptions(wsId)));
  const projects = projectsRead.items;
  const [query, setQuery] = useState("");
  const checkColor = useCheckColor();

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matchName = (n: string) => !q || n.toLowerCase().includes(q);
    const projectRows: { kind: "project"; project: Project }[] = [...projects]
      .filter((p) => matchName(p.title))
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((project) => ({ kind: "project" as const, project }));
    return projectRows;
  }, [projects, query]);

  return (
    <View className="flex-1">
      <SearchBox
        value={query}
        onChange={setQuery}
        placeholder={t("picker.searchProjects")}
      />
      <FlatList
        data={rows}
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        ListHeaderComponent={
          <Pressable
            onPress={onToggleNoProject}
            className={cn(
              "flex-row items-center gap-3 px-4 py-3 active:bg-secondary",
              includeNoProject && "bg-secondary/60",
            )}
          >
            <Ionicons
              name="close-circle-outline"
              size={28}
              color={MOBILE_PLACEHOLDER_COLOR}
            />
            <Text className="flex-1 text-base text-foreground">
              {t("filter.noProject")}
            </Text>
            <OptionCountBadge count={counts?.get(NO_VALUE_KEY)} />
            {includeNoProject ? (
              <Ionicons name="checkmark" size={20} color={checkColor} />
            ) : null}
          </Pressable>
        }
        keyExtractor={(row) => `p:${row.project.id}`}
        renderItem={({ item }) => {
          const isSelected = selected.includes(item.project.id);
          return (
            <Pressable
              onPress={() => onToggle(item.project.id)}
              className={cn(
                "flex-row items-center gap-3 px-4 py-3 active:bg-secondary",
                isSelected && "bg-secondary/60",
              )}
            >
              <ProjectIcon icon={item.project.icon} size="md" />
              <Text
                className="flex-1 text-base text-foreground"
                numberOfLines={1}
              >
                {item.project.title}
              </Text>
              <OptionCountBadge count={counts?.get(item.project.id)} />
              {isSelected ? (
                <Ionicons name="checkmark" size={20} color={checkColor} />
              ) : null}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <CatalogEmptySlot
            states={[projectsRead.state]}
            onRetry={projectsRead.retry}
            emptyMessage={t("picker.noProjects")}
            query={query}
          />
        }
      />
    </View>
  );
}

/** Multi-select labels by id from the workspace issue-label list. No inline
 *  create — filtering is not a label-authoring surface. */
export function FilterLabelPickerBody({
  selected,
  onToggle,
  counts,
}: {
  selected: string[];
  onToggle: (labelId: string) => void;
  /** Facet counts by label id; `undefined` renders no badges. */
  counts?: ReadonlyMap<string, number>;
}) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useTranslation();
  const labelsRead = catalogRead(useQuery(labelListOptions(wsId)));
  const labels = labelsRead.items;
  const [query, setQuery] = useState("");
  const checkColor = useCheckColor();

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qLower = q.toLowerCase();
    return [...labels]
      .filter((l) => !qLower || l.name.toLowerCase().includes(qLower))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [labels, query]);

  return (
    <View className="flex-1">
      <SearchBox value={query} onChange={setQuery} placeholder={t("filter.labelSearch")} />
      <FlatList
        data={rows}
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        keyExtractor={(label) => `l:${label.id}`}
        renderItem={({ item }) => {
          const isSelected = selected.includes(item.id);
          return (
            <Pressable
              onPress={() => onToggle(item.id)}
              className={cn(
                "flex-row items-center gap-3 px-4 py-3 active:bg-secondary",
                isSelected && "bg-secondary/60",
              )}
            >
              <View
                className="size-3 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              <Text
                className="flex-1 text-base text-foreground"
                numberOfLines={1}
              >
                {item.name}
              </Text>
              <OptionCountBadge count={counts?.get(item.id)} />
              {isSelected ? (
                <Ionicons name="checkmark" size={20} color={checkColor} />
              ) : null}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <CatalogEmptySlot
            states={[labelsRead.state]}
            onRetry={labelsRead.retry}
            emptyMessage={t("picker.noLabels")}
            query={query}
          />
        }
      />
    </View>
  );
}

/**
 * Multi-select one custom-property definition's options (web
 * `PropertyFilterOptions` in issues-header.tsx). Checkbox definitions expose
 * the "true"/"false" pseudo-options with Yes/No labels; select and
 * multi_select list the definition's option catalog; actor / multi_actor list
 * the workspace member directory, with the signed-in user first and the value
 * being the `member:<user_id>` reference the server filters on. OR within the
 * definition — every toggle keeps this sheet open.
 */
export function FilterPropertyPickerBody({
  property,
  selected,
  onToggle,
  counts,
}: {
  property: IssueProperty;
  selected: string[];
  onToggle: (optionId: string) => void;
  /** Facet counts by option key; `undefined` renders no badges. */
  counts?: ReadonlyMap<string, number>;
}) {
  const { t } = useTranslation();
  const checkColor = useCheckColor();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [query, setQuery] = useState("");
  const actorProperty = isActorPropertyType(property.type);
  // Four-state read: an actor property with a failed member directory must
  // name that failure, not claim the definition has no selectable values.
  const membersRead = catalogRead(
    useQuery({ ...memberListOptions(wsId), enabled: actorProperty }),
  );

  const options = useMemo((): FilterPropertyOption[] => {
    if (property.type === "checkbox") {
      return [
        { id: "true", name: t("filter.propertyTrue"), color: undefined },
        { id: "false", name: t("filter.propertyFalse"), color: undefined },
      ];
    }
    // The candidate set (option ids, or `member:<user_id>` refs for the actor
    // types) is resolved by a pure helper so the actor branch is unit-tested
    // rather than merely string-matched — see `propertyFilterOptions`.
    return propertyFilterOptions({
      type: property.type,
      options: property.config.options ?? [],
      members: membersRead.items,
      currentUserId,
    });
  }, [property, t, membersRead.items, currentUserId]);

  // Members are searched by name or pinyin, matching every other member list
  // on mobile; option lists stay untitled-filtered as before.
  const rows = useMemo(() => {
    if (!actorProperty) return options;
    const q = query.trim();
    if (!q) return options;
    return options.filter((option) => matchesNameOrPinyin(option.name, q));
  }, [options, actorProperty, query]);

  return (
    <View className="flex-1">
      {actorProperty ? (
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder={t("properties.value.actorSearchPlaceholder")}
        />
      ) : null}
      <FlatList
        data={rows}
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        keyExtractor={(option) => `v:${option.id}`}
        renderItem={({ item }) => {
          const isSelected = selected.includes(item.id);
          return (
            <Pressable
              onPress={() => onToggle(item.id)}
              className={cn(
                "flex-row items-center gap-3 px-4 py-3 active:bg-secondary",
                isSelected && "bg-secondary/60",
              )}
            >
              {item.color ? (
                <View
                  className="size-3 rounded-full"
                  style={{ backgroundColor: item.color }}
                />
              ) : actorProperty ? (
                // Member rows carry the same avatar as every other member list
                // on mobile (web renders ActorAvatar here too).
                <ActorAvatar type="member" id={item.id.slice("member:".length)} size={24} />
              ) : (
                <Ionicons
                  name="pricetag-outline"
                  size={16}
                  color={MOBILE_PLACEHOLDER_COLOR}
                />
              )}
              <Text
                className="flex-1 text-base text-foreground"
                numberOfLines={1}
              >
                {item.name}
              </Text>
              <OptionCountBadge count={counts?.get(item.id)} />
              {isSelected ? (
                <Ionicons name="checkmark" size={20} color={checkColor} />
              ) : null}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          actorProperty ? (
            <CatalogEmptySlot
              states={[membersRead.state]}
              onRetry={membersRead.retry}
              emptyMessage={t("properties.value.actorSearchEmpty")}
              query={query}
            />
          ) : (
            <View className="px-3 py-8 items-center">
              <Text className="text-sm text-muted-foreground text-center">
                {/* No search box here, so "no matches" would be a lie about a
                    search the user never made — the options come from a
                    definition the parent already resolved. */}
                {t("filter.propertyNoOptions")}
              </Text>
            </View>
          )
        }
      />
    </View>
  );
}