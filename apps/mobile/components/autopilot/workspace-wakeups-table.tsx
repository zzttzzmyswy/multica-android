/**
 * The workspace-wide wakeup table (MYS-2043) — web's 自动化 → 任务唤醒 tab,
 * ported to a phone.
 *
 * Mirrors `packages/views/autopilots/components/workspace-wakeups.tsx` (716
 * lines, a `Table` with eight columns). A phone has no table, so the same rows
 * render as cards carrying the same fields, the same controls and the same
 * semantics: the eight columns become a two-line summary plus a detail line,
 * and the toolbar's five-part scope control and three dropdowns become the chip
 * row and single-choice sheets this app already uses on the autopilots list.
 *
 * Every decision it needs — who is selectable, what 有效期 says, which page the
 * pager may move to — lives in `lib/workspace-wakeups.ts`, and the state lives
 * in `lib/use-workspace-wakeups.ts`, so both can be pinned in the Node-only
 * vitest lane. This file is layout and wiring, and `lib/workspace-wakeup-wiring
 * .test.ts` pins that it actually consumes them.
 *
 * The divergences from web, each deliberate:
 *   - **Cards, not a table.** A 900px eight-column table cannot be read on a 6"
 *     screen, and scrolling one horizontally would put each row's controls
 *     off-screen. Each card keeps every column: issue, trigger, target agent,
 *     source, ends, 7-day runs, and the control strip.
 *   - **The per-row controls open the SAME sheet the issue surface uses**
 *     (`WakeupRowSheet`), rather than web's inline popover. A phone has no
 *     hover, and the sheet is this app's established shape for an action list —
 *     so a rule behaves identically wherever it is reached from.
 *   - **The row's switch writes the issue-level disable/enable**, which is what
 *     web's own row does (`WakeupControl` bound to `useDisableIssueWakeup`).
 *     The batch is the only workspace-level write, and it is sequential for the
 *     reason `data/mutations/workspace-wakeups.ts` gives.
 */
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { WorkspaceWakeup } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TextField } from "@/components/ui/text-field";
import { PickerSheet } from "@/components/issue/pickers/picker-sheet";
import { IssuePickerBody } from "@/components/issue/pickers/issue-picker-body";
import { WakeupRowSheet } from "@/components/issue/wakeup-row-actions";
import { WakeupCreateSheet } from "@/components/issue/wakeup-create-sheet";
import { useWorkspaceWakeupsController } from "@/lib/use-workspace-wakeups";
import { useIssueWakeupToggles } from "@/lib/use-issue-wakeup-toggles";
import { useDebouncedTableSearch } from "@/lib/use-debounced-table-search";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { workspaceWakeupBatchMessage } from "@/lib/workspace-wakeups";

/** Ionicons per trigger kind, matching the autopilots list's own vocabulary. */
const KIND_ICONS: Record<string, React.ComponentProps<typeof Ionicons>["name"]> = {
  event: "notifications-outline",
  at: "time-outline",
  every: "repeat-outline",
  cron: "calendar-outline",
};

/**
 * One rule: what it watches, who it wakes, who made it, when it ends.
 *
 * The card keeps web's eight columns in the order the table prints them, minus
 * the ones a phone reads as context rather than as a column (source and runs
 * fold into the second line; the trigger's own detail — a cron's zone, a
 * recurring rule's cadence — is the line under it).
 */
