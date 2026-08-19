/**
 * Interactive issue mock for the pre-auth demo page. Behaviour mirrors the
 * web landing's TeammatesVisual
 * (apps/web/features/landing/components/features-section.tsx): tap the
 * status / priority / assignee chips to cycle through the real enums
 * (same cycles, same roster), rendered with the real StatusIcon /
 * PriorityIcon, AttributeChip and the real localized label helpers — the
 * demo teaches real Multica product semantics offline, with no API or
 * store access.
 */
import { useState } from "react";
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { Card } from "@/components/ui/card";
import { StatusIcon } from "@/components/ui/status-icon";
import { PriorityIcon } from "@/components/ui/priority-icon";
import { AttributeChip } from "@/components/issue/attribute-chip";
import { issuePriorityLabel, issueStatusLabel } from "@/lib/issue-status";
import { MockAvatar } from "@/components/demo/mock-avatar";
import {
  DEMO_ASSIGNEE_CYCLE,
  nextAssignee,
  nextPriority,
  nextStatus,
  type DemoAssignee,
} from "@/lib/demo-cycle";
import type { IssuePriority, IssueStatus } from "@multica/core/types";

interface Props {
  issueTitle: string;
  issueBody: string;
  tapHint: string;
  unassignedLabel: string;
  activityText: string;
  activityActorKind: "member" | "agent";
  activityActorInitials: string;
  activityTime: string;
  commentActor: string;
  commentText: string;
  commentTime: string;
}

export function DemoIssueCard({
  issueTitle,
  issueBody,
  tapHint,
  unassignedLabel,
  activityText,
  activityActorKind,
  activityActorInitials,
  activityTime,
  commentActor,
  commentText,
  commentTime,
}: Props) {
  const [status, setStatus] = useState<IssueStatus>("in_progress");
  const [priority, setPriority] = useState<IssuePriority>("medium");
  const [assignee, setAssignee] = useState<DemoAssignee>(DEMO_ASSIGNEE_CYCLE[3]!); // Claude

  return (
    <Card className="gap-0 p-0 overflow-hidden">
      <View className="p-4 gap-1.5">
        <Text className="text-base font-semibold text-foreground leading-snug">
          {issueTitle}
        </Text>
        <Text className="text-[13px] leading-relaxed text-muted-foreground">
          {issueBody}
        </Text>
      </View>

      <View className="border-t border-border px-4 py-3 gap-2.5">
        <View className="flex-row flex-wrap items-center gap-2">
          <AttributeChip
            icon={<StatusIcon status={status} size={14} />}
            label={issueStatusLabel(status)}
            onPress={() => setStatus(nextStatus(status))}
          />
          <AttributeChip
            icon={<PriorityIcon priority={priority} size={14} />}
            label={issuePriorityLabel(priority)}
            onPress={() => setPriority(nextPriority(priority))}
          />
          <AttributeChip
            icon={
              assignee.kind === "unassigned" ? (
                <View className="size-3.5 items-center justify-center">
                  <View className="size-2 rounded-full bg-muted-foreground/50" />
                </View>
              ) : (
                <MockAvatar
                  kind={assignee.kind}
                  initials={
                    assignee.kind === "member" ? assignee.initials : assignee.name[0] ?? ""
                  }
                  size={16}
                />
              )
            }
            label={assignee.kind === "unassigned" ? unassignedLabel : assignee.name}
            onPress={() => setAssignee(nextAssignee(assignee))}
          />
          <Text className="ml-auto text-xs text-muted-foreground/60">{tapHint}</Text>
        </View>

        {/* Mini activity feed — same shape as the real issue timeline. */}
        <View className="gap-2">
          <View className="flex-row items-center gap-2">
            <MockAvatar kind={activityActorKind} initials={activityActorInitials} size={20} />
            <Text className="flex-1 text-xs text-muted-foreground" numberOfLines={1}>
              {activityText}
            </Text>
            <Text className="text-xs text-muted-foreground/60">{activityTime}</Text>
          </View>
          <View className="ml-8 rounded-lg border border-border bg-muted/40 px-3 py-2 gap-0.5">
            <View className="flex-row items-center gap-2">
              <MockAvatar kind="agent" initials="C" size={18} />
              <Text className="text-xs font-medium text-foreground">{commentActor}</Text>
              <Text className="ml-auto text-xs text-muted-foreground/60">{commentTime}</Text>
            </View>
            <Text className="text-xs leading-relaxed text-muted-foreground" numberOfLines={2}>
              {commentText}
            </Text>
          </View>
        </View>
      </View>
    </Card>
  );
}