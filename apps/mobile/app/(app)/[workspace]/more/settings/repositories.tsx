/**
 * Workspace repositories page (iteration-52) — mirrors web
 * `packages/views/settings/components/repositories-tab.tsx` on the phone.
 *
 * Repositories live INSIDE the Workspace object (PATCH /api/workspaces/:id
 * { repos }) — there is no standalone repositories endpoint, so every edit
 * PATCHes the whole array back. Rows show the clone url (mono), a source
 * badge (GitHub / manual — inferred from the host, since the server stores
 * only url + description), the description, and, for managers, a tap-to-edit
 * affordance plus a remove action.
 *
 * Editing a row's url / description goes through the same PATCH as add and
 * remove (web's repositories tab edits inline and auto-saves the array for
 * the same reason). It is a modal here rather than web's always-editable
 * inputs — see `EditRepositoryModal`.
 *
 * The GitHub import path pushes more/settings/repositories/github-picker.
 * Owner/admin gate mirrors web: non-managers get a read-only list with no
 * add/edit/remove/import affordances.
 */
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  View,
} from "react-native";
import { Stack, router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import type { WorkspaceRepo } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { workspaceListOptions } from "@/data/queries/workspaces";
import { githubInstallationsOptions } from "@/data/queries/github";
import {
  useAddWorkspaceRepo,
  useRemoveWorkspaceRepo,
  useUpdateWorkspaceRepo,
} from "@/data/mutations/repositories";
import { memberListOptions } from "@/data/queries/members";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { repositorySource } from "@/lib/repositories";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

export default function RepositoriesPage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const user = useAuthStore((s) => s.user);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  const {
    data: workspaces,
    isLoading,
    error,
    refetch,
    isRefetching,
  } = useQuery(workspaceListOptions());
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const currentMember = members.find((m) => m.user_id === user?.id) ?? null;
  const canManage =
    currentMember?.role === "owner" || currentMember?.role === "admin";

  const repos = useMemo(
    () => workspaces?.find((w) => w.id === wsId)?.repos ?? [],
    [workspaces, wsId],
  );

  const { data: githubData } = useQuery(githubInstallationsOptions(wsId));
  const githubInstalled = (githubData?.installations ?? []).length > 0;

  const [addOpen, setAddOpen] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const addRepo = useAddWorkspaceRepo();
  const removeRepo = useRemoveWorkspaceRepo();
  const updateRepo = useUpdateWorkspaceRepo();

  const editing = editIndex === null ? null : repos[editIndex] ?? null;

  const confirmRemove = (index: number, url: string) => {
    Alert.alert(
      t("repositories.deleteTitle"),
      t("repositories.deleteDescription"),
      [
        { text: t("quickActions.cancel"), style: "cancel" },
        {
          text: t("quickActions.delete"),
          style: "destructive",
          onPress: () => removeRepo.mutate(index),
        },
      ],
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: t("screen.repositories") }} />
      <View className="flex-1 bg-background">
        <View className="border-b border-border px-4 py-2.5">
          <Text className="text-xs text-muted-foreground leading-4">
            {t("repositories.description")}
          </Text>
        </View>

        {!canManage ? (
          <View className="border-b border-border px-4 py-2">
            <Text className="text-xs text-muted-foreground">
              {t("repositories.manageHint")}
            </Text>
          </View>
        ) : null}

        {isLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator />
          </View>
        ) : error ? (
          <View className="px-4 gap-3 pt-4">
            <Text className="text-sm text-destructive">
              {error instanceof Error
                ? error.message
                : t("common.unknownError")}
            </Text>
            <Button variant="outline" onPress={() => refetch()}>
              <Text>{t("workspace.retry")}</Text>
            </Button>
          </View>
        ) : repos.length === 0 ? (
          <View className="flex-1 items-center justify-center px-6 gap-1">
            <Ionicons name="git-branch-outline" size={32} color={theme.mutedForeground} />
            <Text className="text-sm text-muted-foreground text-center mt-2">
              {t("repositories.empty")}
            </Text>
            {canManage ? (
              <Button
                variant="outline"
                className="mt-3"
                onPress={() => setAddOpen(true)}
              >
                <Ionicons name="add" size={15} color={theme.mutedForeground} />
                <Text>{t("repositories.add")}</Text>
              </Button>
            ) : null}
          </View>
        ) : (
          <FlatList
            data={repos}
            keyExtractor={(_, index) => String(index)}
            ItemSeparatorComponent={() => <View className="h-px bg-border ml-4" />}
            contentContainerClassName="pb-6"
            renderItem={({ item, index }) => (
              <RepoRow
                repo={item}
                source={repositorySource(item.url)}
                canManage={canManage}
                onRemove={() => confirmRemove(index, item.url)}
                onEdit={() => setEditIndex(index)}
              />
            )}
            refreshing={isRefetching}
            onRefresh={refetch}
          />
        )}

        {canManage && repos.length > 0 ? (
          <View className="flex-row gap-2 border-t border-border px-4 py-3">
            <Button
              variant="outline"
              className="flex-1"
              onPress={() => setAddOpen(true)}
            >
              <Ionicons name="add" size={15} color={theme.mutedForeground} />
              <Text>{t("repositories.add")}</Text>
            </Button>
            <Button
              className="flex-1"
              onPress={() => {
                if (wsSlug) {
                  router.push(`/${wsSlug}/more/settings/repositories/github-picker`);
                }
              }}
            >
              <Ionicons name="logo-github" size={15} color={theme.primaryForeground} />
              <Text>
                {githubInstalled
                  ? t("repositories.chooseFromGitHub")
                  : t("repositories.connectGitHub")}
              </Text>
            </Button>
          </View>
        ) : null}
      </View>

      <AddRepositoryModal
        visible={addOpen}
        busy={addRepo.isPending}
        onClose={() => setAddOpen(false)}
        onAdd={async (url, description) => {
          await addRepo.mutateAsync({
            url,
            ...(description.trim() ? { description: description.trim() } : {}),
          });
          setAddOpen(false);
        }}
      />

      {/* Keyed by the row being edited so opening a different row remounts
          the modal with that row's values, instead of carrying the previous
          row's draft over. */}
      <EditRepositoryModal
        key={editIndex ?? "closed"}
        repo={editing}
        busy={updateRepo.isPending}
        onClose={() => setEditIndex(null)}
        onSave={async (repo) => {
          if (editIndex === null) return;
          await updateRepo.mutateAsync({ index: editIndex, repo });
          setEditIndex(null);
        }}
      />
    </>
  );
}

