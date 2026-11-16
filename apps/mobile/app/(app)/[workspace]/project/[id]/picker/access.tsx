/**
 * Project access sheet (MUL-8472, MYS-2915) — mobile's `ProjectAccessControl`
 * (`packages/views/projects/components/project-access.tsx:114-194`, deployed
 * `v0.9.0-myswy.2`).
 *
 * Presented as a `formSheet` like every other project property picker, and
 * self-contained for the same reason they are: it reads the project, the
 * workspace directory and the project's member rows from cache, and needs
 * nothing from the screen that pushed it.
 *
 * ## The write is a SAVE, not a tap-through
 *
 * The other pickers close on selection because one tap IS the write. This one
 * cannot: a visibility change carries a member list with it, and the list takes
 * several taps to assemble. So the sheet keeps a local draft and commits once,
 * which is also what web does (its footer is 「保存」 while dirty, 「完成」 when
 * not).
 *
 * ## The three writes, and why they are not one
 *
 *   - switching visibility → `PUT` with the COMPLETE member list;
 *   - adding on an already-private project → `POST /members` (immediate);
 *   - removing on an already-private project → `DELETE /members/{id}`
 *     (immediate).
 *
 * Add and remove are immediate because the rows they touch already exist
 * server-side; the draft mechanism exists for the list a FUTURE switch will
 * send, not for these. Collapsing them into the PUT would write a stale list
 * over members another client added in between.
 *
 * ## Publishing needs a second confirmation
 *
 * `visibilityRequiresPublishConfirm` gates it. Going private is reversible and
 * removes access; going public hands every issue, comment and attachment to the
 * whole workspace and cannot be taken back. A single tap must not do that.
 *
 * ## Failures say so and stay open
 *
 * A rejected write closes nothing. Dismissing on error would be
 * indistinguishable from success, and the user would walk away believing the
 * project is private when it is not.
 */
import { useMemo, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { ProjectVisibility } from "@multica/core/types";
import { ProjectAccessBody } from "@/components/project/project-access-body";
import { Text } from "@/components/ui/text";
import {
  projectDetailOptions,
  projectMembersOptions,
} from "@/data/queries/projects";
import { memberListOptions } from "@/data/queries/members";
import { useProjectAccessMutation } from "@/data/mutations/project-access";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  canManageProjectAccess,
  canRemoveProjectMember,
  projectAccessSelection,
  resolveProjectVisibility,
  visibilityRequiresPublishConfirm,
} from "@/lib/project-access";
import { useTranslation } from "@/lib/i18n/react";

