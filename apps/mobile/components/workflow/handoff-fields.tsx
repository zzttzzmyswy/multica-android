/**
 * The handoff form's fields, as a reusable block
 * (`packages/views/workflows/handoff-form.tsx` → `HandoffFields`).
 *
 * ## Why this was extracted rather than copied
 *
 * Upstream has exactly one `HandoffFields`, rendered in two places: the
 * column-handoff popover on a board, and the workflow editor's step detail
 * (`workflow-editor-page.tsx:912`). Iteration 293 built the first consumer here
 * as a self-contained sheet. Iteration 294 adds the second — the editor — and a
 * second hand-written copy of 「交给谁 / 说明 / 完成时移到」 is exactly the fork
 * `apps/mobile/CLAUDE.md` calls out (Principle 1: extend the existing pattern,
 * never a second variant).
 *
 * So the fields moved here verbatim and the sheet now renders them. Behaviour
 * is unchanged at both call sites; the only difference between them is the
 * STATUS LIST the next/back controls offer, which is a prop:
 *
 *   - the sheet offers the workflow's SAVED columns
 *     (`handoffTargetStatusKeys`), because it saves one column on its own;
 *   - the editor offers the DRAFT's columns (`listedStatusKeys`), because its
 *     save writes them all at once.
 *
 * ## What stays in the sheet, and why
 *
 * The modal shell, the 「这次改动应用到哪里」 scope question, and the brief
 * preview all belong to *saving one column* — a draft-backed editor has no
 * scope to ask about and renders its own preview link only for a column the
 * server already knows. Keeping them out of here is what lets this component
 * stay presentational and usable from both.
 */
import { useState } from "react";
import { Modal, Pressable, ScrollView, TextInput, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { IssueWorkflowStep } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { StatusIcon } from "@/components/ui/status-icon";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { agentListOptions } from "@/data/queries/agents";
import { memberListOptions } from "@/data/queries/members";
import { squadListOptions } from "@/data/queries/squads";
import { useIssueStatuses } from "@/data/queries/issue-statuses";
import { useActorLookup } from "@/data/use-actor-name";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useStatusLabel } from "@/lib/status-options";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { handoffModeOf, type HandoffDraft, type HandoffMode } from "@/lib/workflow-handoff-edit";

export interface HandoffFieldsProps {
  /** The column's current draft handoff. */
  draft: HandoffDraft;
  canEdit: boolean;
  onPatch: (patch: Partial<HandoffDraft>) => void;
  /** Statuses the 「完成时移到 / 退回时移回」 controls may name. */
  targetKeys: readonly string[];
  /** The label the 「完成时移到」 control shows when nothing is set. */
  defaultNextLabel: string;
  /** Opens the brief preview. Absent for a column the server does not know
   *  yet — there is no saved step to render a brief from. */
  onPreview?: () => void;
}

/**
 * The three 「交给」 modes, who they name, what the handler is told, and where
 * the issue goes next.
 *
 * The three modes are a radio LIST rather than web's bordered card per mode:
 * web's cards hold a nested picker on a 26rem popover, and at phone width that
 * doubles the scroll distance, so the picker opens its own small sheet instead
 * — same two-step choice, one level at a time.
 */
