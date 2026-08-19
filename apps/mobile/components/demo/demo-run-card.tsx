/**
 * Mock run/execution feed for the pre-auth demo page. Compressed mirror of
 * the web landing's AutonomousVisual
 * (apps/web/features/landing/components/features-section.tsx): an
 * in-progress agent card (pulse + duration + tool-call count), a tool-call
 * timeline and a task-run history. Same status colours as real rows —
 * green = completed, brand pulse = running.
 */
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { Card } from "@/components/ui/card";
import { PulseDot } from "@/components/ui/pulse-dot";
import { cn } from "@/lib/utils";

export interface MockRunTask {
  id: string;
  title: string;
  duration: string;
  running?: boolean;
}

interface Props {
  headerLabel: string;
  toolCallsLabel: string;
  toolRows: { tool: string; summary: string }[];
  taskHeader: string;
  tasks: MockRunTask[];
}

export function DemoRunCard({
  headerLabel,
  toolCallsLabel,
  toolRows,
  taskHeader,
  tasks,
}: Props) {
  return (
    <Card className="gap-0 p-0 overflow-hidden">
      {/* Card header — same live-run chrome as the real issue Runs sheet. */}
      <View className="flex-row items-center gap-2 border-b border-border px-4 py-2.5">
        <PulseDot />
        <Text className="text-xs font-medium text-foreground">{headerLabel}</Text>
        <Text className="ml-auto text-xs tabular-nums text-muted-foreground/60">
          {`${toolRows.length} ${toolCallsLabel}`}
        </Text>
      </View>

      {/* Tool-call timeline. */}
      <View className="gap-1 px-4 py-3">
        {toolRows.map((row, index) => (
          <View key={index} className="flex-row items-center gap-2 rounded px-2 py-1">
            <View className="size-1 rounded-full bg-brand/60" />
            <Text className="shrink-0 text-xs font-semibold text-foreground">{row.tool}</Text>
            <Text className="flex-1 text-xs text-muted-foreground" numberOfLines={1}>
              {row.summary}
            </Text>
          </View>
        ))}
      </View>

      {/* Task run history. */}
      <View className="border-t border-border px-4 py-3 gap-1.5">
        <Text className="text-xs font-medium text-muted-foreground">{taskHeader}</Text>
        {tasks.map((task) => (
          <View key={task.id} className="flex-row items-center gap-2">
            <View
              className={cn(
                "size-2 rounded-full",
                task.running ? "bg-brand" : "bg-success",
              )}
            />
            <Text
              className={cn(
                "flex-1 text-xs",
                task.running ? "font-medium text-foreground" : "text-muted-foreground",
              )}
              numberOfLines={1}
            >
              {task.title}
            </Text>
            <Text className="text-xs tabular-nums text-muted-foreground/60">
              {task.duration}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
}