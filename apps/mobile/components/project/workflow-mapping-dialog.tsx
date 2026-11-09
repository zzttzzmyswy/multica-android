/**
 * The confirmation a workflow switch needs (MUL-7420, MYS-2690) — mobile's
 * rendering of web's `WorkflowMappingDialog`
 * (`packages/views/workflows/workflow-mapping-dialog.tsx`).
 *
 * ## Why a dialog rather than an `Alert`
 *
 * The switch can move issues, and the server refuses to do it silently: it
 * answers `409 workflow_status_mapping_required` until every status the target
 * workflow lacks has a destination. That refusal names between one and N
 * statuses, each needing its own choice — and a native alert cannot hold a
 * per-row picker, cannot be re-filled after a refusal, and cannot show how many
 * issues each row moves.
 *
 * ## What it shows, in web's order
 *
 *   1. the title, naming both the project and the workflow being adopted;
 *   2. one row per REQUIRED status: the status, its issue count, and a
 *      destination picker limited to the target workflow's own statuses
 *      (the server refuses a destination outside it — `checkMapping`, so
 *      offering more would be offering a write it rejects);
 *   3. the "these keep their status" summary, or "nothing moves" when there is
 *      nothing to map — the sentence that answers "will my board be shuffled?";
 *   4. the note that a switch hands nothing off and starts no runs, which is
 *      the question a member who has read about handoffs will ask next.
 *
 * The confirm button is disabled until every required status has a
 * destination (`statusMappingComplete`), matching web's `disabled={!complete}`.
 * A blank destination is not cosmetic: the server refuses the write with a
 * sentence naming a raw status key.
 *
 * ## The refusal path is the point
 *
 * A 409 can still arrive for a plan that was stale by the time the user
 * confirmed. The caller reads it (`lib/workflow-mapping-refusal.ts`), re-opens
 * this dialog with the server's plan, and shows `stalePlan` above the rows —
 * so the user corrects the mapping instead of reading an agent-facing error.
 */
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { IssueWorkflowMappingPlan } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { StatusIcon } from "@/components/ui/status-icon";
import { useIssueStatuses } from "@/data/queries/issue-statuses";
import { useStatusLabel } from "@/lib/status-options";
import {
  defaultStatusMapping,
  mappingAffectedIssues,
  mappingRequirements,
  mappingSummaryKind,
  mappingUnchangedIssues,
  statusMappingComplete,
} from "@/lib/project-workflow";
import { useColorScheme } from "@/lib/use-color-scheme";
import { useTranslation } from "@/lib/i18n/react";
import { THEME } from "@/lib/theme";

export interface WorkflowMappingDialogProps {
  /** null keeps the dialog closed; a plan opens it. */
  pending: {
    /** The workflow being adopted, for the title and description. */
    workflowName: string;
    projectName: string;
    plan: IssueWorkflowMappingPlan;
    /** The target workflow's statuses, in its own order. The destination
     *  picker offers exactly these. */
    targetKeys: string[];
  } | null;
  /** Set when the server refused a stale plan; shown above the rows. */
  staleNotice?: boolean;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: (mapping: Record<string, string>) => void;
}

