/**
 * Workspace settings subscreen — mirrors web
 * `packages/views/settings/components/workspace-tab.tsx` semantics:
 *   - editable name + description for owners/admins (dirty check + saving
 *     state + inline error, styled like the Profile subscreen);
 *   - an editable issue prefix for owners/admins (normalize on type, save on
 *     blur behind a destructive confirm — renumbering breaks external
 *     references), read-only for everyone else;
 *   - read-only info rows (slug / created time) for everyone;
 *   - a Danger Zone for owners/admins: Leave (second-confirm via iOS Alert,
 *     sole-owner pre-flight mirrors web :152-153) and owner-only Delete
 *     (typed-confirmation modal mirroring delete-workspace-dialog.tsx —
 *     mobile renders its own Modal because Android has no Alert.prompt).
 *
 * The server stays the authoritative permission gate — `workspaceManagementGuards`
 * only decides what the UI shows (PATCH is admin-gated, DELETE owner-gated,
 * leave re-checks sole-owner). After a confirmed leave/delete the workspace
 * store is cleared BEFORE navigating to /select-workspace: ApiClient.fetch
 * injects X-Workspace-Slug from that store, and a stale slug after the
 * workspace is gone would leak into later requests.
 */
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { AutosizeTextArea } from "@/components/ui/autosize-textarea";
import { Separator } from "@/components/ui/separator";
import { memberListOptions } from "@/data/queries/members";
import { workspaceListOptions } from "@/data/queries/workspaces";
import { issueKeys } from "@/data/queries/issue-keys";
import {
  useDeleteWorkspace,
  useLeaveWorkspace,
  useUpdateWorkspace,
} from "@/data/mutations/workspaces";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useAuthStore } from "@/data/auth-store";
import { formatDateTime } from "@/lib/autopilot-format";
import {
  ISSUE_PREFIX_MAX_LENGTH,
  issuePrefixInvalid,
  normalizeIssuePrefix,
  shouldSaveIssuePrefix,
  workspaceManagementGuards,
  workspaceNameValidationError,
} from "@/lib/workspace-guards";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

type SaveStatus = "idle" | "saving" | "saved" | "error";

