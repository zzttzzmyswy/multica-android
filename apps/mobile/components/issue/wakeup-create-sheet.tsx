/**
 * "New wakeup" — the create form for an issue's wakeup rules (MYS-2040).
 *
 * Why this exists: MYS-2023 put the rules ON the phone (read) and MYS-2031 made
 * them actionable (enable / disable / wake now / edit prompt / delete). Both
 * rounds left the create surface at zero — `git grep -in createIssueWakeup
 * apps/mobile` was 0 lines — so a phone user could stop a rule and could not
 * start one. This is the last piece of the wakeup subsystem on mobile.
 *
 * Mirrors web's `packages/views/issues/components/wakeup-create.tsx` (1,039
 * lines: `WakeupCreate` popover + `WakeupCreateForm` + nine choice sub-controls).
 * Every DECISION lives in `lib/wakeup-draft.ts`, this round's must-agree point
 * with web — same draft, same request body, or the same error code. What is left
 * here is layout and the pickers.
 *
 * Divergences from web, each deliberate:
 *
 *   - **A full-height sheet, not a popover.** Web hangs a 420px popover off a
 *     `+` in the section header. A phone has no hover, and a nine-way condition
 *     form plus its per-condition params does not fit in a popover-sized
 *     surface — so this is `PickerSheet` (the app's existing drill-in
 *     container), scrolling, with the submit row pinned at the bottom.
 *   - **Sub-pickers are the app's existing sheets.** Web's `ConditionMenu` is a
 *     `DropdownMenu` with group headings; the phone's equivalent is a
 *     `PickerSheet` over a list, and `Pill` is that list's trigger. Same
 *     information, one interaction the platform actually has. Where the app
 *     already owns a body for the value (assignee, status, label, property,
 *     issue) that body is reused rather than re-listed.
 *   - **The nine-way list shows each choice's hint inline.** The hints are what
 *     tell "A field changes to a value" apart from "Custom events…", and a list
 *     of nine bare labels is a guessing game on a form this consequential.
 *   - **`datetime-local` does not exist in React Native.** Web's custom-time
 *     input is one HTML control; here it is a day field plus a clock field
 *     recombined in LOCAL time (`rescheduleInstant`, MYS-2031), because
 *     Android's native pickers give the two separately.
 *
 * The form is deliberately NOT optimistic: `useCreateIssueWakeup` refetches the
 * section on settle, so the new rule appears with the server's own id, revision
 * and `next_fire_at` rather than values this client invented.
 *
 * Failure reporting has exactly ONE channel. `useCreateIssueWakeup` carries a
 * `WRITE_FAILURE_TITLE_KEY`, so the QueryClient's MutationCache already raises
 * an alert for every failure — including one that lands after this sheet
 * unmounts. A per-call `onError` here would have to choose between duplicating
 * that alert and being the half that goes dead once the sheet closes, so the
 * only thing this form does on failure is KEEP ITSELF OPEN with the field
 * marked. `lib/write-wiring.test.ts` pins the same rule for the rest of the app.
 */
import { useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";
import DateTimePicker, {
  DateTimePickerAndroid,
} from "@react-native-community/datetimepicker";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import type { Issue, IssueProperty, IssuePropertyOption } from "@multica/core/types";
import { toDateOnly } from "@multica/core/issues/date";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { AutosizeTextArea } from "@/components/ui/autosize-textarea";
import { TextField } from "@/components/ui/text-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { PickerSheet } from "@/components/issue/pickers/picker-sheet";
import { AssigneePickerBody } from "@/components/issue/pickers/assignee-picker-body";
import { IssuePickerBody } from "@/components/issue/pickers/issue-picker-body";
import { useCreateIssueWakeup } from "@/data/mutations/issue-wakeups";
import { issueChildrenOptions, issueDetailOptions } from "@/data/queries/issues";
import { agentListOptions } from "@/data/queries/agents";
import { useIssueStatuses } from "@/data/queries/issue-statuses";
import { labelListOptions } from "@/data/queries/labels";
import { useActivePropertyCatalog } from "@/data/queries/properties";
import { memberListOptions } from "@/data/queries/members";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useActorLookup } from "@/data/use-actor-name";
import { useIntlLocale, useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { formatIssueDate } from "@/lib/format-date";
import { browserTimezone } from "@/lib/timezone";
import {
  WAKEUP_CONDITION_GROUPS,
  WAKEUP_EVENT_TYPES,
  WAKEUP_MAX_FIRES,
  WAKEUP_WAIT_DAYS,
  buildWakeupInput,
  emptyWakeupDraft,
  isEventCondition,
  localDateTimeInput,
  parseLocalDateTime,
  wakeupConditionHintKey,
  wakeupConditionLabelKey,
  wakeupDraftErrorKey,
  wakesAssigneeOnComments,
  type WakeupAtPreset,
  type WakeupConditionChoice,
  type WakeupDraft,
  type WakeupField,
  type WakeupRecurrence,
} from "@/lib/wakeup-draft";
import { rescheduleInstant } from "@/lib/wakeup-controls";
import { wakeupEventName, type WakeupTextDeps } from "@/lib/wakeup-presentation";
import { useStatusLabel } from "@/lib/status-options";
import { isAgentRuntimeBound } from "@/lib/is-agent-runtime-bound";
import { matchesNameOrPinyin } from "@/lib/name-search";

/** `custom` is rendered alone below a hairline, as web renders it: it is the
 *  escape hatch, not a member of any of the four families. */
const CUSTOM: WakeupConditionChoice = "custom";

/** Which sub-picker is open. One at a time — they are all full-screen modals,
 *  and stacking them would put two backdrops over the same draft. */
type SubPicker =
  | null
  | "condition"
  | "agent"
  | "at-preset"
  | "recurrence"
  | "reply-actor"
  | "run-agent"
  | "field-kind"
  | "field-value"
  | "stage"
  | "pr-event"
  | "other-issue"
  | "other-state"
  | "events"
  | "max-fires"
  | "wait-days"
  | "on-timeout"
  | "instant";

interface Props {
  issueId: string;
  visible: boolean;
  onClose: () => void;
  /** Preselected wake target — the issue's agent assignee, as web seeds it. */
  defaultAgentId?: string;
}

export function WakeupCreateSheet({
  issueId,
  visible,
  onClose,
  defaultAgentId = "",
}: Props) {
  const { t } = useTranslation();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: issue } = useQuery(issueDetailOptions(wsId, issueId));
  const timezone = browserTimezone() ?? "UTC";
  const [draft, setDraft] = useState<WakeupDraft>(() =>
    emptyWakeupDraft(defaultAgentId, timezone),
  );
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [picker, setPicker] = useState<SubPicker>(null);
  const create = useCreateIssueWakeup(issueId);
  const intlLocale = useIntlLocale();
  const statusLabel = useStatusLabel(wsId);
  const agents = useQuery(agentListOptions(wsId)).data ?? [];
  // The label catalog, for the `field → label` chip. `labelListOptions` is the
  // issue-scoped catalog, which is the one this condition can match against.
  const labels = useQuery(labelListOptions(wsId)).data ?? [];
  const labelName = (id: string) => labels.find((l) => l.id === id)?.name;
  // Read once here and passed down: the property catalog is a workspace read,
  // and both the field chip's label and the value list need the same row.
  const properties = useActivePropertyCatalog(wsId).definitions;

  const update = (patch: Partial<WakeupDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    setErrorKey(null);
  };

  const agentName = agents.find((a) => a.id === draft.agentId)?.name;
  const propertyOf = (id: string) => properties.find((p) => p.id === id);

  const submit = () => {
    if (create.isPending) return;
    const propertyType =
      draft.field === "property" ? propertyOf(draft.fieldTarget)?.type : undefined;
    const result = buildWakeupInput(draft, new Date(), propertyType);
    if ("error" in result) {
      // A draft the DECISION layer refuses never reaches the wire: the error is
      // shown against the form the user is still looking at, and the server's
      // own 400 stays reserved for things this client cannot know.
      setErrorKey(wakeupDraftErrorKey(result.error));
      return;
    }
    setErrorKey(null);
    create.mutate(result.input, {
      // The MutationCache raises the alert (see the file header), so the only
      // job here is to keep the sheet open with the draft intact — closing on a
      // failure would throw away the instruction the user just typed.
      onError: () => setErrorKey("wakeups.createError"),
      onSuccess: () => onClose(),
    });
  };

  const assigneeAgentId =
    issue?.assignee_type === "agent" ? (issue.assignee_id ?? null) : null;
  const joinsAssigneeRun = wakesAssigneeOnComments(draft, assigneeAgentId);

  return (
    <>
      <PickerSheet
        title={t("wakeups.create.title")}
        visible={visible}
        onClose={() => {
          if (!create.isPending) onClose();
        }}
        fill
      >
        <ScrollView
          contentContainerClassName="px-4 pb-4"
          keyboardShouldPersistTaps="handled"
        >
          <Field label={t("wakeups.create.when")}>
            <Pill
              label={
                draft.condition
                  ? t(wakeupConditionLabelKey(draft.condition))
                  : t("wakeups.create.choose_condition")
              }
              placeholder={!draft.condition}
              onPress={() => setPicker("condition")}
            />
            <ConditionParams
              draft={draft}
              openPicker={setPicker}
              agentName={agentName}
              propertyName={
                draft.field === "property"
                  ? (propertyOf(draft.fieldTarget)?.name ?? "")
                  : ""
              }
              statusLabel={statusLabel}
              labelName={labelName}
            />
          </Field>

          <Field label={t("wakeups.create.wake")}>
            <Pill
              label={agentName ?? t("wakeups.create.choose_agent")}
              placeholder={!agentName}
              leading={
                draft.agentId ? (
                  <ActorAvatar type="agent" id={draft.agentId} size={16} />
                ) : null
              }
              onPress={() => setPicker("agent")}
            />
          </Field>

          {joinsAssigneeRun ? (
            <Text className="mt-2 rounded-md bg-secondary/60 px-2.5 py-2 text-xs leading-5 text-muted-foreground">
              {t("wakeups.create.assignee_comment_hint", {
                name: agentName ?? "",
              })}
            </Text>
          ) : null}

          <Text className="mt-4 mb-1.5 text-xs font-medium text-foreground">
            {t("wakeups.instructionTitle")}
          </Text>
          <AutosizeTextArea
            value={draft.instruction}
            minHeight={88}
            maxHeight={200}
            editable={!create.isPending}
            placeholder={t("wakeups.create.instruction_placeholder")}
            accessibilityLabel={t("wakeups.instructionTitle")}
            onChangeText={(instruction) => update({ instruction })}
            className="rounded-md border border-border bg-background p-2 text-sm text-foreground"
          />

          {draft.condition === "recurring" ? (
            <Field label={t("wakeups.create.until")}>
              <Pill
                label={formatIssueDate(
                  draft.until,
                  { year: "numeric", month: "short", day: "numeric" },
                  intlLocale,
                )}
                onPress={() => setPicker("instant")}
              />
            </Field>
          ) : null}

          {isEventCondition(draft.condition) ? (
            <>
              <Field label={t("wakeups.create.trigger_count")}>
                <SegmentedControl
                  options={[
                    { value: "once", label: t("wakeups.once") },
                    { value: "continuous", label: t("wakeups.continuous") },
                  ]}
                  value={draft.mode}
                  onChange={(mode) => update({ mode })}
                />
              </Field>
              {draft.mode === "continuous" ? (
                <Field label={t("wakeups.create.max_fires")}>
                  <Pill
                    label={t("wakeups.create.max_fires_times_other", {
                      count: draft.maxFires,
                    })}
                    onPress={() => setPicker("max-fires")}
                  />
                </Field>
              ) : null}
              <Field label={t("wakeups.create.max_wait")}>
                <Pill
                  label={t("wakeups.create.wait_days_other", {
                    count: draft.waitDays,
                  })}
                  onPress={() => setPicker("wait-days")}
                />
              </Field>
              <Field label={t("wakeups.create.on_timeout")}>
                <Pill
                  label={
                    draft.onTimeout === "wake"
                      ? t("wakeups.create.timeout_wake", {
                          agent: agentName ?? t("wakeups.create.the_agent"),
                        })
                      : t("wakeups.create.timeout_end")
                  }
                  onPress={() => setPicker("on-timeout")}
                />
              </Field>
            </>
          ) : null}

          {errorKey ? (
            <Text role="alert" className="mt-3 text-xs text-destructive">
              {t(errorKey)}
            </Text>
          ) : null}

          <Text className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
            {t("wakeups.create.on_behalf")}
          </Text>
          <View className="mt-3 flex-row justify-end gap-2">
            <Pressable
              onPress={onClose}
              disabled={create.isPending}
              accessibilityRole="button"
              className="rounded-md border border-border px-3 py-2 active:bg-secondary"
            >
              <Text className="text-sm text-foreground">
                {t("wakeups.create.cancel")}
              </Text>
            </Pressable>
            <Pressable
              onPress={submit}
              disabled={create.isPending}
              accessibilityRole="button"
              accessibilityState={{ disabled: create.isPending }}
              className={`rounded-md bg-primary px-3 py-2 ${
                create.isPending ? "opacity-50" : ""
              }`}
            >
              <Text className="text-sm font-medium text-primary-foreground">
                {create.isPending
                  ? t("wakeups.create.submitting")
                  : t("wakeups.create.submit")}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </PickerSheet>

      {/* Mounted only while one is open: each owns a read and a piece of local
          state, and one left behind a closed sheet would keep querying. */}
      {picker ? (
        <SubPickerSheet
          picker={picker}
          setPicker={setPicker}
          draft={draft}
          update={update}
          issueId={issueId}
          issue={issue}
          properties={properties}
        />
      ) : null}
    </>
  );
}

