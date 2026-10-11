/**
 * Slim header for the issue detail screen.
 *
 * Linear iOS-inspired layout:
 *   - identifier (MUL-NN) above as a small muted label
 *   - title in a large bold treatment
 *   - attribute chip row below (status / priority / assignee / labels /
 *     project / due date) — tappable, opens picker sheets
 *
 * The native iOS Stack header still renders `issue.identifier` as the
 * navigation title; the body re-renders it more prominently per the
 * reference screenshot.
 */
import { View } from "react-native";
import type { Issue } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { AttributeRow } from "./attribute-row";
import { AgentActivityRow } from "./agent-activity-row";
import { CustomPropertyRow } from "./custom-property-row";
import { HighlightOverlay } from "./highlight-overlay";

export function IssueHeaderCard({
  issue,
  titleHighlighted = false,
}: {
  issue: Issue;
  /** True while an in-page find step is landing on the title. The flash wraps
   *  the title line alone — see `TimelineList`'s `ListHeader` for why it is not
   *  the whole card. */
  titleHighlighted?: boolean;
}) {
  return (
    <View className="px-4 pt-4 pb-3 gap-3">
      <Text className="text-caption text-muted-foreground">{issue.identifier}</Text>
      <View>
        <Text className="text-display-sm font-bold text-foreground">
          {issue.title}
        </Text>
        <HighlightOverlay
          active={titleHighlighted}
          className="absolute -inset-1 rounded-lg border-2 border-brand/50 bg-brand/5"
        />
      </View>
      {/* Activity row sits between title and attributes — it represents
       *  "who's doing this issue right now / who has done it" (dynamic),
       *  which is higher-IA than the static property chips below.
       *  Conditionally renders null when there are no tasks at all. */}
      <AgentActivityRow issueId={issue.id} />
      <AttributeRow issue={issue} />
      {/* Workspace custom-property values, resolved against the workspace
       *  definition catalog (MYS-334). Renders null when no values exist
       *  and nothing is addable. */}
      <CustomPropertyRow issue={issue} />
    </View>
  );
}