export function HandoffFields({
  draft,
  canEdit,
  onPatch,
  targetKeys,
  defaultNextLabel,
  onPreview,
}: HandoffFieldsProps) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const [pickerOpen, setPickerOpen] = useState<HandoffMode | null>(null);
  const mode = handoffModeOf(draft.handler);

  return (
    <>
      <View
        className="gap-1"
        accessibilityRole="radiogroup"
        accessibilityLabel={t("workflow.handoff.to")}
      >
        {(["none", "agent", "member"] as const).map((option) => (
          <ModeRow
            key={option}
            mode={option}
            selected={option === mode}
            disabled={!canEdit}
            onPress={() => {
              if (!canEdit || option === mode) return;
              onPatch({
                handler: option === "none" ? { type: "none" } : { type: option },
              });
            }}
          />
        ))}
      </View>

      {/* ── Who, for the two modes that name someone ────────────────────── */}
      {(mode === "agent" || mode === "member") && (
        <Pressable
          onPress={() => canEdit && setPickerOpen(mode)}
          disabled={!canEdit}
          accessibilityRole="button"
          accessibilityLabel={
            mode === "agent" ? t("workflow.handoff.pick_agent") : t("workflow.handoff.pick_member")
          }
          className={cn(
            "flex-row items-center gap-2 rounded-md border border-input bg-background px-3 py-2.5",
            canEdit && "active:bg-secondary",
          )}
        >
          <HandlerLabel handler={draft.handler} mode={mode} />
          <Ionicons name="chevron-down" size={16} color={theme.mutedForeground} />
        </Pressable>
      )}
      {draft.handler.type === "project_lead" ? (
        <Text className="text-caption text-muted-foreground">
          {t("workflow.handoff.project_lead_hint")}
        </Text>
      ) : null}

      {/* ── Instructions + next/back: agent and squad only ───────────────── */}
      {mode === "agent" ? (
        <>
          <Field
            label={t("workflow.handoff.instructions")}
            hint={t("workflow.handoff.instructions_hint")}
          >
            <InstructionInput
              value={draft.instructions}
              editable={canEdit}
              placeholder={t("workflow.handoff.instructions_placeholder")}
              onChange={(instructions) => onPatch({ instructions })}
            />
          </Field>

          <View className="gap-2">
            <StatusTargetRow
              label={t("workflow.handoff.next")}
              value={draft.next_status_key}
              unsetLabel={
                defaultNextLabel
                  ? t("workflow.handoff.nextDefault", { status: defaultNextLabel })
                  : t("workflow.handoff.noneOption")
              }
              options={targetKeys}
              disabled={!canEdit}
              onChange={(key) => onPatch({ next_status_key: key })}
            />
            <StatusTargetRow
              label={t("workflow.handoff.back")}
              value={draft.back_status_key}
              unsetLabel={t("workflow.handoff.noneOption")}
              options={targetKeys}
              disabled={!canEdit}
              onChange={(key) => onPatch({ back_status_key: key })}
            />
            {onPreview ? (
              <Text className="text-caption text-muted-foreground">
                {t("workflow.handoff.nextHint")}{" "}
                <Text className="text-brand" onPress={onPreview} accessibilityRole="link">
                  {t("workflow.handoff.previewBrief")}
                </Text>
              </Text>
            ) : (
              <Text className="text-caption text-muted-foreground">
                {t("workflow.handoff.nextHint")}
              </Text>
            )}
          </View>
        </>
      ) : null}

      <HandlerPickerSheet
        mode={pickerOpen}
        value={draft.handler}
        onClose={() => setPickerOpen(null)}
        onPick={(handler) => {
          onPatch({ handler });
          setPickerOpen(null);
        }}
      />
    </>
  );
}

/** One 「交给」 mode row. */
function ModeRow({
  mode,
  selected,
  disabled,
  onPress,
}: {
  mode: HandoffMode;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      className={cn(
        "flex-row items-start gap-2.5 rounded-lg border px-3 py-2.5",
        selected ? "border-brand/50 bg-brand/5" : "border-border",
      )}
    >
      <View
        className={cn(
          "mt-0.5 size-4 items-center justify-center rounded-full border",
          selected ? "border-brand" : "border-input",
        )}
      >
        {selected ? <View className="size-2 rounded-full bg-brand" /> : null}
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-body font-medium text-foreground">
          {t(`workflow.handoff.mode_${mode}`)}
        </Text>
        <Text className="text-caption text-muted-foreground">
          {t(`workflow.handoff.mode_${mode}_hint`)}
        </Text>
      </View>
    </Pressable>
  );
}

/** The chosen handler's name and avatar, or the placeholder. */
function HandlerLabel({
  handler,
  mode,
}: {
  handler: IssueWorkflowStep["handler"];
  mode: HandoffMode;
}) {
  const { t } = useTranslation();
  const { getName } = useActorLookup();
  const actor =
    (handler.type === "agent" || handler.type === "squad" || handler.type === "member") && handler.id
      ? { type: handler.type, id: handler.id }
      : null;
  if (handler.type === "project_lead") {
    return (
      <Text className="flex-1 text-body text-foreground" numberOfLines={1}>
        {t("workflow.handoff.project_lead_label")}
      </Text>
    );
  }
  if (!actor) {
    return (
      <Text className="flex-1 text-body text-muted-foreground" numberOfLines={1}>
        {mode === "agent" ? t("workflow.handoff.pick_agent") : t("workflow.handoff.pick_member")}
      </Text>
    );
  }
  return (
    <>
      <ActorAvatar type={actor.type} id={actor.id} size={22} />
      <Text className="min-w-0 flex-1 text-body text-foreground" numberOfLines={1}>
        {getName(actor.type, actor.id)}
      </Text>
    </>
  );
}

