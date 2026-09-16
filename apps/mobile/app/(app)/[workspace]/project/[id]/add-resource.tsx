/**
 * Add-resource (GitHub repo) sheet for a project — presented as a formSheet
 * by the parent Stack. Self-contained: picks a repository, takes an optional
 * label, fires useCreateProjectResource, surfaces errors with Alert.
 *
 * v1 only supports `github_repo` resource type. Loose client-side
 * validation: URL must look like `https://github.com/owner/repo`. Server
 * is the canonical validator (validateAndNormalizeResourceRef in Go).
 *
 * Mobile parity with web's `project-resources-section.tsx` popover
 * (MYS-1149): web offers the workspace's configured repositories
 * (`Workspace.repos`, web `:178-179,447-481`) as a searchable list with
 * already-mounted rows disabled, plus a free-text `CustomRepoForm` fallback.
 * The phone keeps both, but the list SELECTS rather than attaches on tap:
 * web's popover has no label field, while this sheet does — a one-tap attach
 * would make the label unreachable for every repository that appears in the
 * list, which is the common case. Selecting first also keeps a single write
 * path (and a single error path) for both entry modes.
 */
import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { WorkspaceRepo } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { useCreateProjectResource } from "@/data/mutations/projects";
import { projectResourcesOptions } from "@/data/queries/projects";
import { workspaceListOptions } from "@/data/queries/workspaces";
import { useWorkspaceStore } from "@/data/workspace-store";
import { isRepoAttached, repoShortLabel } from "@/lib/repositories";
import { githubResourceUrls } from "@/lib/project-resources";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

const GITHUB_PATTERN = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\/|$)/i;

export default function AddResourceRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const createResource = useCreateProjectResource(id);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  const { data: workspaces } = useQuery(workspaceListOptions());
  const { data: resources = [] } = useQuery(projectResourcesOptions(wsId, id));

  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [repoQuery, setRepoQuery] = useState("");

  const repos = useMemo(
    () => workspaces?.find((w) => w.id === wsId)?.repos ?? [],
    [workspaces, wsId],
  );

  // Every github resource already on the project, however it was spelled —
  // those rows can only 409 server-side, so they render disabled.
  const attachedUrls = useMemo(() => githubResourceUrls(resources), [resources]);

  const filteredRepos = useMemo(() => {
    const q = repoQuery.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter(
      (repo) =>
        repo.url.toLowerCase().includes(q) ||
        repoShortLabel(repo.url).toLowerCase().includes(q) ||
        (repo.description ?? "").toLowerCase().includes(q),
    );
  }, [repos, repoQuery]);

  const trimmedUrl = url.trim();
  const valid = GITHUB_PATTERN.test(trimmedUrl);
  const submitting = createResource.isPending;

  const onSubmit = useCallback(() => {
    if (!valid || submitting) return;
    createResource.mutate(
      {
        resource_type: "github_repo",
        resource_ref: { url: trimmedUrl },
        label: label.trim() || undefined,
      },
      {
        onSuccess: () => router.back(),
        onError: (err) => {
          Alert.alert(
            t("resource.failedTitle"),
            err instanceof Error ? err.message : t("newIssue.unknownError"),
          );
        },
      },
    );
  }, [valid, submitting, createResource, trimmedUrl, label, t]);

  return (
    <View className="flex-1">
      <View className="flex-row items-center justify-between px-4 pt-4 pb-2">
        <Text className="text-base font-semibold text-foreground">
          {t("resource.title")}
        </Text>
        <Pressable
          onPress={onSubmit}
          disabled={!valid || submitting}
          hitSlop={6}
          className={`px-3 py-1.5 rounded-md ${
            !valid || submitting ? "opacity-50" : "active:bg-secondary"
          }`}
        >
          <Text className="text-sm font-semibold text-primary">
            {submitting ? t("resource.attaching") : t("resource.attach")}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="pb-8"
      >
        {repos.length > 0 ? (
          <View className="px-4 pt-2">
            <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
              {t("resource.fromRepositories")}
            </Text>
            <View className="mt-2">
              <TextField
                value={repoQuery}
                onChangeText={setRepoQuery}
                placeholder={t("resource.searchRepositories")}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <View className="mt-1">
              {filteredRepos.length === 0 ? (
                <Text className="py-3 text-xs text-muted-foreground text-center">
                  {t("resource.noRepositoryMatch")}
                </Text>
              ) : (
                filteredRepos.map((repo) => (
                  <RepoOptionRow
                    key={repo.url}
                    repo={repo}
                    attached={isRepoAttached(repo.url, attachedUrls)}
                    selected={trimmedUrl === repo.url}
                    busy={submitting}
                    onPress={() => setUrl(repo.url)}
                  />
                ))
              )}
            </View>
          </View>
        ) : null}

        <View className="px-4 pt-5 gap-4">
          <View className="flex-row items-center gap-2">
            <View className="h-px flex-1 bg-border" />
            <Text className="text-xs text-muted-foreground">
              {repos.length > 0
                ? t("resource.manualEntry")
                : t("resource.repoUrl")}
            </Text>
            <View className="h-px flex-1 bg-border" />
          </View>
          <View className="gap-1">
            {repos.length > 0 ? null : (
              <Text className="text-xs text-muted-foreground">
                {t("resource.repoUrl")}
              </Text>
            )}
            <TextField
              value={url}
              onChangeText={setUrl}
              placeholder={t("resource.repoUrlPlaceholder")}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              autoFocus={repos.length === 0}
              editable={!submitting}
            />
          </View>
          <View className="gap-1">
            <Text className="text-xs text-muted-foreground">
              {t("resource.label")}
            </Text>
            <TextField
              value={label}
              onChangeText={setLabel}
              placeholder={t("resource.labelHint")}
              editable={!submitting}
            />
          </View>
          {url.length > 0 && !valid ? (
            <View className="flex-row items-center gap-1.5">
              <Ionicons name="alert-circle-outline" size={13} color={theme.destructive} />
              <Text className="flex-1 text-xs text-destructive">
                {t("repositories.urlRequired")}
              </Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

/**
 * One workspace-repository row. Attached rows stay visible but disabled (web
 * keeps them for the tooltip + "Attached" badge) — hiding them would make the
 * list look like the repository vanished.
 */
function RepoOptionRow({
  repo,
  attached,
  selected,
  busy,
  onPress,
}: {
  repo: WorkspaceRepo;
  attached: boolean;
  selected: boolean;
  busy: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const disabled = attached || busy;

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      accessibilityLabel={repoShortLabel(repo.url)}
      className={`flex-row items-center gap-2 rounded-lg px-2 py-2.5 ${
        disabled ? "opacity-50" : "active:bg-secondary"
      }`}
    >
      <Ionicons name="git-branch-outline" size={15} color={theme.mutedForeground} />
      <View className="flex-1 min-w-0">
        <Text className="font-mono text-sm text-foreground" numberOfLines={1}>
          {repoShortLabel(repo.url)}
        </Text>
        {repo.description ? (
          <Text className="text-xs text-muted-foreground/70" numberOfLines={1}>
            {repo.description}
          </Text>
        ) : null}
      </View>
      {attached ? (
        <Text className="text-[10px] text-muted-foreground font-medium">
          {t("resource.attachedBadge")}
        </Text>
      ) : selected ? (
        <Ionicons name="checkmark" size={17} color={theme.primary} />
      ) : null}
    </Pressable>
  );
}