export default function ProjectAccessPickerRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const userId = useAuthStore((s) => s.user?.id ?? null);

  const detail = useQuery(projectDetailOptions(wsId, id));
  const membersRead = useQuery(memberListOptions(wsId));
  const projectMembersRead = useQuery(projectMembersOptions(wsId, id));
  const changeAccess = useProjectAccessMutation(id);

  const project = detail.data;
  const currentVisibility = resolveProjectVisibility(project ?? {});
  const leadId = project?.lead_type === "member" ? project.lead_id : null;

  // The draft is seeded lazily so it tracks the project until the user touches
  // it: `null` means "still following the server", which is what makes
  // `projectAccessSelection` able to tell a first switch from a settled one.
  const [draftVisibility, setDraftVisibility] =
    useState<ProjectVisibility | null>(null);
  const [draftIds, setDraftIds] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visibility = draftVisibility ?? currentVisibility;
  const workspaceMembers = membersRead.data ?? [];
  // Memoised: `?? []` allocates a new array each render, which would make the
  // `selectedIds` memo below recompute on every render for no reason.
  const projectMembers = useMemo(
    () => projectMembersRead.data?.members ?? [],
    [projectMembersRead.data],
  );
  const role = workspaceMembers.find((m) => m.user_id === userId)?.role ?? null;

  const canManage = canManageProjectAccess(
    project ?? { lead_type: null, lead_id: null },
    userId,
    role,
  );

  const selectedIds = useMemo(
    () =>
      projectAccessSelection({
        currentVisibility,
        currentMemberIds: projectMembers.map((m) => m.user_id),
        currentUserId: userId,
        leadId,
        draftIds,
      }),
    [currentVisibility, projectMembers, userId, leadId, draftIds],
  );

  const loading = detail.isPending || membersRead.isPending || projectMembersRead.isPending;
  const loadFailed = detail.isError || membersRead.isError || projectMembersRead.isError;
  const pending = changeAccess.isPending;
  const dirty = visibility !== currentVisibility;

  const retry = () => {
    void detail.refetch();
    void membersRead.refetch();
    void projectMembersRead.refetch();
  };

  const run = async (change: Parameters<typeof changeAccess.mutateAsync>[0]) => {
    setError(null);
    try {
      await changeAccess.mutateAsync(change);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : t("projects.access.failed"));
      return false;
    }
  };

  const save = async () => {
    if (await run({ type: "visibility", visibility, memberIds: selectedIds })) {
      router.back();
    }
  };

  const commit = () => {
    if (!dirty) {
      router.back();
      return;
    }
    if (visibilityRequiresPublishConfirm(currentVisibility, visibility)) {
      // Deliberately an Alert rather than the sheet's own confirm frame: the
      // sheet is about to close on success, and a nested modal inside a
      // formSheet is not reliably dismissible on Android.
      Alert.alert(
        t("projects.access.publish_title"),
        t("projects.access.publish_description"),
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("projects.access.publish_confirm"),
            onPress: () => {
              void save();
            },
          },
        ],
      );
      return;
    }
    void save();
  };

  const onAdd = (memberId: string) => {
    if (currentVisibility === "private") {
      void run({ type: "add", userId: memberId });
      return;
    }
    setDraftIds([...selectedIds, memberId]);
  };

  const onRemove = (memberId: string) => {
    if (currentVisibility !== "private") {
      setDraftIds(selectedIds.filter((v) => v !== memberId));
      return;
    }
    void run({ type: "remove", userId: memberId });
  };

  const canRemove = (targetId: string) =>
    canRemoveProjectMember({
      targetId,
      currentUserId: userId,
      leadId,
      canManage,
    });

  return (
    <View className="flex-1">
      <View className="px-4 pt-3 pb-1">
        <Text className="text-title-sm font-semibold text-foreground">
          {t("projects.access.label")}
        </Text>
        <Text className="mt-1 text-caption text-muted-foreground">
          {t("projects.access.description")}
        </Text>
      </View>

      <ProjectAccessBody
        visibility={visibility}
        onVisibilityChange={(next) => {
          setDraftVisibility(next);
          setError(null);
        }}
        workspaceMembers={workspaceMembers}
        projectMembers={projectMembers}
        selectedIds={selectedIds}
        currentUserId={userId}
        leadId={leadId}
        canManage={canManage}
        pending={pending}
        loading={loading}
        loadFailed={loadFailed}
        onRetry={retry}
        onAdd={onAdd}
        onRemove={onRemove}
        canRemove={canRemove}
      />

      {error ? (
        <Text
          className="px-4 pb-2 text-caption text-destructive"
          accessibilityRole="alert"
        >
          {error}
        </Text>
      ) : null}

      {/* The footer mirrors web's: 「保存」 while dirty, 「完成」 when the sheet
          is only being read. A disabled 「完成」 would read as a broken button,
          so the non-dirty case stays enabled and simply dismisses. */}
      <View className="border-t border-border px-4 py-3">
        <Pressable
          onPress={commit}
          disabled={pending || (dirty && (loading || loadFailed))}
          accessibilityRole="button"
          accessibilityState={{ disabled: pending || (dirty && (loading || loadFailed)), busy: pending }}
          className={
            pending || (dirty && (loading || loadFailed))
              ? "items-center rounded-xl bg-brand/40 py-3"
              : "items-center rounded-xl bg-brand py-3 active:opacity-80"
          }
        >
          <Text className="text-body font-semibold text-white">
            {dirty ? t("common.save") : t("projects.access.done")}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