/** A labelled block with an optional hint line. */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View className="gap-1.5">
      <Text className="text-caption font-medium text-foreground">{label}</Text>
      {children}
      {hint ? <Text className="text-caption text-muted-foreground">{hint}</Text> : null}
    </View>
  );
}

/** The instructions textarea, capped the way the server caps it. */
function InstructionInput({
  value,
  editable,
  placeholder,
  onChange,
}: {
  value: string;
  editable: boolean;
  placeholder: string;
  onChange: (next: string) => void;
}) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      editable={editable}
      placeholder={placeholder}
      placeholderTextColor={theme.mutedForeground}
      multiline
      // The server stores 8000; matching it here means the user is stopped by
      // the field rather than by a rejected save.
      maxLength={8000}
      textAlignVertical="top"
      className="min-h-24 rounded-md border border-input bg-background px-3 py-2 text-body text-foreground"
    />
  );
}

/**
 * One 「完成时移到 / 被退回时移回」 selector.
 *
 * A row that opens a small list rather than an inline `<Select>`: RN has no
 * popover, and a wrapped option list inside a scrolling sheet scrolls badly.
 */
function StatusTargetRow({
  label,
  value,
  unsetLabel,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string | undefined;
  unsetLabel: string;
  options: readonly string[];
  disabled: boolean;
  onChange: (next: string | undefined) => void;
}) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const statusLabel = useStatusLabel(wsId);
  const { entryOf } = useIssueStatuses(wsId);
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const [open, setOpen] = useState(false);
  const entry = value ? entryOf(value) : undefined;

  return (
    <View className="gap-1">
      <Text className="text-caption font-medium text-foreground">{label}</Text>
      <Pressable
        onPress={() => !disabled && setOpen(true)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value ? statusLabel(value) : unsetLabel}`}
        className={cn(
          "flex-row items-center gap-2 rounded-md border border-input bg-background px-3 py-2",
          !disabled && "active:bg-secondary",
        )}
      >
        {value ? (
          <>
            <StatusIcon
              status={value}
              category={entry?.category}
              color={entry && !entry.is_system ? (entry.color ?? undefined) : undefined}
              size={14}
            />
            <Text className="min-w-0 flex-1 text-body text-foreground" numberOfLines={1}>
              {statusLabel(value)}
            </Text>
          </>
        ) : (
          <Text className="min-w-0 flex-1 text-body text-muted-foreground" numberOfLines={1}>
            {unsetLabel}
          </Text>
        )}
        <Ionicons name="chevron-down" size={16} color={theme.mutedForeground} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1 bg-black/40" onPress={() => setOpen(false)}>
          <View className="flex-1 justify-end">
            <Pressable onPress={() => {}} className="max-h-[60%] rounded-t-2xl bg-popover">
              <View className="border-b border-border px-4 py-3">
                <Text className="text-title-sm font-semibold text-foreground">{label}</Text>
              </View>
              <ScrollView contentContainerClassName="pb-4">
                <Pressable
                  onPress={() => {
                    onChange(undefined);
                    setOpen(false);
                  }}
                  accessibilityRole="button"
                  className="flex-row items-center gap-2 px-4 py-3 active:bg-secondary"
                >
                  <Text className="min-w-0 flex-1 text-body text-muted-foreground" numberOfLines={1}>
                    {unsetLabel}
                  </Text>
                  {!value ? <Ionicons name="checkmark" size={18} color={theme.primary} /> : null}
                </Pressable>
                {options.map((key) => (
                  <Pressable
                    key={key}
                    onPress={() => {
                      onChange(key);
                      setOpen(false);
                    }}
                    accessibilityRole="button"
                    className="flex-row items-center gap-2 px-4 py-3 active:bg-secondary"
                  >
                    <StatusIcon
                      status={key}
                      category={entryOf(key)?.category}
                      color={entryOf(key) && !entryOf(key)!.is_system ? (entryOf(key)!.color ?? undefined) : undefined}
                      size={14}
                    />
                    <Text className="min-w-0 flex-1 text-body text-foreground" numberOfLines={1}>
                      {statusLabel(key)}
                    </Text>
                    {value === key ? (
                      <Ionicons name="checkmark" size={18} color={theme.primary} />
                    ) : null}
                  </Pressable>
                ))}
              </ScrollView>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

/**
 * The agent / squad / member picker — web's `HandlerPicker`
 * (`handoff-form.tsx:381`), as a phone sheet.
 *
 * Reads the same three directories the assignee picker does, and keeps web's
 * two structural rules: the agent mode lists agents THEN squads (a squad is
 * dispatched by its leader, so it belongs with the agents), and the member mode
 * offers 「项目负责人」 FIRST, before any named member, because it is the
 * option that needs no directory read.
 */
function HandlerPickerSheet({
  mode,
  value,
  onClose,
  onPick,
}: {
  mode: HandoffMode | null;
  value: IssueWorkflowStep["handler"];
  onClose: () => void;
  onPick: (handler: IssueWorkflowStep["handler"]) => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: agents } = useQuery({ ...agentListOptions(wsId), enabled: mode === "agent" });
  const { data: squads } = useQuery({ ...squadListOptions(wsId), enabled: mode === "agent" });
  const { data: members } = useQuery({ ...memberListOptions(wsId), enabled: mode === "member" });

  if (!mode) return null;
  const is = (type: string, id?: string) =>
    value.type === type && (id === undefined || value.id === id);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40" onPress={onClose}>
        <View className="flex-1 justify-end">
          <Pressable onPress={() => {}} className="max-h-[70%] rounded-t-2xl bg-popover">
            <View className="border-b border-border px-4 py-3">
              <Text className="text-title-sm font-semibold text-foreground">
                {mode === "agent" ? t("workflow.handoff.pick_agent") : t("workflow.handoff.pick_member")}
              </Text>
            </View>
            <ScrollView contentContainerClassName="pb-4">
              {mode === "member" ? (
                <Pressable
                  onPress={() => onPick({ type: "project_lead" })}
                  accessibilityRole="button"
                  className="flex-row items-center gap-2 px-4 py-3 active:bg-secondary"
                >
                  <Text className="min-w-0 flex-1 text-body text-foreground">
                    {t("workflow.handoff.project_lead_label")}
                  </Text>
                  {is("project_lead") ? (
                    <Ionicons name="checkmark" size={18} color={theme.primary} />
                  ) : null}
                </Pressable>
              ) : null}

              {mode === "agent"
                ? (agents ?? [])
                    .filter((a) => !a.archived_at)
                    .map((a) => (
                      <Pressable
                        key={a.id}
                        onPress={() => onPick({ type: "agent", id: a.id })}
                        accessibilityRole="button"
                        className="flex-row items-center gap-2 px-4 py-3 active:bg-secondary"
                      >
                        <ActorAvatar type="agent" id={a.id} size={24} />
                        <Text className="min-w-0 flex-1 text-body text-foreground" numberOfLines={1}>
                          {a.name}
                        </Text>
                        {is("agent", a.id) ? (
                          <Ionicons name="checkmark" size={18} color={theme.primary} />
                        ) : null}
                      </Pressable>
                    ))
                : null}

              {mode === "agent"
                ? (squads ?? [])
                    .filter((s) => !s.archived_at)
                    .map((s) => (
                      <Pressable
                        key={s.id}
                        onPress={() => onPick({ type: "squad", id: s.id })}
                        accessibilityRole="button"
                        className="flex-row items-center gap-2 px-4 py-3 active:bg-secondary"
                      >
                        <ActorAvatar type="squad" id={s.id} size={24} />
                        <Text className="min-w-0 flex-1 text-body text-foreground" numberOfLines={1}>
                          {s.name}
                        </Text>
                        {is("squad", s.id) ? (
                          <Ionicons name="checkmark" size={18} color={theme.primary} />
                        ) : null}
                      </Pressable>
                    ))
                : null}

              {mode === "member"
                ? (members ?? []).map((m) => (
                    <Pressable
                      key={m.user_id}
                      onPress={() => onPick({ type: "member", id: m.user_id })}
                      accessibilityRole="button"
                      className="flex-row items-center gap-2 px-4 py-3 active:bg-secondary"
                    >
                      <ActorAvatar type="member" id={m.user_id} size={24} />
                      <Text className="min-w-0 flex-1 text-body text-foreground" numberOfLines={1}>
                        {m.name}
                      </Text>
                      {is("member", m.user_id) ? (
                        <Ionicons name="checkmark" size={18} color={theme.primary} />
                      ) : null}
                    </Pressable>
                  ))
                : null}
            </ScrollView>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
