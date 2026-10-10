/**
 * "Agents working" toggle chip for the issue-surface headers — mobile port of
 * web's `WorkspaceAgentWorkingChip`
 * (`packages/views/issues/components/workspace-agent-working-chip.tsx`), which
 * web renders on the Issues header (`issues-header.tsx:1066`) and the My Issues
 * header (`my-issues-header.tsx:167`).
 *
 * Before this, mobile carried the `workingOnly` PREDICATE and wired it into the
 * filter sheet, but the surface header showed nothing at all: the only way to
 * learn the filter existed — let alone toggle it — was to open the sheet and
 * scroll to its boolean row. Web's chip is the visible half of the same
 * feature, so this closes a real gap rather than restyling one.
 *
 * Three visual tiers, and they are load-bearing (see `chipAppearance`):
 *
 *   filter ON          → filled brand      "you are filtering by this"
 *   activity present   → brand tint        "something is happening here"
 *   resolved idle      → neutral, dimmed   "nothing is happening here"
 *   unresolved         → neutral           "we do not know yet"
 *
 * The last two must not look alike. Dimming an unresolved surface claims it is
 * idle, which is the same unearned assertion as rendering "0" for a projection
 * that has not landed (MUL-5525).
 *
 * A phone has no hover, so web's HoverCard body (the roster) is a tap-opened
 * sheet here. Tap on the chip itself toggles the filter — the chip's own
 * `onToggle`, same as web's click — and the count/roster is reachable from the
 * sheet, which is the one interaction that has to differ.
 */
import { useState } from "react";
import { Pressable, View } from "react-native";
import type { WorkingAgentSummary } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { AvatarStack, type StackActor } from "@/components/ui/avatar-stack";
import { PickerSheet } from "./pickers/picker-sheet";
import { WorkingAgentsRoster } from "./working-agents-roster";
import { useTranslation } from "@/lib/i18n/react";
import { countLabelKey } from "@/lib/actor-profile";
import { chipActivity, chipAppearance } from "@/lib/working-agents-chip";
import { cn } from "@/lib/utils";

/** Avatar diameter inside the chip — smaller than the 24pt row default so the
 *  chip stays the height of the buttons beside it on the toolbar row. */
const STACK_SIZE = 16;

export function AgentsWorkingChip({
  value,
  onToggle,
  agents,
}: {
  /** The filter's current state. */
  value: boolean;
  onToggle: () => void;
  /** Agents working inside the surface this header belongs to, already
   *  narrowed by its scope and every active filter. `undefined` = not resolved
   *  yet — see the file header for why that is not `[]`. */
  agents: readonly WorkingAgentSummary[] | undefined;
}) {
  const { t } = useTranslation();
  const [rosterOpen, setRosterOpen] = useState(false);

  const activity = chipActivity(agents);
  const agentIds = agents?.map((agent) => agent.id) ?? [];
  const appearance = chipAppearance(value, activity);

  // An unresolved projection shows "—" rather than a number: "0" and "not
  // known yet" are different claims and the reader cannot tell them apart once
  // one is rendered as the other (web `chip_agents_working_unknown`).
  const label =
    activity === "unknown"
      ? t("issue.agentsWorkingUnknownShort")
      : t(countLabelKey("issue.agentsWorking", agentIds.length), {
          count: agentIds.length,
        });

  const body = (
    <Pressable
      onPress={onToggle}
      onLongPress={() => setRosterOpen(true)}
      accessibilityRole="button"
      accessibilityState={{ selected: value }}
      accessibilityLabel={label}
      accessibilityHint={t("issue.agentsWorkingHint")}
      className={cn(
        "flex-row items-center gap-1.5 rounded-md border px-2 py-1.5",
        appearance.variant === "brand" && "border-brand bg-brand",
        appearance.variant === "brandSubtle" &&
          "border-brand/28 bg-brand/10",
        appearance.variant === "outline" && "border-border bg-background",
      )}
    >
      {activity === "some" ? (
        <AvatarStack
          actors={agentIds.map<StackActor>((id) => ({ type: "agent", id }))}
          max={3}
          size={STACK_SIZE}
          // The stack paints the host surface between overlapping avatars; on
          // the chip that surface is the chip's own fill, not the page.
          ringClassName={
            appearance.variant === "brand" ? "bg-brand" : "bg-background"
          }
        />
      ) : null}
      <Text
        className={cn(
          "text-caption font-medium tabular-nums",
          appearance.variant === "brand" && "text-brand-foreground",
          appearance.variant === "brandSubtle" && "text-foreground",
          // Only a CONFIRMED-idle surface is dimmed — never an unresolved one.
          appearance.variant === "outline" &&
            (appearance.tone === "dimmed"
              ? "text-muted-foreground"
              : "text-foreground"),
        )}
      >
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View className="shrink-0">
      {body}
      <PickerSheet
        title={t("issue.agentsWorkingSheetTitle")}
        visible={rosterOpen}
        onClose={() => setRosterOpen(false)}
      >
        <WorkingAgentsRoster agents={agents} />
      </PickerSheet>
    </View>
  );
}
