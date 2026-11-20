import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Workspace } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { WorkspaceAvatar } from "@/components/workspace/workspace-avatar";
import { useThemePalette } from "@/lib/appearance-a11y-runtime";
import { useTranslation } from "@/lib/i18n/react";
import { workspaceChoiceIdentity } from "@/lib/workspace-choice-identity";
import { cn } from "@/lib/utils";

/** Presentation only: each host owns the switch route and confirmation. */
export function WorkspaceChoiceRow({
  workspace,
  active,
  hasUnread = false,
  onPress,
}: {
  workspace: Workspace;
  active: boolean;
  hasUnread?: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const theme = useThemePalette();
  const unread = !active && hasUnread;
  const identity = workspaceChoiceIdentity(workspace);
  return (
    <Pressable
      onPress={onPress}
      disabled={active}
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled: active }}
      accessibilityLabel={
        active
          ? t("a11y.currentWorkspace", { name: identity })
          : unread
            ? t("a11y.switchToUnread", { name: identity })
            : t("a11y.switchTo", { name: identity })
      }
      className={cn(
        "min-h-14 flex-row items-center gap-3 px-3 py-3 active:bg-secondary",
        active && "bg-brand/10",
      )}
    >
      <WorkspaceAvatar
        name={workspace.name}
        avatarUrl={workspace.avatar_url}
        size={36}
      />
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="text-title-sm font-semibold text-foreground" numberOfLines={2}>
          {workspace.name}
        </Text>
        <Text className="text-caption text-muted-foreground" numberOfLines={1}>
          /{workspace.slug}
        </Text>
      </View>
      {active ? (
        <View className="size-7 shrink-0 items-center justify-center rounded-full bg-background">
          <Ionicons name="checkmark" size={17} color={theme.foreground} />
        </View>
      ) : (
        <View className="shrink-0 flex-row items-center gap-2">
          {unread ? (
            <View className="size-2 rounded-full bg-brand" testID="workspace-unread-dot" />
          ) : null}
          <Ionicons name="chevron-forward" size={16} color={theme.mutedForeground} />
        </View>
      )}
    </Pressable>
  );
}
