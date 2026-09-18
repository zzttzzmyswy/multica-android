/**
 * 分页 issue 列表的页脚 —— web `ListLoadMoreFooter`
 * (`packages/views/issues/components/list-load-more-footer.tsx`) 的移动端对应物。
 * 四个状态集中在一个组件里，Board / 列表 / 泳道 / my-issues / 项目 issue 表面
 * 共用，措辞与判据不会各写一份而漂移：
 *
 *   - 请求失败        → 「加载失败，点击重试」
 *   - 还有下一页      → 触底「加载中…」（纯转圈会被读成卡死）
 *   - 到底且总数超一页 → 静默的「没有更多了」
 *   - 短列表          → 什么都不渲染
 *
 * `onEndReached` 由各表面的列表组件（SectionList / FlatList）自己接，
 * 本组件只管页脚长什么样。
 */
import { ActivityIndicator, Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { PAGINATED_THRESHOLD } from "@/lib/issue-pagination";

export function IssueListFooter({
  hasMore,
  isLoadingMore,
  total,
  isError,
  onRetry,
}: {
  hasMore: boolean;
  isLoadingMore: boolean;
  total: number;
  isError: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  if (isError) {
    return (
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        className="py-3 items-center"
      >
        <Text className="text-xs text-destructive">
          {t("issues.loadMoreFailed")}
        </Text>
      </Pressable>
    );
  }

  if (hasMore) {
    // A permanent spinner reads as "stuck"; the list itself fires the next
    // page via `onEndReached`, so this only paints while a fetch is actually
    // in flight and otherwise holds the row's height.
    return (
      <View className="py-3 flex-row items-center justify-center gap-2">
        {isLoadingMore ? (
          <>
            <ActivityIndicator size="small" color={theme.mutedForeground} />
            <Text className="text-xs text-muted-foreground">
              {t("issues.loadingMore")}
            </Text>
          </>
        ) : null}
      </View>
    );
  }

  if (total > PAGINATED_THRESHOLD) {
    return (
      <View className="py-3 items-center">
        <Text className="text-xs text-muted-foreground">
          {t("issues.noMore")}
        </Text>
      </View>
    );
  }

  return null;
}
