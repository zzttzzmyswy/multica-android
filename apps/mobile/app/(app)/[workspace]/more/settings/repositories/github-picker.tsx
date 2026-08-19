/**
 * GitHub repository import page (iteration-52) — mirrors web's repositories
 * GitHub picker dialog. Lists installations (an account chip row when there
 * are several), the browsable repositories under the selected installation
 * (searchable, first 100), and imports the checked rows into the workspace's
 * `repos` array in one PATCH.
 *
 * When the workspace has no GitHub installation, the page offers a "Connect
 * GitHub" action that opens the App install URL minted by the server
 * (api.getGitHubConnectURL) in the system browser — the OAuth handshake
 * happens there; returning to the app re-opens this page to pick repos.
 */
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { Stack, router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import type { GitHubRepository } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { workspaceListOptions } from "@/data/queries/workspaces";
import { githubInstallationsOptions, githubKeys } from "@/data/queries/github";
import { api } from "@/data/api";
import { useMergeWorkspaceRepos } from "@/data/mutations/repositories";
import { useWorkspaceStore } from "@/data/workspace-store";
import { repositoryIdentity } from "@/lib/repositories";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

const PER_PAGE = 100;

export default function GitHubPickerPage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  const { data: githubData, isPending: installationsPending } = useQuery(
    githubInstallationsOptions(wsId),
  );
  const installations = useMemo(
    () => githubData?.installations ?? [],
    [githubData?.installations],
  );
  const connectConfigured = githubData?.configured === true;
  const browseConfigured = githubData?.repository_browse_configured === true;

  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const [installationId, setInstallationId] = useState<string>("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const { data: workspaces } = useQuery(workspaceListOptions());
  const workspace = workspaces?.find((w) => w.id === wsId);
  const existingIdentities = useMemo(() => {
    const repos = workspace?.repos ?? [];
    return new Set(
      repos
        .map((r) => repositoryIdentity(r.url))
        .filter((v): v is string => !!v),
    );
  }, [workspace]);

  const { data: repoPage, isPending: reposPending } = useQuery({
    queryKey: githubKeys.repositories(wsId, installationId),
    queryFn: () =>
      api.listGitHubInstallationRepositories(wsId ?? "", installationId, {
        page: 1,
        per_page: PER_PAGE,
      }),
    enabled: !!wsId && !!installationId && browseConfigured,
  });
  const repositories = useMemo(
    () => repoPage?.repositories ?? [],
    [repoPage],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return repositories;
    return repositories.filter((r) =>
      r.full_name.toLowerCase().includes(q),
    );
  }, [repositories, query]);

  const toggle = (repository: GitHubRepository) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(repository.id)) next.delete(repository.id);
      else next.add(repository.id);
      return next;
    });
  };

  const merge = useMergeWorkspaceRepos();

  const handleConnect = async () => {
    if (connecting) return;
    setConnecting(true);
    setConnectError(null);
    try {
      const resp = await api.getGitHubConnectURL(wsId ?? "", "repositories");
      if (!resp.configured || !resp.url) {
        setConnectError(t("repositories.githubNotConfigured"));
        return;
      }
      Linking.openURL(resp.url);
    } catch (err) {
      setConnectError(
        err instanceof Error
          ? err.message
          : t("repositories.githubConnectFailed"),
      );
    } finally {
      setConnecting(false);
    }
  };

  const handleImport = async () => {
    if (selected.size === 0) return;
    const additions = repositories
      .filter((r) => selected.has(r.id) && !r.archived)
      .map((r) => ({
        url: r.clone_url,
        ...(r.description?.trim()
          ? { description: r.description.trim() }
          : {}),
      }))
      .filter((r) => {
        const identity = repositoryIdentity(r.url);
        return !!identity && !existingIdentities.has(identity);
      });
    if (additions.length > 0) {
      await merge.mutateAsync(additions);
    }
    router.back();
  };

  return (
    <>
      <Stack.Screen options={{ title: t("repositories.githubPickerTitle") }} />
      {installationsPending ? (
        <View className="flex-1 items-center justify-center bg-background">
          <ActivityIndicator />
        </View>
      ) : installations.length === 0 ? (
        <View className="flex-1 items-center justify-center bg-background px-6 gap-3">
          <Ionicons name="logo-github" size={40} color={theme.mutedForeground} />
          <Text className="text-sm text-muted-foreground text-center">
            {t("repositories.githubNotConfigured")}
          </Text>
          {connectConfigured ? (
            <Button onPress={handleConnect} disabled={connecting}>
              <Text>
                {connecting
                  ? t("workspaceSettings.saving")
                  : t("repositories.connectGitHub")}
              </Text>
            </Button>
          ) : (
            <Text className="text-xs text-muted-foreground/70 text-center">
              {t("repositories.githubBrowseNotConfigured")}
            </Text>
          )}
          {connectError ? (
            <Text className="text-xs text-destructive text-center">
              {connectError}
            </Text>
          ) : null}
        </View>
      ) : (
        <View className="flex-1 bg-background">
          {installations.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              className="border-b border-border"
              contentContainerClassName="px-4 py-2 gap-2"
            >
              {installations.map((installation) => {
                const active = installation.id === installationId;
                return (
                  <Pressable
                    key={installation.id}
                    onPress={() => {
                      setInstallationId(installation.id);
                      setSelected(new Set());
                      setQuery("");
                    }}
                    className={cn(
                      "rounded-full border px-3 py-1",
                      active
                        ? "border-primary bg-accent/60"
                        : "border-border bg-background",
                    )}
                  >
                    <Text
                      className={cn(
                        "text-xs font-medium",
                        active ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {installation.account_login}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : (
            <View className="border-b border-border px-4 py-2.5">
              <Text className="text-xs text-muted-foreground">
                {t("repositories.chooseFromGitHub")}:{" "}
                <Text className="font-medium text-foreground">
                  {installations[0].account_login}
                </Text>
              </Text>
            </View>
          )}

          {installationId && (
            <View className="border-b border-border px-4 py-2">
              <View className="flex-row items-center gap-2 rounded-md border border-border bg-background px-3">
                <Ionicons name="search" size={14} color={theme.mutedForeground} />
                <TextInput
                  className="flex-1 py-2 text-sm text-foreground"
                  placeholder={t("repositories.githubSearchPlaceholder")}
                  placeholderTextColor={theme.mutedForeground}
                  value={query}
                  onChangeText={setQuery}
                  autoCorrect={false}
                />
              </View>
            </View>
          )}

          {reposPending ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator />
            </View>
          ) : filtered.length === 0 ? (
            <View className="flex-1 items-center justify-center px-6">
              <Text className="text-sm text-muted-foreground text-center">
                {query
                  ? t("repositories.githubNoResults")
                  : t("repositories.githubEmpty")}
              </Text>
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(item) => String(item.id)}
              ItemSeparatorComponent={() => <View className="h-px bg-border ml-4" />}
              contentContainerClassName="pb-20"
              renderItem={({ item }) => {
                const identity = repositoryIdentity(item.clone_url);
                const alreadyAdded =
                  !!identity && existingIdentities.has(identity);
                const disabled = alreadyAdded || item.archived;
                const checked = alreadyAdded || selected.has(item.id);
                return (
                  <Pressable
                    onPress={() => !disabled && toggle(item)}
                    disabled={disabled}
                    className={cn(
                      "flex-row items-start gap-3 px-4 py-3",
                      disabled && "opacity-50",
                    )}
                  >
                    <Ionicons
                      name={checked ? "checkbox" : "square-outline"}
                      size={20}
                      color={checked ? theme.primary : theme.mutedForeground}
                    />
                    <View className="flex-1 min-w-0 gap-0.5">
                      <View className="flex-row flex-wrap items-center gap-2">
                        <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                          {item.full_name}
                        </Text>
                        {item.private ? (
                          <View className="rounded-full bg-secondary px-1.5 py-0.5">
                            <Text className="text-[10px] text-muted-foreground font-medium">
                              {t("repositories.githubPrivate")}
                            </Text>
                          </View>
                        ) : null}
                        {item.archived ? (
                          <View className="rounded-full bg-secondary px-1.5 py-0.5">
                            <Text className="text-[10px] text-muted-foreground font-medium">
                              {t("repositories.githubArchived")}
                            </Text>
                          </View>
                        ) : null}
                        {alreadyAdded ? (
                          <View className="rounded-full bg-secondary px-1.5 py-0.5">
                            <Text className="text-[10px] text-muted-foreground font-medium">
                              {t("repositories.githubAdded")}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      {item.description ? (
                        <Text className="text-xs text-muted-foreground/70" numberOfLines={1}>
                          {item.description}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                );
              }}
            />
          )}

          {installationId ? (
            <View className="absolute inset-x-0 bottom-0 flex-row items-center justify-between border-t border-border bg-card px-4 py-3">
              <Text className="text-xs text-muted-foreground">
                {t("repositories.githubSelectedCount", {
                  count: selected.size,
                })}
              </Text>
              <Button
                onPress={handleImport}
                disabled={selected.size === 0 || merge.isPending}
              >
                <Text>
                  {merge.isPending
                    ? t("workspaceSettings.saving")
                    : t("repositories.githubImport")}
                </Text>
              </Button>
            </View>
          ) : null}
        </View>
      )}
    </>
  );
}