/** A labelled row of the form. `label` is the left gutter, matching web's
 *  two-column grid. */
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View className="mt-3.5 flex-row items-start gap-2">
      <Text className="w-16 pt-2 text-xs text-muted-foreground">{label}</Text>
      <View className="flex-1 min-w-0 flex-row flex-wrap items-center gap-1.5">
        {children}
      </View>
    </View>
  );
}

/** One value control: a bordered chip that opens its picker. Web's `pillClass`.
 *  `placeholder` dims the text, which is how the form says "nothing chosen yet"
 *  without a second line of copy. */
function Pill({
  label,
  onPress,
  placeholder = false,
  leading,
}: {
  label: string;
  onPress: () => void;
  placeholder?: boolean;
  leading?: React.ReactNode;
}) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="max-w-full flex-row items-center gap-1.5 rounded-md border border-border bg-secondary/50 px-2.5 py-2 active:bg-secondary"
    >
      {leading}
      <Text
        className={`shrink text-xs ${
          placeholder ? "text-muted-foreground" : "text-foreground"
        }`}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Ionicons name="chevron-down" size={12} color={theme.mutedForeground} />
    </Pressable>
  );
}

/**
 * The per-condition value controls, beside the condition chip.
 *
 * One branch per choice, ported from web's `ConditionParams`. Each branch only
 * chooses the control that collects what `platformCondition` /
 * `buildWakeupInput` needs; none of them decides anything, and the ones with no
 * extra input (`children`, `pull_request`) still need a chip so the user can
 * pick WHICH stage or WHICH PR event.
 */
