/**
 * New issue creation modal — manual + agent modes.
 *
 * Layout follows Apple Reminders / Linear iOS / Things 3: one vertical
 * scrolling form, no sticky bottom toolbar. A top segmented control
 * switches between the two creation modes; each mode keeps its own input
 * state (title/description vs prompt) so switching back and forth never
 * loses a half-typed draft. Property chips are part of the form, not
 * pinned above keyboard. MentionSuggestionBar floats above keyboard when
 * the user is mid-@ in either mode.
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
 * notifications. Mirrors web's AgentCreatePanel, including its attachment
 * support: the prompt carries the same `DescriptionField` the manual form
 * uses, so a screenshot or a log file can ride along on the request's
 * `attachment_ids` — the prompt is where "fix THIS screenshot" lives, so the
 * attachment is part of the task, not an extra. Still no CLI-version gating.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SubmitIssueButton } from "@/components/issue/submit-issue-button";
import { CreateFormAttributeRow } from "@/components/issue/create-form-attribute-row";
import { CreateRunHint } from "@/components/issue/create-run-hint";
import { MentionSuggestionBar } from "@/components/issue/mention-suggestion-bar";
import { DescriptionField } from "@/components/issue/description-field";
import { QuickCreatePanel } from "@/components/issue/quick-create-panel";
import { Text } from "@/components/ui/text";
import { MOBILE_PLACEHOLDER_COLOR } from "@/components/ui/input-tokens";
import { useCreateIssue, useQuickCreateIssue } from "@/data/mutations/issues";
import { projectDetailOptions } from "@/data/queries/projects";
import { useNewIssueDraftStore } from "@/data/stores/new-issue-draft-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useActorLookup } from "@/data/use-actor-name";
import { useMentionInput, type UseMentionInputReturn } from "@/lib/use-mention-input";
import {
  addUploadedAttachmentId,
  attachmentIdsPayload,
  canSubmitQuickCreate,
} from "@/lib/quick-create-attachments";
import type { SubIssueRouteParams } from "@/lib/sub-issue-route";
import { keyboardBehavior } from "@/lib/keyboard";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/react";

type CreateMode = "manual" | "agent";

const MODES: { key: CreateMode; labelKey: string }[] = [
  { key: "manual", labelKey: "newIssue.modeManual" },
  { key: "agent", labelKey: "newIssue.modeAgent" },
];

/** The two rich-text bodies this form persists. Both are mention inputs owned
 *  by the screen, and both are stored as serialized markdown. */
type DraftBodyField = "description" | "prompt";

/**
 * Keep one mention-input body in step with its persisted draft slot.
 *
 * Restore the saved text once, as soon as the workspace's draft file has been
 * read, then mirror every later edit back into it. Web parity: its draft holds
 * the editor's markdown and is rewritten on each keystroke, so a form
 * dismissed mid-sentence reopens with the sentence intact. Because the stored
 * value is markdown, the mention markers need no separate storage slot —
 * `serializeMentions` passes the canonical `[@name](mention://…)` links
 * already in the text straight through.
 *
 * Both halves wait for `hydrated`: until the file has been read, an empty
 * in-memory draft means "not loaded yet", and acting on it would either
 * restore nothing or write the empty state over the file it is about to read.
 * The mirror keys on the SERIALIZED body rather than the hook object, because
 * `useMentionInput` returns a fresh object every render.
 */