export default function WorkspaceSettingsScreen() {
  const { t } = useTranslation();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const clearWorkspace = useWorkspaceStore((s) => s.clear);
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  const { data: workspaces, isLoading: listLoading } = useQuery(
    workspaceListOptions(),
  );
  const workspace = useMemo(
    () => workspaces?.find((w) => w.id === wsId),
    [workspaces, wsId],
  );

  const {
    data: members,
    isFetching: membersLoading,
    isFetched: membersFetched,
  } = useQuery(memberListOptions(wsId));
  const currentMember = members?.find((m) => m.user_id === currentUserId);
  const { canManage, isOwner } = useMemo(
    () => workspaceManagementGuards({ currentRole: currentMember?.role }),
    [currentMember?.role],
  );
  const ownerCount = members?.filter((m) => m.role === "owner").length ?? 0;
  const isSoleOwner = isOwner && ownerCount <= 1;
  const membersReady = membersFetched && !membersLoading;

  const [name, setName] = useState(workspace?.name ?? "");
  const [description, setDescription] = useState(
    workspace?.description ?? "",
  );
  const [context, setContext] = useState(workspace?.context ?? "");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  // Issue prefix is its own field with its own blur-triggered save (web
  // workspace-tab.tsx:133-135, 246-258) — it is NOT part of the General
  // form's dirty/Save flow, because changing it renumbers every issue and
  // therefore takes a confirmation.
  const [issuePrefix, setIssuePrefix] = useState(workspace?.issue_prefix ?? "");
  const [prefixStatus, setPrefixStatus] = useState<SaveStatus>("idle");
  const queryClient = useQueryClient();
  const updateWorkspace = useUpdateWorkspace();
  const leaveWorkspace = useLeaveWorkspace();
  const deleteWorkspace = useDeleteWorkspace();
  const [deleteVisible, setDeleteVisible] = useState(false);

  // Reset form state only when the user switches to a different workspace.
  // Keying on workspace?.id (not the object ref) avoids wiping unsaved edits
  // when an unrelated mutation replaces the cached Workspace object via
  // refetch — same rationale as web workspace-tab.tsx:160-166.
  useEffect(() => {
    setName(workspace?.name ?? "");
    setDescription(workspace?.description ?? "");
    setContext(workspace?.context ?? "");
    setSaveStatus("idle");
    setIssuePrefix(workspace?.issue_prefix ?? "");
    setPrefixStatus("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on id only
  }, [workspace?.id]);

  const nameError = workspaceNameValidationError(name);
  // `context` is the workspace briefing agents read (web workspace-tab.tsx
  // `context_label`) — part of the same dirty/Save flow as name/description.
  const dirty =
    !!workspace &&
    (name.trim() !== (workspace.name ?? "") ||
      description !== (workspace.description ?? "") ||
      context !== (workspace.context ?? ""));

  const handleSave = async () => {
    if (!workspace || !canManage || saveStatus === "saving") return;
    if (nameError) return;
    setSaveStatus("saving");
    try {
      const updated = await updateWorkspace.mutateAsync({
        workspaceId: workspace.id,
        patch: {
          name: name.trim(),
          ...(description !== (workspace.description ?? "")
            ? { description }
            : {}),
          ...(context !== (workspace.context ?? "") ? { context } : {}),
        },
      });
      // The server response is the authoritative post-trim shape — sync the
      // form to it so the dirty check settles (e.g. trailing-space input).
      setName(updated.name);
      setDescription(updated.description ?? "");
      setContext(updated.context ?? "");
      setSaveStatus("saved");
    } catch (err) {
      setSaveStatus("error");
      Alert.alert(
        t("workspaceSettings.saveFailed"),
        err instanceof Error ? err.message : t("common.unknownError"),
      );
    }
  };

  const performPrefixSave = async (nextPrefix: string) => {
    if (!workspace || prefixStatus === "saving") return;
    setPrefixStatus("saving");
    try {
      const updated = await updateWorkspace.mutateAsync({
        workspaceId: workspace.id,
        patch: { issue_prefix: nextPrefix },
      });
      setIssuePrefix(updated.issue_prefix ?? nextPrefix);
      // Renumbering rewrites every issue's identifier, so any cached issue
      // list/page is stale — web invalidates `issueKeys.all(updated.id)`
      // (workspace-tab.tsx:231).
      void queryClient.invalidateQueries({ queryKey: issueKeys.all(workspace.id) });
      setPrefixStatus("saved");
    } catch (err) {
      // Roll the field back to the server's value: leaving the rejected
      // prefix on screen would make the next blur look like a fresh edit
      // and re-fire the same failing request.
      setIssuePrefix(workspace.issue_prefix ?? "");
      setPrefixStatus("error");
      Alert.alert(
        t("workspaceSettings.saveFailed"),
        err instanceof Error ? err.message : t("common.unknownError"),
      );
    }
  };

  const handlePrefixBlur = () => {
    if (!workspace || !canManage || prefixStatus === "saving") return;
    const next = normalizeIssuePrefix(issuePrefix);
    setIssuePrefix(next);
    // Nothing to do when the prefix is blank or already matches the server.
    if (!shouldSaveIssuePrefix(next, workspace.issue_prefix)) {
      if (issuePrefixInvalid(next)) setPrefixStatus("idle");
      return;
    }
    Alert.alert(
      t("workspaceSettings.issuePrefixConfirmTitle"),
      t("workspaceSettings.issuePrefixConfirmMessage", {
        oldPrefix: workspace.issue_prefix ?? "",
        newPrefix: next,
      }),
      [
        {
          text: t("common.cancel"),
          style: "cancel",
          onPress: () => setIssuePrefix(workspace.issue_prefix ?? ""),
        },
        {
          text: t("workspaceSettings.issuePrefixChange"),
          style: "destructive",
          onPress: () => void performPrefixSave(next),
        },
      ],
      { onDismiss: () => setIssuePrefix(workspace.issue_prefix ?? "") },
    );
  };

  const handleLeave = () => {
    if (!workspace || isSoleOwner) return;
    Alert.alert(
      t("workspaceSettings.leaveConfirmTitle", { name: workspace.name }),
      t("workspaceSettings.leaveConfirmMessage"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("workspaceSettings.leaveButton"),
          style: "destructive",
          onPress: () => runLeave(),
        },
      ],
    );
  };

  const runLeave = async () => {
    if (!workspace) return;
    try {
      await leaveWorkspace.mutateAsync(workspace.id);
      await clearWorkspace();
      router.replace("/select-workspace");
    } catch (err) {
      Alert.alert(
        t("workspaceSettings.leaveFailed"),
        err instanceof Error ? err.message : t("common.unknownError"),
      );
    }
  };

  const handleDelete = async () => {
    if (!workspace || !isOwner) return;
    try {
      await deleteWorkspace.mutateAsync(workspace.id);
      setDeleteVisible(false);
      await clearWorkspace();
      router.replace("/select-workspace");
    } catch (err) {
      setDeleteVisible(false);
      Alert.alert(
        t("workspaceSettings.deleteFailed"),
        err instanceof Error ? err.message : t("common.unknownError"),
      );
    }
  };

  if (listLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  if (!workspace) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-background px-6">
        <Text className="text-sm text-muted-foreground text-center">
          {t("workspaceSettings.notFound")}
        </Text>
        <Button variant="outline" onPress={() => router.replace("/select-workspace")}>
          <Text>{t("workspace.retry")}</Text>
        </Button>
      </View>
    );
  }

  const leaveBusy = leaveWorkspace.isPending;
  const deleteBusy = deleteWorkspace.isPending;

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="px-4 py-4 gap-6"
      keyboardShouldPersistTaps="handled"
    >
      {canManage && membersReady ? (
        <SectionGroup title={t("workspaceSettings.general")}>
          <View className="gap-4 p-4">
            <View>
              <Text className="text-xs text-muted-foreground mb-1.5">
                {t("workspaceSettings.name")}
              </Text>
              <TextField
                value={name}
                onChangeText={(v) => {
                  setName(v);
                  if (saveStatus === "saved" || saveStatus === "error") {
                    setSaveStatus("idle");
                  }
                }}
                placeholder={workspace.name}
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="done"
                editable={saveStatus !== "saving"}
                invalid={!!nameError}
              />
              {nameError ? (
                <Text className="text-xs text-destructive mt-1.5">
                  {t("workspaceSettings.nameRequired")}
                </Text>
              ) : null}
            </View>
            <View>
              <Text className="text-xs text-muted-foreground mb-1.5">
                {t("workspaceSettings.description")}
              </Text>
              <View className="rounded-md border border-border bg-background px-3 py-2">
                <AutosizeTextArea
                  value={description}
                  onChangeText={(v) => {
                    setDescription(v);
                    if (saveStatus === "saved" || saveStatus === "error") {
                      setSaveStatus("idle");
                    }
                  }}
                  placeholder={t("workspaceSettings.descriptionPlaceholder")}
                  editable={saveStatus !== "saving"}
                  minHeight={40}
                  maxHeight={128}
                />
              </View>
            </View>
            <View>
              <Text className="text-xs text-muted-foreground mb-1.5">
                {t("workspaceSettings.context")}
              </Text>
              <View className="rounded-md border border-border bg-background px-3 py-2">
                <AutosizeTextArea
                  value={context}
                  onChangeText={(v) => {
                    setContext(v);
                    if (saveStatus === "saved" || saveStatus === "error") {
                      setSaveStatus("idle");
                    }
                  }}
                  placeholder={t("workspaceSettings.contextPlaceholder")}
                  editable={saveStatus !== "saving"}
                  minHeight={80}
                  maxHeight={200}
                />
              </View>
            </View>
            <View className="flex-row items-center justify-between gap-3">
              <Text
                className={cn(
                  "text-xs",
                  saveStatus === "saved" && "text-emerald-600 dark:text-emerald-400",
                  saveStatus === "error" && "text-destructive",
                )}
              >
                {saveStatus === "saving"
                  ? t("workspaceSettings.saving")
                  : saveStatus === "saved"
                    ? t("workspaceSettings.saved")
                    : saveStatus === "error"
                      ? t("workspaceSettings.saveFailed")
                      : ""}
              </Text>
              <Button
                onPress={handleSave}
                disabled={!dirty || !!nameError || saveStatus === "saving"}
                size="sm"
              >
                <Text>
                  {saveStatus === "saving"
                    ? t("workspaceSettings.saving")
                    : t("workspaceSettings.save")}
                </Text>
              </Button>
            </View>
          </View>
        </SectionGroup>
      ) : null}

      {canManage && membersReady ? (
        <SectionGroup title={t("workspaceSettings.management")}>
          <ManageNavRow
            icon="flash"
            title={t("quickActions.title")}
            onPress={() =>
              router.push(`/${workspace.slug}/more/settings/quick-actions`)
            }
          />
          <Separator />
          <ManageNavRow
            icon="git-branch-outline"
            title={t("repositories.title")}
            onPress={() =>
              router.push(`/${workspace.slug}/more/settings/repositories`)
            }
          />
          <Separator />
          <ManageNavRow
            icon="git-merge-outline"
            title={t("integrations.title")}
            onPress={() =>
              router.push(`/${workspace.slug}/more/settings/integrations`)
            }
          />
        </SectionGroup>
      ) : null}

      <SectionGroup title={t("workspaceSettings.info")}>
        <View className="py-1">
          <InfoRow label={t("workspaceSettings.name")} value={workspace.name} />
          <Separator />
          <InfoRow label={t("workspaceSettings.slug")} value={`/${workspace.slug}`} mono />
          {!canManage && workspace.description ? (
            <>
              <Separator />
              <InfoRow
                label={t("workspaceSettings.description")}
                value={workspace.description}
              />
            </>
          ) : null}
          {!canManage && workspace.context ? (
            <>
              <Separator />
              <View className="px-4 py-3 gap-1">
                <Text className="text-sm text-muted-foreground">
                  {t("workspaceSettings.context")}
                </Text>
                <Text className="text-sm text-foreground">
                  {workspace.context}
                </Text>
              </View>
            </>
          ) : null}
          <Separator />
          {canManage ? (
            <View className="px-4 py-3 gap-1.5">
              <Text className="text-sm text-muted-foreground">
                {t("workspaceSettings.issuePrefix")}
              </Text>
              <TextField
                value={issuePrefix}
                onChangeText={(v) => {
                  setIssuePrefix(normalizeIssuePrefix(v));
                  if (prefixStatus !== "saving") setPrefixStatus("idle");
                }}
                onBlur={handlePrefixBlur}
                placeholder={workspace.issue_prefix}
                autoCapitalize="characters"
                autoCorrect={false}
                returnKeyType="done"
                maxLength={ISSUE_PREFIX_MAX_LENGTH}
                editable={prefixStatus !== "saving"}
                invalid={issuePrefixInvalid(issuePrefix)}
                className="font-mono uppercase"
              />
              <Text
                className={cn(
                  "text-xs",
                  prefixStatus === "error"
                    ? "text-destructive"
                    : "text-muted-foreground",
                )}
              >
                {issuePrefixInvalid(issuePrefix)
                  ? t("workspaceSettings.issuePrefixRequired")
                  : prefixStatus === "saving"
                    ? t("workspaceSettings.saving")
                    : prefixStatus === "saved"
                      ? t("workspaceSettings.saved")
                      : prefixStatus === "error"
                        ? t("workspaceSettings.saveFailed")
                        : t("workspaceSettings.issuePrefixHint", {
                            example: `${issuePrefix || workspace.issue_prefix || "ABC"}-123`,
                          })}
              </Text>
            </View>
          ) : (
            <InfoRow
              label={t("workspaceSettings.issuePrefix")}
              value={workspace.issue_prefix || "—"}
              mono
            />
          )}
          <Separator />
          <InfoRow
            label={t("workspaceSettings.createdAt")}
            value={formatDateTime(workspace.created_at)}
          />
        </View>
        {!canManage ? (
          <View className="border-t border-border px-4 py-3">
            <Text className="text-xs text-muted-foreground">
              {t("workspaceSettings.manageHint")}
            </Text>
          </View>
        ) : null}
      </SectionGroup>

      {canManage && membersReady ? (
        <SectionGroup title={t("workspaceSettings.dangerZone")}>
          <View className="px-4 py-3 gap-1">
            <View className="flex-row items-center gap-2">
              <Ionicons name="log-out-outline" size={15} color={theme.mutedForeground} />
              <Text className="text-sm font-medium text-foreground">
                {t("workspaceSettings.leaveTitle")}
              </Text>
            </View>
            <Text className="text-xs text-muted-foreground mt-1">
              {isSoleOwner
                ? t("workspaceSettings.leaveSoleOwner")
                : t("workspaceSettings.leaveDescription")}
            </Text>
            <View className="mt-2.5 self-start">
              <Button
                variant="outline"
                size="sm"
                onPress={handleLeave}
                disabled={isSoleOwner || leaveBusy || deleteBusy}
              >
                <Text>
                  {leaveBusy
                    ? t("workspaceSettings.leaving")
                    : t("workspaceSettings.leaveButton")}
                </Text>
              </Button>
            </View>
          </View>
          {isOwner ? (
            <>
              <Separator />
              <View className="px-4 py-3 gap-1">
                <View className="flex-row items-center gap-2">
                  <Ionicons name="trash-outline" size={15} color={theme.destructive} />
                  <Text className="text-sm font-medium text-destructive">
                    {t("workspaceSettings.deleteTitle")}
                  </Text>
                </View>
                <Text className="text-xs text-muted-foreground mt-1">
                  {t("workspaceSettings.deleteDescription")}
                </Text>
                <View className="mt-2.5 self-start">
                  <Button
                    variant="destructive"
                    size="sm"
                    onPress={() => setDeleteVisible(true)}
                    disabled={deleteBusy || leaveBusy}
                  >
                    <Text>
                      {deleteBusy
                        ? t("workspaceSettings.deleting")
                        : t("workspaceSettings.deleteButton")}
                    </Text>
                  </Button>
                </View>
              </View>
            </>
          ) : null}
        </SectionGroup>
      ) : null}

      <DeleteWorkspaceModal
        visible={deleteVisible}
        workspaceName={workspace.name}
        busy={deleteWorkspace.isPending}
        onConfirm={handleDelete}
        onClose={() => setDeleteVisible(false)}
      />
    </ScrollView>
  );
}

function SectionGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View className="gap-2">
      <Text className="text-xs uppercase tracking-wider text-muted-foreground px-1">
        {title}
      </Text>
      <View className="rounded-md border border-border bg-card overflow-hidden">
        {children}
      </View>
    </View>
  );
}

function InfoRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <View className="flex-row items-center justify-between px-4 py-3 gap-3">
      <Text className="text-sm text-muted-foreground">{label}</Text>
      <Text
        className={cn(
          "flex-1 text-right text-sm text-foreground",
          mono && "font-mono",
        )}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

function ManageNavRow({
  icon,
  title,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  onPress: () => void;
}) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center px-4 py-3.5 gap-3 active:bg-secondary"
    >
      <Ionicons name={icon} size={16} color={theme.mutedForeground} />
      <Text className="flex-1 text-sm font-medium text-foreground">{title}</Text>
      <Ionicons name="chevron-forward" size={16} color={theme.mutedForeground} />
    </Pressable>
  );
}

/**
 * Typed-confirmation delete dialog — mirrors web
 * delete-workspace-dialog.tsx: the destructive button stays disabled until
 * the user types the workspace name exactly (case-sensitive, no trim).
 * Rendered as our own Modal rather than iOS Alert.prompt because Android
 * ignores Alert.prompt's input entirely (mobile/CLAUDE.md native waterfall:
 * the RN-native API doesn't work cross-platform here).
 */
