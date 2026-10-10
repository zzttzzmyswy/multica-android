/**
 * Run-confirm dialog for agent/squad assignment — web `RunConfirmModal`
 * (`packages/views/modals/run-confirm.tsx`) as a phone-native `Modal`.
 *
 * Extracted verbatim from `batch-action-bar.tsx` (where it shipped for the
 * batch toolbar in iteration 66) so the issue-detail assign path can host the
 * SAME dialog. Two dialogs is how the two surfaces would drift: the batch one
 * already carries a handoff-note box, a "Don't start yet" button and the
 * all-backlog short-circuit, and a second copy written from the same
 * description would diverge on the first copy edit.
 *
 * Two things this dialog deliberately does NOT do, both matching web after
 * MUL-5010:
 *
 *   - It fires no request on open. The old shape called
 *     `POST /api/issues/preview-trigger` and blocked the whole dialog behind a
 *     spinner; the modal's meaning is "you are confirming an assignment", not
 *     "you are confirming N runs", so the note box and both buttons are usable
 *     on the first frame.
 *   - It reports no result. Completion is silent — the assignee change and any
 *     run it starts surface through the issue's normal assignee / run-status
 *     updates. Whether a run starts stays the server's decision at write time.
 *
 * `count` is what separates the two hosts: the batch toolbar passes its
 * selection size (copy switches to "Assign {{count}} issues…"), the detail page
 * passes 1 and gets the singular sentence.
 */
import { Modal, Pressable, TextInput, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import { useTranslation } from "@/lib/i18n/react";
import { MAX_HANDOFF_NOTE } from "@/lib/run-confirm";

export function AssignConfirmDialog({
  visible,
  name,
  count,
  note,
  onNoteChange,
  busy,
  onConfirm,
  onDontStart,
  onClose,
}: {
  visible: boolean;
  /** Display name of the agent / squad the issues are being handed to. */
  name: string;
  /** How many issues this confirmation covers. 1 → the singular sentence. */
  count: number;
  note: string;
  onNoteChange: (note: string) => void;
  /** A write is in flight — both footers disable so the two paths cannot
   *  disagree about `suppress_run` by being pressed together. */
  busy: boolean;
  /** "Confirm assignment" — sends the note (if any), may start a run. */
  onConfirm: () => void;
  /** "Don't start yet" — sends `suppress_run`, never the note. */
  onDontStart: () => void;
  onClose: () => void;
}) {
  const { colorScheme } = useColorScheme();
  const { t } = useTranslation();
  const headline =
    count > 1
      ? t("runConfirm.assignBatch", { count, name })
      : t("runConfirm.assignSingle", { name });
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable className="flex-1 bg-black/40" onPress={onClose}>
        <View className="flex-1 justify-center px-6">
          <Pressable onPress={() => {}} className="bg-popover rounded-2xl p-4">
            <Text className="text-title-sm font-semibold text-foreground">
              {t("runConfirm.titleAssign")}
            </Text>
            <Text className="text-body text-muted-foreground leading-5 mt-1.5">
              {headline}
            </Text>
            <View className="mt-3">
              <Text className="text-caption font-medium text-foreground">
                {t("runConfirm.noteLabel")}
              </Text>
              <TextInput
                value={note}
                onChangeText={onNoteChange}
                placeholder={t("runConfirm.notePlaceholder")}
                placeholderTextColor={THEME[colorScheme].mutedForeground}
                maxLength={MAX_HANDOFF_NOTE}
                multiline
                className="border border-border rounded-lg px-3 py-2 mt-1.5 text-body text-foreground min-h-[72px]"
              />
            </View>
            <View className="flex-row gap-2 mt-4">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                disabled={busy}
                onPress={onDontStart}
              >
                <Text>{t("runConfirm.dontStart")}</Text>
              </Button>
              <Button
                size="sm"
                className="flex-1"
                disabled={busy}
                onPress={onConfirm}
              >
                <Text>{t("runConfirm.confirmAssign")}</Text>
              </Button>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
