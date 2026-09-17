/**
 * The in_place / worktree choice for a local_directory resource, extracted so
 * the add-resource sheet and the detail section's edit sheet offer literally
 * the same options, copy and error surface — the decision is identical, only
 * the container differs. Web splits it the same way for the same reason
 * (`LocalDirectoryModeOptions` in `local-directory-mode-dialog.tsx`, shared by
 * the mode dialog and the create-project modal).
 */
import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { LocalDirectoryExecutionMode } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import type { WorktreeUnsupportedInfo } from "@/lib/project-resources";

export function LocalDirectoryModeOptions({
  value,
  onChange,
  error,
}: {
  value: LocalDirectoryExecutionMode;
  onChange: (mode: LocalDirectoryExecutionMode) => void;
  /** The server's refusal, when there is one. Shown inline under the options
   *  rather than as an alert, so the sheet can stay open on the control the
   *  user has to change. */
  error?: WorktreeUnsupportedInfo | null;
}) {
  const { t } = useTranslation();
  return (
    <View className="gap-2">
      <ModeOption
        icon="pencil"
        title={t("resource.modeInPlaceTitle")}
        description={t("resource.modeInPlaceDescription")}
        identifier="in_place"
        selected={value === "in_place"}
        onPress={() => onChange("in_place")}
      />
      <ModeOption
        icon="git-branch-outline"
        title={t("resource.modeWorktreeTitle")}
        description={t("resource.modeWorktreeDescription")}
        identifier="worktree"
        selected={value === "worktree"}
        onPress={() => onChange("worktree")}
      />
      {/* The worktree option is never disabled on the phone: it cannot check
          whether the folder is a git working tree, nor what the daemon
          advertises, and guessing "not supported" would block a valid setup.
          Web is permissive in exactly the same case
          (`worktreeUnavailableReason` returns undefined when `isGitRepo` could
          not be determined); the daemon and the server re-check
          authoritatively at save and at task time. */}
      {error ? <ModeErrorNotice error={error} /> : null}
    </View>
  );
}

export function ModeErrorNotice({ error }: { error: WorktreeUnsupportedInfo }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <View className="flex-row items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
      <Ionicons name="warning-outline" size={13} color={theme.destructive} />
      <View className="flex-1 gap-1">
        {/* The server's own sentence — already written for the user, and the
            only text that names the offending path. */}
        <Text className="text-xs text-destructive">{error.message}</Text>
        {error.minVersion ? (
          <Text className="text-[11px] text-destructive/80">
            {t("resource.modeUpgradeRequired", {
              current: error.currentVersion || t("resource.modeVersionUnknown"),
              min: error.minVersion,
            })}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * One execution-mode choice. Deliberately does NOT lead with the raw
 * `in_place` / `worktree` identifier (web's `ModeOption` makes the same call):
 * the choice a user is actually making is about how they get their results
 * back, so the title says that and the identifier is only a secondary hint for
 * anyone matching this against the CLI or the docs.
 *
 * Selection is carried by border + tint rather than a filled background so it
 * stays legible in both themes.
 */
function ModeOption({
  icon,
  title,
  description,
  identifier,
  selected,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  description: string;
  identifier: LocalDirectoryExecutionMode;
  selected: boolean;
  onPress: () => void;
}) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={title}
      className={cn(
        "flex-row items-start gap-3 rounded-lg border p-3 active:opacity-90",
        selected ? "border-brand bg-brand/5" : "border-border",
      )}
    >
      <Ionicons
        name={icon}
        size={15}
        color={selected ? theme.brand : theme.mutedForeground}
        style={{ marginTop: 2 }}
      />
      <View className="flex-1 min-w-0">
        <View className="flex-row items-center gap-2">
          <Text className="text-sm font-medium text-foreground">{title}</Text>
          <Text className="font-mono text-[10px] text-muted-foreground">
            {identifier}
          </Text>
        </View>
        <Text className="mt-0.5 text-xs text-muted-foreground">
          {description}
        </Text>
      </View>
    </Pressable>
  );
}