function DeleteWorkspaceModal({
  visible,
  workspaceName,
  busy,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  workspaceName: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState("");
  const matched = typed === workspaceName;

  useEffect(() => {
    if (!visible) setTyped("");
  }, [visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={busy ? undefined : onClose}
    >
      <Pressable
        className="flex-1 bg-black/40"
        onPress={busy ? undefined : onClose}
      >
        <View className="flex-1 items-center justify-center px-6">
          <Pressable onPress={() => {}} className="w-full max-w-sm">
            <View className="bg-popover rounded-2xl p-4 gap-3">
              <Text className="text-base font-semibold text-destructive">
                {t("workspaceSettings.deleteModalTitle")}
              </Text>
              <Text className="text-sm text-muted-foreground">
                {t("workspaceSettings.deleteModalDescription", {
                  name: workspaceName,
                })}
              </Text>
              <View>
                <Text className="text-xs text-muted-foreground mb-1.5">
                  {t("workspaceSettings.typeToConfirmPrefix")}{" "}
                  <Text className="font-mono text-foreground">
                    {workspaceName}
                  </Text>{" "}
                  {t("workspaceSettings.typeToConfirmSuffix")}
                </Text>
                <TextField
                  value={typed}
                  onChangeText={setTyped}
                  placeholder={workspaceName}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  editable={!busy}
                  autoFocus
                />
              </View>
              <View className="flex-row justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onPress={onClose}
                  disabled={busy}
                >
                  <Text>{t("common.cancel")}</Text>
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onPress={onConfirm}
                  disabled={!matched || busy}
                >
                  <Text>
                    {busy
                      ? t("workspaceSettings.deleting")
                      : t("workspaceSettings.deleteConfirm")}
                  </Text>
                </Button>
              </View>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}