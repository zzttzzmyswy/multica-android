/**
 * Emoji avatar picker — bottom Modal grid for the agent-create form.
 * Mobile's v1 avatar affordance: web's control (avatar-upload-control.tsx)
 * also offers image upload + a full searchable emoji-mart; mobile ships the
 * same `emoji:` `avatar_url` wire format via the same suggestion set
 * (lib/agent-avatar.ts) but keeps it tap-only, no upload.
 */
import { Modal, Pressable, ScrollView, View } from "react-native";
import { Text } from "@/components/ui/text";
import { AVATAR_EMOJI_SUGGESTIONS } from "@/lib/agent-avatar";
import { useTranslation } from "@/lib/i18n/react";

interface Props {
  visible: boolean;
  selected: string | null;
  onPick: (value: string) => void;
  onClose: () => void;
}

export function AgentEmojiPickerSheet({
  visible,
  selected,
  onPick,
  onClose,
}: Props) {
  const { t } = useTranslation();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable className="flex-1 bg-black/40" onPress={onClose}>
        <View className="flex-1 items-center justify-center px-6">
          <Pressable onPress={() => {}} className="w-full max-w-sm">
            <View className="bg-popover rounded-2xl overflow-hidden">
              <View className="px-4 py-3 border-b border-border">
                <Text className="text-base font-semibold text-foreground">
                  {t("agents.new.avatarTitle")}
                </Text>
              </View>
              <ScrollView className="max-h-96">
                <View className="flex-row flex-wrap p-3 gap-1">
                  {AVATAR_EMOJI_SUGGESTIONS.map((emoji) => {
                    const isSelected = selected === emoji;
                    return (
                      <Pressable
                        key={emoji}
                        onPress={() => {
                          onPick(emoji);
                          onClose();
                        }}
                        accessibilityLabel={emoji}
                        className={
                          "size-11 items-center justify-center rounded-lg active:bg-secondary " +
                          (isSelected
                            ? "bg-primary/10 border border-primary/50"
                            : "border border-transparent")
                        }
                      >
                        <Text style={{ fontSize: 22 }}>{emoji}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}