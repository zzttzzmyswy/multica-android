/**
 * Autopilot edit screen (PATCH). Push target of the detail page's "Edit"
 * action — prefill the shared form from the detail payload, then PATCH the
 * touched fields wholesale (title / description / project / assignee type+id
 * / execution_mode / subscribers), mirroring web's edit-mode dialog.
 *
 * The form mounts only after the detail payload is present (`key={id}`), so
 * the prefill state is stable — never the empty-initial → late-fill race.
 * A failed save keeps the form mounted with the user's input intact and
 * alerts; success returns to the detail page (which re-fetches via the
 * mutation's settle invalidate).
 *
 * The record read is `recordRead` (MYS-1908): a failed detail read used to
 * fall through to 「还没有自动化」 with no retry.
 */
import { useCallback, useMemo, useRef } from "react";
import { Alert, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { AutopilotSubscriber } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { CatalogStatus } from "@/components/catalog/catalog-status";
import {
  AutopilotForm,
  type AutopilotFormHandle,
  type AutopilotFormInitial,
} from "@/components/autopilot/autopilot-form";
import { autopilotDetailOptions } from "@/data/queries/autopilots";
import { useUpdateAutopilot } from "@/data/mutations/autopilots";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";
import { recordRead } from "@/lib/catalog-read";
import {
  buildUpdateAutopilotRequest,
  type AutopilotFormValues,
} from "@/lib/autopilot-form-values";

export default function EditAutopilotPage() {
  const { id } = useLocalSearchParams<{ id: string; workspace: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useTranslation();
  const formRef = useRef<AutopilotFormHandle>(null);
  const detail = useQuery(autopilotDetailOptions(wsId, id));
  const updateAutopilot = useUpdateAutopilot();
  const isSubmitting = updateAutopilot.isPending;

  const autopilot = detail.data?.autopilot;
  const read = recordRead(autopilot, [detail]);

  const initial = useMemo<AutopilotFormInitial>(() => {
    const a = detail.data?.autopilot;
    if (!a) return EMPTY_INITIAL;
    const subscribers = Array.isArray(a.subscribers)
      ? (a.subscribers as AutopilotSubscriber[])
      : [];
    return {
      title: a.title,
      description: a.description ?? "",
      projectId: a.project_id ?? null,
      assigneeType: a.assignee_type ?? "agent",
      assigneeId: a.assignee_id,
      executionMode: a.execution_mode,
      subscriberUserIds: subscribers
        .filter((s) => s.user_type === "member")
        .map((s) => s.user_id),
    };
  }, [detail.data]);

  const handleSubmit = useCallback(
    async (values: AutopilotFormValues) => {
      if (!id) return;
      try {
        await updateAutopilot.mutateAsync(
          buildUpdateAutopilotRequest(id, values),
        );
        router.back();
      } catch (err) {
        Alert.alert(
          t("autopilots.edit.failedTitle"),
          err instanceof Error ? err.message : t("common.unknownError"),
        );
      }
    },
    [id, updateAutopilot, t],
  );

  const headerRight = useCallback(
    () => (
      <Button
        size="sm"
        disabled={isSubmitting}
        onPress={() => formRef.current?.submit()}
      >
        <Text>
          {isSubmitting
            ? t("autopilots.edit.saving")
            : t("autopilots.edit.save")}
        </Text>
      </Button>
    ),
    [isSubmitting, t],
  );

  if (!read.isResolved) {
    return (
      <View className="flex-1 justify-center bg-background">
        <CatalogStatus state={read.state} onRetry={read.retry} layout="centered" />
      </View>
    );
  }

  if (!autopilot) {
    return (
      <View className="flex-1 justify-center bg-background">
        <CatalogStatus
          state="empty"
          onRetry={read.retry}
          emptyMessage={t("autopilots.notFound")}
          layout="centered"
        />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: t("autopilots.edit.title"),
          headerRight,
        }}
      />
      <AutopilotForm
        key={autopilot.id}
        ref={formRef}
        mode="edit"
        initial={initial}
        isSubmitting={isSubmitting}
        onSubmit={handleSubmit}
      />
    </>
  );
}

const EMPTY_INITIAL: AutopilotFormInitial = {
  title: "",
  description: "",
  projectId: null,
  assigneeType: "agent",
  assigneeId: "",
  executionMode: "create_issue",
  subscriberUserIds: [],
};