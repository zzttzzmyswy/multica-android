/**
 * Autopilot Schedule 富编辑器 — mobile counterpart of web
 * `packages/views/autopilots/components/schedule-editor/schedule-editor.tsx`.
 *
 * Replaces the bare cron textbox with the full structured editor: modal
 * segmented toggles (at / every-N with window / weekly / monthly day chips /
 * advanced raw cron inline editing), the plain-language readback, and a
 * debounced next-runs preview against the server's cron-preview endpoint —
 * the server 400-rejection is surfaced inline and mirrors back to the owning
 * form via `onValidityChange` so the submit button stays in step.
 *
 * Model notes (identical to web): the window is a dimension of the schedule,
 * not a mode — all day is `window: null`, every committed window goes through
 * the canonical `clampWindow`/`isFullDay` pair; typed text in the cron box
 * wins over the structured model until applied (blur/Enter). A `TZ=` prefixed
 * draft stays in `raw` verbatim until the server rules on it (no auto-promotion
 * on mobile — the timezone picker is a separate sheet, so promotion would just
 * rewrite two controls mid-edit).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Modal, Pressable, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { TimezonePickerSheet } from "@/components/autopilot/timezone-picker-sheet";
import { api, ApiError } from "@/data/api";
import { getCurrentLocale } from "@/lib/i18n";
import { useTranslation } from "@/lib/i18n/react";
import {
  classifyScheduleRejection,
} from "@/lib/autopilot-trigger-form";
import type { DayPattern, ScheduleConfig, TimePattern } from "@/lib/schedule-editor-model";
import { DAY_KEYS, pad2, timeParts } from "@/lib/schedule-editor-model";
import {
  cronFields,
  extractTimezonePrefix,
  parseCron,
  toCron,
} from "@/lib/schedule-editor-cron";
import { describeSchedule } from "@/lib/schedule-editor-describe";
import { countdownDiff, formatInTimeZone } from "@/lib/schedule-editor-format";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

export interface ScheduleEditorProps {
  value: ScheduleConfig;
  onChange: (value: ScheduleConfig) => void;
  wsId: string;
  disabled?: boolean;
  /** Fires when the server rejects (or accepts) the current expression so the
   *  owning form can keep its submit button in step with the inline error. */
  onValidityChange?: (valid: boolean) => void;
}

const PREVIEW_DEBOUNCE_MS = 300;

type EveryPattern = Extract<TimePattern, { kind: "every" }>;
type ScheduleWindow = { from: string; to: string };

const S = "autopilots.schedule_editor";

