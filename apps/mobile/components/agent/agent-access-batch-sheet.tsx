/**
 * Batch "Set access scope" sheet (iteration-84, A8, MUL-4302 parity). The
 * bulk-action dialog web opens from its batch toolbar — a single scope choice
 * (with an optional member list) applied to every selected agent the caller
 * owns. Reuses the shared pure draft UI (`AgentAccessEditor`) and the core
 * wire builder (`buildInvocationTargets`) so the batch dialog and the
 * detail-page editor cannot drift.
 *
 * Each open starts from an EMPTY draft: there is no meaningful "persisted"
 * value across a heterogeneous selection, so the user picks a scope explicitly
 * before Apply enables.
 */
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import {
  buildInvocationTargets,
  EMPTY_AGENT_DRAFT,
  type AgentDraft,
} from "@multica/core/agents";
import type { AgentInvocationTargetInput, MemberWithUser } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { AgentAccessEditor } from "@/components/agent/agent-access-picker";
import { useTranslation } from "@/lib/i18n/react";

export type AccessChangePick = {
  permission_mode: "private" | "public_to";
  invocation_targets: AgentInvocationTargetInput[];
};

/** The change the current draft selection would apply, or null when it cannot
 *  be applied yet (a members scope with zero grants). */
export function draftAccessChange(draft: AgentDraft): AccessChangePick | null {
  if (draft.permissionScope === "private") {
    return { permission_mode: "private", invocation_targets: [] };
  }
  const invocation_targets = buildInvocationTargets(draft);
  if (invocation_targets.length === 0) return null;
  return { permission_mode: "public_to", invocation_targets };
}

export function AgentAccessBatchSheet({
  visible,
  members,
  applying,
  onApply,
  onClose,
}: {
  visible: boolean;
  members: MemberWithUser[];
  applying?: boolean;
  onApply: (change: AccessChangePick) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<AgentDraft>(() => ({ ...EMPTY_AGENT_DRAFT }));

  // Each open starts from a clean draft — a previous selection must never
  // leak into the next bulk action.
  useEffect(() => {
    if (visible) setDraft({ ...EMPTY_AGENT_DRAFT });
  }, [visible]);

  const change = draftAccessChange(draft);
  const ready = change !== null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40" onPress={applying ? undefined : onClose}>
        <View className="flex-1 items-center justify-center px-6">
          <Pressable onPress={() => {}} className="w-full max-w-sm">
            <View className="bg-popover rounded-2xl overflow-hidden">
              <View className="flex-row items-center justify-between px-4 py-3 border-b border-border">
                <Text className="text-base font-semibold text-foreground">
                  {t("agents.batch.actions.setAccess")}
                </Text>
                <Pressable onPress={onClose} disabled={applying}>
                  <Text className="text-sm font-medium text-brand">
                    {t("common.cancel")}
                  </Text>
                </Pressable>
              </View>
              <ScrollView className="max-h-[70%]">
                <View className="p-4">
                  <AgentAccessEditor
                    draft={draft}
                    members={members}
                    disabled={applying}
                    onDraftChange={setDraft}
                  />
                </View>
              </ScrollView>
              <View className="flex-row items-center justify-between gap-3 px-4 py-3 border-t border-border">
                <Text className="flex-1 text-xs text-muted-foreground">
                  {t("agents.batch.actions.setAccess")}
                </Text>
                <Button
                  size="sm"
                  disabled={!ready || applying}
                  onPress={() => {
                    if (change) onApply(change);
                  }}
                >
                  {t("agents.batch.apply")}
                </Button>
              </View>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}