function RepoRow({
  repo,
  source,
  canManage,
  onRemove,
  onEdit,
}: {
  repo: WorkspaceRepo;
  source: "github" | "manual";
  canManage: boolean;
  onRemove: () => void;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;

  const body = (
    <View className="flex-1 min-w-0 gap-0.5">
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 font-mono text-sm text-foreground" numberOfLines={1}>
          {repo.url}
        </Text>
        <View className="rounded-full bg-secondary px-1.5 py-0.5">
          <Text className="text-[10px] text-muted-foreground font-medium">
            {source === "github"
              ? t("repositories.sourceGitHub")
              : t("repositories.sourceManual")}
          </Text>
        </View>
      </View>
      {repo.description ? (
        <Text className="text-xs text-muted-foreground/70" numberOfLines={1}>
          {repo.description}
        </Text>
      ) : null}
    </View>
  );

  return (
    <View className="px-4 py-3">
      <View className="flex-row items-center gap-3">
        {/* Managers tap the row to edit url / description; non-managers keep
            the plain read-only row they had (no edit affordance at all). */}
        {canManage ? (
          <Pressable
            onPress={onEdit}
            className="flex-1 flex-row items-center gap-2 active:opacity-60"
            accessibilityRole="button"
            accessibilityLabel={t("repositories.editTitle")}
            accessibilityHint={repo.url}
          >
            {body}
          </Pressable>
        ) : (
          body
        )}
        {canManage ? (
          <Pressable onPress={onRemove} hitSlop={8} className="p-1">
            <Ionicons name="trash-outline" size={16} color={muted} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Edit one repository's url / description.
 *
 * A modal rather than in-place fields (web's row is two always-editable
 * inputs): a 375pt row cannot hold a full clone url, a description and two
 * controls without the text collapsing to a few characters, and the settings
 * page's other row editors (quick actions, MCP servers) are modals too — the
 * surface should not have two editing idioms.
 *
 * The save button is gated on a non-empty url for the same reason web
 * disables its auto-save on `allUrlsValid`: the server rejects an empty url
 * with a 400, and a save that cannot succeed should not look available.
 */
function EditRepositoryModal({
  repo,
  busy,
  onClose,
  onSave,
}: {
  repo: WorkspaceRepo | null;
  busy: boolean;
  onClose: () => void;
  onSave: (repo: WorkspaceRepo) => Promise<void>;
}) {
  const { t } = useTranslation();
  // Seeded from the row this modal was opened on. The caller keys the modal
  // by the row index, so opening a different row remounts it with that row's
  // values rather than carrying the previous draft over.
  const [url, setUrl] = useState(repo?.url ?? "");
  const [description, setDescription] = useState(repo?.description ?? "");
  const [errorText, setErrorText] = useState<string | null>(null);

  const valid = url.trim().length > 0 && !busy;

  const submit = async () => {
    if (!url.trim()) {
      setErrorText(t("repositories.urlRequired"));
      return;
    }
    const trimmedDescription = description.trim();
    try {
      await onSave({
        url: url.trim(),
        ...(trimmedDescription ? { description: trimmedDescription } : {}),
      });
    } catch (err) {
      setErrorText(
        err instanceof Error ? err.message : t("common.unknownError"),
      );
    }
  };

  return (
    <Modal
      visible={repo !== null}
      transparent
      animationType="fade"
      onRequestClose={busy ? undefined : onClose}
    >
      <Pressable
        className="flex-1 bg-black/40"
        onPress={busy ? undefined : onClose}
      >
        <View className="flex-1 justify-end">
          <Pressable onPress={() => {}} className="bg-popover rounded-t-2xl p-4 gap-3">
            <Text className="text-base font-semibold text-foreground">
              {t("repositories.editTitle")}
            </Text>
            <View className="gap-1.5">
              <Text className="text-xs text-muted-foreground mb-1">URL</Text>
              <TextField
                value={url}
                onChangeText={(v) => {
                  setUrl(v);
                  setErrorText(null);
                }}
                placeholder={t("repositories.urlPlaceholder")}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                editable={!busy}
                invalid={!!errorText}
              />
              {errorText ? (
                <Text className="text-xs text-destructive">{errorText}</Text>
              ) : null}
            </View>
            <View className="gap-1.5">
              <Text className="text-xs text-muted-foreground mb-1">
                {t("repositories.description")}
              </Text>
              <TextField
                value={description}
                onChangeText={setDescription}
                placeholder={t("repositories.descriptionPlaceholder")}
                autoCapitalize="sentences"
                editable={!busy}
              />
            </View>
            <View className="flex-row justify-end gap-2">
              <Button variant="outline" size="sm" onPress={onClose} disabled={busy}>
                <Text>{t("quickActions.cancel")}</Text>
              </Button>
              <Button size="sm" onPress={submit} disabled={!valid}>
                <Text>
                  {busy ? t("workspaceSettings.saving") : t("common.save")}
                </Text>
              </Button>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

function AddRepositoryModal({
  visible,
  busy,
  onClose,
  onAdd,
}: {
  visible: boolean;
  busy: boolean;
  onClose: () => void;
  onAdd: (url: string, description: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);

  const valid = url.trim().length > 0 && !busy;

  const submit = async () => {
    if (!url.trim()) {
      setErrorText(t("repositories.urlRequired"));
      return;
    }
    try {
      await onAdd(url.trim(), description);
      setUrl("");
      setDescription("");
      setErrorText(null);
    } catch (err) {
      setErrorText(
        err instanceof Error ? err.message : t("common.unknownError"),
      );
    }
  };

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
        <View className="flex-1 justify-end">
          <Pressable onPress={() => {}} className="bg-popover rounded-t-2xl p-4 gap-3">
            <Text className="text-base font-semibold text-foreground">
              {t("repositories.addTitle")}
            </Text>
            <View className="gap-1.5">
              <Text className="text-xs text-muted-foreground mb-1">URL</Text>
              <TextField
                value={url}
                onChangeText={(v) => {
                  setUrl(v);
                  setErrorText(null);
                }}
                placeholder={t("repositories.urlPlaceholder")}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                editable={!busy}
                invalid={!!errorText}
              />
              {errorText ? (
                <Text className="text-xs text-destructive">{errorText}</Text>
              ) : null}
            </View>
            <View className="gap-1.5">
              <Text className="text-xs text-muted-foreground mb-1">
                {t("repositories.description")}
              </Text>
              <TextField
                value={description}
                onChangeText={setDescription}
                placeholder={t("repositories.descriptionPlaceholder")}
                autoCapitalize="sentences"
                editable={!busy}
              />
            </View>
            <View className="flex-row justify-end gap-2">
              <Button variant="outline" size="sm" onPress={onClose} disabled={busy}>
                <Text>{t("quickActions.cancel")}</Text>
              </Button>
              <Button size="sm" onPress={submit} disabled={!valid}>
                <Text>
                  {busy
                    ? t("workspaceSettings.saving")
                    : t("repositories.add")}
                </Text>
              </Button>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}