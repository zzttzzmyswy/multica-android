/**
 * Workflow handoff confirmation — web
 * `packages/views/workflows/handoff-confirm-dialog.tsx` (MUL-7420) as a
 * phone-native sheet (MYS-2743).
 *
 * ## Why this exists
 *
 * Iterations 288/289 taught the phone which statuses a workflow allows, but not
 * what entering one *does*. On the desktop, moving an issue into a handoff
 * column first says who it goes from and to, whether the previous agent is
 * still running, offers (pre-checked) to stop it, and shows the brief the new
 * handler receives. The phone reassigned silently: a user could hand a running
 * task to another agent without being told, while the first agent kept working
 * the same issue. That is a product-semantics divergence, not a UI difference.
 *
 * ## What it mirrors, point by point
 *
 * | Web (`handoff-confirm-dialog.tsx`) | Here |
 * |---|---|
 * | from-status → to-status with icons | the same row (`StatusIcon` + label) |
 * | workflow name beside it | the same |
 * | sentence: reassign / reassign_run / same_handler_run | `handoffSentenceKind` |
 * | warning box + default-on stop checkbox | the same, sentiment-coloured |
 * | collapsible brief (`BriefBlock`) | collapsible, monospace, preformatted |
 * | "preview says no handoff → apply silently" | `handoffGateKind` → `noHandoff` |
 * | a failed preview leaves Confirm disabled | `handoffConfirmRead.canConfirm` |
 *
 * ## Where it must differ, and why
 *
 *   - **A bottom sheet, not a centred dialog.** The content (a two-actor
 *     sentence, a warning box with a checkbox and a hint, an expandable
 *     multi-paragraph brief) is too tall for a phone-centred modal, and this is
 *     the container every other consequential choice in the app uses.
 *   - **The brief is plain preformatted text, not markdown.** The server's
 *     brief is a fixed scaffold (`Step instructions:` plus a status list plus a
 *     command list) — rendering it as markdown would re-style the server's own
 *     formatting for no gain. Upstream's `BriefBlock` is a plain block too.
 *   - **The failure state is load-bearing.** Upstream greys Confirm on error
 *     and stops there; on a phone a dead button with no explanation reads as a
 *     broken app, so the state also says *what* could not be established and
 *     offers Retry. The substance is identical — the move is NOT applied.
 *
 * ## The sentence is assembled from parts, not interpolated
 *
 * Web interpolates `FROM`/`TO` sentinels and swaps nodes back in
 * (`withChips`). React Native `Text` nests, so the sentence is split on the
 * actor names instead and the chips are nested inside it — same result, and it
 * keeps each actor's real name/avatar in the copy where the translator put it.
 *
 * The decisions themselves live in `lib/workflow-handoff.ts`, which is where
 * they are tested; this file is layout and wiring only.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { IssueStatus, IssueStatusCategory } from "@multica/core/types";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { StatusIcon } from "@/components/ui/status-icon";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useActorLookup } from "@/data/use-actor-name";
import { useIssueStatuses } from "@/data/queries/issue-statuses";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import {
  handoffConfirmRead,
  handoffDurationKey,
  handoffOldestRunStart,
  handoffSentenceKind,
  handoffStopDefault,
  handoffStopPayload,
  handoffTargetStatus,
  isHandoffRunStarted,
  sameHandoffHandler,
  type HandoffPreviewLike,
} from "@/lib/workflow-handoff";
import type { WorkflowReadState } from "@/lib/workflow-status-scope";

/** What the caller is moving: a status change, or a move into another project. */
export type HandoffTarget =
  | { kind: "status"; status: string }
  | { kind: "project"; projectId: string; projectTitle: string };

export interface HandoffConfirmDialogProps {
  /** The issue being moved; null keeps the sheet closed. */
  issue: { id: string; identifier: string } | null;
  target: HandoffTarget;
  /** The preview and its read state — see `data/queries/workflow-handoff.ts`. */
  preview: HandoffPreviewLike | null;
  readState: WorkflowReadState;
  /** Re-read after a failure. */
  onRetry: () => void;
  onCancel: () => void;
  /**
   * The user confirmed AND the read is authoritative. `stopPreviousRuns` is
   * already reduced to what the write should carry (never true when there is
   * nothing to stop, or when the handler is the actor already assigned).
   */
  onConfirm: (options: { stopPreviousRuns: boolean }) => void;
  /** Injectable clock, for tests and for a stable "now" across one render. */
  now?: number;
}

