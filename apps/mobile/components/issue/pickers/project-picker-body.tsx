/**
 * Pure picker body for an issue's project — single-select. Mirrors the
 * assignee picker pattern: the route owns the search input
 * (`usePickerSearch`) and passes the current `query` in as a prop. Body is
 * a pure FlatList — no chrome.
 */
import { useMemo } from "react";
import { FlatList, Pressable } from "react-native";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useColorScheme } from "nativewind";
import type { Project } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ProjectIcon } from "@/components/ui/project-icon";
import { MOBILE_PLACEHOLDER_COLOR } from "@/components/ui/input-tokens";
import { CatalogEmptySlot } from "@/components/catalog/catalog-status";
import { projectListOptions } from "@/data/queries/projects";
import { useWorkspaceStore } from "@/data/workspace-store";
import { catalogRead } from "@/lib/catalog-read";
import { matchesNameOrPinyin } from "@/lib/name-search";
import { useScrollToTopOnChange } from "@/lib/use-scroll-to-top-on-change";
import { THEME } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n/react";

type Row = { kind: "none" } | { kind: "project"; project: Project };

interface Props {
  value: Project | null;
  query: string;
  onChange: (next: Project | null) => void;
}

export function ProjectPickerBody({ value, query, onChange }: Props) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useTranslation();
  // Four-state read (MYS-1907): the `= []` default made a failed or in-flight
  // project list indistinguishable from a workspace with no projects, so the
  // sheet answered 「此工作区暂无项目。请在网页端创建。」 and sent the user to the
  // web UI to create a project they already had.
  const catalog = catalogRead(useQuery(projectListOptions(wsId)));
  const projects = catalog.items;
  const listRef = useScrollToTopOnChange(query);
  const { colorScheme } = useColorScheme();
  const checkColor =
    colorScheme === "dark" ? THEME.dark.primary : THEME.light.primary;

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    // Project titles are searched pinyin-aware, matching web's project picker
    // (projects/components/project-picker.tsx:64: `title.includes(q) ||
    // matchesPinyin(title, q)`) — which is what makes 「数据透明化」 reachable
    // by typing `sjtmh`.
    const projectRows: Row[] = [...projects]
      .filter((p) => matchesNameOrPinyin(p.title, query))
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((p) => ({ kind: "project" as const, project: p }));

    if (q) return projectRows;

    // Pin selected project to the top (below "No project"). Apple HIG
    // doesn't require this — product UX choice that mirrors assignee.
    const selected = projectRows.find(
      (r) => r.kind === "project" && r.project.id === value?.id,
    );
    return [
      { kind: "none" },
      ...(selected ? [selected] : []),
      ...projectRows.filter(
        (r) => !(r.kind === "project" && r.project.id === value?.id),
      ),
    ];
  }, [projects, query, value]);

  const isSelected = (row: Row) => {
    if (row.kind === "none") return value === null;
    return value !== null && row.project.id === value.id;
  };

  return (
    <FlatList
      ref={listRef}
      data={rows}
      className="flex-1"
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      contentInsetAdjustmentBehavior="automatic"
      keyExtractor={(row) =>
        row.kind === "none" ? "none" : `p:${row.project.id}`
      }
      renderItem={({ item }) => (
        <Pressable
          onPress={() =>
            item.kind === "none" ? onChange(null) : onChange(item.project)
          }
          className="flex-row items-center gap-3 px-4 py-3 active:bg-secondary"
        >
          {item.kind === "none" ? (
            <Ionicons
              name="close-circle-outline"
              size={28}
              color={MOBILE_PLACEHOLDER_COLOR}
            />
          ) : (
            <ProjectIcon icon={item.project.icon} size="md" />
          )}
          <Text
            className="flex-1 text-title-sm text-foreground"
            numberOfLines={1}
          >
            {item.kind === "none" ? t("picker.noProject") : item.project.title}
          </Text>
          {isSelected(item) ? (
            <Ionicons name="checkmark" size={20} color={checkColor} />
          ) : null}
        </Pressable>
      )}
      ListEmptyComponent={
        <CatalogEmptySlot
          states={[catalog.state]}
          onRetry={catalog.retry}
          emptyMessage={t("picker.noProjects")}
          query={query}
        />
      }
    />
  );
}