/** 30s ticker so countdowns and the preview-refresh-on-past stay fresh. */
function useNowTicker(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

function isFullDay(window: ScheduleWindow): boolean {
  return timeParts(window.from).hour === 0 && timeParts(window.to).hour === 23;
}

function displayWindow(time: EveryPattern): ScheduleWindow {
  if (time.window !== null) return time.window;
  return time.unit === "hours"
    ? { from: `00:${pad2(time.minute)}`, to: `23:${pad2(time.minute)}` }
    : { from: "00:00", to: "23:59" };
}

function clampWindow(
  window: ScheduleWindow,
  unit: EveryPattern["unit"],
  minute: number,
): ScheduleWindow {
  const from = timeParts(window.from);
  const to = timeParts(window.to);
  const edgeMinute = unit === "hours" ? minute : 0;
  const endMinute = unit === "hours" ? minute : 59;
  const endHour = Math.max(to.hour, from.hour);
  return {
    from: `${pad2(from.hour)}:${pad2(edgeMinute)}`,
    to: `${pad2(endHour)}:${pad2(endMinute)}`,
  };
}

function timeAnchorOf(time: TimePattern): string | null {
  if (time.kind === "at") return time.time;
  if (time.window === null) return null;
  return `${pad2(timeParts(time.window.from).hour)}:${pad2(time.minute)}`;
}

function defaultAtTime(prev: TimePattern, anchor: string): string {
  return (
    timeAnchorOf(prev) ??
    `${pad2(timeParts(anchor).hour)}:${pad2(prev.kind === "every" ? prev.minute : 0)}`
  );
}

function defaultEveryTime(prev: TimePattern, anchor: EveryPattern | null): EveryPattern {
  if (prev.kind === "every") return prev;
  const { hour, minute } = timeParts(prev.time);
  const base: EveryPattern = anchor ?? {
    kind: "every",
    interval: 1,
    unit: "hours",
    window: null,
    minute,
  };
  const time: EveryPattern = { ...base, minute };
  if (time.window === null) return time;
  const rebased =
    hour < timeParts(time.window.to).hour
      ? { from: `${pad2(hour)}:${pad2(minute)}`, to: time.window.to }
      : time.window;
  const window = clampWindow(rebased, time.unit, minute);
  return { ...time, window: isFullDay(window) ? null : window };
}

function toggleDay(days: number[], day: number): number[] {
  if (days.includes(day)) {
    if (days.length === 1) return days;
    return days.filter((d) => d !== day);
  }
  return [...days, day].sort((a, b) => a - b);
}

function countdownText(
  t: (id: string, params?: Record<string, string | number>) => string,
  iso: string,
  now: Date,
): string {
  const diff = countdownDiff(iso, now);
  if (diff === null) return "";
  if (diff.kind === "less") return t(`${S}.countdown.less_than_minute`);
  if (diff.kind === "days") {
    return t(`${S}.countdown.days_hours`, {
      days: diff.days,
      hours: diff.hours,
      minutes: diff.minutes,
    });
  }
  if (diff.kind === "hours") {
    return t(`${S}.countdown.hours_minutes`, {
      hours: diff.hours,
      minutes: diff.minutes,
    });
  }
  return t(`${S}.countdown.minutes`, { minutes: diff.minutes });
}

function ScheduleField({
  label,
  disabled,
  children,
}: {
  label: string;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <View className={cn("gap-1.5", disabled && "opacity-60")}>
      <Text className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </Text>
      <View className="gap-2">{children}</View>
    </View>
  );
}

/** Chips row mirroring the web SegmentedToggle / triggerKind chips. */
function SegChips<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <View className="flex-row gap-2">
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            disabled={disabled}
            className={cn(
              "flex-1 rounded-lg border px-2 py-2.5 items-center",
              selected ? "border-primary/60 bg-primary/10" : "border-border bg-secondary/50",
            )}
          >
            <Text
              className={cn(
                "text-sm",
                selected ? "text-foreground font-medium" : "text-muted-foreground",
              )}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Step / day number: mirrors web NumberField — commits valid in-range input
 *  as you type, clamps (and snaps back on empty) on blur. */
function StepField({
  value,
  min,
  max,
  onCommit,
  ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
  ariaLabel: string;
}) {
  const [text, setText] = useState(String(value));
  const lastRef = useRef(value);
  if (lastRef.current !== value) {
    lastRef.current = value;
    setText(String(value));
  }
  return (
    <TextField
      value={text}
      accessibilityLabel={ariaLabel}
      keyboardType="number-pad"
      className="w-16 text-center"
      onChangeText={(raw) => {
        const cleaned = raw.replace(/[^0-9]/g, "");
        setText(cleaned);
        const n = parseInt(cleaned, 10);
        if (!Number.isNaN(n) && n >= min && n <= max) onCommit(n);
      }}
      onBlur={() => {
        const n = parseInt(text, 10);
        if (Number.isNaN(n)) {
          setText(String(lastRef.current));
          return;
        }
        const clamped = Math.min(max, Math.max(min, n));
        setText(String(clamped));
        if (clamped !== lastRef.current) onCommit(clamped);
      }}
    />
  );
}

/** A time "HH:MM" that opens a native spinner. `hourOnly` renders "HH" and
 *  commits minutes according to the unit convention (start :00 / end :59). */
function TimeField({
  value,
  hourOnly,
  onPick,
  ariaLabel,
}: {
  value: string;
  hourOnly: boolean;
  onPick: (value: string) => void;
  ariaLabel: string;
}) {
  const { hour, minute } = timeParts(value);
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const date = useMemo(() => {
    const d = new Date();
    d.setHours(hour, minute, 0, 0);
    return d;
  }, [hour, minute]);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityLabel={ariaLabel}
        className="min-w-20 flex-row items-center justify-center gap-1.5 rounded-md border border-border bg-secondary/50 px-3 py-2.5"
      >
        <Ionicons name="time-outline" size={15} color={muted} />
        <Text className="font-mono text-sm tabular-nums text-foreground">
          {hourOnly ? pad2(hour) : `${pad2(hour)}:${pad2(minute)}`}
        </Text>
      </Pressable>
      {open ? (
        <Modal transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <Pressable className="flex-1 bg-black/40" onPress={() => setOpen(false)}>
            <Pressable className="mx-6 my-auto rounded-2xl bg-popover p-4" onPress={() => {}}>
              <DateTimePicker
                value={date}
                mode="time"
                display="spinner"
                onChange={(event, selected) => {
                  if (event.type === "dismissed" || !selected) return;
                  const h = selected.getHours();
                  // For hour-only (minute-granular) windows the minute is the
                  // unit convention's (start :00 / end :59); clampWindow
                  // normalizes it, so only the hour is passed along. Android's
                  // spinner carries its own confirm row, which fires this
                  // handler — commit and close in one place.
                  onPick(hourOnly ? `${pad2(h)}:00` : `${pad2(h)}:${pad2(selected.getMinutes())}`);
                  setOpen(false);
                }}
              />
              <Pressable
                onPress={() => setOpen(false)}
                className="mt-2 items-center rounded-md bg-primary px-4 py-2"
              >
                <Text className="text-sm font-medium text-primary-foreground">
                  {t("common.done")}
                </Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </>
  );
}

export function ScheduleEditor({
  value,
  onChange,
  wsId,
  disabled,
  onValidityChange,
}: ScheduleEditorProps) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const now = useNowTicker();
  const advanced = value.raw !== null;
  const locked = disabled === true;
  const locale = getCurrentLocale() === "zh" ? "zh-CN" : "en-US";

  // The cron box mirrors the structured model except while typing: the draft
  // wins until applied on blur/Enter (never on a typing pause), so a half-typed
  // expression can't flip the editor into advanced-only mid-edit.
  const [cronDraft, setCronDraft] = useState<string | null>(null);
  const [cronEditing, setCronEditing] = useState(false);
  const committedCron = toCron(value);
  const fieldsText = cronFields(value);
  const cronText = cronDraft ?? fieldsText;
  const cronOpen = advanced || cronEditing;

  // The at/every switch keeps the time the user was last on, and the days
  // switch keeps each kind's own value (every-day has no day set, weekly has
  // no day number — a glance and back must not return Monday / day-1).
  const timeAnchorRef = useRef(timeAnchorOf(value.time) ?? "09:00");
  const currentAnchor = timeAnchorOf(value.time);
  if (currentAnchor !== null) timeAnchorRef.current = currentAnchor;

  const everyAnchorRef = useRef<EveryPattern | null>(null);
  if (value.time.kind === "every") everyAnchorRef.current = value.time;

  const intervalAnchorRef = useRef<Record<EveryPattern["unit"], number | null>>({
    hours: null,
    minutes: null,
  });
  if (value.time.kind === "every") {
    intervalAnchorRef.current[value.time.unit] = value.time.interval;
  }

  const daysOfWeekAnchorRef = useRef<number[]>([1]);
  const dayOfMonthAnchorRef = useRef(1);
  if (value.days.kind === "weekly") daysOfWeekAnchorRef.current = value.days.daysOfWeek;
  if (value.days.kind === "monthly") dayOfMonthAnchorRef.current = value.days.dayOfMonth;

  const applyDraft = (draft: string): boolean => {
    const next = draft.trim();
    setCronDraft(null);
    if (next.length === 0 || next === cronFields(value)) return advanced;
    // A typed `TZ=` prefix stays verbatim (advanced) until the server has
    // ruled on it — the zone is real or it isn't, and only the server knows.
    if (extractTimezonePrefix(next) !== null) {
      onChange({ ...value, raw: next });
      return true;
    }
    const parsed = parseCron(next, value.timezone);
    // An expression beyond the model keeps the structured schedule underneath
    // it rather than replacing it with parseCron's 09:00 defaults.
    onChange(parsed.raw === null ? parsed : { ...value, raw: next });
    return parsed.raw !== null;
  };

  const setTime = (time: TimePattern) => {
    setCronDraft(null);
    onChange({ ...value, time, raw: null });
  };
  const setDays = (days: DayPattern) => {
    setCronDraft(null);
    onChange({ ...value, days, raw: null });
  };
  const setTimezone = (timezone: string) => onChange({ ...value, timezone });

  // Debounced next-runs preview. Only a 400 means "this input is invalid" —
  // transport/server failures must not be painted as the user's cron being
  // wrong. The server tags which input it rejected (invalid_cron vs
  // invalid_timezone) so the message can name the right control.
  const previewExpr = useDebouncedValue(committedCron, PREVIEW_DEBOUNCE_MS);
  const preview = useQuery({
    queryKey: ["autopilot-cron-preview", previewExpr, value.timezone],
    queryFn: () => api.cronPreview({ expr: previewExpr, tz: value.timezone }),
    enabled: previewExpr.trim().length > 0,
    retry: false,
  });
  const { refetch } = preview;
  const nextRuns = preview.data?.next_runs ?? null;
  const previewIsCurrent = previewExpr === committedCron;
  const liveRejection =
    previewIsCurrent && preview.error instanceof ApiError && preview.error.status === 400
      ? preview.error
      : null;
  const scheduleRejection = liveRejection !== null ? classifyScheduleRejection(liveRejection) : null;
  const cronErrorDetail = scheduleRejection?.detail ?? null;
  const cronErrorCode = scheduleRejection?.code ?? null;

  const previewUnavailable =
    previewIsCurrent &&
    ((preview.error !== null && cronErrorDetail === null) ||
      (preview.isSuccess && nextRuns === null));

  const previewIsSettled = previewIsCurrent && preview.isSuccess && nextRuns !== null;
  const serverAccepted = previewIsSettled;

  // Keep the last readable list on screen while a newer one is in flight; dim
  // it until it belongs to the current expression.
  const shownRunsRef = useRef<{ runs: string[]; timezone: string } | null>(null);
  if (
    previewIsSettled &&
    (shownRunsRef.current?.runs !== nextRuns ||
      shownRunsRef.current.timezone !== value.timezone)
  ) {
    shownRunsRef.current = { runs: nextRuns, timezone: value.timezone };
  }
  const shownPreview = shownRunsRef.current;
  const shownRuns = useMemo(() => {
    if (shownPreview === null) return [];
    return shownPreview.runs.map((iso) => ({
      iso,
      label: formatInTimeZone(iso, shownPreview.timezone, locale),
      at: Date.parse(iso),
    }));
  }, [shownPreview, locale]);
  const previewIsPending = !previewIsSettled;

  // The preview is cached, so once its first entry is in the past the whole
  // list is stale — refresh it (guarded by the run it was fired for).
  const firstRunMs = nextRuns?.[0] !== undefined ? Date.parse(nextRuns[0]) : Number.NaN;
  const queriedKey = `${previewExpr} ${value.timezone}`;
  const refetchedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (Number.isNaN(firstRunMs) || firstRunMs > now.getTime()) return;
    const fetchedFor = `${queriedKey} ${firstRunMs}`;
    if (refetchedForRef.current === fetchedFor) return;
    refetchedForRef.current = fetchedFor;
    void refetch();
  }, [firstRunMs, now, refetch, queriedKey]);

  // The owning form's submit button lives outside this component, so it needs
  // to know the expression the server rejected.
  useEffect(() => {
    onValidityChange?.(cronErrorDetail === null);
  }, [cronErrorDetail, committedCron, value.timezone, onValidityChange]);

  const description = useMemo(() => describeSchedule(t, value), [t, value]);

  const [tzPickerOpen, setTzPickerOpen] = useState(false);

  const timeControlsDisabled = locked || advanced;
  const every = value.time.kind === "every" ? value.time : null;

  return (
    <View className="gap-5">
      {/* Time */}
      <ScheduleField
        label={t(`${S}.time_label`)}
        disabled={timeControlsDisabled}
      >
        <SegChips
          options={[
            { value: "at", label: t(`${S}.time_at`) },
            { value: "every", label: t(`${S}.time_every`) },
          ]}
          value={value.time.kind}
          disabled={timeControlsDisabled}
          onChange={(kind) => {
            setTime(
              kind === "at"
                ? { kind: "at", time: defaultAtTime(value.time, timeAnchorRef.current) }
                : defaultEveryTime(value.time, everyAnchorRef.current),
            );
          }}
        />
        {every === null ? (
          <TimeField
            value={value.time.kind === "at" ? value.time.time : "09:00"}
            hourOnly={false}
            ariaLabel={t(`${S}.a11y.fixed_hour`)}
            onPick={(v) => setTime({ kind: "at", time: v })}
          />
        ) : (
          <EveryTimeControls
            time={every}
            intervalAnchor={intervalAnchorRef.current}
            onSet={setTime}
          />
        )}
      </ScheduleField>

      {/* Days */}
      <ScheduleField label={t(`${S}.days_label`)} disabled={timeControlsDisabled}>
        <SegChips
          options={[
            { value: "every", label: t(`${S}.days_every`) },
            { value: "weekly", label: t(`${S}.days_weekly`) },
            { value: "monthly", label: t(`${S}.days_monthly`) },
          ]}
          value={value.days.kind}
          disabled={timeControlsDisabled}
          onChange={(kind) => {
            if (kind === "every") setDays({ kind: "every" });
            else if (kind === "weekly")
              setDays({ kind: "weekly", daysOfWeek: daysOfWeekAnchorRef.current });
            else setDays({ kind: "monthly", dayOfMonth: dayOfMonthAnchorRef.current });
          }}
        />
        {value.days.kind === "weekly" ? (
          <View className="flex-row gap-1">
            {DAY_KEYS.map((dayKey, i) => {
              const selected = value.days.kind === "weekly" && value.days.daysOfWeek.includes(i);
              return (
                <Pressable
                  key={dayKey}
                  accessibilityLabel={t(`${S}.a11y.days_full.${dayKey}`)}
                  accessibilityState={{ selected }}
                  onPress={() => {
                    if (value.days.kind !== "weekly") return;
                    setDays({
                      kind: "weekly",
                      daysOfWeek: toggleDay(value.days.daysOfWeek, i),
                    });
                  }}
                  className={cn(
                    "h-8 flex-1 items-center justify-center rounded-md",
                    selected
                      ? "bg-foreground"
                      : "bg-muted active:bg-muted-foreground/20",
                  )}
                >
                  <Text
                    className={cn(
                      "text-[11px] font-medium",
                      selected ? "text-background" : "text-muted-foreground",
                    )}
                  >
                    {t(`${S}.days_short.${dayKey}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        {value.days.kind === "monthly" && value.days.dayOfMonth >= 29 ? (
          <Text className="text-xs text-muted-foreground">
            {t(`${S}.monthly_short_month_hint`, { day: value.days.dayOfMonth })}
          </Text>
        ) : null}
      </ScheduleField>

      {/* Timezone */}
      <ScheduleField label={t(`${S}.timezone_label`)} disabled={locked}>
        <Pressable
          onPress={() => setTzPickerOpen(true)}
          disabled={locked}
          accessibilityLabel={t(`${S}.a11y.timezone`)}
          className="flex-row items-center gap-2 rounded-md border border-border bg-secondary/50 px-3 py-2.5"
        >
          <Ionicons name="globe-outline" size={16} color={muted} />
          <Text className="flex-1 text-sm text-foreground">{value.timezone}</Text>
          <Ionicons name="chevron-down" size={16} color={muted} />
        </Pressable>
        <TimezonePickerSheet
          visible={tzPickerOpen}
          value={value.timezone}
          onPick={setTimezone}
          onClose={() => setTzPickerOpen(false)}
        />
      </ScheduleField>

      {/* Cron readback + next-runs */}
      <View className="rounded-md bg-muted/40 p-2.5">
        <View className="gap-2">
          {description !== null ? (
            <View className="flex-row items-start gap-1.5">
              <Ionicons
                name="time-outline"
                size={13}
                color={muted}
                style={{ marginTop: 2 }}
              />
              <Text className="flex-1 text-sm text-foreground">{description}</Text>
            </View>
          ) : null}

          {cronOpen ? (
            <View className="gap-1">
              <Text className="font-mono text-[11px] text-muted-foreground">
                TZ={value.timezone}
              </Text>
              <TextField
                value={cronText}
                accessibilityLabel={t(`${S}.cron_toggle`)}
                autoFocus={cronEditing}
                autoCapitalize="none"
                autoCorrect={false}
                className="font-mono"
                onChangeText={setCronDraft}
                onBlur={() => {
                  const stillAdvanced = cronDraft !== null ? applyDraft(cronDraft) : advanced;
                  if (!stillAdvanced) setCronEditing(false);
                }}
                onSubmitEditing={() => {
                  if (cronDraft !== null) {
                    setCronEditing(true);
                    applyDraft(cronDraft);
                  }
                }}
              />
            </View>
          ) : (
            <Pressable
              onPress={() => setCronEditing(true)}
              accessibilityLabel={t(`${S}.cron_click_to_edit`)}
              className="flex-row items-center gap-1.5"
            >
              <Text className="min-w-0 flex-1 font-mono text-xs text-muted-foreground">
                {cronText}
              </Text>
              <Ionicons name="create-outline" size={13} color={muted} />
            </Pressable>
          )}

          {cronErrorDetail !== null ? (
            <View className="gap-0.5">
              <Text className="text-xs text-destructive">
                {cronErrorCode === "invalid_timezone"
                  ? t(`${S}.timezone_invalid`)
                  : t(`${S}.cron_invalid`)}
              </Text>
              <Text className="font-mono text-[10px] text-destructive">
                {cronErrorDetail}
              </Text>
            </View>
          ) : advanced ? (
            <Text className="text-xs text-muted-foreground">
              {serverAccepted
                ? t(`${S}.advanced_hint`)
                : previewUnavailable
                  ? t(`${S}.advanced_unverified`)
                  : t(`${S}.advanced_checking`)}
            </Text>
          ) : cronOpen ? (
            <Text className="text-xs text-muted-foreground">{t(`${S}.cron_hint`)}</Text>
          ) : null}
        </View>

        {cronErrorDetail === null ? (
          <View className="mt-2.5 border-t border-border/60 pt-2.5">
            <Text className="mb-1.5 text-sm font-medium text-foreground">
              {t(`${S}.next_runs_label`)}
            </Text>
            {previewUnavailable ? (
              <Text className="text-xs text-muted-foreground">
                {t(`${S}.preview_unavailable`)}
              </Text>
            ) : shownPreview !== null && shownPreview.runs.length > 0 ? (
              <View className={cn("gap-1", previewIsPending && "opacity-50")}>
                {shownRuns.map(({ iso, label, at }) => (
                  <View key={iso} className="flex-row items-center justify-between gap-3">
                    <Text className="text-sm text-foreground tabular-nums">{label}</Text>
                    <Text className="text-xs text-muted-foreground tabular-nums">
                      {Number.isNaN(at)
                        ? ""
                        : t(`${S}.next_in`, { countdown: countdownText(t, iso, now) })}
                    </Text>
                  </View>
                ))}
              </View>
            ) : previewIsSettled ? (
              <Text className="text-xs text-muted-foreground">
                {t(`${S}.no_upcoming_runs`)}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function EveryTimeControls({
  time,
  intervalAnchor,
  onSet,
}: {
  time: EveryPattern;
  intervalAnchor: Record<EveryPattern["unit"], number | null>;
  onSet: (time: TimePattern) => void;
}) {
  const { t } = useTranslation();
  const maxInterval = time.unit === "hours" ? 23 : 59;
  const window = displayWindow(time);

  // The end the user actually asked for. A window cannot run backwards: a
  // start pushed past the end drags the end along, and the end must come back
  // when the start does (else "09:00–15:00" briefly mis-started at 22:00 saves
  // as "09:00–22:00"). Mirrors web's endAnchor/draggedEnd pair.
  const endAnchorRef = useRef<number | null>(null);
  const draggedEndRef = useRef<number | null>(null);
  if (timeParts(window.to).hour !== draggedEndRef.current) {
    endAnchorRef.current = timeParts(window.to).hour;
  }
  const anchoredEnd = (from: string, to: string): string => {
    const end = Math.max(endAnchorRef.current ?? timeParts(to).hour, timeParts(from).hour);
    return `${pad2(end)}:${pad2(timeParts(to).minute)}`;
  };

  const setWindow = (next: ScheduleWindow, minute: number) => {
    const clamped = clampWindow(next, time.unit, minute);
    onSet({ ...time, minute, window: isFullDay(clamped) ? null : clamped });
  };

  const onFromPick = (v: string) => {
    const minute = time.unit === "hours" ? timeParts(v).minute : time.minute;
    const to = anchoredEnd(v, window.to);
    draggedEndRef.current = timeParts(to).hour;
    setWindow({ from: v, to }, minute);
  };
  const onToPick = (v: string) => {
    const minute = time.unit === "hours" ? timeParts(v).minute : time.minute;
    endAnchorRef.current = timeParts(v).hour;
    draggedEndRef.current = timeParts(v).hour;
    setWindow({ from: window.from, to: v }, minute);
  };

  return (
    <View className="gap-2">
      {/* Every N [hours|minutes] */}
      <View className="flex-row items-center gap-2">
        <Text className="text-sm text-muted-foreground">{t(`${S}.every_prefix`)}</Text>
        <StepField
          value={time.interval}
          min={1}
          max={maxInterval}
          ariaLabel={t(`${S}.a11y.interval`)}
          onCommit={(n) => onSet({ ...time, interval: n })}
        />
        <View className="flex-row gap-1">
          {(["hours", "minutes"] as const).map((unit) => {
            const selected = unit === time.unit;
            return (
              <Pressable
                key={unit}
                onPress={() => {
                  if (unit === time.unit) return;
                  const max = unit === "hours" ? 23 : 59;
                  onSet({
                    ...time,
                    unit,
                    interval: intervalAnchor[unit] ?? Math.min(time.interval, max),
                  });
                }}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                className={cn(
                  "rounded-md border px-2.5 py-1.5",
                  selected
                    ? "border-primary/60 bg-primary/10"
                    : "border-border bg-secondary/50",
                )}
              >
                <Text
                  className={cn(
                    "text-xs",
                    selected ? "text-foreground font-medium" : "text-muted-foreground",
                  )}
                >
                  {unit === "hours" ? t(`${S}.unit_hours`) : t(`${S}.unit_minutes`)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Window from ~ to */}
      <View className="flex-row items-center gap-2">
        <TimeField
          value={window.from}
          hourOnly={time.unit === "minutes"}
          ariaLabel={t(`${S}.a11y.window_start_hour`)}
          onPick={onFromPick}
        />
        <Text className="text-muted-foreground">~</Text>
        <TimeField
          value={window.to}
          hourOnly={time.unit === "minutes"}
          ariaLabel={t(`${S}.a11y.window_end_hour`)}
          onPick={onToPick}
        />
      </View>
    </View>
  );
}

/** Re-export so consumers don't reach into the component file for the type. */
export type { ScheduleWindow };