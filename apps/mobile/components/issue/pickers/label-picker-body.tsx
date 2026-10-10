/**
 * Pure picker body for issue labels — multi-select with toggle-on-tap.
 * Mirrors the assignee picker shape: the route owns the search input
 * (`usePickerSearch` decides between the iOS native header and a
 * body-rendered field) and passes `query` in as a prop. Two differences:
 *
 *   1. Multi-select: tap toggles attach/detach and does NOT close the
 *      sheet. The user dismisses via grabber drag-down or Back.
 *   2. Inline create: when the query has no exact match, the top row
 *      becomes a "Create '<query>'" affordance — taps create-and-attach
 *      in one motion.
 *
 * Mirrors `packages/views/issues/components/pickers/label-picker.tsx` for
 * the createAndAttach + pickInlineColor logic.
 */
import { useMemo } from "react";
import { FlatList, Pressable, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { UseQueryOptions } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useColorScheme } from "nativewind";
import type { Label } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { labelCatalogOptions, labelListOptions } from "@/data/queries/labels";
import { useWorkspaceStore } from "@/data/workspace-store";
import { catalogRead } from "@/lib/catalog-read";
import { CatalogEmptySlot } from "@/components/catalog/catalog-status";
import { useScrollToTopOnChange } from "@/lib/use-scroll-to-top-on-change";
import { pickInlineColor } from "@/lib/inline-color";
import { THEME } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n/react";

type Row =
  | { kind: "create"; name: string }
  | { kind: "label"; label: Label };

interface Props {
  attached: Label[];
  query: string;
  onAttach: (label: Label) => void;
  onDetach: (labelId: string) => void;
  /** Create-and-attach in one motion. `query` is the entered text. */
  onCreate: (name: string, color: string) => void;
  /**
   * Resource-scope the picker's catalog (defaults to the workspace issue
   * list for the issue flows). When set (e.g. "skill" from the skill-detail
   * labels picker), the catalog is fetched with `?resource_type=` so only
   * labels of that type are offered — mirrors web resource-label-picker.
   */
  catalogResourceType?: "issue" | "agent" | "skill";
}

export function LabelPickerBody({
  attached,
  query,
  onAttach,
  onDetach,
  onCreate,
  catalogResourceType,
}: Props) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useTranslation();
  // Issue-list and resource-scoped catalogs return the same Label[] shape but
  // carry different query keys — widen the union so useQuery accepts either.
  const catalogOptions = (catalogResourceType
    ? labelCatalogOptions(wsId, catalogResourceType)
    : labelListOptions(wsId)) as UseQueryOptions<Label[]>;
  // Four-state read (MYS-1907): a failed or in-flight label catalog used to
  // answer 「此工作区暂无标签。」 — a claim about the workspace made without having
  // read it. The state now gates the empty slot, and the inline-create row
  // stays available in every state (creating a label whose catalog has not
  // arrived is still a legitimate action).
  const catalog = catalogRead(useQuery(catalogOptions));
  const labels = catalog.items;
  const listRef = useScrollToTopOnChange(query);
  const { colorScheme } = useColorScheme();
  const checkColor =
    colorScheme === "dark" ? THEME.dark.primary : THEME.light.primary;

  const attachedIds = useMemo(
    () => new Set(attached.map((l) => l.id)),
    [attached],
  );

  const rows = useMemo<Row[]>(() => {
    const q = query.trim();
    const qLower = q.toLowerCase();

    const sorted = [...labels].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    const filtered = qLower
      ? sorted.filter((l) => l.name.toLowerCase().includes(qLower))
      : sorted;
    const exactMatch = sorted.some(
      (l) => l.name.toLowerCase() === qLower,
    );

    // No query → pin attached labels at top, others below.
    if (!q) {
      const attachedRows: Row[] = sorted
        .filter((l) => attachedIds.has(l.id))
        .map((l) => ({ kind: "label" as const, label: l }));
      const otherRows: Row[] = sorted
        .filter((l) => !attachedIds.has(l.id))
        .map((l) => ({ kind: "label" as const, label: l }));
      return [...attachedRows, ...otherRows];
    }

    // Query active → show Create row first when no exact match, then matches.
    const labelRows: Row[] = filtered.map((l) => ({
      kind: "label" as const,
      label: l,
    }));
    return exactMatch ? labelRows : [{ kind: "create", name: q }, ...labelRows];
  }, [labels, query, attachedIds]);

  const onToggle = (label: Label) => {
    if (attachedIds.has(label.id)) onDetach(label.id);
    else onAttach(label);
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
        row.kind === "create" ? `create:${row.name}` : `l:${row.label.id}`
      }
      renderItem={({ item }) =>
        item.kind === "create" ? (
          <Pressable
            onPress={() => onCreate(item.name, pickInlineColor(item.name))}
            className="flex-row items-center gap-3 px-4 py-3 active:bg-secondary"
          >
            <View
              className="size-3 rounded-full"
              style={{ backgroundColor: pickInlineColor(item.name) }}
            />
            <Text className="flex-1 text-title-sm text-foreground">
              {t("picker.createWithGuess", { name: item.name })}
            </Text>
            <Ionicons name="add" size={20} color={checkColor} />
          </Pressable>
        ) : (
          <Pressable
            onPress={() => onToggle(item.label)}
            className="flex-row items-center gap-3 px-4 py-3 active:bg-secondary"
          >
            <View
              className="size-3 rounded-full"
              style={{ backgroundColor: item.label.color }}
            />
            <Text
              className="flex-1 text-title-sm text-foreground"
              numberOfLines={1}
            >
              {item.label.name}
            </Text>
            {attachedIds.has(item.label.id) ? (
              <Ionicons name="checkmark" size={20} color={checkColor} />
            ) : null}
          </Pressable>
        )
      }
      ListEmptyComponent={
        <CatalogEmptySlot
          states={[catalog.state]}
          onRetry={catalog.retry}
          emptyMessage={t("picker.noLabels")}
          query={query}
        />
      }
    />
  );
}