function WakeupTableRow({
  row,
  text,
  selected,
  selecting,
  pending,
  onToggleSelect,
  onOpen,
  onToggleEnabled,
}: {
  row: WorkspaceWakeup;
  text: ReturnType<typeof useWorkspaceWakeupsController>["text"];
  selected: boolean;
  selecting: boolean;
  pending: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onToggleEnabled: (enabled: boolean) => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const detail = text.triggerDetail(row);
  const runState = text.runState(row);
  const blockKey = text.blockKey(row);
  const selectable = text.selectable(row);
  // A system rule's row is edited on its issue (the sheet behind it writes the
  // system endpoint there), so the table gives it no switch — `rule` is what
  // marks it, and `workspaceWakeupRowBlock` refuses its writes for the same
  // reason.
  const isSystem = !!row.rule;

  return (
    <Pressable
      onPress={onOpen}
      className="px-4 py-3 active:bg-secondary"
      accessibilityRole="button"
      accessibilityLabel={`${row.issue_identifier} ${row.issue_title}`}
    >
      <View className="flex-row items-start gap-2">
        {/* The checkbox is offered only where the batch can act (see
            `workspaceWakeupSelectable`) and stays visible while ANY row is
            selected — a phone has no hover to reveal it on. */}
        {selectable || selecting ? (
          <Pressable
            onPress={onToggleSelect}
            disabled={pending || !selectable}
            hitSlop={8}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected, disabled: !selectable }}
            accessibilityLabel={t("autopilots.wakeups.select_row", {
              issue: row.issue_identifier,
              agent: row.agent_name,
            })}
            className={pending || !selectable ? "opacity-40" : ""}
          >
            <Ionicons
              name={selected ? "checkbox" : "square-outline"}
              size={18}
              color={selected ? theme.brand : theme.mutedForeground}
            />
          </Pressable>
        ) : null}

        <View className="flex-1 min-w-0">
          <View className="flex-row items-center gap-1.5">
            <Ionicons
              name={KIND_ICONS[row.kind] ?? "notifications-outline"}
              size={13}
              color={theme.mutedForeground}
            />
            <Text className="text-xs tabular-nums text-muted-foreground">
              {row.issue_identifier}
            </Text>
            <Text
              className="flex-1 text-sm font-medium text-foreground"
              numberOfLines={1}
            >
              {row.issue_title}
            </Text>
          </View>

          <Text className="mt-1 text-xs text-foreground" numberOfLines={2}>
            {text.trigger(row)}
          </Text>
          {detail ? (
            <Text className="mt-0.5 text-[11px] text-muted-foreground" numberOfLines={1}>
              {detail}
            </Text>
          ) : null}

          {/* Second line: web's target-agent / source columns, then 有效期. */}
          <View className="mt-1 flex-row flex-wrap items-center gap-x-1.5 gap-y-1">
            <Text className="text-[11px] text-muted-foreground" numberOfLines={1}>
              {row.agent_name || t("autopilots.wakeups.no_target")}
            </Text>
            <Text className="text-[11px] text-muted-foreground">·</Text>
            <Text className="text-[11px] text-muted-foreground" numberOfLines={1}>
              {t(`autopilots.wakeups.sources.${row.source}`)}
            </Text>
            <Text className="text-[11px] text-muted-foreground">·</Text>
            <Text
              className={`flex-1 text-[11px] ${
                row.paused_reason ? "text-destructive" : "text-muted-foreground"
              }`}
              numberOfLines={2}
            >
              {text.ends(row)}
            </Text>
          </View>

          {/* Third line: the run counters web puts in their own column. */}
          <View className="mt-1 flex-row items-center gap-2">
            <Ionicons name="repeat-outline" size={11} color={theme.mutedForeground} />
            <Text className="text-[11px] tabular-nums text-muted-foreground">
              {t("autopilots.wakeups.runs_7d")}: {row.runs_7d}
            </Text>
            {runState ? (
              <Text className="text-[11px] tabular-nums text-brand" numberOfLines={1}>
                {runState}
              </Text>
            ) : null}
            {row.issue_closed ? (
              <Text className="text-[11px] text-muted-foreground">
                {t("autopilots.wakeups.issue_closed")}
              </Text>
            ) : null}
            {row.last_error ? (
              <Text className="text-[11px] text-destructive">
                {t("wakeups.needsAttention")}
              </Text>
            ) : null}
          </View>

          {/* Why the row's own controls are inert, when they are. A control
              that silently does nothing is the defect this family of rounds
              exists to close. */}
          {blockKey ? (
            <Text className="mt-1 text-[11px] text-muted-foreground">
              {t(blockKey)}
            </Text>
          ) : null}
        </View>

        {isSystem ? null : (
          <Switch
            checked={row.enabled}
            // The same gate the row's own writes use: the server refuses a
            // disable from a non-manager, and a closed issue cannot hold an
            // enabled rule.
            disabled={pending || !row.can_manage || row.issue_closed}
            accessibilityLabel={t("wakeups.toggle", { agent: row.agent_name })}
            onCheckedChange={onToggleEnabled}
          />
        )}
      </View>
    </Pressable>
  );
}

