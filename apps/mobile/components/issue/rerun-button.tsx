/**
 * Re-run button for a failed agent run. One implementation for both places a
 * retry can be offered — a past run row (`run-row.tsx`) and the system comment
 * an agent leaves behind when it fails (`comment-card.tsx`, G22) — because web
 * routes both through the same `api.rerunIssue` call and the same 403
 * classification (packages/views/issues/components/comment-card.tsx:246-297
 * and execution-log-section.tsx:457-500). Two copies would be two places for
 * that error handling to drift.
 *
 * The button renders in two shapes, since the two hosts differ: the run row is
 * a compact chip among Cancel/expand actions (`chip`), while a comment body has
 * room for a labelled button (`default`).
 */
import { ActivityIndicator, Alert, Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { useRerunIssue } from "@/data/mutations/issues";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { isInvocationBlocked } from "@/lib/run-retry";
import { useTranslation } from "@/lib/i18n/react";

interface Props {
  issueId: string;
  /** The run to re-fire — a run row's id, or a failed comment's
   *  `source_task_id`. */
  taskId: string;
  /** `chip` = the run row's compact action; `default` = the comment's labelled
   *  button. */
  variant?: "chip" | "default";
}

export function RerunButton({ issueId, taskId, variant = "chip" }: Props) {
  const mutation = useRerunIssue(issueId);
  const { colorScheme } = useColorScheme();
  const { t } = useTranslation();

  const onPress = () => {
    mutation.mutate(taskId, {
      // A rerun is re-gated on the operator's invoke permission (MUL-4525):
      // a structured 403 means the agent can't be triggered, not a transient
      // failure — localize it instead of echoing the generic message (web
      // execution-log-section.tsx:485).
      onError: (err) => {
        Alert.alert(
          t("runs.retryTitle"),
          isInvocationBlocked(err) ? t("runs.retryBlocked") : t("runs.retryFailed"),
        );
      },
    });
  };

  const label = mutation.isPending ? t("runs.retryRunning") : t("runs.retry");

  return (
    <Pressable
      onPress={onPress}
      disabled={mutation.isPending}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={
        variant === "chip"
          ? "px-3 py-1.5 rounded-md bg-secondary active:opacity-70"
          : "self-start flex-row items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 active:bg-secondary"
      }
    >
      {mutation.isPending ? (
        <ActivityIndicator
          size="small"
          color={THEME[colorScheme].mutedForeground}
        />
      ) : (
        <View className="flex-row items-center gap-1">
          <Ionicons
            name="refresh"
            size={variant === "chip" ? 12 : 13}
            className="text-muted-foreground"
          />
          <Text className="text-xs font-medium text-foreground">
            {t("runs.retry")}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