export function HandoffConfirmDialog({
  issue,
  target,
  preview,
  readState,
  onRetry,
  onCancel,
  onConfirm,
  now,
}: HandoffConfirmDialogProps) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const catalog = useIssueStatuses(wsId);
  const { resolveActorName } = useActorLookup();

  // The stop choice resets ON every time the sheet opens on a NEW target —
  // upstream resets it in an effect keyed on the same inputs. Carrying the
  // previous answer across a different handoff would let a "no" from one
  // target silently apply to another, which is how a user who once declined
  // ends up leaving two agents on one issue without ever seeing the box.
  const [stop, setStop] = useState(handoffStopDefault());
  const [briefOpen, setBriefOpen] = useState(false);
  const open = issue !== null;
  const targetKey = target.kind === "status" ? `s:${target.status}` : `p:${target.projectId}`;

  useEffect(() => {
    if (open) {
      setStop(handoffStopDefault());
      setBriefOpen(false);
    }
  }, [open, issue?.id, targetKey]);

  const read = handoffConfirmRead({
    isPending: readState === "pending",
    isError: readState === "failed",
    preview,
  });
  const landedStatus = handoffTargetStatus({
    preview,
    toStatus: target.kind === "status" ? target.status : "",
    toProject: target.kind === "project",
  });
  const fromStatus = preview?.from_status ?? "";
  const sameHandler = preview ? sameHandoffHandler(preview) : false;
  const runs = preview?.previous_runs ?? [];
  const started = runs.some(isHandoffRunStarted);
  const duration = handoffDurationKey(handoffOldestRunStart(runs), now);
  const sentenceKind = handoffSentenceKind(preview);

  const handlerType = preview?.handler_type ?? null;
  const handlerId = preview?.handler_id ?? null;
  const handlerNameState =
    handlerType && handlerId ? resolveActorName(handlerType, handlerId) : null;
  const handlerName = handlerNameState?.kind === "unsettled" ? "" : (handlerNameState?.name ?? "");
  // `unsettled` is "the directory has not answered" — a skeleton, not "Unknown".
  // `gone` IS a settled answer (the row is missing), so it prints its id
  // fragment rather than pretending to still be loading.
  const handlerNameSettled = handlerNameState?.kind !== "unsettled";

  const prevType = preview?.previous_assignee_type ?? null;
  const prevId = preview?.previous_assignee_id ?? null;
  const prevNameState = prevType && prevId ? resolveActorName(prevType, prevId) : null;
  const prevName =
    prevNameState && prevNameState.kind !== "unsettled"
      ? prevNameState.name
      : prevType && prevId
        ? ""
        : t("workflow.confirm.unassigned");
  const prevNameSettled = prevNameState?.kind !== "unsettled";

  const statusChip = (key: string) => (
    <View className="flex-row items-center gap-1">
      <StatusIcon
        status={key as IssueStatus}
        category={catalog.categoryOf(key) as IssueStatusCategory}
        color={catalog.entryOf(key)?.color}
        size={12}
      />
      <Text className="text-body text-foreground">{catalog.labelOf(key)}</Text>
    </View>
  );

  const durationText =
    duration.key === "under_minute"
      ? t("workflow.confirm.under_minute")
      : t(
          duration.count === 1
            ? `workflow.confirm.${duration.key}_one`
            : `workflow.confirm.${duration.key}_other`,
          { count: duration.count },
        );

  const title =
    target.kind === "project"
      ? t("workflow.confirm.project_title", {
          issue: issue?.identifier ?? "",
          project: target.projectTitle,
        })
      : t("workflow.confirm.title", {
          issue: issue?.identifier ?? "",
          status: catalog.labelOf(target.status),
        });

  const confirmLabel =
    target.kind === "project"
      ? t("workflow.confirm.project_confirm", { project: target.projectTitle })
      : t("workflow.confirm.confirm", { status: catalog.labelOf(target.status) });

  // The sheet stays open on `noHandoff` for exactly one frame in practice: the
  // caller applies the move and closes it. Rendering nothing there avoids a
  // flash of an empty sheet.
  const visible = open && read.state !== "noHandoff";

  /**
   * The leading sentence with the two actor names swapped for nested chips.
   * An unsettled name renders a skeleton rather than "Unknown" — see
   * `lib/actor-name-state.ts` for why that distinction is load-bearing.
   */
  const sentence = (): ReactNode => {
    if (!sentenceKind) return null;
    if (sentenceKind === "sameHandler") {
      const [before, after] = splitAround(
        t("workflow.confirm.same_handler_run", { to: "\u0000to\u0000" }),
        "\u0000to\u0000",
      );
      return (
        <Text className="text-body leading-7 text-foreground">
          {before}
          <ActorChip type={handlerType} id={handlerId} settled={handlerNameSettled} name={handlerName} theme={theme} />
          {after}
        </Text>
      );
    }
    const key =
      sentenceKind === "reassignRun"
        ? "workflow.confirm.reassign_run"
        : "workflow.confirm.reassign";
    const [beforeFrom, rest] = splitAround(
      t(key, { from: "\u0000from\u0000", to: "\u0000to\u0000" }),
      "\u0000from\u0000",
    );
    const [between, afterTo] = splitAround(rest ?? "", "\u0000to\u0000");
    return (
      <Text className="text-body leading-7 text-foreground">
        {beforeFrom}
        {prevType && prevId ? (
          <ActorChip
            type={prevType}
            id={prevId}
            settled={prevNameSettled}
            name={prevName}
            theme={theme}
          />
        ) : (
          <Text className="font-medium text-foreground">
            {t("workflow.confirm.unassigned")}
          </Text>
        )}
        {between}
        <ActorChip type={handlerType} id={handlerId} settled={handlerNameSettled} name={handlerName} theme={theme} />
        {afterTo}
      </Text>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View className="flex-1 justify-end bg-black/40">
        <Pressable className="absolute inset-0" onPress={onCancel} />
        <View className="max-h-[85%] rounded-t-2xl bg-popover">
          <View className="flex-row items-start gap-2 border-b border-border px-4 py-3">
            <View className="min-w-0 flex-1">
              <Text className="text-title-sm font-semibold text-foreground">{title}</Text>
              {/* from → to, the workflow's name. Rendered only once the read
                  has answered: printing a status row from a failed read would
                  assert facts this sheet does not have. */}
              {read.state === "confirm" ? (
                <View className="mt-1 flex-row flex-wrap items-center gap-1.5">
                  {fromStatus && fromStatus !== landedStatus ? (
                    <>
                      {statusChip(fromStatus)}
                      <Ionicons name="arrow-forward" size={12} color={theme.mutedForeground} />
                    </>
                  ) : null}
                  {landedStatus ? statusChip(landedStatus) : null}
                  {preview?.workflow_name ? (
                    <>
                      <Text className="text-body text-muted-foreground">·</Text>
                      <Text className="text-body text-muted-foreground">
                        {preview.workflow_name}
                      </Text>
                    </>
                  ) : null}
                </View>
              ) : null}
            </View>
            <Pressable
              onPress={onCancel}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t("workflow.confirm.sheetDismiss")}
              className="p-1"
            >
              <Ionicons name="close" size={20} color={theme.mutedForeground} />
            </Pressable>
          </View>

          <ScrollView contentContainerClassName="gap-4 px-4 py-3">
            {read.state === "pending" ? (
              <Text className="text-body text-muted-foreground">
                {t("workflow.project.checking")}
              </Text>
            ) : read.state === "error" ? (
              // Deliberately NOT "no handoff". The move is not applied; the
              // sheet says what could not be established and offers a retry.
              <View className="gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-3">
                <Text className="text-body font-medium text-foreground">
                  {t("workflow.confirm.error")}
                </Text>
                <Text className="text-caption leading-5 text-muted-foreground">
                  {t("workflow.confirm.errorBody")}
                </Text>
                <Pressable onPress={onRetry} hitSlop={6} accessibilityRole="button">
                  <Text className="text-caption font-medium text-brand">
                    {t("workflow.confirm.retry")}
                  </Text>
                </Pressable>
              </View>
            ) : (
              <>
                {sentence()}

                {runs.length > 0 && !sameHandler ? (
                  <View className="gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-3">
                    <View className="flex-row items-center gap-2">
                      <Ionicons name="warning" size={14} color={theme.warning} />
                      <Text className="flex-1 text-body font-medium text-foreground">
                        {started
                          ? t("workflow.confirm.running_title", {
                              name: prevName,
                              duration: durationText,
                            })
                          : t("workflow.confirm.queued_title", { name: prevName })}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => setStop((v) => !v)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: stop }}
                      className="flex-row items-center gap-2 py-1"
                    >
                      <Ionicons
                        name={stop ? "checkbox" : "square-outline"}
                        size={18}
                        color={stop ? theme.primary : theme.mutedForeground}
                      />
                      <Text className="flex-1 text-body text-foreground">
                        {started
                          ? t("workflow.confirm.stop_label", { name: prevName })
                          : t("workflow.confirm.cancel_queued_label", { name: prevName })}
                      </Text>
                    </Pressable>
                    <Text className="ml-6 text-caption leading-5 text-muted-foreground">
                      {started
                        ? t("workflow.confirm.stop_hint")
                        : t("workflow.confirm.queued_hint", { name: prevName })}
                    </Text>
                  </View>
                ) : null}

                {preview?.brief ? (
                  <View>
                    <Pressable
                      onPress={() => setBriefOpen((v) => !v)}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: briefOpen }}
                      className="flex-row items-center gap-1 py-1"
                    >
                      <Ionicons
                        name={briefOpen ? "chevron-down" : "chevron-forward"}
                        size={14}
                        color={theme.primary}
                      />
                      <Text className="text-caption font-medium text-brand">
                        {t("workflow.confirm.brief_toggle", { name: handlerName })}
                      </Text>
                    </Pressable>
                    {briefOpen ? (
                      <View className="mt-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
                        {/* Preformatted on purpose: the server's brief is a
                            fixed scaffold whose indentation carries meaning. */}
                        <Text className="font-mono text-caption leading-5 text-foreground">
                          {preview.brief}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </>
            )}
          </ScrollView>

          <View className="flex-row gap-2 border-t border-border px-4 py-3">
            <Button variant="outline" size="sm" className="flex-1" onPress={onCancel}>
              <Text>{t("workflow.confirm.cancel")}</Text>
            </Button>
            <Button
              size="sm"
              className="flex-1"
              disabled={!read.canConfirm}
              onPress={() => {
                // The tested reducer decides whether the flag rides along at
                // all — nothing to stop, or the handler is already the
                // assignee, both answer `{}`.
                const payload = handoffStopPayload({ preview, stop });
                onConfirm({ stopPreviousRuns: payload.stop_previous_assignee_runs === true });
              }}
            >
              <Text>{confirmLabel}</Text>
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** An actor as it appears inline in a sentence: avatar + name, or a skeleton. */
function ActorChip({
  type,
  id,
  settled,
  name,
  theme,
}: {
  type: string | null;
  id: string | null;
  settled: boolean;
  name: string;
  theme: (typeof THEME)["light"];
}) {
  // `ActorAvatar` takes the four known actor types. `previous_assignee_type` is
  // an open string on the wire; an unknown value renders no chip rather than a
  // broken avatar, which is the same "drift downgrades" rule the preview schema
  // applies to `handler_type`.
  if (!id || !isKnownActorType(type)) return null;
  return (
    <Text className="font-medium text-foreground">
      {" "}
      <ActorAvatar type={type} id={id} size={14} />
      {settled ? name : <Skeleton className="h-3 w-14" />}{" "}
    </Text>
  );
}

const KNOWN_ACTOR_TYPES = ["agent", "squad", "member"] as const;

function isKnownActorType(
  type: string | null,
): type is (typeof KNOWN_ACTOR_TYPES)[number] {
  return !!type && (KNOWN_ACTOR_TYPES as readonly string[]).includes(type);
}

/**
 * Split `text` on `marker`, returning the two halves. Used instead of web's
 * node-substitution helper because RN `Text` nests rather than composing
 * fragments. A missing marker yields `[text, undefined]`, so a translation that
 * dropped its placeholder degrades to a plain sentence instead of throwing.
 */
function splitAround(text: string, marker: string): [string, string | undefined] {
  const at = text.indexOf(marker);
  if (at < 0) return [text, undefined];
  return [text.slice(0, at), text.slice(at + marker.length)];
}
