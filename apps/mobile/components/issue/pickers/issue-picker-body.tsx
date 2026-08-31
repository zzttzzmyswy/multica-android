/**
 * Searchable issue-picker body for the "add sub-issue" / "set parent issue"
 * sheets (MYS-493). Mirrors web's `issue-picker-modal.tsx`:
 *
 *   - Search-as-you-type against `api.searchIssues` with the same debounce
 *     (300ms), limit (20), `include_closed: true`, and abort-in-flight
 *     policy as web's `CommandDialog`.
 *   - Rows render `status icon + identifier + title` (truncated), matching
 *     web's `CommandItem` layout.
 *   - `excludeIds` applies the same predicate web uses
 *     (`res.issues.filter((i) => !excludeIds.includes(i.id))`) so callers
 *     can rule out the issue itself, its current parent, and existing
 *     children.
 *
 * Search input is body-rendered (title + input rendered here) rather than
 * the native UISearchController the assignee/label pickers use — those are
 * browse-first lists where a missing search box just means "no filter",
 * while THIS picker is search-first (web lists nothing until you type), so
 * it needs a search box that works on every platform, matching web's inline
 * `CommandInput`. Same debounce/abort discipline as
 * `app/(app)/[workspace]/search.tsx`.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Pressable,
  TextInput,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Issue } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { StatusIcon } from "@/components/ui/status-icon";
import { useIssueStatuses } from "@/data/queries/issue-statuses";
import { useScrollToTopOnChange } from "@/lib/use-scroll-to-top-on-change";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { api } from "@/data/api";
import { keyboardBehavior } from "@/lib/keyboard";

const DEBOUNCE_MS = 300;
const ISSUE_LIMIT = 20;

interface Props {
  /** Sheet title — body-rendered (the formSheet hides the native header). */
  title: string;
  /** One-line explainer under the title, mirroring web's modal
   *  `description` (e.g. modals.set_parent.description). */
  description?: string;
  /** Issue ids to hide from results (the issue itself, its parent, its
   *  existing direct children, …). */
  excludeIds: string[];
  onSelect: (issue: Issue) => void;
}

export function IssuePickerBody({
  title,
  description,
  excludeIds,
  onSelect,
}: Props) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Issue[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const listRef = useScrollToTopOnChange(query);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Exclude set must be stable across renders — rebuilding it every render
  // while the debounce closure captures it would race excludeId updates
  // against in-flight searches (web bakes `excludeIds` into `search` via
  // useCallback with the same intent).
  const excludeSet = useMemo(() => new Set(excludeIds), [excludeIds]);

  // Cleanup pending debounce + abort on unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  const runSearch = useCallback(
    (q: string) => {
      // Clear the pending debounce AND abort any in-flight controller BEFORE
      // the early-return / state writes below — the abort is synchronous, so
      // the post-await guard wins any race. Same discipline as search.tsx.
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();

      if (!q.trim()) {
        setResults([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      debounceRef.current = setTimeout(async () => {
        const controller = new AbortController();
        abortRef.current = controller;
        try {
          const res = await api.searchIssues(
            { q: q.trim(), limit: ISSUE_LIMIT, include_closed: true },
            { signal: controller.signal },
          );
          if (!controller.signal.aborted) {
            setResults(res.issues.filter((i) => !excludeSet.has(i.id)));
            setIsLoading(false);
          }
        } catch {
          if (!controller.signal.aborted) setIsLoading(false);
        }
      }, DEBOUNCE_MS);
    },
    [excludeSet],
  );

  const handleChange = useCallback(
    (value: string) => {
      setQuery(value);
      runSearch(value);
    },
    [runSearch],
  );

  const trimmedQuery = query.trim();
  const showPrompt = !isLoading && !trimmedQuery;
  const showEmpty = !isLoading && trimmedQuery && results.length === 0;

  return (
    <KeyboardAvoidingView className="flex-1" behavior={keyboardBehavior}>
      {/* Sheet title — body-rendered since the formSheet hides the native
          nav header. Identifier block mirrors web's CommandDialog header. */}
      <View className="px-4 pt-3 pb-1">
        <Text className="text-base font-semibold text-foreground">{title}</Text>
      </View>
      {description ? (
        <Text className="px-4 pb-2 text-sm text-muted-foreground">
          {description}
        </Text>
      ) : null}
      {/* Search input row — same chrome as the workspace search modal. */}
      <View className="flex-row items-center gap-2 border-b border-border px-4 py-2">
        <Ionicons name="search" size={20} color={theme.mutedForeground} />
        <TextInput
          value={query}
          onChangeText={handleChange}
          placeholder={t("issueRelation.searchPlaceholder")}
          placeholderTextColor={theme.mutedForeground}
          autoFocus
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="while-editing"
          className="flex-1 text-base text-foreground"
        />
      </View>
      <FlatList
        ref={listRef}
        data={results}
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        keyExtractor={(issue) => issue.id}
        renderItem={({ item }) => (
          <IssuePickerRow issue={item} onPress={() => onSelect(item)} />
        )}
        ListEmptyComponent={
          <View className="px-3 py-8 items-center">
            {isLoading ? (
              <View className="items-center gap-2 py-4">
                <ActivityIndicator />
                <Text className="text-sm text-muted-foreground">
                  {t("issueRelation.searching")}
                </Text>
              </View>
            ) : showPrompt ? (
              <Text className="text-sm text-muted-foreground">
                {t("issueRelation.promptToSearch")}
              </Text>
            ) : showEmpty ? (
              <Text className="text-sm text-muted-foreground">
                {t("issueRelation.noResults")}
              </Text>
            ) : null}
          </View>
        }
      />
    </KeyboardAvoidingView>
  );
}

function IssuePickerRow({
  issue,
  onPress,
}: {
  issue: Issue;
  onPress: () => void;
}) {
  const statusEntry = useIssueStatuses().entryOf(issue.status);
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-3 px-4 py-3 active:bg-secondary"
    >
      <StatusIcon
        status={issue.status}
        category={statusEntry?.category}
        color={
          statusEntry?.is_system ? undefined : (statusEntry?.color ?? undefined)
        }
        size={14}
      />
      <Text className="text-xs text-muted-foreground shrink-0">
        {issue.identifier}
      </Text>
      <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
        {issue.title}
      </Text>
    </Pressable>
  );
}