/**
 * Shared autopilot create/edit form body, mirroring web
 * `packages/views/autopilots/components/autopilot-dialog.tsx` field set:
 * title / description / assignee (agent + squad) / execution mode / project /
 * subscribers. The trigger section is create-only and injected by the caller
 * via `children` — editing an existing autopilot keeps its triggers (managed
 * on the detail page), never re-creates them.
 *
 * Project and subscribers render only while `execution_mode ===
 * "create_issue"` (web dialog parity): a run_only autopilot creates no issue,
 * so neither binding is meaningful there. State survives a mode toggle so
 * switching back restores the choices.
 *
 * Submit collects neutral `AutopilotFormValues` (lib/autopilot-form-values.ts)
 * and hands them to the caller, which serializes to the create/PATCH request
 * shapes — those pure serializers are unit-tested separately.
 */
import { forwardRef, useCallback, useImperativeHandle, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import type {
  AutopilotAssigneeType,
  AutopilotExecutionMode,
} from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { AutosizeTextArea } from "@/components/ui/autosize-textarea";
import { TextField } from "@/components/ui/text-field";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { MultiSelectSheet } from "@/components/agent/multi-select-sheet";
import { AssigneePickerSheet } from "@/components/autopilot/assignee-picker-sheet";
import { ProjectPickerSheet } from "@/components/autopilot/project-picker-sheet";
import { agentListOptions } from "@/data/queries/agents";
import { memberListOptions } from "@/data/queries/members";
import { projectListOptions } from "@/data/queries/projects";
import { squadListOptions } from "@/data/queries/squads";
import { useWorkspaceStore } from "@/data/workspace-store";
import { keyboardBehavior } from "@/lib/keyboard";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import type { AutopilotFormValues } from "@/lib/autopilot-form-values";

export interface AutopilotFormInitial {
  title: string;
  description: string;
  projectId: string | null;
  assigneeType: AutopilotAssigneeType;
  assigneeId: string;
  executionMode: AutopilotExecutionMode;
  subscriberUserIds: string[];
}

interface Props {
  mode: "create" | "edit";
  initial: AutopilotFormInitial;
  isSubmitting: boolean;
  /** Create-only trigger section, rendered after the core fields. */
  children?: React.ReactNode;
  onSubmit: (values: AutopilotFormValues) => Promise<void> | void;
}

export interface AutopilotFormHandle {
  /** Runs the same validation + onSubmit path the page's header CTA drives. */
  submit: () => void;
}

const MODE_OPTIONS: { value: AutopilotExecutionMode; labelKey: string }[] = [
  { value: "create_issue", labelKey: "autopilots.executionMode.createIssue" },
  { value: "run_only", labelKey: "autopilots.executionMode.runOnly" },
];

export const AutopilotForm = forwardRef<AutopilotFormHandle, Props>(
  function AutopilotForm(
    { mode, initial, isSubmitting, children, onSubmit }: Props,
    ref,
  ) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [projectId, setProjectId] = useState<string | null>(initial.projectId);
  const [assigneeType, setAssigneeType] =
    useState<AutopilotAssigneeType>(initial.assigneeType);
  const [assigneeId, setAssigneeId] = useState<string>(initial.assigneeId);
  const [executionMode, setExecutionMode] =
    useState<AutopilotExecutionMode>(initial.executionMode);
  const [subscriberIds, setSubscriberIds] = useState<Set<string>>(
    new Set(initial.subscriberUserIds),
  );
  const [assigneePickerOpen, setAssigneePickerOpen] = useState(false);
  const [subscriberPickerOpen, setSubscriberPickerOpen] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const { data: squads = [] } = useQuery(squadListOptions(wsId));
  const { data: projects = [] } = useQuery(projectListOptions(wsId));

  const createIssueMode = executionMode === "create_issue";

  const nameMissing = title.trim().length === 0;
  const assigneeMissing = assigneeId.length === 0;

  const selectedAssignee =
    assigneeType === "squad"
      ? squads.find((s) => s.id === assigneeId) ?? null
      : agents.find((a) => a.id === assigneeId) ?? null;
  const selectedSubscribers = members.filter((m) =>
    subscriberIds.has(m.user_id),
  );
  const selectedProject = projects.find((p) => p.id === projectId) ?? null;

  const handleSubmit = useCallback(() => {
    if (isSubmitting) return;
    if (nameMissing || assigneeMissing) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    void Promise.resolve(
      onSubmit({
        title,
        description,
        projectId,
        assigneeType,
        assigneeId,
        executionMode,
        subscriberUserIds: Array.from(subscriberIds),
      }),
    );
  }, [
    isSubmitting,
    nameMissing,
    assigneeMissing,
    onSubmit,
    title,
    description,
    projectId,
    assigneeType,
    assigneeId,
    executionMode,
    subscriberIds,
  ]);

  useImperativeHandle(
    ref,
    () => ({
      submit: handleSubmit,
    }),
    [handleSubmit],
  );

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={keyboardBehavior}
    >
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pt-4 pb-10 gap-5"
        keyboardShouldPersistTaps="handled"
      >
        {/* Name */}
        <View className="gap-1.5">
          <FieldLabel icon="pricetag-outline" text={t("autopilots.new.name")} />
          <TextField
            value={title}
            onChangeText={setTitle}
            placeholder={t("autopilots.new.namePlaceholder")}
            invalid={showErrors && nameMissing}
            editable={!isSubmitting}
            autoFocus={mode === "create"}
          />
          {showErrors && nameMissing ? (
            <FieldError text={t("autopilots.new.nameRequired")} />
          ) : null}
        </View>

        {/* Description */}
        <View className="gap-1.5">
          <FieldLabel
            icon="document-text-outline"
            text={t("autopilots.new.description")}
          />
          <AutosizeTextArea
            value={description}
            onChangeText={setDescription}
            placeholder={t("autopilots.new.descriptionPlaceholder")}
            editable={!isSubmitting}
            className="border border-border rounded-md px-3 py-2 min-h-[72px]"
          />
        </View>

        {/* Assignee — agent or squad, required. */}
        <View className="gap-1.5">
          <FieldLabel icon="person-outline" text={t("autopilots.new.assignee")} />
          {agents.length === 0 && squads.length === 0 ? (
            <View className="rounded-md border border-border px-3 py-3">
              <Text className="text-sm text-muted-foreground">
                {t("autopilots.new.agentsEmpty")}
              </Text>
            </View>
          ) : (
            <>
              <Pressable
                onPress={() => setAssigneePickerOpen(true)}
                disabled={isSubmitting}
                accessibilityLabel={t("autopilots.new.selectAssignee")}
                className={cn(
                  "flex-row items-center gap-2.5 rounded-md border px-3 py-2.5",
                  showErrors && assigneeMissing
                    ? "border-destructive/60 bg-destructive/10"
                    : "border-border bg-secondary/50",
                )}
              >
                {selectedAssignee ? (
                  <>
                    <ActorAvatar
                      type={assigneeType === "squad" ? "squad" : "agent"}
                      id={selectedAssignee.id}
                      size={28}
                    />
                    <View className="flex-1">
                      <Text className="text-sm text-foreground" numberOfLines={1}>
                        {selectedAssignee.name}
                      </Text>
                      {selectedAssignee.description?.trim() ? (
                        <Text
                          className="text-[11px] text-muted-foreground"
                          numberOfLines={1}
                        >
                          {selectedAssignee.description}
                        </Text>
                      ) : null}
                    </View>
                    <Ionicons name="chevron-down" size={16} color={muted} />
                  </>
                ) : (
                  <>
                    <Text
                      className={cn(
                        "flex-1 text-sm",
                        showErrors && assigneeMissing
                          ? "text-destructive"
                          : "text-muted-foreground",
                      )}
                    >
                      {t("autopilots.new.selectAssignee")}
                    </Text>
                    <Ionicons name="chevron-down" size={16} color={muted} />
                  </>
                )}
              </Pressable>
              {showErrors && assigneeMissing ? (
                <FieldError text={t("autopilots.new.agentRequired")} />
              ) : null}
              <AssigneePickerSheet
                visible={assigneePickerOpen}
                agents={agents.filter((a) => !a.archived_at)}
                squads={squads.filter((s) => !s.archived_at)}
                selection={
                  assigneeId ? { type: assigneeType, id: assigneeId } : null
                }
                onPick={(next) => {
                  setAssigneeType(next.type);
                  setAssigneeId(next.id);
                }}
                onClose={() => setAssigneePickerOpen(false)}
              />
            </>
          )}
        </View>

        {/* Execution mode */}
        <View className="gap-1.5">
          <FieldLabel icon="git-branch-outline" text={t("autopilots.new.mode")} />
          <ModeSelector
            value={executionMode}
            onChange={setExecutionMode}
            disabled={isSubmitting}
            t={t}
          />
        </View>

        {/* Project — meaningful only when the run creates an issue (web dialog
            parity). State survives toggling to run_only and back. */}
        {createIssueMode ? (
          <View className="gap-1.5">
            <FieldLabel icon="folder-outline" text={t("autopilots.new.project")} />
            <Pressable
              onPress={() => setProjectPickerOpen(true)}
              disabled={isSubmitting}
              accessibilityLabel={t("autopilots.new.selectProject")}
              className="flex-row items-center gap-2.5 rounded-md border border-border bg-secondary/50 px-3 py-2.5"
            >
              {selectedProject ? (
                <>
                  <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
                    {selectedProject.title}
                  </Text>
                  <Ionicons name="chevron-down" size={16} color={muted} />
                </>
              ) : (
                <>
                  <Text className="flex-1 text-sm text-muted-foreground">
                    {t("autopilots.new.noProject")}
                  </Text>
                  <Ionicons name="chevron-down" size={16} color={muted} />
                </>
              )}
            </Pressable>
            <ProjectPickerSheet
              visible={projectPickerOpen}
              projects={projects}
              selectedProjectId={projectId}
              onPick={setProjectId}
              onClose={() => setProjectPickerOpen(false)}
            />
          </View>
        ) : null}

        {/* Subscribers — auto-subscribed to every issue this autopilot creates. */}
        {createIssueMode ? (
          <View className="gap-1.5">
            <FieldLabel
              icon="people-outline"
              text={t("autopilots.subscribers.sectionLabel")}
            />
            {selectedSubscribers.length > 0 ? (
              <View className="flex-row flex-wrap gap-1.5">
                {selectedSubscribers.map((m) => (
                  <View
                    key={m.user_id}
                    className="flex-row items-center gap-1 rounded-full border border-border bg-secondary/60 px-2 py-1"
                  >
                    <ActorAvatar type="member" id={m.user_id} size={18} />
                    <Text className="text-xs text-foreground">{m.name}</Text>
                    <Pressable
                      onPress={() => {
                        const next = new Set(subscriberIds);
                        next.delete(m.user_id);
                        setSubscriberIds(next);
                      }}
                      hitSlop={8}
                      accessibilityLabel={t("autopilots.subscribers.remove")}
                      className="p-0.5"
                    >
                      <Ionicons
                        name="close"
                        size={12}
                        color={THEME[colorScheme].mutedForeground}
                      />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}
            <Pressable
              onPress={() => setSubscriberPickerOpen(true)}
              disabled={isSubmitting}
              accessibilityLabel={t("autopilots.subscribers.add")}
              className="self-start flex-row items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1.5"
            >
              <Ionicons
                name="add"
                size={14}
                color={THEME[colorScheme].mutedForeground}
              />
              <Text className="text-xs text-muted-foreground">
                {t("autopilots.subscribers.add")}
              </Text>
            </Pressable>
            <Text className="text-[11px] leading-tight text-muted-foreground/80">
              {t("autopilots.subscribers.hint")}
            </Text>
            <MultiSelectSheet
              visible={subscriberPickerOpen}
              title={t("autopilots.subscribers.sectionLabel")}
              rows={members.map((m) => ({ key: m.user_id, title: m.name }))}
              selectedKeys={subscriberIds}
              emptyText={t("autopilots.subscribers.empty")}
              leading={(row) => (
                <ActorAvatar type="member" id={row.key} size={32} />
              )}
              onToggle={(id) => {
                const next = new Set(subscriberIds);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                setSubscriberIds(next);
              }}
              onClose={() => setSubscriberPickerOpen(false)}
            />
          </View>
        ) : null}

        {/* Create-only trigger section (schedule / webhook). */}
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
  },
);

function FieldLabel({
  icon,
  text,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  text: string;
}) {
  const { colorScheme } = useColorScheme();
  return (
    <View className="flex-row items-center gap-1.5">
      <Ionicons
        name={icon}
        size={13}
        color={THEME[colorScheme].mutedForeground}
      />
      <Text className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {text}
      </Text>
    </View>
  );
}

function FieldError({ text }: { text: string }) {
  return <Text className="text-xs text-destructive">{text}</Text>;
}

function ModeSelector({
  value,
  onChange,
  disabled,
  t,
}: {
  value: AutopilotExecutionMode;
  onChange: (mode: AutopilotExecutionMode) => void;
  disabled: boolean;
  t: (id: string) => string;
}) {
  return (
    <RadioGroup
      value={value}
      onValueChange={(v) => onChange(v as AutopilotExecutionMode)}
    >
      {MODE_OPTIONS.map((opt) => (
        <Pressable
          key={opt.value}
          onPress={() => onChange(opt.value)}
          disabled={disabled}
          className="flex-row items-center gap-2.5 px-1 py-0.5"
        >
          <RadioGroupItem
            value={opt.value}
            aria-label={t(opt.labelKey)}
            disabled={disabled}
          />
          <Text className="text-sm text-foreground">{t(opt.labelKey)}</Text>
        </Pressable>
      ))}
    </RadioGroup>
  );
}