function useDraftBodySync(
  input: UseMentionInputReturn,
  field: DraftBodyField,
  persist: (next: string) => void,
  hydrated: boolean,
  /** A URL-carried seed is the only writer of the description this mount. */
  skipRestore: boolean,
) {
  const restore = input.restore;
  const liveText = input.text;
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!hydrated || restoredRef.current || skipRestore) return;
    restoredRef.current = true;
    const saved = useNewIssueDraftStore.getState()[field];
    // Never clobber text the user got in first — the same "don't overwrite
    // live work" rule the store applies to a late file read.
    if (!saved || liveText) return;
    restore({
      text: saved,
      markers: [],
      selection: { start: saved.length, end: saved.length },
    });
  }, [hydrated, skipRestore, field, restore, liveText]);

  const serialized = input.serialize();
  const lastMirroredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    // The first hydrated render also carries the pre-restore input (`""`).
    // Adopt it as the baseline without writing: otherwise the empty string
    // would overwrite the draft, and a crash before the restore's re-render
    // would lose it for good.
    if (lastMirroredRef.current === null) {
      lastMirroredRef.current = serialized;
      return;
    }
    if (lastMirroredRef.current === serialized) return;
    lastMirroredRef.current = serialized;
    persist(serialized);
  }, [hydrated, serialized, persist]);
}

