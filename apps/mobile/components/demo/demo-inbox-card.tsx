/**
 * Mock inbox for the pre-auth demo page. Row shape mirrors the real
 * InboxRow (components/inbox/inbox-row.tsx): avatar, unread dot + title on
 * the top row with a status icon at the right, type-aware detail line +
 * time below. Tapping a row toggles read locally — no API involved, the
 * demo page runs fully offline.
 */
import { useState } from "react";
import { Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { Card } from "@/components/ui/card";
import { StatusIcon } from "@/components/ui/status-icon";
import { MockAvatar } from "@/components/demo/mock-avatar";
import { cn } from "@/lib/utils";
import type { IssueStatus } from "@multica/core/types";

export interface MockInboxRowData {
  id: string;
  title: string;
  detail: string;
  time: string;
  actorKind: "member" | "agent";
  actorInitials: string;
  status: IssueStatus | null;
}

interface Props {
  rows: MockInboxRowData[];
}

export function DemoInboxCard({ rows }: Props) {
  const [readIds, setReadIds] = useState<ReadonlySet<string>>(new Set());

  const toggle = (id: string) => {
    setReadIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <Card className="gap-0 p-0 overflow-hidden">
      {rows.map((row, index) => {
        const isUnread = !readIds.has(row.id);
        return (
          <Pressable
            key={row.id}
            onPress={() => toggle(row.id)}
            accessibilityRole="button"
            accessibilityLabel={isUnread ? row.title : row.title}
            className={cn(
              "bg-background active:bg-secondary px-4 py-3",
              index > 0 && "border-t border-border",
            )}
          >
            <View className="flex-row gap-3">
              <MockAvatar kind={row.actorKind} initials={row.actorInitials} size={36} />
              <View className="flex-1 min-w-0">
                <View className="flex-row items-center gap-2">
                  <View className="flex-row items-center gap-1.5 flex-1 min-w-0">
                    {isUnread ? (
                      <View className="size-1.5 rounded-full bg-brand shrink-0" />
                    ) : null}
                    <Text
                      className={cn(
                        "flex-1 text-sm",
                        isUnread ? "font-medium text-foreground" : "text-muted-foreground",
                      )}
                      numberOfLines={1}
                    >
                      {row.title}
                    </Text>
                  </View>
                  {row.status ? <StatusIcon status={row.status} size={14} /> : null}
                </View>
                <View className="flex-row items-center gap-2 mt-0.5">
                  <Text className="flex-1 text-xs text-muted-foreground" numberOfLines={1}>
                    {row.detail}
                  </Text>
                  <Text className="text-xs text-muted-foreground/60">{row.time}</Text>
                </View>
              </View>
            </View>
          </Pressable>
        );
      })}
    </Card>
  );
}