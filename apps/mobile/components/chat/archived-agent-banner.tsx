/**
 * Inline notice rendered above the chat input when the open session's agent
 * has been archived (retired). Mirror of
 * `packages/views/chat/components/archived-agent-banner.tsx` — sibling of
 * OfflineBanner / RuntimeRequiredBanner, occupying the same slot.
 *
 * The composer below is disabled and this banner explains why: the agent can
 * no longer reply, so the conversation is read-only history. Without it the
 * screen falls back to the generic "no agent selected" copy, which is wrong —
 * the session does have an agent, it is just retired.
 */
import Ionicons from "@expo/vector-icons/Ionicons";
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n/react";

interface Props {
  /** Display name for the copy. Falls back to the generic "this agent". */
  agentName?: string;
}

export function ArchivedAgentBanner({ agentName }: Props) {
  const { t } = useTranslation();
  const name = agentName?.trim() || t("chat.thisAgent");
  return (
    <View className="mx-3 mb-1.5 flex-row items-center gap-1.5 rounded-md bg-muted px-2.5 py-1.5">
      <Ionicons
        name="archive-outline"
        size={14}
        className="text-muted-foreground"
      />
      <Text className="flex-1 text-xs text-muted-foreground" numberOfLines={1}>
        {t("chat.archivedAgentBanner", { name })}
      </Text>
    </View>
  );
}