function ConditionParams({
  draft,
  openPicker,
  agentName,
  propertyName,
  statusLabel,
  labelName,
}: {
  draft: WakeupDraft;
  openPicker: (picker: SubPicker) => void;
  agentName: string | undefined;
  propertyName: string;
  statusLabel: (key: string) => string;
  labelName: (id: string) => string | undefined;
}) {
  const { t } = useTranslation();
  const { getName } = useActorLookup();
  const actorLabel = (actor: { type: string; id: string }) =>
    getName(actor.type as "member" | "agent" | "squad", actor.id);

  switch (draft.condition) {
    case "at":
      return (
        <Pill
          label={t(`wakeups.create.at_${draft.atPreset}`)}
          onPress={() => openPicker("at-preset")}
        />
      );
    case "recurring":
      return (
        <Pill
          label={t(`wakeups.create.${draft.recurrence}`)}
          onPress={() => openPicker("recurrence")}
        />
      );
    case "reply":
      return (
        <Pill
          label={
            draft.replyActor
              ? actorLabel(draft.replyActor)
              : t("wakeups.create.anyone")
          }
          placeholder={!draft.replyActor}
          onPress={() => openPicker("reply-actor")}
        />
      );
    case "run_end":
      return (
        <Pill
          label={
            draft.runAgentId
              ? (agentName ?? t("wakeups.create.any_agent"))
              : t("wakeups.create.any_agent")
          }
          placeholder={!draft.runAgentId}
          onPress={() => openPicker("run-agent")}
        />
      );
    case "field":
      return (
        <>
          <Pill
            label={t(`wakeups.create.field_${draft.field}`)}
            onPress={() => openPicker("field-kind")}
          />
          <Pill
            label={
              draft.field === "assignee"
                ? draft.assignee
                  ? actorLabel(draft.assignee)
                  : t("wakeups.create.choose_assignee")
                : draft.field === "status"
                  ? draft.fieldTarget
                    ? statusLabel(draft.fieldTarget)
                    : t("wakeups.create.choose_status")
                  : draft.field === "label"
                    ? (labelName(draft.fieldTarget) ??
                      t("wakeups.create.choose_label"))
                    : (propertyName || t("wakeups.create.choose_property"))
            }
            placeholder={
              draft.field === "assignee"
                ? !draft.assignee
                : !draft.fieldTarget
            }
            onPress={() => openPicker("field-value")}
          />
        </>
      );
    case "children":
      return (
        <Pill
          label={
            draft.stage === null
              ? t("wakeups.create.children_all")
              : t("wakeups.create.children_stage", { stage: draft.stage })
          }
          onPress={() => openPicker("stage")}
        />
      );
    case "pull_request":
      return (
        <Pill
          label={t(
            draft.prEvent === "merged"
              ? "wakeups.create.pr_merged"
              : "wakeups.create.pr_checks",
          )}
          onPress={() => openPicker("pr-event")}
        />
      );
    case "other_issue":
      return (
        <>
          <Pill
            label={draft.otherIssue?.identifier ?? t("wakeups.create.choose_issue")}
            placeholder={!draft.otherIssue}
            onPress={() => openPicker("other-issue")}
          />
          <Pill
            label={t(
              `wakeups.create.other_${
                draft.otherState === "in_review" ? "in_review" : draft.otherState
              }`,
            )}
            onPress={() => openPicker("other-state")}
          />
        </>
      );
    case "custom":
      return (
        <Pill
          label={
            draft.events.length === 0
              ? t("wakeups.create.events_selected_other", { count: 0 })
              : draft.events.length === 1
                ? t("wakeups.create.events_selected_one", { count: 1 })
                : t("wakeups.create.events_selected_other", {
                    count: draft.events.length,
                  })
          }
          placeholder={draft.events.length === 0}
          onPress={() => openPicker("events")}
        />
      );
    default:
      return null;
  }
}

/**
 * Every sub-picker, in one component.
 *
 * Kept together rather than spread through the form because they share the
 * draft and the "which one is open" state — a new condition branch means one
 * more branch here and one more entry in `SubPicker`, and the form above stays
 * readable.
 *
 * Reuses the app's existing bodies wherever one exists (`AssigneePickerBody`,
 * `IssuePickerBody`) instead of re-listing the same directories: a second list
 * of agents would drift from the first about archived rows and runtime binding.
 */
