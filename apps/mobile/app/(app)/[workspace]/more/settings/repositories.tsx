/**
 * Workspace repositories page (iteration-52) — mirrors web
 * `packages/views/settings/components/repositories-tab.tsx` on the phone.
 *
 * Repositories live INSIDE the Workspace object (PATCH /api/workspaces/:id
 * { repos }) — there is no standalone repositories endpoint. The list reads
 * the current workspace's `repos` from the workspace-list query; Add and
 * Remove PATCH the array back through the workspace update. Rows show the
 * clone url (mono), a source badge (GitHub / manual — inferred from the
 * host, since the server stores only url + description), the description,
 * and a remove action for managers.
 *
 * The GitHub import path pushes more/settings/repositories/github-picker.
 * Owner/admin gate mirrors web: non-managers get a read-only list with no
 * add/remove/import affordances.
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
  const addRepo = useAddWorkspaceRepo();
  const removeRepo = useRemoveWorkspaceRepo();

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
    </>
  );
}

function RepoRow({
  repo,
  source,
  canManage,
  onRemove,
}: {
  repo: WorkspaceRepo;
  source: "github" | "manual";
  canManage: boolean;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;

  return (
    <View className="px-4 py-3">
      <View className="flex-row items-center gap-3">
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
        {canManage ? (
          <Pressable onPress={onRemove} hitSlop={8} className="p-1">
            <Ionicons name="trash-outline" size={16} color={muted} />
          </Pressable>
        ) : null}
      </View>
    </View>
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