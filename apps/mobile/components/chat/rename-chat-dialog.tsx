/**
 * Rename-chat dialog — a centered Modal with a title input.
 *
 * iOS has `Alert.prompt`, but Android's AlertDialog has no free-text entry,
 * so the chat screens (session sheet, chat tab ⋯ menu) share this tiny
 * controlled dialog instead. Kept as a sibling of `chat-session-actions.tsx`
 * because it's the one place that needs a text input; the actions themselves
 * all route through the native/bottom action sheet.
 *
 * Style follows `agent-emoji-picker-sheet.tsx` (bg-popover rounded-2xl card
 * on a dimmed backdrop) so it reads as part of the same sheet family.
 */
import { useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n/react";

interface Props {
  visible: boolean;
  initialTitle: string;
  onCancel: () => void;
  onSubmit: (title: string) => void;
}

/** Server-side cap on a chat session title (chat.go chatSessionTitleMaxLen). */
const CHAT_TITLE_MAX_LEN = 200;

export function RenameChatDialog({
  visible,
  initialTitle,
  onCancel,
  onSubmit,
}: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initialTitle);

  // Re-seed the draft each time the dialog opens so a stale value from the
  // previous session never leaks in.
  const handleShow = () => setDraft(initialTitle);

  const trimmed = draft.trim();
  const dirty = visible && trimmed.length > 0 && trimmed !== initialTitle;

  const confirm = () => {
    if (!dirty) return;
    onSubmit(trimmed);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onShow={handleShow}
      onRequestClose={onCancel}
    >
      <Pressable className="flex-1 bg-black/40" onPress={onCancel}>
        <View className="flex-1 items-center justify-center px-6">
          <Pressable onPress={() => {}} className="w-full max-w-sm">
            <View className="bg-popover rounded-2xl overflow-hidden p-4 gap-3">
              <Text className="text-base font-semibold text-foreground">
                {t("chat.renameTitle")}
              </Text>
              <TextField
                value={draft}
                onChangeText={setDraft}
                placeholder={t("chat.renamePlaceholder")}
                autoFocus
                selectTextOnFocus
                maxLength={CHAT_TITLE_MAX_LEN}
                returnKeyType="done"
                onSubmitEditing={confirm}
              />
              <View className="flex-row justify-end gap-2">
                <Button variant="ghost" onPress={onCancel}>
                  <Text>{t("common.cancel")}</Text>
                </Button>
                <Button onPress={confirm} disabled={!dirty}>
                  <Text>{t("common.save")}</Text>
                </Button>
              </View>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}