function SubPickerSheet({
  picker,
  setPicker,
  draft,
  update,
  issueId,
  issue,
  properties,
}: {
  picker: SubPicker;
  setPicker: (picker: SubPicker) => void;
  draft: WakeupDraft;
  update: (patch: Partial<WakeupDraft>) => void;
  issueId: string;
  issue: Issue | undefined;
  properties: IssueProperty[];
}) {
  const { t } = useTranslation();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const statusLabel = useStatusLabel(wsId);
  const { getName } = useActorLookup();
  // The status catalog's ACTIVE entries — the same set every status picker
  // offers. A condition that could name an archived status would describe a
  // transition nothing can reach.
  const statuses = useIssueStatuses(wsId).activeStatuses;
  const close = () => setPicker(null);

  const agents = useQuery(agentListOptions(wsId)).data ?? [];
  const members = useQuery(memberListOptions(wsId)).data ?? [];
  const labels = useQuery(labelListOptions(wsId)).data ?? [];
  // The stages already in use among this issue's children. Fetched only for the
  // `children` condition — the query is enabled by the picker being open, so a
  // form that never reaches that branch makes no request.
  const children =
    useQuery({
      ...issueChildrenOptions(wsId, issueId),
      enabled: picker === "stage",
    }).data ?? [];
  const text: WakeupTextDeps = useMemo(
    () => ({
      t,
      statusLabel,
      actorName: (type, id) => getName(type as "agent", id),
    }),
    [t, statusLabel, getName],
  );

  if (picker === "condition") {
    return (
      <PickerSheet
        title={t("wakeups.create.choose_condition")}
        visible
        onClose={close}
      >
        <ScrollView>
          {WAKEUP_CONDITION_GROUPS.map((group) => (
            <View key={group.groupKey}>
              <SectionLabel label={t(group.groupKey)} />
              {group.conditions.map((condition) => (
                <Row
                  key={condition}
                  label={t(wakeupConditionLabelKey(condition))}
                  hint={t(wakeupConditionHintKey(condition))}
                  selected={draft.condition === condition}
                  onPress={() => {
                    // Switching condition clears the per-condition TARGET but
                    // leaves everything the new choice can still use (the
                    // instruction, the trigger mode, the wait). A target is
                    // meaningless across choices — a status key is not a stage.
                    update({
                      condition,
                      fieldTarget: "",
                      fieldValue: "",
                      assignee: null,
                    });
                    close();
                  }}
                />
              ))}
            </View>
          ))}
          {/* Alone, below a hairline: the escape hatch is not a family member. */}
          <View className="mt-1 border-t border-border">
            <Row
              label={t(wakeupConditionLabelKey(CUSTOM))}
              hint={t(wakeupConditionHintKey(CUSTOM), {
                count: WAKEUP_EVENT_TYPES.length,
              })}
              selected={draft.condition === CUSTOM}
              onPress={() => {
                update({ condition: CUSTOM });
                close();
              }}
            />
          </View>
        </ScrollView>
      </PickerSheet>
    );
  }

  if (picker === "agent" || picker === "run-agent") {
    const isRunAgent = picker === "run-agent";
    const query = "";
    return (
      <PickerSheet
        title={
          isRunAgent
            ? t("wakeups.create.any_agent")
            : t("wakeups.create.choose_agent")
        }
        visible
        onClose={close}
      >
        <ScrollView>
          {isRunAgent ? (
            // An empty filter means "any agent's run", which is web's first row.
            <Row
              label={t("wakeups.create.any_agent")}
              selected={!draft.runAgentId}
              onPress={() => {
                update({ runAgentId: "" });
                close();
              }}
            />
          ) : null}
          {agents
            .filter((a) => !a.archived_at)
            .filter((a) => matchesNameOrPinyin(a.name, query))
            .map((agent) => {
              // Web disables an UNBOUND agent as a wake TARGET (it can never
              // run) but allows it as a run FILTER (it may have run before).
              const disabled = !isRunAgent && !isAgentRuntimeBound(agent);
              const selected = isRunAgent
                ? draft.runAgentId === agent.id
                : draft.agentId === agent.id;
              return (
                <Row
                  key={agent.id}
                  label={agent.name}
                  selected={selected}
                  disabled={disabled}
                  leading={<ActorAvatar type="agent" id={agent.id} size={24} />}
                  onPress={() => {
                    update(
                      isRunAgent
                        ? { runAgentId: agent.id }
                        : { agentId: agent.id },
                    );
                    close();
                  }}
                />
              );
            })}
        </ScrollView>
      </PickerSheet>
    );
  }

  if (picker === "at-preset") {
    return (
      <ListSheet
        title={t("wakeups.create.cond_at")}
        value={draft.atPreset}
        options={[
          { value: "10m", label: t("wakeups.create.at_10m") },
          { value: "1h", label: t("wakeups.create.at_1h") },
          { value: "tomorrow", label: t("wakeups.create.at_tomorrow") },
          { value: "custom", label: t("wakeups.create.at_custom") },
        ]}
        onPick={(atPreset) => {
          if (atPreset === "custom") {
            // An empty custom time is a guaranteed `future_time` on submit, so
            // the field is seeded from an hour out and its picker opens straight
            // away — the user asked for a time, so ask for it now.
            update({
              atPreset: "custom",
              atCustom: localDateTimeInput(new Date(Date.now() + 60 * 60 * 1000)),
            });
            setPicker("instant");
            return;
          }
          update({ atPreset: atPreset as WakeupAtPreset });
          close();
        }}
      />
    );
  }

  if (picker === "recurrence") {
    return (
      <ListSheet
        title={t("wakeups.create.cond_recurring")}
        value={draft.recurrence}
        options={[
          { value: "hourly", label: t("wakeups.create.hourly") },
          { value: "daily", label: t("wakeups.create.daily") },
          { value: "weekdays", label: t("wakeups.create.weekdays") },
        ]}
        onPick={(recurrence) => {
          update({ recurrence: recurrence as WakeupRecurrence });
          close();
        }}
      />
    );
  }

  if (picker === "reply-actor") {
    return (
      <PickerSheet title={t("wakeups.create.cond_reply")} visible onClose={close}>
        <ScrollView>
          <Row
            label={t("wakeups.create.anyone")}
            selected={!draft.replyActor}
            onPress={() => {
              update({ replyActor: null });
              close();
            }}
          />
          <SectionLabel label={t("wakeups.create.members")} />
          {members.map((m) => (
            <Row
              key={m.user_id}
              label={m.name}
              selected={
                draft.replyActor?.type === "member" &&
                draft.replyActor.id === m.user_id
              }
              leading={<ActorAvatar type="member" id={m.user_id} size={24} />}
              onPress={() => {
                update({ replyActor: { type: "member", id: m.user_id } });
                close();
              }}
            />
          ))}
          <SectionLabel label={t("wakeups.create.agents")} />
          {agents
            .filter((a) => !a.archived_at)
            .map((a) => (
              <Row
                key={a.id}
                label={a.name}
                selected={
                  draft.replyActor?.type === "agent" && draft.replyActor.id === a.id
                }
                leading={<ActorAvatar type="agent" id={a.id} size={24} />}
                onPress={() => {
                  update({ replyActor: { type: "agent", id: a.id } });
                  close();
                }}
              />
            ))}
        </ScrollView>
      </PickerSheet>
    );
  }

  if (picker === "field-kind") {
    return (
      <ListSheet
        title={t("wakeups.create.field_kind")}
        value={draft.field}
        options={[
          { value: "status", label: t("wakeups.create.field_status") },
          { value: "assignee", label: t("wakeups.create.field_assignee") },
          { value: "label", label: t("wakeups.create.field_label") },
          { value: "property", label: t("wakeups.create.field_property") },
        ]}
        onPick={(field) => {
          // Changing the field KIND invalidates every target: a status key is
          // not a label id is not a property id. The rest of the draft is left
          // alone, so switching back and forth does not lose the instruction.
          update({
            field: field as WakeupField,
            fieldTarget: "",
            fieldValue: "",
            assignee: null,
          });
          close();
        }}
      />
    );
  }

  if (picker === "field-value") {
    if (draft.field === "assignee") {
      return (
        <PickerSheet
          title={t("wakeups.create.choose_assignee")}
          visible
          onClose={close}
          fill
        >
          {/* The app's own assignee body: same three directories, same
              frequency ordering and pinyin search as every other assignee
              picker, and the same "needs a runtime" gate. */}
          <AssigneePickerBody
            value={draft.assignee}
            query=""
            showUnassigned={false}
            onChange={(next) => {
              update({ assignee: next });
              close();
            }}
          />
        </PickerSheet>
      );
    }
    if (draft.field === "status") {
      return (
        <ListSheet
          title={t("wakeups.create.choose_status")}
          value={draft.fieldTarget}
          options={statuses.map((s) => ({
            value: s.key,
            label: statusLabel(s.key),
          }))}
          onPick={(fieldTarget) => {
            update({ fieldTarget });
            close();
          }}
        />
      );
    }
    if (draft.field === "label") {
      return (
        <ListSheet
          title={t("wakeups.create.choose_label")}
          value={draft.fieldTarget}
          options={labels.map((l) => ({ value: l.id, label: l.name }))}
          onPick={(fieldTarget) => {
            update({ fieldTarget });
            close();
          }}
        />
      );
    }
    return (
      <PropertyValueSheet
        properties={properties}
        value={draft.fieldTarget}
        fieldValue={draft.fieldValue}
        onPickTarget={(fieldTarget) => update({ fieldTarget, fieldValue: "" })}
        onPickValue={(fieldValue) => update({ fieldValue })}
        onClose={close}
      />
    );
  }

  if (picker === "stage") {
    const stages = [
      ...new Set(
        children
          .map((c) => c.stage)
          .filter((s): s is number => typeof s === "number"),
      ),
    ].sort((a, b) => a - b);
    return (
      <ListSheet
        title={t("wakeups.create.cond_children")}
        value={draft.stage === null ? "all" : String(draft.stage)}
        options={[
          { value: "all", label: t("wakeups.create.children_all") },
          ...stages.map((stage) => ({
            value: String(stage),
            label: t("wakeups.create.children_stage", { stage }),
          })),
        ]}
        onPick={(next) => {
          update({ stage: next === "all" ? null : Number(next) });
          close();
        }}
      />
    );
  }

  if (picker === "pr-event") {
    return (
      <ListSheet
        title={t("wakeups.create.cond_pr")}
        value={draft.prEvent}
        options={[
          { value: "checks_finished", label: t("wakeups.create.pr_checks") },
          { value: "merged", label: t("wakeups.create.pr_merged") },
        ]}
        onPick={(prEvent) => {
          update({ prEvent: prEvent as WakeupDraft["prEvent"] });
          close();
        }}
      />
    );
  }

  if (picker === "other-state") {
    return (
      <ListSheet
        title={t("wakeups.create.cond_issue")}
        value={draft.otherState}
        options={[
          { value: "done", label: t("wakeups.create.other_done") },
          { value: "ended", label: t("wakeups.create.other_ended") },
          { value: "in_review", label: t("wakeups.create.other_in_review") },
        ]}
        onPick={(otherState) => {
          update({ otherState: otherState as WakeupDraft["otherState"] });
          close();
        }}
      />
    );
  }

  if (picker === "other-issue") {
    return (
      <PickerSheet
        title={t("wakeups.create.pick_issue_title")}
        visible
        onClose={close}
        fill
      >
        {/* The app's own issue picker — search-first, 300ms debounce, aborting
            in flight. `excludeIds` keeps the issue watching itself out. */}
        <IssuePickerBody
          title={t("wakeups.create.pick_issue_title")}
          description={t("wakeups.create.pick_issue_description")}
          excludeIds={[issueId]}
          onSelect={(picked) => {
            update({
              otherIssue: { id: picked.id, identifier: picked.identifier },
            });
            close();
          }}
        />
      </PickerSheet>
    );
  }

  if (picker === "events") {
    return (
      <PickerSheet title={t("wakeups.create.cond_custom")} visible onClose={close}>
        <ScrollView>
          {WAKEUP_EVENT_TYPES.map((event) => {
            const checked = draft.events.includes(event);
            return (
              <Row
                key={event}
                label={wakeupEventName(text, event)}
                selected={checked}
                onPress={() =>
                  // Kept in CATALOG order rather than tap order: web does the
                  // same, and the order is what the rule's own readback prints.
                  update({
                    events: checked
                      ? draft.events.filter((e) => e !== event)
                      : WAKEUP_EVENT_TYPES.filter(
                          (e) => e === event || draft.events.includes(e),
                        ),
                  })
                }
              />
            );
          })}
        </ScrollView>
      </PickerSheet>
    );
  }

  if (picker === "max-fires") {
    return (
      <ListSheet
        title={t("wakeups.create.max_fires")}
        value={String(draft.maxFires)}
        options={WAKEUP_MAX_FIRES.map((count) => ({
          value: String(count),
          // The ladder is [5, 10, 20, 50] — it never holds 1, so there is no
          // singular form to branch to and only the `_other` key exists.
          label: t("wakeups.create.max_fires_times_other", { count }),
        }))}
        onPick={(value) => {
          update({ maxFires: Number(value) });
          close();
        }}
      />
    );
  }

  if (picker === "wait-days") {
    return (
      <ListSheet
        title={t("wakeups.create.max_wait")}
        value={String(draft.waitDays)}
        options={WAKEUP_WAIT_DAYS.map((count) => ({
          value: String(count),
          label: t(
            count === 1
              ? "wakeups.create.wait_days_one"
              : "wakeups.create.wait_days_other",
            { count },
          ),
        }))}
        onPick={(value) => {
          update({ waitDays: Number(value) });
          close();
        }}
      />
    );
  }

  if (picker === "on-timeout") {
    return (
      <ListSheet
        title={t("wakeups.create.on_timeout")}
        value={draft.onTimeout}
        options={[
          {
            value: "wake",
            label: t("wakeups.create.timeout_wake", {
              agent:
                agents.find((a) => a.id === draft.agentId)?.name ??
                t("wakeups.create.the_agent"),
            }),
          },
          { value: "end", label: t("wakeups.create.timeout_end") },
        ]}
        onPick={(value) => {
          update({ onTimeout: value as WakeupDraft["onTimeout"] });
          close();
        }}
      />
    );
  }

  if (picker === "instant") {
    return (
      <WakeupInstantSheet
        title={
          draft.condition === "recurring"
            ? t("wakeups.create.until")
            : t("wakeups.create.at_custom")
        }
        // Recurring edits a calendar DAY (the rule ends at the end of it); an
        // `at` custom preset edits a full instant.
        mode={draft.condition === "recurring" ? "day" : "instant"}
        value={draft.condition === "recurring" ? draft.until : draft.atCustom}
        onClose={close}
        onCommit={(value) => {
          update(
            draft.condition === "recurring" ? { until: value } : { atCustom: value },
          );
          close();
        }}
      />
    );
  }

  return null;
}

