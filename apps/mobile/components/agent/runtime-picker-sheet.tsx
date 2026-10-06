/**
 * Runtime picker for the agent create/edit form — a modal sheet over the
 * workspace's runtimes. Mirrors web
 * `packages/views/agents/components/runtime-picker.tsx`: rows grouped by machine
 * with a per-section online count, row labels disambiguated by machine, a search
 * box above a threshold, and a Mine / All scope toggle whenever the workspace
 * holds somebody else's runtime.
 *
 * The FULL runtime list reaches this component. A runtime the viewer may not use
 * (somebody else's private machine) stays VISIBLE and renders locked with the
 * reason in-line — web does the same, and hiding those rows is how the viewer
 * never learns the machine exists or who to ask. The caller's `usableRuntimes()`
 * therefore only seeds the default selection; it no longer shapes what can be
 * seen.
 *
 * Mobile has no hover, so web's `title=` tooltip becomes an in-row reason line
 * plus an accessibility hint: the lock badge and the explanation are rendered
 * together, always, for exactly the rows that are locked.
 */
import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, TextInput, View, ActivityIndicator } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { RuntimeDevice } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { runtimeRowLabel } from "@/lib/runtime-machines";
import {
  RUNTIME_SEARCH_THRESHOLD,
  computeFilteredRuntimes,
  firstUsableRuntimeId,
  hasOtherRuntimes,
  isRuntimeRowLocked,
  pickerEmptyState,
  pickerMachines,
  type RuntimeFilter,
} from "@/lib/runtime-picker";

interface Props {
  visible: boolean;
  runtimes: RuntimeDevice[];
  loading: boolean;
  selectedId: string | null;
  /**
   * The viewing member — required, and deliberately so. It decides both the
   * scope toggle and which rows render locked, so a caller that forgot it would
   * show somebody else's private runtime as pickable. There is no safe default;
   * every caller knows its viewer.
   */
  currentUserId: string | null;
  /**
   * Scope the sheet opens on. Defaults to "mine", matching web's create dialog.
   * Surfaces that hand in an ALREADY-scoped list — the AI-builder page, the
   * builder's runtime switch and the Mika setup dialog all pass
   * `usableRuntimes(...)` — open on "all" instead, so adding the toggle cannot
   * shrink a list those callers had already decided on.
   */
  defaultFilter?: RuntimeFilter;
  /** Row tap. The sheet closes itself afterwards; the caller only applies the
   *  selection, so the two never disagree about ordering. */
  onPick: (runtime: RuntimeDevice) => void;
  onClose: () => void;
}

