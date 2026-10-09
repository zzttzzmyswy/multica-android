/**
 * The controls that act on one wakeup rule (MYS-2031).
 *
 * MYS-2023 shipped the section read-only and said why: "a phone row that opens
 * a form it cannot submit is worse than no form". This file is the other half —
 * the mutations web hangs off every row (enable/disable, wake-now, edit
 * instruction, delete), each ported to a shape a phone can actually use.
 *
 * Where this deliberately differs from web, and why:
 *
 *   - **The write actions live in a sheet.** Web's row opens a `Popover` with
 *     the rule's detail plus a button strip. A phone has no hover, and a nested
 *     popover over a scrolling FlashList fights the scroll responder — the same
 *     reason the section's detail is already inline. So the detail stays inline
 *     (see `wakeups-section.tsx`) and the writes moved into a bottom sheet,
 *     which is mobile's existing shape for an action list (`PickerSheet`).
 *
 *   - **Only delete confirms.** Web confirms only the delete too, and the line
 *     holds: "wake now" is one run, stopping a rule is reversible, deleting is
 *     not (the server withdraws unstarted runs and the rule is gone).
 *
 *   - **A conflict is classified, not echoed.** The server's 409 body
 *     ("wakeup changed; refresh and retry") is written for a developer; the row
 *     shows `wakeups.conflictError` and the mutation layer re-fetches. See
 *     `wakeupWriteErrorKey` / `wakeupWriteNeedsRefresh`.
 *
 * The actions are all bound to `wakeup.issue_id`, not to a prop: a rule carries
 * its own issue, so a sheet opened from the wakeups tab of one issue can never
 * write to another.
 */
import { useState } from "react";
import { Alert, Platform, Pressable, View } from "react-native";
import DateTimePicker, {
  DateTimePickerAndroid,
} from "@react-native-community/datetimepicker";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { IssueWakeup } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Switch } from "@/components/ui/switch";
import { AutosizeTextArea } from "@/components/ui/autosize-textarea";
import { PickerSheet } from "@/components/issue/pickers/picker-sheet";
import { formatIssueDate } from "@/lib/format-date";
import { toDateOnly } from "@multica/core/issues/date";
import {
  useDeleteIssueWakeup,
  useEditWakeupInstruction,
  useTriggerIssueWakeup,
} from "@/data/mutations/issue-wakeups";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useIntlLocale, useTranslation } from "@/lib/i18n/react";
import {
  isFutureWakeupTime,
  rescheduleInstant,
  wakeupInstructionErrorKey,
  wakeupWriteErrorKey,
  type WakeupControlState,
} from "@/lib/wakeup-controls";

/** The alert title for any failed wakeup write. The detail line below it is
 *  the classified one, which names the action and branches on 403/409. */
const WRITE_FAILED_TITLE = "wakeups.writeFailedTitle";

/** One alert helper for every write in this file, so the four failures cannot
 *  drift into four phrasings of the same sentence. */
function raiseWakeupFailure(
  t: (id: string, params?: Record<string, string | number>) => string,
  error: unknown,
  fallbackKey: string,
): void {
  Alert.alert(t(WRITE_FAILED_TITLE), t(wakeupWriteErrorKey(error, fallbackKey)));
}

/** Why a control is inert, in the reader's words. `null` renders nothing —
 *  a live control needs no explanation. */
export function wakeupBlockedTextKey(
  blocked: WakeupControlState["blocked"],
): string | null {
  switch (blocked) {
    case "pending":
      return "wakeups.blockedPending";
    case "closed":
      return "wakeups.blockedClosed";
    case "active_run":
      return "wakeups.blockedActiveRun";
    case "revision":
      return "wakeups.blockedRevision";
    default:
      return null;
  }
}

/**
 * The enable/disable control, shaped like web's `WakeupControl`.
 *
 * Four shapes, chosen by `wakeupControlState` — see that function for the
 * branch order and why each one exists. A blocked control is drawn but inert;
 * the row prints the reason underneath, because a control that silently does
 * nothing on tap is the defect this whole family of iterations is about.
 *
 * Rescheduling opens `WakeupRescheduleSheet` rather than firing an enable
 * immediately: the server refuses an `at` enable with no new time ("choose a
 * future time"), so the control's job is to ask for one.
 */