/** A one-column choice list in the standard sheet. Web's `PillMenu`. */
function ListSheet({
  title,
  value,
  options,
  onPick,
}: {
  title: string;
  value: string;
  options: { value: string; label: string }[];
  onPick: (value: string) => void;
}) {
  return (
    <PickerSheet title={title} visible onClose={() => {}}>
      <ScrollView>
        {options.map((option) => (
          <Row
            key={option.value}
            label={option.label}
            selected={option.value === value}
            onPress={() => onPick(option.value)}
          />
        ))}
      </ScrollView>
    </PickerSheet>
  );
}

/** One tappable choice. `hint` is the second line web puts under a condition's
 *  name; a checkmark marks the current value. */
function Row({
  label,
  hint,
  selected,
  disabled = false,
  leading,
  onPress,
}: {
  label: string;
  hint?: string;
  selected: boolean;
  disabled?: boolean;
  leading?: React.ReactNode;
  onPress: () => void;
}) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={label}
      className={`flex-row items-center gap-3 px-4 py-3 ${
        disabled ? "opacity-50" : "active:bg-secondary"
      }`}
    >
      {leading}
      <View className="flex-1 min-w-0">
        <Text className="text-sm text-foreground">{label}</Text>
        {hint ? (
          <Text className="text-xs text-muted-foreground">{hint}</Text>
        ) : null}
      </View>
      {selected ? (
        <Ionicons name="checkmark" size={20} color={theme.brand} />
      ) : null}
    </Pressable>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <Text className="px-4 pt-3 pb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
      {label}
    </Text>
  );
}

