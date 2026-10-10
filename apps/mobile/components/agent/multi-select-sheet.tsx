/**
 * Multi-select checklist sheet — shared by the agent-create form's skill and
 * member pickers, and the skill-detail add-to-agent sheet. One interaction:
 * a Modal listing toggleable rows with a checkmark on the selected ones and a
 * Done control in the header. The caller owns the selected set (and how a row
 * is visually led — icon tile / avatar), this owns the chrome.
 *
 * Optional group + search: pass `groups` (labeled row buckets, rendered in
 * order) and `searchPlaceholder` to get a search field and per-group header
 * labels (web AddToAgentDialog parity). Search filters rows by title, case-
 * insensitive; the caller keeps ownership of the row set.
 *
 * Employs the same transparent-Modal + backdrop pattern as
 * components/chat/agent-picker-sheet.tsx.
 *
 * Load state: the caller owns the read, so it passes the resolved
 * `state` (and a `retry`) rather than a bare `loading` boolean. The sheet is
 * the *shared implementation* of five pickers (agent-create skills and
 * members, the AI-builder config panel, the access picker, autopilot
 * subscribers, the skill batch bar), so a missing failure branch here lied on
 * all of them at once: a failed directory read fell into the `emptyText`
 * branch and said 「工作区还没有 skill，请先创建或导入。」 / 「没有可选择的工作区
 * 成员。」 about a workspace whose rows merely had not arrived (MYS-1924, gap 2).
 *
 * `state` defaults to `"ready"` so a caller that genuinely has no read (a
 * caller-owned static list) is unaffected — but any caller reading a workspace
 * directory must pass it, and `lib/catalog-wiring.test.ts` enforces that.
 */
import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { Text } from "@/components/ui/text";
import { CatalogStatus } from "@/components/catalog/catalog-status";
import type { CatalogState } from "@/lib/catalog-state";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

export interface MultiSelectRow {
  key: string;
  title: string;
  subtitle?: string;
  disabled?: boolean;
}

export interface MultiSelectGroup {
  label: string;
  rows: MultiSelectRow[];
}

interface Props {
  visible: boolean;
  title: string;
  rows?: MultiSelectRow[];
  /** Labeled row buckets rendered in order; overrides `rows` when set. */
  groups?: MultiSelectGroup[];
  /** Shows a search field above the list filtering rows by title. */
  searchPlaceholder?: string;
  /** Load state of the directory backing `rows`/`groups`. Defaults to
   *  `"ready"` for callers whose rows are not a remote read. Pass the state
   *  from `catalogRead` — a failed read must never fall through to
   *  `emptyText`. */
  state?: CatalogState;
  /** Re-runs the caller's read; wired to the failure's retry. Required for the
   *  error branch to be reachable in practice. */
  onRetry?: () => void;
  /** Overrides the generic failure copy when the caller can name what failed
   *  (e.g. "could not load skills"). */
  errorMessage?: string;
  selectedKeys: ReadonlySet<string>;
  emptyText: string;
  /** Rendered when the search matches nothing (defaults to `emptyText`). */
  noMatchText?: string;
  /** Rendered before the title on each row. */
  leading?: (row: MultiSelectRow) => ReactNode;
  /** Pinned below the list — for a control that acts on the whole selection
   *  (e.g. the skills filter's "clear filters"). */
  footer?: ReactNode;
  onToggle: (key: string) => void;
  onClose: () => void;
}

