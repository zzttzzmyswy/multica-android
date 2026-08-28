/**
 * Execution-transcript modal for a single agent task — the mobile port of
 * web's transcript entry (`TranscriptButton` → `AgentTranscriptDialog`,
 * `packages/views/common/task-transcript/`). Reads the task's message stream
 * through the shared `RunLog` so loading / error / empty and live-polling
 * states behave exactly like the issue Runs sheet.
 *
 * `live` mirrors the row's running state (`isLive={isRunning}` on web): while
 * the task is running the log polls so the trace keeps growing on screen.
 */
import { Modal, Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { AgentTask } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { RunLog } from "@/components/issue/run-log";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

export function RunTranscriptDialog({
  taskId,
  taskStatus,
  onClose,
}: {
  taskId: string;
  taskStatus: AgentTask["status"];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View
        className="flex-1 bg-background"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <View className="border-b border-border px-4 py-3 flex-row items-center gap-3">
          <View className="size-8 rounded-lg bg-secondary items-center justify-center">
            <Ionicons
              name="document-text-outline"
              size={16}
              color={theme.mutedForeground}
            />
          </View>
          <Text className="flex-1 text-base font-semibold text-foreground">
            {t("agents.activity.transcriptTitle")}
          </Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t("a11y.close")}
            hitSlop={8}
          >
            <Ionicons name="close" size={20} color={theme.mutedForeground} />
          </Pressable>
        </View>
        <ScrollView
          className="flex-1"
          contentContainerClassName="px-4 py-4"
        >
          <RunLog taskId={taskId} live={taskStatus === "running"} embedded />
        </ScrollView>
      </View>
    </Modal>
  );
}