/** The scope chip row — web's five-part control, with the server's own scope
 *  inventories beside each label. */
function ScopeChips({
  counts,
  value,
  onChange,
  disabled,
}: {
  counts: Record<string, number>;
  value: string;
  onChange: (scope: "active" | "paused" | "disabled" | "ended" | "all") => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const scopes = ["active", "paused", "disabled", "ended", "all"] as const;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="gap-2 px-4 py-2"
    >
      {scopes.map((scope) => {
        const active = value === scope;
        return (
          <Pressable
            key={scope}
            onPress={() => onChange(scope)}
            disabled={disabled}
            accessibilityRole="tab"
            accessibilityState={{ selected: active, disabled }}
            className={`flex-row items-center gap-1.5 rounded-md border px-2.5 py-1.5 active:opacity-70 ${
              active ? "border-brand bg-brand/10" : "border-border bg-secondary/50"
            } ${disabled ? "opacity-50" : ""}`}
          >
            <Text
              className={`text-xs font-medium ${
                active ? "text-brand" : "text-muted-foreground"
              }`}
            >
              {t(`autopilots.wakeups.scopes.${scope}`)}
            </Text>
            <Text
              className="text-xs tabular-nums"
              style={{ color: theme.mutedForeground }}
            >
              {counts[scope] ?? 0}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** A single-choice filter sheet — the phone's shape for web's three dropdowns. */
function ChoiceSheet<T extends string>({
  title,
  visible,
  onClose,
  options,
  value,
  onChange,
  testID,
}: {
  title: string;
  visible: boolean;
  onClose: () => void;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  testID?: string;
}) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <PickerSheet title={title} visible={visible} onClose={onClose}>
      <ScrollView testID={testID}>
        {options.map((option) => (
          <Pressable
            key={option.value || "__all__"}
            onPress={() => {
              onChange(option.value);
              onClose();
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: option.value === value }}
            className={`flex-row items-center justify-between px-4 py-3 active:bg-secondary ${
              option.value === value ? "bg-secondary/50" : ""
            }`}
          >
            <Text className="text-sm text-foreground" numberOfLines={1}>
              {option.label}
            </Text>
            {option.value === value ? (
              <Ionicons name="checkmark" size={16} color={theme.brand} />
            ) : null}
          </Pressable>
        ))}
      </ScrollView>
    </PickerSheet>
  );
}

/**
 * The table surface: banner, filters, rows, selection footer, pager.
 *
 * `onCreateRequest` is forwarded to the route's header action so the 新建唤醒
 * button lives in the nav bar (this app's convention for a list's primary
 * action) while the create flow itself — pick an issue, then the same form the
 * issue surface mounts — stays here, next to the rows it will change.
 */
export function WorkspaceWakeupsTable({
  createOpen,
  onCreateClose,
}: {
  createOpen: boolean;
  onCreateClose: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const c = useWorkspaceWakeupsController();
  const toggles = useIssueWakeupToggles();
  const [searchText, setSearchText] = useState(c.filters.search);
  const debouncedSearch = useDebouncedTableSearch(searchText);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [kindOpen, setKindOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [openRow, setOpenRow] = useState<WorkspaceWakeup | null>(null);
  const [createIssueId, setCreateIssueId] = useState<string | null>(null);

  // The search box drives the SERVER's `search`, so it is debounced before it
  // reaches the query key — otherwise every keystroke is its own request and
  // its own cache entry.
  useEffect(() => {
    if (debouncedSearch === c.filters.search) return;
    c.setFilters({ search: debouncedSearch });
  }, [debouncedSearch, c]);

  const batchMessage = workspaceWakeupBatchMessage(c.batchResult);
  const rows = c.page?.items ?? [];

  const closeCreate = useCallback(() => {
    setCreateIssueId(null);
    onCreateClose();
  }, [onCreateClose]);

  return (
    <View className="flex-1">
      <ScopeChips
        counts={c.counts}
        value={c.filters.scope}
        onChange={(scope) => c.setFilters({ scope })}
        disabled={c.batch.isPending}
      />

      <View className="flex-row items-center gap-2 px-4 pb-2">
        <View className="flex-1 flex-row items-center rounded-md border border-border bg-secondary/50 pl-2">
          <Ionicons name="search" size={14} color={theme.mutedForeground} />
          <TextField
            value={searchText}
            onChangeText={setSearchText}
            maxLength={256}
            editable={!c.batch.isPending}
            placeholder={t("autopilots.wakeups.search")}
            accessibilityLabel={t("autopilots.wakeups.search")}
            className="flex-1 border-transparent bg-transparent"
          />
        </View>
        <Pressable
          onPress={() => setSourceOpen(true)}
          disabled={c.batch.isPending}
          accessibilityRole="button"
          accessibilityLabel={t("autopilots.wakeups.source")}
          className="flex-row items-center gap-1 rounded-md border border-border bg-secondary/50 px-2 h-10 active:opacity-70"
        >
          <Ionicons name="funnel-outline" size={13} color={theme.mutedForeground} />
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {t(
              c.filters.source
                ? `autopilots.wakeups.sources.${c.filters.source}`
                : "autopilots.wakeups.sources.all",
            )}
          </Text>
        </Pressable>
      </View>

      <View className="flex-row items-center gap-2 px-4 pb-2">
        <Pressable
          onPress={() => setKindOpen(true)}
          disabled={c.batch.isPending}
          accessibilityRole="button"
          accessibilityLabel={t("autopilots.wakeups.trigger")}
          className="flex-row items-center gap-1 rounded-md border border-border bg-secondary/50 px-2 py-1.5 active:opacity-70"
        >
          <Ionicons name="flash-outline" size={13} color={theme.mutedForeground} />
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {c.kindOptions.find((o) => o.value === c.filters.kind)
              ? t(
                  c.kindOptions.find((o) => o.value === c.filters.kind)!
                    .labelKey,
                )
              : t("autopilots.wakeups.all_triggers")}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setAgentOpen(true)}
          disabled={c.batch.isPending}
          accessibilityRole="button"
          accessibilityLabel={t("autopilots.wakeups.target_agent")}
          className="flex-1 flex-row items-center gap-1 rounded-md border border-border bg-secondary/50 px-2 py-1.5 active:opacity-70"
        >
          <Ionicons name="person-outline" size={13} color={theme.mutedForeground} />
          <Text className="flex-1 text-xs text-muted-foreground" numberOfLines={1}>
            {c.agentLabel || t("autopilots.wakeups.all_agents")}
          </Text>
        </Pressable>
        {/* Select-all, offered only once something is selected — as on web,
            where the header checkbox carries it. */}
        {c.selection.selecting ? (
          <Pressable
            onPress={c.toggleSelectAll}
            disabled={c.batch.isPending}
            accessibilityRole="button"
            accessibilityLabel={t("autopilots.wakeups.select_page")}
            accessibilityState={{ checked: c.selection.allSelected }}
            className="flex-row items-center gap-1 px-1 py-1.5 active:opacity-70"
          >
            <Ionicons
              name={
                c.selection.allSelected
                  ? "checkbox"
                  : c.selection.someSelected
                    ? "remove-circle-outline"
                    : "square-outline"
              }
              size={16}
              color={theme.mutedForeground}
            />
          </Pressable>
        ) : null}
      </View>

      {batchMessage ? (
        <Text
          accessibilityRole="alert"
          className={`px-4 pb-2 text-xs ${
            c.batchResult?.failed.length
              ? "text-destructive"
              : "text-muted-foreground"
          }`}
        >
          {t(batchMessage.key, batchMessage.params)}
        </Text>
      ) : null}

      {c.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
          <Text className="mt-2 text-xs text-muted-foreground">
            {t("autopilots.wakeups.loading")}
          </Text>
        </View>
      ) : c.isError ? (
        <View className="px-4 gap-3 pt-4">
          <Text className="text-sm text-destructive">
            {t("autopilots.wakeups.load_error")}
          </Text>
          <Button variant="outline" onPress={c.refetch}>
            <Text>{t("workspace.retry")}</Text>
          </Button>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          ItemSeparatorComponent={() => <View className="h-px bg-border ml-4" />}
          contentContainerClassName="pb-4"
          refreshing={c.isRefetching}
          onRefresh={c.refetch}
          ListHeaderComponent={
            c.banner ? (
              <View
                accessibilityRole="alert"
                className="mx-4 mt-1 mb-2 flex-row items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2"
              >
                <Ionicons
                  name="warning-outline"
                  size={16}
                  color={theme.destructive}
                />
                <Text className="flex-1 text-xs text-foreground">
                  {t("autopilots.wakeups.banner", {
                    count: c.banner.count,
                    issue: c.banner.issue,
                    condition: c.banner.condition,
                    reason: c.banner.reason,
                  })}
                </Text>
                <Button
                  variant="outline"
                  size="sm"
                  onPress={() => c.setFilters({ scope: "paused" })}
                >
                  <Text>{t("autopilots.wakeups.banner_view")}</Text>
                </Button>
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <WakeupTableRow
              row={item}
              text={c.text}
              selected={c.selected.has(item.id)}
              selecting={c.selection.selecting}
              pending={c.batch.isPending || toggles.isPending(item.issue_id)}
              onToggleSelect={() => c.toggleSelect(item.id)}
              onOpen={() => setOpenRow(item)}
              onToggleEnabled={(enabled) => toggles.setEnabled(item, enabled)}
            />
          )}
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center px-6 py-10">
              <Ionicons
                name="notifications-off-outline"
                size={28}
                color={theme.mutedForeground}
              />
              <Text className="mt-2 text-sm text-muted-foreground text-center">
                {c.filtered && c.counts.all > 0
                  ? t("autopilots.wakeups.empty_filtered")
                  : t("autopilots.wakeups.empty")}
              </Text>
              {/* The reset is offered only when narrowing is what emptied the
                  table — an empty workspace has nothing to reset. */}
              {c.filtered && c.counts.all > 0 ? (
                <Button
                  variant="outline"
                  className="mt-3"
                  onPress={() => {
                    setSearchText("");
                    c.clearFilters();
                  }}
                >
                  <Text>{t("autopilots.wakeups.clear_filters")}</Text>
                </Button>
              ) : null}
            </View>
          }
        />
      )}

      {/* Footer: the selection's actions while there is a selection, else the
          page report. The pager is always present, as on web. */}
      <View className="border-t border-border px-3 py-2 flex-row items-center gap-1">
        {c.selection.picked.length > 0 ? (
          <>
            <Text className="text-xs text-muted-foreground">
              {t("autopilots.wakeups.selected", {
                count: c.selection.picked.length,
              })}
            </Text>
            <Button
              variant="outline"
              size="sm"
              disabled={c.batch.isPending}
              onPress={() => setConfirmOpen(true)}
            >
              <Text>{t("autopilots.wakeups.disable_selected")}</Text>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={c.batch.isPending}
              onPress={c.clearSelection}
            >
              <Text>{t("autopilots.wakeups.clear")}</Text>
            </Button>
          </>
        ) : (
          <Text className="text-xs tabular-nums text-muted-foreground">
            {t("autopilots.wakeups.results", {
              page: c.pageNumber,
              count: c.page?.total ?? 0,
            })}
          </Text>
        )}
        <View className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          disabled={c.batch.isPending || c.previousOffset === null}
          onPress={() => c.goToOffset(c.previousOffset)}
        >
          <Text>{t("autopilots.wakeups.previous")}</Text>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={c.batch.isPending || c.nextOffset === null}
          onPress={() => c.goToOffset(c.nextOffset)}
        >
          <Text>{t("autopilots.wakeups.next_page")}</Text>
        </Button>
      </View>

      {/* The row sheet: the same one the issue surface opens, so a rule behaves
          identically wherever it is reached from. */}
      {openRow ? (
        <WakeupRowSheet
          visible
          onClose={() => setOpenRow(null)}
          wakeup={openRow}
          canTrigger={!openRow.issue_closed && !openRow.disabled_at}
        />
      ) : null}

      {/* Create: a wakeup belongs to one issue, so the issue is picked first —
          web's `WorkspaceWakeupCreate` flow, same order and same form. */}
      {createOpen && !createIssueId ? (
        <PickerSheet
          title={t("autopilots.wakeups.create_pick_issue")}
          visible
          onClose={closeCreate}
          fill
        >
          <IssuePickerBody
            title={t("autopilots.wakeups.create_pick_issue")}
            description={t("autopilots.wakeups.create_pick_issue_description")}
            excludeIds={[]}
            onSelect={(issue) => setCreateIssueId(issue.id)}
          />
        </PickerSheet>
      ) : null}
      {createIssueId ? (
        <WakeupCreateSheet
          issueId={createIssueId}
          visible
          onClose={closeCreate}
        />
      ) : null}

      <ChoiceSheet
        title={t("autopilots.wakeups.source")}
        visible={sourceOpen}
        onClose={() => setSourceOpen(false)}
        options={c.sourceOptions.map((option) => ({
          value: option.value,
          label: t(option.labelKey),
        }))}
        value={c.filters.source}
        onChange={(source) => c.setFilters({ source })}
      />
      <ChoiceSheet
        title={t("autopilots.wakeups.trigger")}
        visible={kindOpen}
        onClose={() => setKindOpen(false)}
        options={c.kindOptions.map((option) => ({
          value: option.value,
          label: t(option.labelKey),
        }))}
        value={c.filters.kind}
        onChange={(kind) => c.setFilters({ kind })}
      />
      <ChoiceSheet
        title={t("autopilots.wakeups.target_agent")}
        visible={agentOpen}
        onClose={() => setAgentOpen(false)}
        options={[
          { value: "", label: t("autopilots.wakeups.all_agents") },
          ...c.agentOptions.map((agent) => ({
            value: agent.id,
            label: agent.name,
          })),
        ]}
        value={c.filters.agent_id}
        onChange={(agent_id) => c.setFilters({ agent_id })}
      />

      {/* The batch confirm. Web confirms because a disable withdraws runs that
          have not started; the copy says exactly that. */}
      <PickerSheet
        title={t("autopilots.wakeups.confirm_title", {
          count: c.selection.picked.length,
        })}
        visible={confirmOpen}
        onClose={() => {
          if (!c.batch.isPending) setConfirmOpen(false);
        }}
      >
        <View className="px-4 pb-4">
          <Text className="text-xs text-muted-foreground">
            {t("autopilots.wakeups.confirm_body")}
          </Text>
          <View className="mt-3 flex-row justify-end gap-2">
            <Button
              variant="outline"
              disabled={c.batch.isPending}
              onPress={() => setConfirmOpen(false)}
            >
              <Text>{t("autopilots.wakeups.cancel")}</Text>
            </Button>
            <Button
              disabled={c.batch.isPending}
              onPress={() => {
                setConfirmOpen(false);
                void c.runBatch();
              }}
            >
              <Text>
                {c.batch.isPending
                  ? t("autopilots.wakeups.disabling")
                  : t("autopilots.wakeups.confirm")}
              </Text>
            </Button>
          </View>
        </View>
      </PickerSheet>
    </View>
  );
}