export function MultiSelectSheet({
  visible,
  title,
  rows,
  groups,
  searchPlaceholder,
  state = "ready",
  onRetry,
  errorMessage,
  selectedKeys,
  emptyText,
  noMatchText,
  leading,
  footer,
  onToggle,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const [query, setQuery] = useState("");

  const effectiveQuery = query.trim().toLowerCase();
  const searching = effectiveQuery.length > 0;
  const filteredGroups = useMemo(() => {
    if (!groups) return null;
    if (!searching) return groups;
    return groups
      .map((g) => ({
        ...g,
        rows: g.rows.filter((r) =>
          r.title.toLowerCase().includes(effectiveQuery),
        ),
      }))
      .filter((g) => g.rows.length > 0);
  }, [groups, searching, effectiveQuery]);
  const flatRows = useMemo(() => {
    if (filteredGroups) return filteredGroups.flatMap((g) => g.rows);
    if (!searching) return rows ?? [];
    return (rows ?? []).filter((r) =>
      r.title.toLowerCase().includes(effectiveQuery),
    );
  }, [filteredGroups, rows, searching, effectiveQuery]);
  const hasAny = groups
    ? groups.some((g) => g.rows.length > 0)
    : (rows?.length ?? 0) > 0;
  const noMatch = searching && hasAny && flatRows.length === 0;

  const renderRow = (row: MultiSelectRow) => {
    const selected = selectedKeys.has(row.key);
    const disabled = !!row.disabled;
    return (
      <Pressable
        key={row.key}
        disabled={disabled}
        onPress={() => onToggle(row.key)}
        className={cn(
          "flex-row items-center gap-3 px-4 py-3",
          disabled ? "opacity-50" : "active:bg-secondary",
          selected && "bg-secondary",
        )}
        accessibilityLabel={row.title}
      >
        {leading ? leading(row) : null}
        <View className="flex-1 min-w-0 gap-0.5">
          <Text
            className="text-body font-medium text-foreground"
            numberOfLines={1}
          >
            {row.title}
          </Text>
          {row.subtitle ? (
            <Text
              className="text-caption text-muted-foreground"
              numberOfLines={2}
            >
              {row.subtitle}
            </Text>
          ) : null}
        </View>
        <Ionicons
          name={selected ? "checkmark-circle" : "ellipse-outline"}
          size={20}
          color={
            selected ? theme.brand : theme.mutedForeground
          }
        />
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
              <View className="flex-row items-center justify-between px-4 py-3 border-b border-border">
                <Text className="text-title-sm font-semibold text-foreground">
                  {title}
                </Text>
                <Pressable onPress={onClose} accessibilityLabel={t("common.done")}>
                  <Text className="text-body font-medium text-brand">
                    {t("common.done")}
                  </Text>
                </Pressable>
              </View>
              {searchPlaceholder ? (
                <View className="border-b border-border px-3 py-2">
                  <View className="flex-row items-center gap-2 rounded-md border border-border bg-background px-2.5">
                    <Ionicons
                      name="search-outline"
                      size={14}
                      color={theme.mutedForeground}
                    />
                    <TextInput
                      value={query}
                      onChangeText={setQuery}
                      placeholder={searchPlaceholder}
                      placeholderTextColor={theme.mutedForeground}
                      autoCorrect={false}
                      autoCapitalize="none"
                      style={{
                        fontSize: 14,
                        includeFontPadding: false,
                        textAlignVertical: "center",
                      }}
                      className="flex-1 min-w-0 py-2 text-foreground"
                      accessibilityLabel={searchPlaceholder}
                    />
                  </View>
                </View>
              ) : null}
              <ScrollView className="max-h-96">
                {/* The empty slot is *decided*, not assumed. A directory that
                    has not arrived and one that failed both used to land in
                    `!hasAny` and render `emptyText` — so a timeout told the
                    user their workspace had no skills to import and no members
                    to share with. Only a settled directory may say that. */}
                {state !== "ready" ? (
                  <CatalogStatus
                    state={state}
                    onRetry={onRetry ?? (() => {})}
                    errorMessage={errorMessage}
                  />
                ) : !hasAny ? (
                  <View className="px-4 py-8">
                    <Text className="text-body text-muted-foreground text-center">
                      {emptyText}
                    </Text>
                  </View>
                ) : noMatch ? (
                  <View className="px-4 py-8">
                    <Text className="text-body text-muted-foreground text-center">
                      {noMatchText ?? emptyText}
                    </Text>
                  </View>
                ) : filteredGroups ? (
                  filteredGroups.map((group) => (
                    <View key={group.label}>
                      <Text className="px-4 pt-3 pb-1 text-caption uppercase tracking-wider text-muted-foreground">
                        {group.label}
                      </Text>
                      {group.rows.map(renderRow)}
                    </View>
                  ))
                ) : (
                  (flatRows ?? []).map(renderRow)
                )}
              </ScrollView>
              {footer ? (
                <View className="border-t border-border">{footer}</View>
              ) : null}
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}