export function WorkflowMappingDialog({
  pending,
  staleNotice = false,
  submitting,
  onCancel,
  onConfirm,
}: WorkflowMappingDialogProps) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  // Passing `undefined` lets the hooks resolve the store's current workspace —
  // the same call the pickers make. Both the catalog and the label resolver
  // are workspace-scoped, and the dialog is only ever mounted inside one.
  const { categoryOf } = useIssueStatuses();
  const labelOf = useStatusLabel();
  const [mapping, setMapping] = useState<Record<string, string>>({});
  /** Which required status's destination list is expanded. One at a time:
   *  the sheet holds a handful of rows and a single open list keeps the
   *  confirm button reachable without scrolling. */
  const [openRow, setOpenRow] = useState<string | null>(null);

  const plan = pending?.plan ?? null;
  // Memoized on the PROPS it derives from, not built inline: an array literal
  // in the effect's dependency list is a new identity every render, which makes
  // the re-seeding effect fire on every render — wiping the user's choices as
  // they make them.
  const targetKeys = useMemo(() => pending?.targetKeys ?? [], [pending?.targetKeys]);

  // Re-seed whenever the PLAN changes. Keyed on the plan and the target list,
  // exactly as web's `useEffect` is: a refusal that re-opens the dialog with a
  // different plan must not keep the destinations the user chose for the old
  // one (the statuses may not even be in the new plan).
  useEffect(() => {
    setMapping(defaultStatusMapping(plan, targetKeys));
    setOpenRow(null);
  }, [plan, targetKeys]);

  if (!pending) return null;

  const required = mappingRequirements(plan);
  const moving = mappingAffectedIssues(plan);
  const staying = mappingUnchangedIssues(plan);
  const summaryKind = mappingSummaryKind(plan);
  const complete = statusMappingComplete(plan, mapping);
  const separator = t("workflow.listSeparator");
  const unchangedNames = (plan?.unchanged ?? [])
    .map((row) => labelOf(row.status_key))
    .join(separator);

  const confirmLabel =
    moving > 0
      ? t(
          moving === 1
            ? "workflow.mapping.confirm_one"
            : "workflow.mapping.confirm_other",
          { count: moving },
        )
      : t("workflow.mapping.confirmPlain");

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!submitting) onCancel();
      }}
    >
      <View className="flex-1 items-center justify-center bg-black/50 px-4">
        <View className="w-full max-w-[480px] overflow-hidden rounded-xl bg-background">
          <View className="px-5 pb-2 pt-5">
            <Text className="text-title-sm font-semibold text-foreground">
              {t("workflow.mapping.title", {
                project: pending.projectName,
                workflow: pending.workflowName,
              })}
            </Text>
            <Text className="mt-1 text-body leading-5 text-muted-foreground">
              {t(
                (plan?.total_issues ?? 0) === 1
                  ? "workflow.mapping.description_one"
                  : "workflow.mapping.description_other",
                {
                  project: pending.projectName,
                  workflow: pending.workflowName,
                  count: plan?.total_issues ?? 0,
                },
              )}
            </Text>
          </View>

          <ScrollView
            className="max-h-[46vh]"
            contentContainerClassName="px-5 pb-3"
            showsVerticalScrollIndicator={false}
          >
            {staleNotice ? (
              <View
                accessibilityRole="alert"
                className="mb-3 flex-row items-start gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2"
              >
                <Ionicons
                  name="alert-circle-outline"
                  size={14}
                  color={theme.warning}
                  style={{ marginTop: 2 }}
                />
                <Text className="flex-1 text-caption text-foreground">
                  {t("workflow.mapping.stalePlan")}
                </Text>
              </View>
            ) : null}

            {required.length > 0 ? (
              <Text className="mb-1 text-caption font-medium text-muted-foreground">
                {t(
                  moving === 1
                    ? "workflow.mapping.needsMapping_one"
                    : "workflow.mapping.needsMapping_other",
                  { count: moving },
                )}
              </Text>
            ) : null}

            {required.map((row) => {
              const chosen = mapping[row.status_key] ?? "";
              const expanded = openRow === row.status_key;
              return (
                <View key={row.status_key} className="border-b border-border/60 py-2">
                  <View className="flex-row items-center gap-2">
                    <StatusIcon
                      status={row.status_key}
                      size={14}
                      category={categoryOf(row.status_key)}
                    />
                    <Text className="shrink text-body text-foreground" numberOfLines={1}>
                      {labelOf(row.status_key)}
                    </Text>
                    <Text className="text-caption tabular-nums text-muted-foreground">
                      {t(
                        row.issue_count === 1
                          ? "workflow.mapping.issueCount_one"
                          : "workflow.mapping.issueCount_other",
                        { count: row.issue_count },
                      )}
                    </Text>
                    <View className="flex-1" />
                    <Ionicons
                      name="arrow-forward"
                      size={13}
                      color={theme.mutedForeground}
                    />
                    <Pressable
                      onPress={() =>
                        setOpenRow(expanded ? null : row.status_key)
                      }
                      accessibilityRole="button"
                      accessibilityLabel={t("workflow.mapping.destination")}
                      className="flex-row items-center gap-1.5 rounded-md border border-border px-2 py-1 active:bg-secondary"
                    >
                      {chosen ? (
                        <StatusIcon
                          status={chosen}
                          size={13}
                          category={categoryOf(chosen)}
                        />
                      ) : null}
                      <Text className="text-body text-foreground">
                        {chosen ? labelOf(chosen) : t("workflow.mapping.destination")}
                      </Text>
                      <Ionicons
                        name={expanded ? "chevron-up" : "chevron-down"}
                        size={12}
                        color={theme.mutedForeground}
                      />
                    </Pressable>
                  </View>

                  {expanded ? (
                    <View className="mt-1.5 overflow-hidden rounded-md border border-border">
                      {targetKeys.map((key) => {
                        const selected = key === chosen;
                        return (
                          <Pressable
                            key={key}
                            onPress={() => {
                              setMapping((current) => ({
                                ...current,
                                [row.status_key]: key,
                              }));
                              setOpenRow(null);
                            }}
                            accessibilityRole="button"
                            accessibilityState={{ selected }}
                            className="flex-row items-center gap-2 px-3 py-2 active:bg-secondary"
                          >
                            <StatusIcon
                              status={key}
                              size={13}
                              category={categoryOf(key)}
                            />
                            <Text className="flex-1 text-body text-foreground">
                              {labelOf(key)}
                            </Text>
                            {selected ? (
                              <Ionicons
                                name="checkmark"
                                size={15}
                                color={theme.primary}
                              />
                            ) : null}
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}
                </View>
              );
            })}

            {/* Only when it can be TRUE — see `mappingSummaryKind`. A plan with
                rows required and nothing staying means every issue moves, and
                「nothing moves」 there contradicts the list directly above. */}
            {summaryKind !== "hidden" ? (
              <View className="mt-3 flex-row items-start gap-2 rounded-lg bg-secondary/60 px-3 py-2.5">
                <Ionicons
                  name="checkmark-circle-outline"
                  size={14}
                  color={theme.mutedForeground}
                  style={{ marginTop: 2 }}
                />
                <Text className="flex-1 text-caption leading-5 text-foreground">
                  {summaryKind === "unchanged"
                    ? t(
                        staying === 1
                          ? "workflow.mapping.unchanged_one"
                          : "workflow.mapping.unchanged_other",
                        { count: staying, statuses: unchangedNames },
                      )
                    : t("workflow.mapping.nothingMoves")}
                </Text>
              </View>
            ) : null}

            <Text className="mt-2 text-caption leading-5 text-muted-foreground">
              {t("workflow.mapping.note")}
            </Text>
          </ScrollView>

          <View className="flex-row justify-end gap-2 border-t border-border bg-secondary/25 px-5 py-3">
            <Button
              variant="outline"
              size="sm"
              onPress={onCancel}
              disabled={submitting}
            >
              <Text>{t("workflow.mapping.cancel")}</Text>
            </Button>
            <Button
              size="sm"
              onPress={() => onConfirm(mapping)}
              disabled={!complete || submitting}
            >
              {submitting ? (
                <ActivityIndicator size="small" color={theme.primaryForeground} />
              ) : (
                <Text>{confirmLabel}</Text>
              )}
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}