export default function NewIssueModal() {
  const { t } = useTranslation();
  // Quick-create recovery seed (inbox detail → "Edit as advanced form"): the
  // original prompt + agent hint ride the URL and reseed the manual form so
  // the user can finish the issue in the full editor instead of retyping.
  const {
    seedDescription,
    seedAssigneeId,
    parentIssueId,
    parentIssueIdentifier,
    parentProjectId,
  } = useLocalSearchParams<{
    seedDescription?: string;
    seedAssigneeId?: string;
    /** Parent preset by the issue table's row-level "+" (web createSubIssue). */
  } & Partial<SubIssueRouteParams>>();
  const [parentCleared, setParentCleared] = useState(false);
  const parent = parentCleared ? undefined : parentIssueId;
  // The description editor's own state. It cannot live in the draft store the
  // way the chips do — `useMentionInput` owns text, caret and the in-progress
  // `@` query, and the picker routes never touch it — so the store keeps the
  // serialized markdown and the two effects below keep them in step.
  const description = useMentionInput();
  // Agent mode's prompt, the second mention-input instance. Same reasoning as
  // the description: the panel renders `DescriptionField` so a picked file can
  // be uploaded and linked into the prompt (web's agent panel uses the same
  // rich editor as its advanced form). It is owned here rather than inside
  // `QuickCreatePanel` for two reasons — a manual ↔ agent mode switch must not
  // lose either body, and the @ suggestion bar has to be rendered by the
  // screen, outside the scroll view, so it can float above the keyboard.
  const promptInput = useMentionInput();
  // Attribute chips (status / priority / assignee / due date / project) and
  // the text fields all live in `useNewIssueDraftStore`, so the
  // new-issue-picker/* formSheet routes can read and write the same values
  // without a parent-child React relationship. The store persists per
  // workspace, so dismissing the form keeps the draft and reopening restores
  // it — web parity (`multica_issue_draft`, see the store header).
  const mode = useNewIssueDraftStore((s) => s.mode);
  const setMode = useNewIssueDraftStore((s) => s.setMode);
  const title = useNewIssueDraftStore((s) => s.title);
  const setTitle = useNewIssueDraftStore((s) => s.setTitle);
  // Agent mode's prompt lives in its own mention-input instance (see above);
  // the store only holds its serialized form for the reopen-restores-draft
  // behaviour, exactly like `description`.
  const promptSetter = useNewIssueDraftStore((s) => s.setPrompt);
  const status = useNewIssueDraftStore((s) => s.status);
  const priority = useNewIssueDraftStore((s) => s.priority);
  const assignee = useNewIssueDraftStore((s) => s.assignee);
  const setAssignee = useNewIssueDraftStore((s) => s.setAssignee);
  const dueDate = useNewIssueDraftStore((s) => s.dueDate);
  const startDate = useNewIssueDraftStore((s) => s.startDate);
  const labels = useNewIssueDraftStore((s) => s.labels);
  const project = useNewIssueDraftStore((s) => s.project);
  const agentActor = useNewIssueDraftStore((s) => s.agentActor);
  const resetDraft = useNewIssueDraftStore((s) => s.reset);
  const setDraftDescription = useNewIssueDraftStore((s) => s.setDescription);
  const { getName } = useActorLookup();

  // Restore each saved body, then mirror every later edit back into the store
  // (see `useDraftBodySync`). Waits for `hydrated` — until the workspace's
  // file has been read, an empty in-memory draft means "not loaded yet", and
  // acting on it would either restore nothing or write the empty state over
  // the saved file. The description skips the restore on a seeded mount
  // because the seed effect below is then its only writer.
  const hydrated = useNewIssueDraftStore((s) => s.hydrated);
  useDraftBodySync(
    description,
    "description",
    setDraftDescription,
    hydrated,
    !!seedDescription,
  );
  useDraftBodySync(promptInput, "prompt", promptSetter, hydrated, false);

  // Apply the quick-create recovery seed. The restore effect above skips a
  // mount that carries a seed, so the seed is the only writer here and a stale
  // draft can never win over the text the user explicitly asked to carry over.
  // The assignee hint is a candidate, not a lock — still editable in the form.
  // `description` is rebuilt every render; its setText is a stable setter, so
  // alias it here to keep the effect dependency stable.
  const descriptionTextSetter = description.setText;
  useEffect(() => {
    if (!seedDescription) return;
    descriptionTextSetter(String(seedDescription));
    if (seedAssigneeId) setAssignee({ type: "agent", id: String(seedAssigneeId) });
  }, [seedDescription, seedAssigneeId, descriptionTextSetter, setAssignee]);

  // A sub-issue inherits its parent's project (web `createSubIssue` passes
  // `project_id: issue.project_id`). One detail fetch for the one id the
  // preset names — not a workspace-wide project list, which the form would
  // otherwise page in on every open — and the effect is keyed on the id and
  // the fetched project only, so a later refetch can never re-apply the
  // parent's project over a project the user has since picked.
  const projectSetter = useNewIssueDraftStore((s) => s.setProject);
  const parentProjectIdValue = parentProjectId ? String(parentProjectId) : null;
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: parentProject } = useQuery(
    projectDetailOptions(wsId, parentProjectIdValue ?? ""),
  );
  useEffect(() => {
    if (!parentProjectIdValue || !parentProject) return;
    projectSetter(parentProject);
  }, [parentProjectIdValue, parentProject, projectSetter]);

  const createIssue = useCreateIssue();
  const quickCreate = useQuickCreateIssue();
  // Loading state follows the ACTIVE mode — the header button must show a
  // spinner for whichever submit is in flight.
  const isSubmitting =
    mode === "manual" ? createIssue.isPending : quickCreate.isPending;

  // Attachment ids freshly uploaded from either body's toolbar. Carried into
  // the create payload so the server binds them to the issue. One list for
  // both modes, mirroring web's single shared upload pool
  // (`packages/views/modals/use-issue-create-uploads.ts`): the user uploaded
  // the file in THIS modal, and a mode switch must not throw it away.
  const [uploadedAttachmentIds, setUploadedAttachmentIds] = useState<string[]>(
    [],
  );
  const collectAttachment = useCallback((id: string) => {
    setUploadedAttachmentIds((prev) => addUploadedAttachmentId(prev, id));
  }, []);
  // In-flight upload on either body's toolbar — hold submit until the picked
  // file lands, else its attachment id never reaches the create payload.
  const [uploadsPending, setUploadsPending] = useState(false);

  const canSubmit =
    mode === "manual"
      ? !isSubmitting &&
        !uploadsPending &&
        title.trim().length > 0
      : canSubmitQuickCreate({
          prompt: promptInput.text,
          hasActor: agentActor != null,
          submitting: isSubmitting,
          uploadsPending,
        });

  const submitAgentMode = useCallback(async (): Promise<boolean> => {
    // Serialize rather than read the raw body: the prompt can carry @mentions
    // now that it is a real editor, and the agent should receive the canonical
    // `[@name](mention://…)` markdown, not the in-editor sentinel form.
    const trimmedPrompt = promptInput.serialize().trim();
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
        ...(parent ? { parent_issue_id: parent } : {}),
        ...attachmentIdsPayload(uploadedAttachmentIds),
      });
      // The issue exists, so the draft is spent — clear it before leaving, or
      // the next open would restore the issue the user just filed. Web runs a
      // fuller "untouched draft" check here because its dialog can stay open
      // across a submit and accept more typing; this form always closes, so
      // clearing unconditionally is the same outcome.
      resetDraft();
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
  }, [promptInput, agentActor, priority, dueDate, project, parent, uploadedAttachmentIds, quickCreate, getName, t, resetDraft]);

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
        ...(parent ? { parent_issue_id: parent } : {}),
        ...(uploadedAttachmentIds.length > 0
          ? { attachment_ids: uploadedAttachmentIds }
          : {}),
      });
      // Spent draft — see submitAgentMode. Cleared before `router.back()` so
      // the unmount never races the write.
      resetDraft();
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
    parent,
    uploadedAttachmentIds,
    createIssue,
    resetDraft,
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
                      "text-body font-medium",
                      active ? "text-background" : "text-muted-foreground",
                    )}
                  >
                    {t(m.labelKey)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Sub-issue preset (issue table's row-level "+"). Web renders the
              same chip in its agent panel (`agent-sub-issue-chip`); mobile
              shows it once, above the mode-specific body, because the parent
              applies to whichever mode submits. */}
          {parent ? (
            <View className="flex-row items-center gap-1.5 self-start rounded-full bg-secondary/60 px-2.5 py-1">
              <Ionicons
                name="git-branch-outline"
                size={13}
                color={MOBILE_PLACEHOLDER_COLOR}
              />
              <Text className="text-caption text-muted-foreground" numberOfLines={1}>
                {t("newIssue.parentChip", {
                  identifier: parentIssueIdentifier
                    ? String(parentIssueIdentifier)
                    : "",
                })}
              </Text>
              <Pressable
                onPress={() => setParentCleared(true)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t("newIssue.parentChipClear")}
              >
                <Ionicons
                  name="close"
                  size={13}
                  color={MOBILE_PLACEHOLDER_COLOR}
                />
              </Pressable>
            </View>
          ) : null}

          {mode === "manual" ? (
            <>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder={t("newIssue.titlePlaceholder")}
                placeholderTextColor={MOBILE_PLACEHOLDER_COLOR}
                className="text-display-sm font-semibold text-foreground py-2"
                autoFocus
                returnKeyType="next"
                editable={!isSubmitting}
              />
              <DescriptionField
                description={description}
                disabled={isSubmitting}
                onAttachmentUploaded={collectAttachment}
                onUploadingChange={setUploadsPending}
              />
              <CreateFormAttributeRow mode="manual" />
              {/* Pre-trigger caption — a passive line saying whether saving
                  will start a run, asked of the backend's own predicate
                  (web CreateRunHint). Renders nothing until it has an
                  answer, so it never flashes the wrong verdict. */}
              <CreateRunHint
                assigneeType={
                  assignee?.type === "agent" || assignee?.type === "squad"
                    ? assignee.type
                    : null
                }
                assigneeId={assignee?.id ?? null}
                status={status}
              />
            </>
          ) : (
            <QuickCreatePanel
              promptInput={promptInput}
              onAttachmentUploaded={collectAttachment}
              onUploadingChange={setUploadsPending}
              disabled={isSubmitting}
            />
          )}
        </ScrollView>

        {/* Mention suggestions float above the keyboard in BOTH modes — the
            agent prompt carries the same toolbar and `@` support as the manual
            description. Self-hides via `if (!visible) return null` so it
            doesn't take space at rest. */}
        <MentionSuggestionBar
          {...(mode === "manual"
            ? description.suggestionBar
            : promptInput.suggestionBar)}
        />
      </KeyboardAvoidingView>
    </>
  );
}