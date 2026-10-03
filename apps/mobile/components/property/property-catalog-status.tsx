/**
 * The one place a workspace property-catalog read renders its non-ready
 * states (MYS-1892).
 *
 * Before this, each surface destructured `{ data: properties = [] }` and
 * branched on `properties.length === 0`, so a request that was still in
 * flight and a request that had failed both fell into the *empty* branch —
 * painting 「该工作区还没有自定义属性」 / 「没有可添加的属性」 / 「未找到该属性」
 * over a catalog that had merely not arrived. The workspace's `Severity`
 * property existed the whole time; only the sentence lied.
 *
 * Three states, three different sentences, and a way out of the failure:
 *
 *   - `loading` → a spinner. Never text, so it can't be mistaken for a fact.
 *   - `error`   → the failure named as a failure, plus a retry that re-runs
 *                 the request instead of making the user kill the app.
 *   - `empty`   → the caller's own copy, still the only branch allowed to
 *                 claim the workspace has nothing.
 *
 * `ready` renders nothing: the caller draws its real content. Keeping that
 * branch out of here is what lets this component stay a pure status painter
 * and lets callers keep their own layout (a list, a section body, a sheet).
 */
import { ActivityIndicator, Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import type { PropertyCatalogState } from "@/lib/property-catalog-state";

export function PropertyCatalogStatus({
  state,
  onRetry,
  emptyMessage,
  /** Error copy. Defaults to `properties.catalogLoadError`, which stands on
   *  its own. Do NOT default this to `properties.loadError`: that key ends in
   *  a colon because the management page appends `error.message` after it
   *  (`more/properties.tsx`), and a bare colon here would dangle. */
  errorMessage,
  /** `inline` keeps the failure inside a section body (a few lines, no
   *  centering); `centered` fills a sheet or an empty surface. */
  layout = "inline",
  className,
}: {
  state: PropertyCatalogState;
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
            : "items-start px-4 py-3",
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
            : "items-start px-4 py-3",
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
        <Text className="text-sm text-destructive">
          {errorMessage ?? t("properties.catalogLoadError")}
        </Text>
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          className="px-2.5 py-1.5 rounded-md bg-secondary active:opacity-70"
        >
          <Text className="text-xs font-medium text-foreground">
            {t("common.retry")}
          </Text>
        </Pressable>
      </View>
    );
  }

  // `empty` — the caller owns the wording, because "no properties at all" and
  // "none of them can be used here" are different facts about the same state.
  // It owns the type scale too: a section body's empty line and a full-sheet
  // one are not the same weight, and the Display section shipped at the
  // smaller treatment before this was factored out.
  if (!emptyMessage) return null;
  return (
    <View
      className={cn(
        layout === "centered" ? "px-6 py-8 items-center" : "px-4 py-3",
        className,
      )}
    >
      <Text
        className={cn(
          layout === "centered"
            ? "text-sm text-muted-foreground text-center"
            : "text-xs text-muted-foreground/70",
        )}
      >
        {emptyMessage}
      </Text>
    </View>
  );
}
