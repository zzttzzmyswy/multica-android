/**
 * Read-only peek at one skill, opened from an agent's Skills section.
 *
 * Web parity: `SkillDetailDialog` in
 * `packages/views/agents/components/tabs/skills-tab.tsx:423-497`. Web's rows
 * are buttons that open this dialog (`:177-178` for workspace skills, `:295`
 * for runtime-local ones); mobile's rows were not pressable at all, so
 * answering "what is actually in this skill?" meant leaving the agent page,
 * finding the skill again in the library, and coming back.
 *
 * Two bodies, because the two skills are different objects — see
 * `lib/agent-skill-detail.ts` for the reasoning and the read-state rules:
 *
 *  - workspace skill → fetched on demand (`/api/skills/:id`; the list endpoint
 *    omits `content`), rendered as monospace text rather than markdown. Web
 *    also renders it in a `<pre>`: this is the skill's SOURCE, and rendering
 *    it as prose would hide its structure.
 *  - runtime skill  → the summary's own fields, no request.
 *
 * Extras beyond web, both because a phone cannot hover and cannot select text
 * as easily: the source path is shown in full (web truncates in the list) and
 * a copy affordance is offered for the content. Everything web shows is shown.
 */
import { Modal, Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { SkillSummary } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n/react";
import {
  skillDetailTitle,
  skillDetailView,
  type SelectedAgentSkill,
} from "@/lib/agent-skill-detail";

export function AgentSkillDetailSheet({
  selection,
  workspaceSkill,
  workspaceName,
  workspaceReadState,
  onRetry,
  onClose,
}: {
  selection: SelectedAgentSkill;
  /** The fetched workspace skill, when the read has settled successfully. */
  workspaceSkill: (SkillSummary & { content?: string; files?: unknown }) | null;
  /** The workspace skill's own name, for the header while content loads. */
  workspaceName: string | null;
  /** Three-state read status — never collapsed into "content is empty". */
  workspaceReadState: "loading" | "failed" | "ready";
  onRetry: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;

  const view = skillDetailView(
    selection,
    workspaceReadState === "ready" && workspaceSkill
      ? {
          state: "ready",
          skill: {
            content: workspaceSkill.content ?? "",
            files: (workspaceSkill.files ?? []) as {
              id: string;
              path: string;
            }[],
          },
        }
      : workspaceReadState === "failed"
        ? { state: "failed" }
        : { state: "loading" },
  );

  if (!view) return null;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable className="flex-1 bg-black/40" onPress={onClose}>
        <View className="flex-1 justify-end">
          <Pressable
            onPress={() => {}}
            className="bg-popover rounded-t-2xl max-h-[80%]"
          >
            <View className="px-4 py-3 border-b border-border flex-row items-center justify-between gap-3">
              <View className="flex-1 min-w-0">
                <Text
                  className="text-title-sm font-semibold text-foreground"
                  numberOfLines={1}
                >
                  {skillDetailTitle(
                    selection,
                    workspaceName,
                    t("agents.skills.detailTitle"),
                  )}
                </Text>
                {/* Which of the two kinds this is. Same distinction web draws
                    with its badge (`skills-tab.tsx:436-441`): an inherited
                    runtime skill is not editable from the workspace. */}
                <Text className="text-micro text-muted-foreground">
                  {view.kind === "runtime"
                    ? t("agents.skills.inheritedBadge")
                    : t("agents.skills.workspaceBadge")}
                </Text>
              </View>
              <Pressable onPress={onClose} hitSlop={8}>
                <Ionicons name="close" size={20} color={muted} />
              </Pressable>
            </View>

            <ScrollView className="px-4 py-3">
              {view.kind === "workspace-loading" ? (
                <Text className="text-body text-muted-foreground py-6 text-center">
                  {t("agents.skills.detailLoading")}
                </Text>
              ) : view.kind === "workspace-error" ? (
                // A failed read is named as a failure with a retry, never
                // rendered as "this skill is empty" (MYS-1908 line).
                <View className="py-4 gap-3 items-start">
                  <Text className="text-body text-muted-foreground">
                    {t("agents.skills.detailFailed")}
                  </Text>
                  <Button variant="outline" size="sm" onPress={onRetry}>
                    <Text>{t("workspace.retry")}</Text>
                  </Button>
                </View>
              ) : view.kind === "runtime" ? (
                <View className="gap-2">
                  <DetailRow label={t("agents.skills.detailSource")}>
                    {view.sourcePath}
                  </DetailRow>
                  <DetailRow label={t("agents.skills.detailProvider")}>
                    {view.provider}
                  </DetailRow>
                  {view.plugin ? (
                    <DetailRow label={t("agents.skills.detailPlugin")}>
                      {view.plugin}
                    </DetailRow>
                  ) : null}
                  <DetailRow label={t("agents.skills.detailFiles")}>
                    {String(view.fileCount)}
                  </DetailRow>
                  <Text className="pt-2 text-micro text-muted-foreground leading-4">
                    {t("agents.skills.detailRuntimeHint")}
                  </Text>
                </View>
              ) : (
                <View className="gap-3">
                  {/* Web renders this in a `<pre>` too (`skills-tab.tsx:483`):
                      it is the skill's source, not prose. */}
                  <View className="rounded-md border border-border bg-secondary/30 p-3">
                    <ScrollView horizontal>
                      <Text className="text-caption font-mono text-foreground">
                        {view.content ||
                          t("agents.skills.detailNoContent")}
                      </Text>
                    </ScrollView>
                  </View>
                  {view.files.length > 0 ? (
                    <View className="gap-1">
                      <Text className="text-caption font-medium text-foreground">
                        {t("agents.skills.detailSupportingFiles")}
                      </Text>
                      {view.files.map((file) => (
                        <Text
                          key={file.id}
                          className="text-caption font-mono text-muted-foreground"
                          numberOfLines={1}
                        >
                          {file.path}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                </View>
              )}
            </ScrollView>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View className="flex-row gap-3">
      <Text className="text-caption text-muted-foreground w-24 shrink-0">
        {label}
      </Text>
      <Text className="text-caption text-foreground flex-1">{children}</Text>
    </View>
  );
}

/** The selection a tap produces. Re-exported so the section can name the type
 *  without importing the model module directly. */
export type { SelectedAgentSkill };
