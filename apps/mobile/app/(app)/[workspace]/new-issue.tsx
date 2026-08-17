/**
 * New issue creation modal — manual + agent modes.
 *
 * Layout follows Apple Reminders / Linear iOS / Things 3: one vertical
 * scrolling form, no sticky bottom toolbar. A top segmented control
 * switches between the two creation modes; each mode keeps its own input
 * state (title/description vs prompt) so switching back and forth never
 * loses a half-typed draft. Property chips are part of the form, not
 * pinned above keyboard. MentionSuggestionBar floats above keyboard only
 * when the user is mid-@ in manual mode.
 *
 * Manual mode: title → description → property chips. Mention pipeline
 * shares `useMentionInput` with `issue/[id]/new-comment.tsx` — both
 * surfaces produce canonical `[@name](mention://type/id)` markdown
 * recognised by util.ParseMentions on the server. The description input
 * carries the `MarkdownToolbar` (via `DescriptionField`) for markdown
 * syntax insert plus image / file upload; freshly uploaded attachment ids
 * ride along on create via `attachment_ids`.
 *
 * Agent mode (`QuickCreatePanel`): natural-language prompt + agent/squad
 * + project / priority / due-date → POST /api/issues/quick-create. The
 * server enqueues a quick-create task and the picked agent authors the
 * issue (no handwritten title needed); success/failure surface as inbox
 * notifications. Mirrors web's AgentCreatePanel, without attachment
 * upload / CLI-version gating.
 */
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { Stack, router } from "expo-router";
import { SubmitIssueButton } from "@/components/issue/submit-issue-button";
import { CreateFormAttributeRow } from "@/components/issue/create-form-attribute-row";
import { MentionSuggestionBar } from "@/components/issue/mention-suggestion-bar";
import { DescriptionField } from "@/components/issue/description-field";
import { QuickCreatePanel } from "@/components/issue/quick-create-panel";
import { Text } from "@/components/ui/text";
import { MOBILE_PLACEHOLDER_COLOR } from "@/components/ui/input-tokens";
import { useCreateIssue, useQuickCreateIssue } from "@/data/mutations/issues";
import { useNewIssueDraftStore } from "@/data/stores/new-issue-draft-store";
import { useActorLookup } from "@/data/use-actor-name";
import { useMentionInput } from "@/lib/use-mention-input";
import { keyboardBehavior } from "@/lib/keyboard";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/react";

type CreateMode = "manual" | "agent";

const MODES: { key: CreateMode; labelKey: string }[] = [
  { key: "manual", labelKey: "newIssue.modeManual" },
  { key: "agent", labelKey: "newIssue.modeAgent" },
];