export function WakeupControl({
  wakeup,
  control,
  pending,
  onEnable,
  onDisable,
}: {
  wakeup: IssueWakeup;
  control: WakeupControlState;
  pending: boolean;
  onEnable: (input?: { at?: string; rearm?: boolean }) => void;
  onDisable: () => void;
}) {
  const { t } = useTranslation();
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const label = t("wakeups.toggle", { agent: wakeup.agent_name });

  if (control.kind === "switch") {
    return (
      <Switch
        checked={control.checked}
        disabled={control.disabled}
        accessibilityLabel={label}
        onCheckedChange={(checked) => {
          if (checked) onEnable();
          else onDisable();
        }}
      />
    );
  }

  if (control.kind === "reschedule") {
    return (
      <>
        <ControlButton
          label={t("wakeups.reschedule")}
          disabled={control.disabled}
          onPress={() => setRescheduleOpen(true)}
        />
        <WakeupRescheduleSheet
          visible={rescheduleOpen}
          pending={pending}
          wakeup={wakeup}
          onClose={() => setRescheduleOpen(false)}
          onSubmit={(at) => {
            setRescheduleOpen(false);
            onEnable({ at, rearm: true });
          }}
        />
      </>
    );
  }

  if (control.kind === "withdraw") {
    // Web's second branch calls `onDisable` here, NOT `onEnable`. The rule is
    // already off; what this button does is withdraw the run it enqueued, which
    // is the disable endpoint's job (`CancelUnstartedWakeupTasks`). Enabling
    // instead would ask the server to turn the rule back on while its own run
    // is still queued — the opposite of what the user tapped.
    return (
      <ControlButton
        label={t("wakeups.withdraw")}
        disabled={control.disabled}
        onPress={onDisable}
      />
    );
  }

  return (
    <ControlButton
      label={t("wakeups.resubscribe")}
      disabled={control.disabled}
      // A resubscribe restarts a spent or expired rule, so it re-arms; the
      // server refuses a consumed one-shot without that flag.
      onPress={() => onEnable({ rearm: true })}
    />
  );
}

/** The outlined compact button the three non-switch branches share. */
function ControlButton({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      className={`rounded-md border border-border px-2.5 py-1 active:bg-secondary ${
        disabled ? "opacity-50" : ""
      }`}
    >
      <Text className="text-xs font-medium text-foreground">{label}</Text>
    </Pressable>
  );
}

/**
 * The action sheet for one rule: wake now, edit the prompt, delete.
 *
 * Split out of the row so the row stays readable and so the editor's state
 * unmounts with the sheet — an editor left mounted behind a closed sheet would
 * keep a draft keyed to a rule the user may have just deleted.
 */
