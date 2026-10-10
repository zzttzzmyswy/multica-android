/**
 * The one place a remote-directory read renders its non-ready states.
 *
 * Before this, each surface destructured `{ data: rows = [] }` and branched on
 * `rows.length === 0`, so a request still in flight and a request that had
 * failed both fell into the *empty* branch — painting 「此工作区暂无项目。请在网页
 * 端创建。」 over a project list that had merely not arrived. The workspace's
 * projects existed the whole time; only the sentence lied, and it sent the user
 * to the web UI to create something they already had.
 *
 * Three states, three different sentences, and a way out of the failure:
 *
 *   - `loading` → a spinner. Never text, so it can't be mistaken for a fact.
 *   - `error`   → the failure named as a failure, plus a retry that re-runs
 *                 the request instead of making the user kill the app.
 *   - `empty`   → the caller's own copy, still the only branch allowed to
 *                 claim the workspace has nothing.
 *
 * `ready` renders nothing: the caller draws its real rows. Keeping that branch
 * out of here is what lets this component stay a pure status painter and lets
 * callers keep their own layout (a list, a search box, a sheet).
 *
 * Generalised from `components/property/property-catalog-status.tsx`, which had
 * accumulated the same three branches for the custom-property catalog alone.
 */
import { ActivityIndicator, Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { resolveCatalogEmpty, type CatalogState } from "@/lib/catalog-state";

export function CatalogStatus({
  state,
  onRetry,
  emptyMessage,
  /** Error copy. Defaults to `catalog.loadError`, which stands on its own.
   *  Do NOT default this to a key that ends in a colon: `properties.loadError`
   *  is a prefix the management page appends `error.message` to
   *  (`more/properties.tsx`), and a bare colon here would dangle. */
  errorMessage,
  /** `inline` keeps the failure inside a section body (a few lines, no
   *  centering); `centered` fills a sheet or an empty surface. */
  layout = "inline",
  className,
}: {
  state: CatalogState;
  onRetry: () => void;
  emptyMessage?: string;
  errorMessage?: string;
  layout?: "inline" | "centered";
  className?: string;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  if (state === "ready") return null;

  if (state === "loading") {
    return (
      <View
        className={cn(
          layout === "centered"
            ? "flex-1 items-center justify-center py-10"
            : "items-center px-4 py-8",
          className,
        )}
      >
        <ActivityIndicator size="small" color={theme.mutedForeground} />
      </View>
    );
  }

  if (state === "error") {
    return (
      <View
        className={cn(
          "gap-2",
          layout === "centered"
            ? "flex-1 items-center justify-center px-6 py-10"
            : "items-center px-4 py-8",
          className,
        )}
      >
        {layout === "centered" ? (
          <Ionicons
            name="cloud-offline-outline"
            size={28}
            color={theme.mutedForeground}
          />
        ) : null}
        <Text className="text-body text-destructive text-center">
          {errorMessage ?? t("catalog.loadError")}
        </Text>
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          className="px-2.5 py-1.5 rounded-md bg-secondary active:opacity-70"
        >
          <Text className="text-caption font-medium text-foreground">
            {t("common.retry")}
          </Text>
        </Pressable>
      </View>
    );
  }

  // `empty` — the caller owns the wording, because "no projects at all" and
  // "none of them matched the search" are different facts about the same
  // state, and only the caller knows which one it is looking at.
  if (!emptyMessage) return null;
  return (
    <View
      className={cn(
        layout === "centered" ? "items-center px-6 py-8" : "items-center px-4 py-8",
        className,
      )}
    >
      <Text className="text-body text-muted-foreground text-center">
        {emptyMessage}
      </Text>
    </View>
  );
}

/**
 * A picker's `ListEmptyComponent`, decided rather than assumed.
 *
 * This is the shape every picker in the family needs and each one previously
 * hand-rolled wrongly: the slot is reached for three unrelated reasons — a
 * directory that has not arrived, a directory that failed, and a search that
 * matched nothing — and the hand-rolled versions answered all three with the
 * "no matches" sentence. A failed member read therefore told the user their
 * own name was not in the workspace.
 *
 * `states` is every directory the picker draws rows from, in any order;
 * `emptyMessage` is the caller's "the workspace really has none" copy (the only
 * branch allowed to make that claim), and `query` is the raw search text.
 */
export function CatalogEmptySlot({
  states,
  onRetry,
  emptyMessage,
  query,
  className,
}: {
  states: CatalogState[];
  onRetry: () => void;
  emptyMessage: string;
  /** The picker's live search text. Non-blank means a zero-match result is
   *  about the search, not about the workspace. */
  query?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const verdict = resolveCatalogEmpty(states, !!query?.trim());

  if (verdict.kind === "status") {
    return (
      <CatalogStatus state={verdict.status} onRetry={onRetry} />
    );
  }

  return (
    <View className={cn("items-center px-4 py-8", className)}>
      <Text className="text-body text-muted-foreground text-center">
        {verdict.kind === "no-match" ? t("picker.noMatches") : emptyMessage}
      </Text>
    </View>
  );
}
