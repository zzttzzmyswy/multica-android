/**
 * Passive pre-trigger caption for the new-issue form — web `CreateRunHint`
 * (`packages/views/modals/create-issue.tsx:112-140`).
 *
 * When the form holds an agent/squad assignee, saving may start a run. Web
 * prints one line above its property toolbar saying which it will be, driven by
 * the backend's own predicate (`POST /api/issues/preview-trigger`, `is_create`)
 * rather than a frontend guess — the same rule the write path will apply. The
 * phone had no such line at all: assigning an agent in the create form looked
 * identical to assigning one on an issue that would never start.
 *
 * Three states, and the third is the point: nothing is rendered until the
 * assignee is agent-like AND the predicate has answered. Revealing "won't
 * start" first and flipping it to "will start" when the response lands is a
 * lie the user reads, and it is the flash web's reveal band exists to avoid.
 *
 * The copy names the actor the run belongs to: an agent picks the issue up
 * itself, while a squad only evaluates and delegates, so the squad path keeps
 * the squad as the subject and says its leader will assign the work.
 */
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { useIssueTriggerPreview } from "@/data/queries/issue-trigger-preview";
import { useActorLookup } from "@/data/use-actor-name";
import {
  createRunHintKey,
  createRunHintKind,
} from "@/lib/run-confirm";
import { useTranslation } from "@/lib/i18n/react";

export function CreateRunHint({
  assigneeType,
  assigneeId,
  status,
}: {
  assigneeType: "agent" | "squad" | null;
  assigneeId: string | null;
  status: Parameters<typeof useIssueTriggerPreview>[0]["status"];
}) {
  const { t } = useTranslation();
  const { getName } = useActorLookup();
  // The hook already gates on "agent-like assignee present"; passing the
  // caller's gate through keeps the request off the wire until then.
  const preview = useIssueTriggerPreview({
    isCreate: true,
    assigneeType,
    assigneeId,
    status,
    enabled: !!assigneeId,
  });

  const kind = createRunHintKind({
    assigneeType,
    assigneeId,
    isLoading: preview.isLoading,
    willStart: preview.willStart,
  });
  const key = createRunHintKey(kind, assigneeType);
  // Nothing to say yet (or at all) — render nothing rather than an empty band,
  // so the form does not reserve a row it will not fill.
  if (!key || !assigneeId) return null;

  const name = getName(assigneeType ?? "agent", assigneeId);

  return (
    <View
      className="flex-row items-center gap-1.5 px-1"
      accessibilityLiveRegion="polite"
    >
      <ActorAvatar type={assigneeType} id={assigneeId} size={16} />
      <Text className="flex-1 text-caption text-muted-foreground" numberOfLines={2}>
        {t(key, { name })}
      </Text>
    </View>
  );
}
