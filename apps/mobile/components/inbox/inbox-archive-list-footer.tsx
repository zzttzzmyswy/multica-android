/**
 * Footer for the archived sub-view's paged list.
 *
 * The four states live in one component so the wording and the predicate
 * cannot drift — the same discipline `issue-list-footer.tsx` applies to the
 * paginated issue lists, restated for the archive because the trigger differs
 * in one important way: this list paginates WITHOUT a known total (the cursor
 * endpoint reports "more" or "end", never a count), so there is no
 * `total > threshold` test to decide whether "no more" is worth saying.
 * Instead:
 *
 *   - load failed        → a tappable "failed, tap to retry"
 *   - more to fetch      → a "load more" press target while idle, a spinner
 *                          plus "loading…" while a page is in flight
 *   - end of the archive → a quiet "no more" line, but only once at least one
 *                          page has been followed
 *   - a single short page → nothing at all
 *
 * The load-more affordance is an explicit press target rather than
 * reach-the-bottom-only, and that is a deliberate difference from the issue
 * lists. Those drain a bounded window; the archive is unbounded, so
 * everything has to stay reachable without the user committing to an
 * open-ended auto-drain — and a footer they can press is also the only way
 * back after a page fails, since `retry: false` on the query means nothing
 * refetches on its own.
 *
 * `paged` is what distinguishes "the archive is one page long" from "the user
 * has not looked past page one yet": with a single page fetched and no
 * continuation, the honest footer is empty.
 */
import { ActivityIndicator, Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

export function InboxArchiveListFooter({
  hasMore,
  isLoadingMore,
  isError,
  paged,
  onLoadMore,
  onRetry,
}: {
  hasMore: boolean;
  isLoadingMore: boolean;
  isError: boolean;
  /** True once a continuation has been fetched — see the module doc. */
  paged: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  // Failure first: a failed page and "there is more" are both true at once,
  // and offering "load more" over a failure would look like the press did
  // nothing.
  if (isError) {
    return (
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel={t("inbox.archivedLoadMoreFailed")}
        className="py-3 items-center"
      >
        <Text className="text-caption text-destructive">
          {t("inbox.archivedLoadMoreFailed")}
        </Text>
      </Pressable>
    );
  }

  if (!hasMore) {
    // Nothing fetched beyond page one → the list is short, not complete; an
    // "end of archive" line under six rows would be noise.
    if (!paged) return null;
    return (
      <View className="py-3 items-center">
        <Text className="text-caption text-muted-foreground">
          {t("inbox.archivedNoMore")}
        </Text>
      </View>
    );
  }

  return (
    <Pressable
      onPress={onLoadMore}
      disabled={isLoadingMore}
      accessibilityRole="button"
      accessibilityState={{ disabled: isLoadingMore }}
      accessibilityLabel={
        isLoadingMore
          ? t("inbox.archivedLoadingMore")
          : t("inbox.archivedLoadMore")
      }
      className="py-3 flex-row items-center justify-center gap-2 active:bg-secondary"
    >
      {isLoadingMore ? (
        <>
          <ActivityIndicator size="small" color={theme.mutedForeground} />
          <Text className="text-caption text-muted-foreground">
            {t("inbox.archivedLoadingMore")}
          </Text>
        </>
      ) : (
        <Text className="text-caption font-medium text-muted-foreground">
          {t("inbox.archivedLoadMore")}
        </Text>
      )}
    </Pressable>
  );
}