export default function NewIssueModal() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<CreateMode>("manual");
  const [title, setTitle] = useState("");
  // Agent-mode natural-language prompt. Lives here (not in the panel) so a
  // manual ↔ agent switch preserves it — same reasoning as title.
  const [prompt, setPrompt] = useState("");
  const description = useMentionInput();
  // Attribute chips (status / priority / assignee / due date / project)
  // live in `useNewIssueDraftStore` so the new-issue-picker/* formSheet
  // routes can read and write the same values without a parent-child
  // React relationship. The store is reset on mount + on unmount so
  // re-opening the new-issue modal starts clean.
  const status = useNewIssueDraftStore((s) => s.status);
  const priority = useNewIssueDraftStore((s) => s.priority);
  const assignee = useNewIssueDraftStore((s) => s.assignee);
  const dueDate = useNewIssueDraftStore((s) => s.dueDate);
  const startDate = useNewIssueDraftStore((s) => s.startDate);
  const labels = useNewIssueDraftStore((s) => s.labels);
  const project = useNewIssueDraftStore((s) => s.project);
  const agentActor = useNewIssueDraftStore((s) => s.agentActor);
  const resetDraft = useNewIssueDraftStore((s) => s.reset);
  const { getName } = useActorLookup();

  useEffect(() => {
    resetDraft();
    return () => {
      resetDraft();
    };
  }, [resetDraft]);

  const createIssue = useCreateIssue();
  const quickCreate = useQuickCreateIssue();
  // Loading state follows the ACTIVE mode — the header button must show a
  // spinner for whichever submit is in flight.
  const isSubmitting =
    mode === "manual" ? createIssue.isPending : quickCreate.isPending;

  // Attachment ids freshly uploaded from the description toolbar. Carried
  // into the create payload so the server binds them to the issue.
  const [uploadedAttachmentIds, setUploadedAttachmentIds] = useState<string[]>(
    [],
  );
  // In-flight description upload — hold submit until the picked file lands,
  // else its attachment id never reaches the create payload.
  const [uploadsPending, setUploadsPending] = useState(false);

  const canSubmit =
    mode === "manual"
      ? !isSubmitting &&
        !uploadsPending &&
        title.trim().length > 0
      : !isSubmitting &&
        prompt.trim().length > 0 &&
        agentActor != null;

  const submitAgentMode = useCallback(async (): Promise<boolean> => {
    const trimmedPrompt = prompt.trim();
    if (trimmedPrompt.length === 0 || !agentActor) return false;
    try {
      await quickCreate.mutateAsync({
        ...(agentActor.type === "agent"
          ? { agent_id: agentActor.id }
          : { squad_id: agentActor.id }),
        prompt: trimmedPrompt,
        ...(priority !== "none" ? { priority } : {}),
        ...(dueDate ? { due_date: dueDate } : {}),
        ...(project ? { project_id: project.id } : {}),
      });
      Alert.alert(
        t("newIssue.agentSentTitle"),
        t("newIssue.agentSentBody", {
          name: getName(agentActor.type, agentActor.id),
        }),
      );
      router.back();
      return true;
    } catch (err) {
      Alert.alert(
        t("newIssue.failedTitle"),
        err instanceof Error ? err.message : t("newIssue.unknownError"),
      );
      return false;
    }
  }, [prompt, agentActor, priority, dueDate, project, quickCreate, getName, t]);

  const submitManualMode = useCallback(async () => {
    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0) return;
    const finalDescription = description.serialize().trim();
    try {
      await createIssue.mutateAsync({
        title: trimmedTitle,
        description: finalDescription || undefined,
        status,
        priority,
        ...(assignee
          ? { assignee_type: assignee.type, assignee_id: assignee.id }
          : {}),
        ...(dueDate ? { due_date: dueDate } : {}),
        ...(startDate ? { start_date: startDate } : {}),
        ...(labels.length > 0 ? { label_ids: labels.map((l) => l.id) } : {}),
        ...(project ? { project_id: project.id } : {}),
        ...(uploadedAttachmentIds.length > 0
          ? { attachment_ids: uploadedAttachmentIds }
          : {}),
      });
      router.back();
    } catch (err) {
      Alert.alert(
        t("newIssue.failedTitle"),
        err instanceof Error ? err.message : t("newIssue.unknownError"),
      );
    }
  }, [
    title,
    description,
    status,
    priority,
    assignee,
    dueDate,
    startDate,
    labels,
    project,
    uploadedAttachmentIds,
    createIssue,
    t,
  ]);

  const onSubmit = useCallback(() => {
    if (mode === "manual") return submitManualMode();
    return submitAgentMode();
  }, [mode, submitManualMode, submitAgentMode]);

  const headerRight = useCallback(
    () => (
      <SubmitIssueButton
        disabled={!canSubmit}
        loading={isSubmitting}
        onPress={onSubmit}
      />
    ),
    [canSubmit, isSubmitting, onSubmit],
  );

  return (
    <>
      <Stack.Screen options={{ headerRight }} />
      <KeyboardAvoidingView
        className="flex-1 bg-background"
        behavior={keyboardBehavior}
      >
        <ScrollView
          className="flex-1"
          contentContainerClassName="px-4 pt-4 pb-6 gap-4"
          keyboardShouldPersistTaps="handled"
        >
          {/* Creation mode segmented control. Both modes share the draft —
              switching preserves each mode's own inputs. */}
          <View className="flex-row gap-1 rounded-full bg-secondary/60 p-1">
            {MODES.map((m) => {
              const active = mode === m.key;
              return (
                <Pressable
                  key={m.key}
                  onPress={() => setMode(m.key)}
                  className={cn(
                    "flex-1 items-center rounded-full px-3 py-1.5",
                    active ? "bg-foreground" : "bg-transparent",
                  )}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text
                    className={cn(
                      "text-sm font-medium",
                      active ? "text-background" : "text-muted-foreground",
                    )}
                  >
                    {t(m.labelKey)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {mode === "manual" ? (
            <>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder={t("newIssue.titlePlaceholder")}
                placeholderTextColor={MOBILE_PLACEHOLDER_COLOR}
                className="text-2xl font-semibold text-foreground py-2"
                autoFocus
                returnKeyType="next"
                editable={!isSubmitting}
              />
              <DescriptionField
                description={description}
                disabled={isSubmitting}
                onAttachmentUploaded={(id) =>
                  setUploadedAttachmentIds((prev) =>
                    prev.includes(id) ? prev : [...prev, id],
                  )
                }
                onUploadingChange={setUploadsPending}
              />
              <CreateFormAttributeRow mode="manual" />
            </>
          ) : (
            <QuickCreatePanel
              prompt={prompt}
              onPromptChange={setPrompt}
              disabled={isSubmitting}
            />
          )}
        </ScrollView>

        {/* Mention suggestions float above the keyboard only when the user
            types `@` in manual mode. Self-hides via `if (!visible) return
            null` so it doesn't take space at rest. */}
        {mode === "manual" ? (
          <MentionSuggestionBar {...description.suggestionBar} />
        ) : null}
      </KeyboardAvoidingView>
    </>
  );
}