/**
 * Agent-list filter sheet — the mobile port of web's Filter popover
 * (`packages/views/agents/components/agent-list-toolbar.tsx:314-508`). Web
 * renders four submenus (Availability / Access / Runtime / Owner / Model) in a
 * `DropdownMenu`; on a phone the equivalent host is `PickerSheet`, the same
 * bottom-sheet shell every other picker on this screen uses.
 *
 * Two deliberate differences from web, both recorded here because they are
 * shape decisions a later reader would otherwise "fix" back:
 *
 *   - **No Access section.** Mobile's access chips (`ScopeFilterChips` in the
 *     agents route) already ARE web's `filters.access` dimension, so listing
 *     it again inside this sheet would put one axis on the screen twice.
 *   - **Sections are always listed in full.** Web renders each dimension's
 *     options from the scope's unfiltered rows, which is what keeps a facet
 *     from erasing its siblings; mobile inherits that from
 *     `buildAgentFilterOptions` and additionally keeps the section header
 *     visible when a dimension has no options at all (web hides the Model
 *     submenu entirely when `modelCounts` is empty — `:489`), so the four
 *     dimensions read as a stable, learnable list rather than one whose
 *     entries appear and disappear.
 *
 * The rows carry an explicit `checkbox` / `square-outline` glyph where web
 * renders a `Checkbox` primitive mobile does not have — the same substitution
 * `subscriber-picker-sheet.tsx` makes.
 */
import { Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { AgentFilterOptions, AgentListFilters } from "@/lib/filter-agents";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { PickerSheet } from "@/components/issue/pickers/picker-sheet";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

/** Availability → its dot colour, web's `availabilityConfig` (`agent-list-toolbar.tsx`
 *  imports it from `packages/views/agents/components/availability.ts`). The
 *  three offered values only — `archived` is not an option here. */
const AVAILABILITY_DOT: Record<string, string> = {
  online: "bg-emerald-500",
  unstable: "bg-amber-500",
  offline: "bg-muted-foreground",
};

/** Availability → its i18n key. Mirrors the row dot's vocabulary so the
 *  filter and the list cannot label the same state differently. */
const AVAILABILITY_LABEL_KEY: Record<string, string> = {
  online: "agents.availability.online",
  unstable: "agents.availability.unstable",
  offline: "agents.availability.offline",
};

interface Props {
  visible: boolean;
  onClose: () => void;
  filters: AgentListFilters;
  options: AgentFilterOptions;
  /** Count of active dimensions — gates the Clear action, web's
   *  `hasActiveFilters` (`agent-list-toolbar.tsx:318`). */
  activeCount: number;
  onToggle: (
    dimension: keyof AgentListFilters,
    value: string,
  ) => void;
  onClear: () => void;
}

export function AgentFilterSheet({
  visible,
  onClose,
  filters,
  options,
  activeCount,
  onToggle,
  onClear,
}: Props) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  const section = (title: string) => (
    <View className="bg-muted/40 px-4 py-1.5">
      <Text className="text-caption font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </Text>
    </View>
  );

  const row = ({
    key,
    label,
    count,
    checked,
    onPress,
    leading,
    a11yLabel,
  }: {
    key: string;
    label: string;
    count: number;
    checked: boolean;
    onPress: () => void;
    leading?: React.ReactNode;
    a11yLabel?: string;
  }) => (
    <Pressable
      key={key}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={a11yLabel ?? t("agents.filter.optionAria", { label, count })}
      className="flex-row items-center gap-3 px-4 py-3 active:bg-secondary"
    >
      <Ionicons
        name={checked ? "checkbox" : "square-outline"}
        size={20}
        color={checked ? theme.primary : theme.mutedForeground}
      />
      {leading}
      <Text className="flex-1 text-body text-foreground" numberOfLines={1}>
        {label}
      </Text>
      <Text className="text-caption tabular-nums text-muted-foreground">
        {count}
      </Text>
    </Pressable>
  );

  return (
    <PickerSheet
      title={t("agents.filter.title")}
      visible={visible}
      onClose={onClose}
      fill
    >
      <View className="flex-1">
        <ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
          {section(t("agents.filter.sectionAvailability"))}
          {options.availability.map((o) =>
            row({
              key: `availability:${o.value}`,
              label: AVAILABILITY_LABEL_KEY[o.value]
                ? t(AVAILABILITY_LABEL_KEY[o.value])
                : o.value,
              count: o.count,
              checked: filters.availability.includes(o.value),
              onPress: () => onToggle("availability", o.value),
              leading: (
                <View
                  className={cn(
                    "size-1.5 rounded-full",
                    AVAILABILITY_DOT[o.value] ?? "bg-muted-foreground",
                  )}
                />
              ),
            }),
          )}

          {section(t("agents.filter.sectionRuntime"))}
          {options.runtimes.length === 0 ? (
            <EmptyRow />
          ) : (
            options.runtimes.map((o) =>
              row({
                key: `runtime:${o.value}`,
                label: o.label,
                count: o.count,
                checked: filters.runtimes.includes(o.value),
                onPress: () => onToggle("runtimes", o.value),
              }),
            )
          )}

          {section(t("agents.filter.sectionOwner"))}
          {options.owners.length === 0 ? (
            <EmptyRow />
          ) : (
            options.owners.map((o) =>
              row({
                key: `owner:${o.value}`,
                label: o.label,
                count: o.count,
                checked: filters.owners.includes(o.value),
                onPress: () => onToggle("owners", o.value),
                leading: <ActorAvatar type="member" id={o.value} size={24} />,
              }),
            )
          )}

          {section(t("agents.filter.sectionModel"))}
          {options.models.length === 0 ? (
            <EmptyRow />
          ) : (
            options.models.map((o) =>
              row({
                key: `model:${o.value}`,
                // Web shows the runtime-native model id verbatim
                // (`agent-list-toolbar.tsx:501`), not a prettified label.
                label: o.label,
                count: o.count,
                checked: filters.models.includes(o.value),
                onPress: () => onToggle("models", o.value),
              }),
            )
          )}
        </ScrollView>

        {/* Clear — web puts this on the trigger button (`:321`); the sheet's
            own footer is the mobile equivalent, and it stays disabled until
            something is actually active so it never reads as a no-op. */}
        <View className="border-t border-border px-4 py-3">
          <Pressable
            onPress={onClear}
            disabled={activeCount === 0}
            accessibilityRole="button"
            accessibilityState={{ disabled: activeCount === 0 }}
            accessibilityLabel={t("agents.filter.clear")}
            className={cn(
              "items-center rounded-lg py-2.5",
              activeCount === 0 ? "opacity-40" : "active:bg-secondary",
            )}
          >
            <Text className="text-body font-medium text-foreground">
              {t("agents.filter.clear")}
            </Text>
          </Pressable>
        </View>
      </View>
    </PickerSheet>
  );
}

/** Placeholder for a dimension with no options in the current scope — keeps
 *  the four section headers stable (see the module doc). */
function EmptyRow() {
  const { t } = useTranslation();
  return (
    <View className="px-4 py-3">
      <Text className="text-body text-muted-foreground">
        {t("agents.filter.noOptions")}
      </Text>
    </View>
  );
}
