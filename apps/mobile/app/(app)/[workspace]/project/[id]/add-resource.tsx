/**
 * Add-resource sheet for a project. Presented as a formSheet by the parent
 * Stack. Self-contained: choose a resource kind, fill its form, fire
 * useCreateProjectResource, surface errors inline or in an Alert.
 *
 * Two kinds since iteration 135:
 *
 *   - `github_repo` (MYS-1149): the workspace's configured repositories
 *     (`Workspace.repos`, web `project-resources-section.tsx:447-481`) as a
 *     searchable list with already-mounted rows disabled, plus free-text
 *     entry. The list SELECTS rather than attaches on tap: web's popover has
 *     no label field, while this sheet does, so a one-tap attach would make
 *     the label unreachable for every repository in the list — the common
 *     case. Selecting first also keeps a single write path for both modes.
 *   - `local_directory`: agents run tasks in an existing folder on a specific
 *     machine (`packages/core/types/project.ts:88`).
 *
 * The local-directory form is NOT a port of web's flow, because web's flow is
 * unavailable on a phone in two independent ways: it runs the folder picker
 * natively in the desktop app, and it requires a daemon running *on the device
 * you are holding* to own the path. A phone can do neither. So the mobile
 * adaptation substitutes the two things it can actually determine — which
 * machine (chosen from the workspace's runtimes) and which absolute path
 * (typed) — and keeps everything downstream of that identical: the same
 * in_place / worktree choice with web's copy, the same one-directory-per-daemon
 * rule, and the same handling of the server's daemon-capability refusal.
 *
 * Client-side validation mirrors the server's own rules
 * (`lib/project-resources.ts`): `isValidGitRepoUrl` for a repository, and
 * `isAbsoluteLocalPath` for a folder. Both are the exact predicates the server
 * applies (`server/internal/handler/project_resource.go:304,330`), so the phone
 * never blocks a write the server would accept.
 */
import { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { LocalDirectoryExecutionMode, WorkspaceRepo } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { PresenceDot } from "@/components/ui/presence-dot";
import { LocalDirectoryModeOptions } from "@/components/project/local-directory-mode-options";
import { useCreateProjectResource } from "@/data/mutations/projects";
import { projectResourcesOptions } from "@/data/queries/projects";
import { runtimeListOptions } from "@/data/queries/runtimes";
import { workspaceListOptions } from "@/data/queries/workspaces";
import { useWorkspaceStore } from "@/data/workspace-store";
import { isRepoAttached, repoShortLabel } from "@/lib/repositories";
import {
  attachedDaemonIds,
  githubResourceUrls,
  isAbsoluteLocalPath,
  isValidGitRepoUrl,
  worktreeUnsupportedInfo,
  type WorktreeUnsupportedInfo,
} from "@/lib/project-resources";
import { buildRuntimeMachines } from "@/lib/runtime-machines";
import type { RuntimeHealth } from "@multica/core/runtimes";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

type ResourceKind = "github_repo" | "local_directory";

export default function AddResourceRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const createResource = useCreateProjectResource(id);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  const { data: workspaces } = useQuery(workspaceListOptions());
  const { data: resources = [] } = useQuery(projectResourcesOptions(wsId, id));
  const { data: runtimes = [] } = useQuery(runtimeListOptions(wsId));

  const [kind, setKind] = useState<ResourceKind>("github_repo");

  // --- github_repo form ---------------------------------------------------
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
  const githubValid = isValidGitRepoUrl(trimmedUrl);
  const submitting = createResource.isPending;

  // --- local_directory form ----------------------------------------------
  // One row per MACHINE, not per runtime: a daemon registers a runtime row per
  // provider, and `daemon_id` — the field the resource pins — is shared by all
  // of them. Offering them separately would present the same folder target
  // four times and imply a choice that does not exist.
  const machines = useMemo(() => {
    const built = buildRuntimeMachines(runtimes, { now: Date.now() });
    return built
      .filter((m) => !!m.daemonId)
      .map((m) => ({
        daemonId: m.daemonId as string,
        title: m.title,
        subtitle: m.deviceInfo ?? m.subtitle,
        health: m.health,
        online: m.onlineCount > 0,
      }))
      .sort((a, b) => Number(b.online) - Number(a.online) || a.title.localeCompare(b.title));
  }, [runtimes]);

  const attachedDaemons = useMemo(() => attachedDaemonIds(resources), [resources]);

  const [daemonId, setDaemonId] = useState<string | null>(null);
  const [localPath, setLocalPath] = useState("");
  const [localLabel, setLocalLabel] = useState("");
  const [mode, setMode] = useState<LocalDirectoryExecutionMode>("in_place");
  /** The server's daemon-capability refusal, kept inline so the sheet stays
   *  open on the option the user can act on (upgrade that machine) instead of
   *  closing with a toast they cannot follow. */
  const [modeError, setModeError] = useState<WorktreeUnsupportedInfo | null>(null);

  // Preselect the first machine that can still take a directory: the common
  // case is a single machine, and a preselected row means the form is one
  // field away from submittable.
  const selectedDaemonId = useMemo(() => {
    if (daemonId && machines.some((m) => m.daemonId === daemonId)) return daemonId;
    return machines.find((m) => !attachedDaemons.includes(m.daemonId))?.daemonId ?? null;
  }, [daemonId, machines, attachedDaemons]);

  const trimmedPath = localPath.trim();
  const pathValid = isAbsoluteLocalPath(trimmedPath);
  const localValid = !!selectedDaemonId && pathValid;

  const submitGithub = useCallback(() => {
    if (!githubValid || submitting) return;
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
  }, [githubValid, submitting, createResource, trimmedUrl, label, t]);

  const submitLocal = useCallback(() => {
    if (!localValid || submitting || !selectedDaemonId) return;
    setModeError(null);
    createResource.mutate(
      {
        resource_type: "local_directory",
        resource_ref: {
          local_path: trimmedPath,
          daemon_id: selectedDaemonId,
          // Web defaults the ref label to the path when the user gave none
          // (project-resources-section.tsx:297), which is also what makes the
          // row readable on a machine whose folders the viewer cannot see.
          label: localLabel.trim() || trimmedPath,
          execution_mode: mode,
        },
      },
      {
        onSuccess: () => router.back(),
        onError: (err) => {
          const unsupported = worktreeUnsupportedInfo(err);
          if (unsupported) {
            setModeError(unsupported);
            return;
          }
          Alert.alert(
            t("resource.failedTitle"),
            err instanceof Error ? err.message : t("newIssue.unknownError"),
          );
        },
      },
    );
  }, [
    localValid,
    submitting,
    selectedDaemonId,
    createResource,
    trimmedPath,
    localLabel,
    mode,
    t,
  ]);

  const canSubmit = kind === "github_repo" ? githubValid : localValid;

  return (
    <View className="flex-1">
      <View className="flex-row items-center justify-between px-4 pt-4 pb-2">
        <Text className="text-base font-semibold text-foreground">
          {kind === "github_repo"
            ? t("resource.title")
            : t("resource.attachLocalDirectory")}
        </Text>
        <Pressable
          onPress={kind === "github_repo" ? submitGithub : submitLocal}
          disabled={!canSubmit || submitting}
          hitSlop={6}
          className={`px-3 py-1.5 rounded-md ${
            !canSubmit || submitting ? "opacity-50" : "active:bg-secondary"
          }`}
        >
          <Text className="text-sm font-semibold text-primary">
            {submitting
              ? t("resource.attaching")
              : kind === "github_repo"
                ? t("resource.attach")
                : t("resource.attachLocalDirectory")}
          </Text>
        </Pressable>
      </View>

      <View className="px-4 pb-2">
        <SegmentedControl
          options={[
            {
              value: "github_repo",
              label: t("resource.kindRepository"),
              icon: "logo-github",
            },
            {
              value: "local_directory",
              label: t("resource.kindLocalDirectory"),
              icon: "folder-open-outline",
            },
          ]}
          value={kind}
          onChange={(next) => {
            setKind(next);
            setModeError(null);
          }}
        />
      </View>

      <ScrollView
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="pb-8"
      >
        {kind === "github_repo" ? (
          <>
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
              {url.length > 0 && !githubValid ? (
                <View className="flex-row items-center gap-1.5">
                  <Ionicons
                    name="alert-circle-outline"
                    size={13}
                    color={theme.destructive}
                  />
                  <Text className="flex-1 text-xs text-destructive">
                    {t("repositories.urlRequired")}
                  </Text>
                </View>
              ) : null}
            </View>
          </>
        ) : (
          <View className="px-4 pt-2 gap-5">
            <View>
              <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                {t("resource.localRuntime")}
              </Text>
              {machines.length === 0 ? (
                <Text className="mt-2 text-xs text-muted-foreground">
                  {t("resource.localRuntimeEmpty")}
                </Text>
              ) : (
                <View className="mt-2">
                  {machines.map((machine) => (
                    <MachineOptionRow
                      key={machine.daemonId}
                      title={machine.title}
                      subtitle={machine.subtitle}
                      health={machine.health}
                      attached={attachedDaemons.includes(machine.daemonId)}
                      selected={selectedDaemonId === machine.daemonId}
                      busy={submitting}
                      onPress={() => setDaemonId(machine.daemonId)}
                    />
                  ))}
                </View>
              )}
              {machines.length > 0 ? (
                <Text className="mt-1 text-[11px] text-muted-foreground">
                  {t("resource.localRuntimeHint")}
                </Text>
              ) : null}
            </View>

            <View className="gap-1">
              <Text className="text-xs text-muted-foreground">
                {t("resource.localPath")}
              </Text>
              <TextField
                value={localPath}
                onChangeText={setLocalPath}
                placeholder={t("resource.localPathPlaceholder")}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!submitting}
              />
              {localPath.length > 0 && !pathValid ? (
                <View className="flex-row items-center gap-1.5 pt-0.5">
                  <Ionicons
                    name="alert-circle-outline"
                    size={13}
                    color={theme.destructive}
                  />
                  <Text className="flex-1 text-xs text-destructive">
                    {t("resource.localMissingPath")}
                  </Text>
                </View>
              ) : null}
            </View>

            <View className="gap-1">
              <Text className="text-xs text-muted-foreground">
                {t("resource.label")}
              </Text>
              <TextField
                value={localLabel}
                onChangeText={setLocalLabel}
                placeholder={trimmedPath || t("resource.labelHint")}
                editable={!submitting}
              />
            </View>

            <View className="gap-2">
              <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                {t("resource.modeTitle")}
              </Text>
              <Text className="text-[11px] text-muted-foreground">
                {t("resource.modeDescription")}
              </Text>
              <LocalDirectoryModeOptions
                value={mode}
                onChange={(next) => {
                  setMode(next);
                  setModeError(null);
                }}
                error={modeError}
              />
            </View>
          </View>
        )}
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

/** Machine health → the four-state dot vocabulary `PresenceDot` speaks. The
 *  runtime "health" enum splits offline by how long ago the daemon was last
 *  seen; the dot only distinguishes live / flaky / gone, so the two long-gone
 *  buckets collapse. */
function availabilityForHealth(
  health: RuntimeHealth,
): "online" | "unstable" | "offline" {
  if (health === "online") return "online";
  if (health === "recently_lost") return "unstable";
  return "offline";
}

/**
 * One machine row. An offline machine stays selectable on purpose: the
 * resource is a durable pointer, and a folder on a machine that is currently
 * asleep is still the right answer — only `worktree` needs the daemon to
 * answer, and the server says so at save time. An ALREADY-ATTACHED machine is
 * disabled instead, because the server refuses a second directory on the same
 * daemon outright (409, `project_resource.go:436`).
 */
function MachineOptionRow({
  title,
  subtitle,
  health,
  attached,
  selected,
  busy,
  onPress,
}: {
  title: string;
  subtitle: string | null;
  health: RuntimeHealth;
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
      accessibilityLabel={title}
      className={cn(
        "flex-row items-center gap-2 rounded-lg px-2 py-2.5",
        disabled ? "opacity-50" : "active:bg-secondary",
      )}
    >
      <PresenceDot availability={availabilityForHealth(health)} />
      <View className="flex-1 min-w-0">
        <Text className="text-sm text-foreground" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text className="text-xs text-muted-foreground/70" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {attached ? (
        <Text className="text-[10px] text-muted-foreground font-medium">
          {t("resource.localAlreadyAttached")}
        </Text>
      ) : selected ? (
        <Ionicons name="checkmark" size={17} color={theme.primary} />
      ) : null}
    </Pressable>
  );
}
