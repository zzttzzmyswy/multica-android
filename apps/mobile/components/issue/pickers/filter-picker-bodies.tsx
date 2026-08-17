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
 * Android-safe search: each body owns a local TextInput filter instead of
 * relying on the iOS-only native UISearchController (useNativeSearchBar) the
 * attribute pickers use — Expo on Android does not render
 * `headerSearchBarOptions`. Same search semantics, one code path for both.
 */
import { useMemo, useState } from "react";
import { FlatList, Pressable, TextInput, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useColorScheme } from "nativewind";
import type { Agent, MemberWithUser, Project, Squad } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { ProjectIcon } from "@/components/ui/project-icon";
import { MOBILE_PLACEHOLDER_COLOR } from "@/components/ui/input-tokens";
import { memberListOptions } from "@/data/queries/members";
import { agentListOptions } from "@/data/queries/agents";
import { squadListOptions } from "@/data/queries/squads";
import { projectListOptions } from "@/data/queries/projects";
import { labelListOptions } from "@/data/queries/labels";
import { useWorkspaceStore } from "@/data/workspace-store";
import type { ActorFilterValue } from "@/data/stores/issue-filter-slice";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme as useSystemColorScheme } from "@/lib/use-color-scheme";

const AVATAR_SIZE = 36;

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
}: {
  selected: ActorFilterValue[];
  onToggle: (value: ActorFilterValue) => void;
  searchPlaceholder: string;
}) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useTranslation();
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: squads = [] } = useQuery(squadListOptions(wsId));
  const [query, setQuery] = useState("");
  const checkColor = useCheckColor();

  const selectedKeys = useMemo(
    () => new Set(selected.map((s) => `${s.type}:${s.id}`)),
    [selected],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matchName = (name: string) => !q || name.toLowerCase().includes(q);
    const memberRows: { kind: "member"; member: MemberWithUser }[] =
      [...members]
        .filter((m) => matchName(m.name))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((member) => ({ kind: "member" as const, member }));
    const agentRows: { kind: "agent"; agent: Agent }[] = [...agents]
      .filter((a) => matchName(a.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((agent) => ({ kind: "agent" as const, agent }));
    const squadRows: { kind: "squad"; squad: Squad }[] = [...squads]
      .filter((s) => !s.archived_at && matchName(s.name))
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
              {isSelected ? (
                <Ionicons name="checkmark" size={20} color={checkColor} />
              ) : null}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View className="px-3 py-8 items-center">
            <Text className="text-sm text-muted-foreground">
              {t("picker.noMatches")}
            </Text>
          </View>
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
}: {
  selected: string[];
  includeNoProject: boolean;
  onToggle: (projectId: string) => void;
  onToggleNoProject: () => void;
}) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useTranslation();
  const { data: projects = [] } = useQuery(projectListOptions(wsId));
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
              {isSelected ? (
                <Ionicons name="checkmark" size={20} color={checkColor} />
              ) : null}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View className="px-3 py-8 items-center">
            <Text className="text-sm text-muted-foreground text-center">
              {query ? t("picker.noMatches") : t("picker.noProjects")}
            </Text>
          </View>
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
}: {
  selected: string[];
  onToggle: (labelId: string) => void;
}) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useTranslation();
  const { data: labels = [] } = useQuery(labelListOptions(wsId));
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
              {isSelected ? (
                <Ionicons name="checkmark" size={20} color={checkColor} />
              ) : null}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View className="px-3 py-8 items-center">
            <Text className="text-sm text-muted-foreground text-center">
              {query ? t("picker.noMatches") : t("picker.noLabels")}
            </Text>
          </View>
        }
      />
    </View>
  );
}