/**
 * A custom property's target and value, in one sheet.
 *
 * Two steps in one surface because the value's CONTROL depends on the target's
 * type (a select lists its own options, a checkbox is a yes/no pair, a number is
 * a text field) — splitting them would leave the user picking a value with no
 * way back to the property. Mirrors web's `FieldParams` property branch.
 */
function PropertyValueSheet({
  properties,
  value,
  fieldValue,
  onPickTarget,
  onPickValue,
  onClose,
}: {
  /** Every ACTIVE definition — the same projection the "+ add property" surface
   *  reads. The full row is needed, not just id/name: a select's value options
   *  come from its own `config`. */
  properties: IssueProperty[];
  /** Chosen property id, or "" while none is chosen. */
  value: string;
  fieldValue: string;
  onPickTarget: (id: string) => void;
  onPickValue: (value: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const definition = properties.find((p) => p.id === value);

  if (!value || !definition) {
    return (
      <PickerSheet
        title={t("wakeups.create.choose_property")}
        visible
        onClose={onClose}
      >
        <ScrollView>
          {properties.map((p) => (
            <Row
              key={p.id}
              label={p.name}
              selected={false}
              onPress={() => onPickTarget(p.id)}
            />
          ))}
        </ScrollView>
      </PickerSheet>
    );
  }

  const options: { value: string; label: string }[] =
    definition?.type === "select" || definition?.type === "multi_select"
      ? (definition.config?.options ?? []).map((o: IssuePropertyOption) => ({
          value: o.id,
          label: o.name,
        }))
      : definition?.type === "checkbox"
        ? [
            { value: "true", label: t("wakeups.create.checked") },
            { value: "false", label: t("wakeups.create.unchecked") },
          ]
        : [];

  return (
    <PickerSheet title={definition?.name ?? t("wakeups.create.choose_property")} visible onClose={onClose}>
      <ScrollView>
        {options.length > 0 ? (
          options.map((option) => (
            <Row
              key={option.value}
              label={option.label}
              selected={fieldValue === option.value}
              onPress={() => onPickValue(option.value)}
            />
          ))
        ) : (
          // text / number / date / url: a free-text value. `keyboardType` is
          // numeric for a number so the phone opens the number pad.
          <View className="px-4 py-3">
            <TextField
              value={fieldValue}
              autoFocus
              placeholder={t("wakeups.create.value_placeholder")}
              accessibilityLabel={definition.name}
              keyboardType={definition?.type === "number" ? "numeric" : "default"}
              onChangeText={onPickValue}
              onSubmitEditing={onClose}
            />
          </View>
        )}
      </ScrollView>
    </PickerSheet>
  );
}

/**
 * A day, an instant, or both — the `datetime-local` stand-in.
 *
 * Web renders one HTML control; React Native has none, and Android's native
 * pickers give a day and a clock separately, so the sheet shows the fields the
 * chosen mode needs and recombines them in LOCAL time (`rescheduleInstant`).
 * Building the instant from an ISO string would read the pair as UTC and move
 * the wakeup by the viewer's offset.
 */
function WakeupInstantSheet({
  title,
  mode,
  value,
  onClose,
  onCommit,
}: {
  title: string;
  mode: "day" | "instant";
  /** "YYYY-MM-DD" for `day`; "YYYY-MM-DDTHH:mm" for `instant`. */
  value: string;
  onClose: () => void;
  onCommit: (value: string) => void;
}) {
  const { t } = useTranslation();
  const seed = parseLocalDateTime(value) ?? new Date();
  const [day, setDay] = useState<Date>(seed);
  const [hour, setHour] = useState(seed.getHours());
  const [minute, setMinute] = useState(seed.getMinutes());

  const commit = () => {
    onCommit(
      mode === "day"
        ? toDateOnly(day)
        : localDateTimeInput(rescheduleInstant(day, hour, minute)),
    );
  };

  return (
    <PickerSheet title={title} visible onClose={onClose}>
      <View className="px-4 pb-4">
        <Text className="text-xs text-muted-foreground">
          {t("wakeups.localTime", { timezone: browserTimezone() ?? "UTC" })}
        </Text>
        <View className="mt-2 flex-row gap-2">
          <TimeField
            value={day}
            mode="date"
            accessibilityLabel={t("datePicker.chooseDate")}
            onChange={setDay}
          />
          {mode === "instant" ? (
            <TimeField
              value={rescheduleInstant(day, hour, minute)}
              mode="time"
              accessibilityLabel={title}
              onChange={(picked) => {
                setHour(picked.getHours());
                setMinute(picked.getMinutes());
              }}
            />
          ) : null}
        </View>
        <View className="mt-3 flex-row justify-end gap-2">
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            className="rounded-md border border-border px-3 py-2 active:bg-secondary"
          >
            <Text className="text-sm text-foreground">
              {t("wakeups.instructionCancel")}
            </Text>
          </Pressable>
          <Pressable
            onPress={commit}
            accessibilityRole="button"
            className="rounded-md bg-primary px-3 py-2"
          >
            <Text className="text-sm font-medium text-primary-foreground">
              {t("common.done")}
            </Text>
          </Pressable>
        </View>
      </View>
    </PickerSheet>
  );
}

/**
 * One native picker (day or clock) as a tappable row.
 *
 * Android's `@react-native-community/datetimepicker` renders nothing inline —
 * it opens a dialog as soon as the component mounts — so the dialog is opened
 * imperatively through `DateTimePickerAndroid.open` and iOS renders the inline
 * control. Same split, and the same reason, as
 * `components/issue/pickers/due-date-picker-body.tsx` and the reschedule sheet
 * in `wakeup-row-actions.tsx`.
 */
function TimeField({
  value,
  mode,
  accessibilityLabel,
  onChange,
}: {
  value: Date;
  mode: "date" | "time";
  accessibilityLabel: string;
  onChange: (next: Date) => void;
}) {
  const { colorScheme } = useColorScheme();
  const { t } = useTranslation();
  const theme = THEME[colorScheme];
  const intlLocale = useIntlLocale();
  const [open, setOpen] = useState(false);
  const label =
    mode === "date"
      ? formatIssueDate(
          toDateOnly(value),
          { year: "numeric", month: "short", day: "numeric" },
          intlLocale,
        )
      : `${String(value.getHours()).padStart(2, "0")}:${String(
          value.getMinutes(),
        ).padStart(2, "0")}`;

  const openPicker = () => {
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value,
        mode,
        is24Hour: true,
        onChange: (event, selected) => {
          if (event.type === "set" && selected) onChange(selected);
        },
      });
      return;
    }
    setOpen((v) => !v);
  };

  return (
    <>
      <Pressable
        onPress={openPicker}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        className="flex-1 flex-row items-center justify-center gap-1.5 rounded-md border border-border bg-secondary/50 px-3 py-2.5 active:bg-secondary"
      >
        <Ionicons
          name={mode === "date" ? "calendar-outline" : "time-outline"}
          size={15}
          color={theme.mutedForeground}
        />
        <Text className="text-sm tabular-nums text-foreground">{label}</Text>
      </Pressable>
      {/* The Android dialog carries its own confirm row, so there is nothing to
          tap here; the iOS spinner needs one. */}
      {Platform.OS !== "android" && open ? (
        <>
          <DateTimePicker
            value={value}
            mode={mode}
            display="spinner"
            onChange={(_event, selected) => {
              if (selected) onChange(selected);
            }}
          />
          <Pressable
            onPress={() => setOpen(false)}
            accessibilityRole="button"
            className="mt-2 items-center rounded-md bg-primary px-4 py-2"
          >
            <Text className="text-sm font-medium text-primary-foreground">
              {t("common.done")}
            </Text>
          </Pressable>
        </>
      ) : null}
    </>
  );
}
