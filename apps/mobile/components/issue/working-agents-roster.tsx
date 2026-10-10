/**
 * Roster sheet for the agents-working affordances — mobile port of web's
 * `WorkingAgentsHoverContent` (`workspace-agent-working-chip.tsx:71-123`).
 *
 * Web hangs this off a HoverCard on both the Issues header chip and the
 * sub-issues header chip, so a narrowed read and an unnarrowed one describe
 * activity the same way; a phone has no hover, so here it is the body of a
 * `PickerSheet` that a tap opens. Keeping ONE body for both callers is the
 * same parity rule web follows — the only difference between the two is the
 * projection's scope, never the way it is described.
 *
 * Three states, and the first two must never collapse into each other
 * (MUL-5525): `undefined` = the projection has not resolved, `[]` = it
 * resolved and this surface really has nobody working, non-empty = the
 * roster. Rendering the empty sentence for an unresolved projection would
 * assert "no agents working right now" on no evidence.
 *
 * Identity comes from the workspace agent directory rather than the payload:
 * web's projection is a facet of ids and counts, and it resolves names the
 * same way. One definition of an agent's name/avatar across both callers.
 *
 * The counts here are the projection's own `running_task_count`, labelled
 * through `countLabelKey` — `translate()` does no plural resolution, so the
 * `_one` / `_other` pick has to happen at the call site.
 */
import { ScrollView, View } from "react-native";
import type { WorkingAgentSummary } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { useActorLookup } from "@/data/use-actor-name";
import { useTranslation } from "@/lib/i18n/react";
import { countLabelKey } from "@/lib/actor-profile";

export function WorkingAgentsRoster({
  agents,
}: {
  /** The projection, passed through UNTOUCHED. Defaulting to `[]` at the call
   *  site would hand this body a definite "nobody is working" for a state that
   *  has not resolved. */
  agents: readonly WorkingAgentSummary[] | undefined;
}) {
  const { t } = useTranslation();
  const { getName } = useActorLookup();

  if (agents === undefined) {
    return (
      <View className="px-4 py-3">
        <Text className="text-caption text-muted-foreground">
          {t("issue.agentsWorkingUnknown")}
        </Text>
      </View>
    );
  }

  if (agents.length === 0) {
    return (
      <View className="px-4 py-3">
        <Text className="text-caption text-muted-foreground">
          {t("issue.agentsWorkingNone")}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView className="max-h-80">
      <View className="px-4 pt-1 pb-2">
        <Text className="text-caption font-medium text-muted-foreground">
          {t(countLabelKey("issue.agentsWorkingHeader", agents.length), {
            count: agents.length,
          })}
        </Text>
      </View>
      <View className="pb-2">
        {agents.map((agent) => (
          <View
            key={agent.id}
            className="flex-row items-center gap-2 px-4 py-2"
          >
            <ActorAvatar type="agent" id={agent.id} size={22} />
            <Text
              numberOfLines={1}
              className="min-w-0 flex-1 text-caption font-medium text-foreground"
            >
              {getName("agent", agent.id)}
            </Text>
            <Text className="shrink-0 text-caption text-muted-foreground tabular-nums">
              {t(countLabelKey("issue.agentsWorkingTasks", agent.running_task_count), {
                count: agent.running_task_count,
              })}
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