export function RuntimePickerSheet({
  visible,
  runtimes,
  loading,
  selectedId,
  currentUserId,
  defaultFilter = "mine",
  onPick,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const muted = theme.mutedForeground;

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<RuntimeFilter>(defaultFilter);
  // Health buckets are minute-scale, so the grouping only needs a timestamp
  // accurate to the open. Sampled here, in the same effect that resets the
  // query, so a keystroke or an unrelated re-render never regroups the list.
  const [now, setNow] = useState(() => Date.now());

  // The sheet stays mounted while closed, so its search box and scope would
  // otherwise carry over between visits — reopening into a stale query reads as
  // an empty list. Reset both on each open, which is also what web does when its
  // popover closes.
  useEffect(() => {
    if (!visible) return;
    setSearch("");
    setFilter(defaultFilter);
    setNow(Date.now());
  }, [visible, defaultFilter]);

  const showSearch = runtimes.length > RUNTIME_SEARCH_THRESHOLD;
  // No known viewer ⇒ no scope to compute, so no toggle. A tab pair that cannot
  // change the list is worse than no tab pair.
  const showFilter = hasOtherRuntimes(runtimes, currentUserId);

  const machines = useMemo(
    () => pickerMachines(runtimes, { filter, search, currentUserId, now }),
    [runtimes, filter, search, currentUserId, now],
  );

  const emptyState = pickerEmptyState(runtimes, machines, search);

  // Collapse the machine header when there is only one group. Web always draws
  // it; on a phone the header on a single-group list is pure overhead, and the
  // group title is already carried by each row label.
  const flat = machines.length === 1 ? machines[0] : null;

  /**
   * Scope toggle — a second way to commit a selection, not merely a view
   * filter.
   *
   * Divergence from web, deliberately: web pushes "" when the new scope holds
   * no usable runtime. Mobile cannot, because the create form's own seeding
   * effect refills an empty `runtimeId` from its scope-unaware
   * `usableRuntimes()` — so pushing "" would silently re-select a runtime the
   * sheet is not showing. When the new scope has nothing runnable the existing
   * selection is kept instead: it is still valid, and the user is only
   * browsing scopes.
   */
  const handleScopeChange = (next: RuntimeFilter) => {
    if (next === filter) return;
    setFilter(next);
    const scoped = computeFilteredRuntimes(runtimes, next, currentUserId);
    const usableId = firstUsableRuntimeId(scoped, currentUserId);
    const nextRuntime = scoped.find((runtime) => runtime.id === usableId);
    if (nextRuntime) onPick(nextRuntime);
  };

  const renderRow = (machineTitle: string, runtime: RuntimeDevice) => {
    const selected = runtime.id === selectedId;
    const locked = isRuntimeRowLocked(runtime, currentUserId);
    const isPublic = runtime.visibility === "public";
    const isCloud = runtime.runtime_mode === "cloud";
    const label = runtimeRowLabel(runtime, machineTitle);
    return (
      <Pressable
        key={runtime.id}
        disabled={locked}
        onPress={() => {
          onPick(runtime);
          onClose();
        }}
        className={cn(
          "flex-row items-center gap-3 px-4 py-3",
          locked ? "opacity-50" : "active:bg-secondary",
          selected && !locked && "bg-secondary",
        )}
        accessibilityRole="button"
        accessibilityState={{ disabled: locked, selected }}
        accessibilityLabel={label}
        accessibilityHint={
          locked ? t("agents.runtimePicker.lockedReason") : undefined
        }
      >
        <View className="size-8 rounded-lg bg-secondary items-center justify-center">
          <Ionicons
            name={isCloud ? "cloud" : "hardware-chip"}
            size={16}
            color={muted}
          />
        </View>
        <View className="flex-1 min-w-0 gap-0.5">
          <View className="flex-row items-center gap-1.5">
            <Text
              className="text-sm font-medium text-foreground shrink"
              numberOfLines={1}
            >
              {label}
            </Text>
            {isCloud ? (
              <Text className="text-[10px] text-info">
                {t("agents.runtime.cloud")}
              </Text>
            ) : null}
            {/* Lock stands in for access, the status dot for reachability: an
                offline runtime the viewer OWNS is reachable-but-away, not
                locked, and must stay pickable in edit mode. */}
            {locked ? (
              <View className="flex-row items-center gap-0.5 rounded bg-secondary px-1 py-0.5">
                <Ionicons name="lock-closed" size={9} color={muted} />
                <Text className="text-[10px] text-muted-foreground">
                  {t("agents.runtimePicker.lockedBadge")}
                </Text>
              </View>
            ) : null}
          </View>
          {/* No hover on a phone: the reason web puts in a `title` is rendered
              in-row, under the very row it explains. */}
          {locked ? (
            <Text className="text-[11px] text-muted-foreground" numberOfLines={2}>
              {t("agents.runtimePicker.lockedReason")}
            </Text>
          ) : (
            <View className="flex-row items-center gap-1.5">
              <View
                className={cn(
                  "size-1.5 rounded-full",
                  runtime.status === "online"
                    ? "bg-success"
                    : "bg-muted-foreground/40",
                )}
              />
              <Text className="text-xs text-muted-foreground">
                {t(`runtimes.health.${runtime.status}`)}
                {runtime.provider ? ` · ${runtime.provider}` : ""}
              </Text>
              {!isPublic ? (
                <Text className="text-[10px] text-muted-foreground">
                  ·{" "}
                  <Text className="text-info">
                    {t("runtimes.visibility.private")}
                  </Text>
                </Text>
              ) : null}
            </View>
          )}
        </View>
        {selected && !locked ? (
          <Ionicons name="checkmark" size={18} color={muted} />
        ) : null}
      </Pressable>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable className="flex-1 bg-black/40" onPress={onClose}>
        <View className="flex-1 items-center justify-center px-6">
          <Pressable onPress={() => {}} className="w-full max-w-sm">
            <View className="bg-popover rounded-2xl overflow-hidden">
              <View className="flex-row items-center justify-between gap-2 px-4 py-3 border-b border-border">
                <Text className="text-base font-semibold text-foreground">
                  {t("agents.new.runtimeLabel")}
                </Text>
                {showFilter ? (
                  <View className="flex-row items-center gap-0.5 rounded-md p-0.5 bg-secondary">
                    {(["mine", "all"] as const).map((scope) => {
                      const active = filter === scope;
                      return (
                        <Pressable
                          key={scope}
                          onPress={() => handleScopeChange(scope)}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          className={cn(
                            "rounded px-2 py-0.5",
                            active && "bg-background",
                          )}
                        >
                          <Text
                            className={cn(
                              "text-xs font-medium",
                              active
                                ? "text-foreground"
                                : "text-muted-foreground",
                            )}
                          >
                            {t(
                              scope === "mine"
                                ? "agents.runtimePicker.filterMine"
                                : "agents.runtimePicker.filterAll",
                            )}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </View>

              {showSearch ? (
                <View className="px-3 py-2 border-b border-border">
                  <TextInput
                    value={search}
                    onChangeText={setSearch}
                    placeholder={t("agents.runtimePicker.searchPlaceholder")}
                    placeholderTextColor={muted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    className="h-9 rounded-md bg-secondary px-3 text-sm text-foreground"
                  />
                </View>
              ) : null}

              <ScrollView
                className="max-h-96"
                keyboardShouldPersistTaps="handled"
              >
                {loading ? (
                  <View className="py-8 items-center">
                    <ActivityIndicator />
                  </View>
                ) : emptyState ? (
                  /* Three distinct empty states, and the difference is the
                     point: an empty workspace has no runtime to add (none), an
                     empty scope needs the other tab (scope), and a search that
                     matched nothing needs the query loosened (search). Web
                     splits the last two but conflates away the first. */
                  <View className="px-4 py-8">
                    <Text className="text-sm text-muted-foreground text-center">
                      {t(
                        emptyState === "none"
                          ? "agents.new.runtimesNone"
                          : emptyState === "scope"
                            ? "agents.runtimePicker.scopeEmpty"
                            : "agents.runtimePicker.noResults",
                      )}
                    </Text>
                  </View>
                ) : flat ? (
                  flat.runtimes.map((runtime) => renderRow(flat.title, runtime))
                ) : (
                  machines.map((machine) => (
                    <View key={machine.id}>
                      <View className="flex-row items-center justify-between gap-2 px-4 pb-1 pt-3">
                        <Text
                          className="text-[11px] font-medium text-muted-foreground shrink"
                          numberOfLines={1}
                        >
                          {machine.title}
                        </Text>
                        <Text className="text-[11px] text-muted-foreground">
                          {t("agents.runtimePicker.groupOnline", {
                            online: machine.onlineCount,
                            total: machine.runtimes.length,
                          })}
                        </Text>
                      </View>
                      {machine.runtimes.map((runtime) =>
                        renderRow(machine.title, runtime),
                      )}
                    </View>
                  ))
                )}
              </ScrollView>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