export function WakeupRowSheet({
  visible,
  onClose,
  wakeup,
  canTrigger,
}: {
  visible: boolean;
  onClose: () => void;
  wakeup: IssueWakeup;
  /** False once the rule is switched off server-side: a withdrawn rule has no
   *  run to re-fire. Web hides "wake now" in exactly that case. */
  canTrigger: boolean;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const trigger = useTriggerIssueWakeup(wakeup.issue_id);
  const remove = useDeleteIssueWakeup(wakeup.issue_id);
  const busy = trigger.isPending || remove.isPending;

  const fail = (error: unknown, fallbackKey: string) =>
    raiseWakeupFailure(t, error, fallbackKey);

  const confirmDelete = () => {
    Alert.alert(
      t("wakeups.deleteTitle"),
      t("wakeups.deleteBody", { agent: wakeup.agent_name }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("wakeups.delete"),
          style: "destructive",
          onPress: () =>
            remove.mutate(wakeup.id, {
              onSuccess: onClose,
              onError: (err) => fail(err, "wakeups.deleteError"),
            }),
        },
      ],
    );
  };

  return (
    <PickerSheet
      title={t("wakeups.menuTitle")}
      visible={visible}
      onClose={() => {
        if (busy) return;
        setEditing(false);
        onClose();
      }}
    >
      {editing ? (
        <WakeupInstructionEditor
          wakeup={wakeup}
          onDone={() => {
            setEditing(false);
            onClose();
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <View className="pb-2">
          {canTrigger ? (
            <SheetAction
              icon="play-outline"
              label={t("wakeups.wakeNow")}
              disabled={busy}
              onPress={() =>
                trigger.mutate(wakeup.id, {
                  // `wakeNowDone` confirms the run was accepted — the rule's
                  // next state arrives with the refetch, so without this line
                  // the sheet would close on an apparently-no-op tap.
                  onSuccess: () => {
                    onClose();
                    Alert.alert(
                      t("wakeups.wakeNowDone", { agent: wakeup.agent_name }),
                    );
                  },
                  onError: (err) => fail(err, "wakeups.wakeNowError"),
                })
              }
            />
          ) : null}
          <SheetAction
            icon="create-outline"
            label={t("wakeups.editInstruction")}
            disabled={busy}
            onPress={() => setEditing(true)}
          />
          <SheetAction
            icon="trash-outline"
            label={t("wakeups.delete")}
            destructive
            disabled={busy}
            onPress={confirmDelete}
          />
        </View>
      )}
    </PickerSheet>
  );
}

/** One row of the action sheet. */
function SheetAction({
  icon,
  label,
  onPress,
  disabled = false,
  destructive = false,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      className={`flex-row items-center gap-3 px-4 py-3 active:bg-secondary ${
        disabled ? "opacity-50" : ""
      }`}
    >
      <Ionicons
        name={icon}
        size={18}
        color={destructive ? theme.destructive : theme.foreground}
      />
      <Text
        className={`text-sm ${destructive ? "text-destructive" : "text-foreground"}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * The prompt editor, inline in the sheet.
 *
 * Web loads the rule fresh before editing and keeps that snapshot as
 * `expected_instruction`, so a save racing someone else's edit conflicts
 * instead of overwriting it. This keeps the row's own snapshot for the same
 * reason — and freezes it at mount, so a background refetch landing mid-edit
 * cannot move the fence out from under the typist.
 */
export function WakeupInstructionEditor({
  wakeup,
  onDone,
  onCancel,
}: {
  wakeup: IssueWakeup;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const edit = useEditWakeupInstruction(wakeup.issue_id);
  const [original] = useState(wakeup);
  const [value, setValue] = useState(wakeup.instruction);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const unchanged = value.trim() === original.instruction;

  const submit = () => {
    const invalid = wakeupInstructionErrorKey(value);
    if (invalid) {
      setErrorKey(invalid);
      return;
    }
    setErrorKey(null);
    edit.mutate(
      {
        id: original.id,
        instruction: value.trim(),
        expected_instruction: original.instruction,
        revision: original.revision ?? 0,
      },
      {
        onSuccess: onDone,
        onError: (err) => raiseWakeupFailure(t, err, "wakeups.instructionSaveError"),
      },
    );
  };

  return (
    <View className="px-4 pb-4">
      <Text className="text-xs text-muted-foreground">
        {t("wakeups.instructionEffect")}
      </Text>
      <AutosizeTextArea
        value={value}
        minHeight={96}
        maxHeight={220}
        editable={!edit.isPending}
        accessibilityLabel={t("wakeups.instructionTitle")}
        onChangeText={(next) => {
          setValue(next);
          setErrorKey(null);
        }}
        className="mt-2 rounded-md border border-border bg-background p-2 text-sm text-foreground"
      />
      {errorKey ? (
        <Text className="mt-1 text-xs text-destructive">{t(errorKey)}</Text>
      ) : null}
      <View className="mt-3 flex-row justify-end gap-2">
        <Pressable
          onPress={onCancel}
          disabled={edit.isPending}
          accessibilityRole="button"
          className="rounded-md border border-border px-3 py-2 active:bg-secondary"
        >
          <Text className="text-sm text-foreground">
            {t("wakeups.instructionCancel")}
          </Text>
        </Pressable>
        <Pressable
          onPress={submit}
          // An unchanged prompt is not a write: the server would accept it and
          // bump nothing, and the button would look like it did something.
          disabled={edit.isPending || unchanged}
          accessibilityRole="button"
          className={`rounded-md bg-primary px-3 py-2 ${
            edit.isPending || unchanged ? "opacity-50" : ""
          }`}
        >
          <Text className="text-sm font-medium text-primary-foreground">
            {edit.isPending
              ? t("wakeups.instructionSaving")
              : t("wakeups.instructionSave")}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * "Set a new time" for a single-time rule.
 *
 * Web renders a `datetime-local` input in a dialog. React Native has no such
 * control, and the two native pickers give a DAY and a CLOCK TIME separately —
 * Android's `DateTimePicker` cannot do both in one dialog. So the sheet shows
 * both controls and recombines them in LOCAL time (`rescheduleInstant`), which
 * is what the person who picked them meant: building the instant from an ISO
 * string would read the pair as UTC and move the wakeup by their offset.
 *
 * The time is seeded to the rule's existing deadline (or an hour out when it is
 * gone) rather than to "now": the common case is nudging a deadline that just
 * passed, and starting from now makes the user re-pick the hour and minute they
 * were already looking at.
 */
export function WakeupRescheduleSheet({
  visible,
  pending,
  wakeup,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  pending: boolean;
  /** The rule being rescheduled; supplies the seed day and time. */
  wakeup: IssueWakeup;
  onClose: () => void;
  onSubmit: (at: string) => void;
}) {
  const { t } = useTranslation();
  const seed = useSeedInstant(wakeup);
  const [day, setDay] = useState<Date>(seed);
  const [hour, setHour] = useState<number>(seed.getHours());
  const [minute, setMinute] = useState<number>(seed.getMinutes());
  const [error, setError] = useState<string | null>(null);
  const instant = rescheduleInstant(day, hour, minute);

  const submit = () => {
    if (!isFutureWakeupTime(instant)) {
      // The server refuses a past deadline with a 400 ("choose a future
      // time"). Catching it here keeps the sheet open with the field marked,
      // instead of closing and raising an alert about a value the user can no
      // longer see.
      setError(t("wakeups.futureTime"));
      return;
    }
    onSubmit(instant.toISOString());
  };

  return (
    <PickerSheet
      title={t("wakeups.reschedule")}
      visible={visible}
      onClose={() => {
        if (!pending) onClose();
      }}
    >
      <View className="px-4 pb-4">
        <Text className="text-xs text-muted-foreground">
          {t("wakeups.localTime", { timezone: deviceTimeZone() })}
        </Text>
        <View className="mt-2 flex-row gap-2">
          <TimeField
            value={day}
            mode="date"
            disabled={pending}
            accessibilityLabel={t("datePicker.chooseDate")}
            onChange={(picked) => {
              setDay(picked);
              setError(null);
            }}
          />
          <TimeField
            value={instant}
            mode="time"
            disabled={pending}
            accessibilityLabel={t("wakeups.reschedule")}
            onChange={(picked) => {
              setHour(picked.getHours());
              setMinute(picked.getMinutes());
              setError(null);
            }}
          />
        </View>
        {error ? (
          <Text role="alert" className="mt-1 text-xs text-destructive">
            {error}
          </Text>
        ) : null}
        <View className="mt-3 flex-row justify-end gap-2">
          <Pressable
            onPress={onClose}
            disabled={pending}
            accessibilityRole="button"
            className="rounded-md border border-border px-3 py-2 active:bg-secondary"
          >
            <Text className="text-sm text-foreground">
              {t("wakeups.instructionCancel")}
            </Text>
          </Pressable>
          <Pressable
            onPress={submit}
            disabled={pending}
            accessibilityRole="button"
            className={`rounded-md bg-primary px-3 py-2 ${pending ? "opacity-50" : ""}`}
          >
            <Text className="text-sm font-medium text-primary-foreground">
              {t("wakeups.reschedule")}
            </Text>
          </Pressable>
        </View>
      </View>
    </PickerSheet>
  );
}

/** The instant the reschedule sheet opens on: the rule's own deadline when it
 *  still has one, else an hour from now. */
function useSeedInstant(wakeup: IssueWakeup): Date {
  const [seed] = useState(() => {
    const existing = wakeup.next_fire_at ? new Date(wakeup.next_fire_at) : null;
    if (existing && Number.isFinite(existing.getTime())) return existing;
    return new Date(Date.now() + 60 * 60 * 1000);
  });
  return seed;
}

/** The device's IANA zone, as the label that tells the user which clock the
 *  two fields below are in. Hermes ships `Intl`, and `resolvedOptions` is the
 *  same call web's dialog makes. */
function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * One native picker (day or clock) as a tappable row.
 *
 * Android's `@react-native-community/datetimepicker` renders nothing inline —
 * it opens a dialog as soon as the component mounts — so the dialog is opened
 * imperatively through `DateTimePickerAndroid.open` and iOS renders the inline
 * control. Same split, and the same reason, as
 * `components/issue/pickers/due-date-picker-body.tsx`.
 */
function TimeField({
  value,
  mode,
  disabled,
  accessibilityLabel,
  onChange,
}: {
  value: Date;
  mode: "date" | "time";
  disabled: boolean;
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
      ? formatIssueDate(toDateOnly(value), { year: "numeric", month: "short", day: "numeric" }, intlLocale)
      : `${pad2(value.getHours())}:${pad2(value.getMinutes())}`;

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
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled }}
        className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-md border border-border bg-secondary/50 px-3 py-2.5 ${
          disabled ? "opacity-50" : "active:bg-secondary"
        }`}
      >
        <Ionicons
          name={mode === "date" ? "calendar-outline" : "time-outline"}
          size={15}
          color={theme.mutedForeground}
        />
        <Text className="text-sm tabular-nums text-foreground">{label}</Text>
      </Pressable>
      {Platform.OS !== "android" && open ? (
        <DateTimePicker
          value={value}
          mode={mode}
          display="spinner"
          onChange={(_event, selected) => {
            if (selected) onChange(selected);
          }}
        />
      ) : null}
      {/* The Android dialog carries its own confirm row, so there is nothing to
          tap here; the iOS spinner needs one. */}
      {Platform.OS !== "android" && open ? (
        <Pressable
          onPress={() => setOpen(false)}
          accessibilityRole="button"
          className="mt-2 items-center rounded-md bg-primary px-4 py-2"
        >
          <Text className="text-sm font-medium text-primary-foreground">
            {t("common.done")}
          </Text>
        </Pressable>
      ) : null}
    </>
  );
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
