/**
 * Mock chat for the pre-auth demo page. Bubble shapes mirror the real
 * chat message list (components/chat/chat-message-list.tsx): user messages
 * are right-aligned on muted, agent replies start at the left with an
 * avatar + name row. The "working" row reuses PulseDot — the same
 * in-progress signal real issue/chat cards use.
 */
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { Card } from "@/components/ui/card";
import { PulseDot } from "@/components/ui/pulse-dot";
import { MockAvatar } from "@/components/demo/mock-avatar";

interface Props {
  askText: string;
  askTime: string;
  agentName: string;
  replyText: string;
  replyTime: string;
  workingText: string;
}

export function DemoChatCard({
  askText,
  askTime,
  agentName,
  replyText,
  replyTime,
  workingText,
}: Props) {
  return (
    <Card className="gap-3">
      {/* User question — right-aligned, same shape as a real sent message. */}
      <View className="self-end max-w-[80%] gap-1 rounded-2xl border-2 border-transparent bg-muted px-3.5 py-2">
        <Text className="text-sm text-foreground">{askText}</Text>
        <Text className="self-end text-[11px] text-muted-foreground/70">{askTime}</Text>
      </View>

      {/* Agent reply — left-aligned with the author row above the bubble. */}
      <View className="self-start max-w-[85%] gap-1.5">
        <View className="flex-row items-center gap-1.5">
          <MockAvatar kind="agent" initials={agentName[0] ?? ""} size={20} />
          <Text className="text-xs font-medium text-foreground">{agentName}</Text>
          <Text className="text-[11px] text-muted-foreground/60">{replyTime}</Text>
        </View>
        <View className="rounded-2xl border border-border bg-background px-3.5 py-2">
          <Text className="text-sm leading-relaxed text-foreground">{replyText}</Text>
        </View>
      </View>

      {/* In-flight signal — same PulseDot the real run/activity cards use. */}
      <View className="flex-row items-center gap-2">
        <PulseDot />
        <Text className="text-xs text-muted-foreground">{workingText}</Text>
      </View>
    </Card>
  );
}