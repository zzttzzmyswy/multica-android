/**
 * Version & daemon-update section for a local runtime's detail page
 * (iteration-83, A2.4) — port of web
 * `packages/views/runtimes/components/update-section.tsx` for the phone.
 *
 * Shows the current CLI version, the Docker/AWS-managed marker, an
 * update-available offer with an Update action, and the pending/running/
 * completed/failed/timeout state machine over `POST /api/runtimes/:id/update`
 * polled at 2s until it settles. Degrades read-only when the viewer has no
 * manageable runtime (`runtimeId === null`), when the binary reports a
 * non-release (git-describe/dev) version, or when GitHub is unreachable.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { RuntimeUpdateStatus } from "@multica/core/types";
import { api } from "@/data/api";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import {
  fetchGithubLatestVersion,
  isNewer,
  parseReleaseVersion,
} from "@/lib/cli-version";
import { useTranslation } from "@/lib/i18n/react";
import { cn } from "@/lib/utils";

const POLL_MS = 2_000;
const CLEAR_STATUS_MS = 5_000;

const STATUS_TONE: Record<RuntimeUpdateStatus, string> = {
  pending: "text-muted-foreground",
  running: "text-info",
  completed: "text-success",
  failed: "text-destructive",
  timeout: "text-warning",
};

interface UpdateSectionProps {
  /** Null for a read-only viewer who cannot use a runtime as the command channel. */
  runtimeId: string | null;
  currentVersion: string | null;
  isOnline: boolean;
  /**
   * Non-null when the daemon process was spawned by a managed launcher
   * (e.g. "desktop" for the Electron app). In that case the CLI binary
   * is shipped and upgraded by the launcher itself — in-app self-update
   * is disabled.
   */
  launchedBy?: string | null;
}

export function UpdateSection({
  runtimeId,
  currentVersion,
  isOnline,
  launchedBy,
}: UpdateSectionProps) {
  const { t } = useTranslation();
  const isManaged = launchedBy === "desktop";
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [status, setStatus] = useState<RuntimeUpdateStatus | null>(null);
  const [error, setError] = useState("");
  const [output, setOutput] = useState("");
  const [updating, setUpdating] = useState(false);
  const [targetVersion, setTargetVersion] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clearRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanup = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (clearRef.current) {
      clearTimeout(clearRef.current);
      clearRef.current = null;
    }
  }, []);

  useEffect(() => cleanup, [cleanup]);

  // Fetch GitHub release latest on mount — silent degrade to null (unknown).
  useEffect(() => {
    let active = true;
    void fetchGithubLatestVersion().then((v) => {
      if (active) setLatestVersion(v);
    });
    return () => {
      active = false;
    };
  }, []);

  const markCompleted = useCallback(
    (message: string) => {
      setStatus("completed");
      setOutput(message);
      setUpdating(false);
      setTargetVersion(null);
      cleanup();
      // Auto-clear after a few seconds so the UI refreshes to show the new
      // version from re-fetched runtime data.
      clearRef.current = setTimeout(() => setStatus(null), CLEAR_STATUS_MS);
    },
    [cleanup],
  );

  // The daemon already restarted into the new version under us — settle
  // without the poll round-trip (web updates the same way).
  useEffect(() => {
    if (!updating || !targetVersion || !currentVersion) return;
    if (!isNewer(targetVersion, currentVersion)) {
      markCompleted(t("runtimes.update.completed", { version: targetVersion }));
    }
  }, [currentVersion, markCompleted, targetVersion, updating, t]);

  // Kick off the update and poll until it settles. Deliberately not a
  // useCallback — the interval closure needs the latest `targetVersion`.
  const handleUpdate = async () => {
    if (!latestVersion || !runtimeId) return;
    cleanup();
    setUpdating(true);
    setTargetVersion(latestVersion);
    setStatus("pending");
    setError("");
    setOutput("");

    try {
      const update = await api.initiateUpdate(runtimeId, latestVersion);

      pollRef.current = setInterval(async () => {
        try {
          const result = await api.getUpdateResult(runtimeId, update.id);
          setStatus(result.status);

          if (result.status === "completed") {
            markCompleted(
              result.output ?? t("runtimes.update.completed", {
                version: targetVersion ?? latestVersion,
              }),
            );
          } else if (
            result.status === "failed" ||
            result.status === "timeout"
          ) {
            setError(result.error ?? t("runtimes.update.unknown_error"));
            setUpdating(false);
            setTargetVersion(null);
            cleanup();
          }
        } catch {
          // ignore poll errors — the loop keeps trying until it settles
        }
      }, POLL_MS);
    } catch {
      setStatus("failed");
      setError(t("runtimes.update.initiate_failed"));
      setUpdating(false);
      setTargetVersion(null);
    }
  };

  const hasUpdate =
    currentVersion &&
    latestVersion &&
    isNewer(latestVersion, currentVersion);

  // A source build cannot be ordered against a release tag, so neither
  // "update available" nor "Latest" is a claim we can make. Say that, rather
  // than defaulting to "Latest".
  const isLocalBuild =
    !!currentVersion && parseReleaseVersion(currentVersion) === null;

  const isActive = status === "pending" || status === "running";

  return (
    <View className="gap-1.5">
      <View className="flex-row items-center gap-2 flex-wrap">
        <Text className="text-xs text-muted-foreground">
          {t("runtimes.update.cli_version_label")}
        </Text>
        <Text className="text-xs font-mono text-foreground">
          {currentVersion ?? t("runtimes.update.version_unknown")}
        </Text>

        {isManaged ? (
          <Badge
            tone="text-muted-foreground"
            accessibilityLabel={t("runtimes.update.managed_by_desktop_title")}
          >
            {t("runtimes.update.managed_by_desktop")}
          </Badge>
        ) : (
          <>
            {isLocalBuild && !status && (
              <Badge
                tone="text-muted-foreground"
                accessibilityLabel={t("runtimes.update.local_build_title")}
              >
                {t("runtimes.update.local_build")}
              </Badge>
            )}

            {!isLocalBuild &&
              !hasUpdate &&
              currentVersion &&
              latestVersion &&
              !status && (
                <Badge tone="text-success">
                  <Ionicons name="checkmark-circle" size={12} color="currentColor" />
                  {t("runtimes.update.latest")}
                </Badge>
              )}

            {hasUpdate && !status && (
              <>
                <Text className="text-xs text-muted-foreground">→</Text>
                <Text className="text-xs font-mono text-info">
                  {latestVersion ?? ""}
                </Text>
                <Text className="text-xs text-muted-foreground">
                  {t("runtimes.update.available")}
                </Text>
              </>
            )}

            {hasUpdate && !runtimeId && (
              <Badge
                tone="text-muted-foreground"
                accessibilityLabel={t("runtimes.update.read_only_title")}
              >
                <Ionicons name="lock-closed" size={12} color="currentColor" />
                {t("runtimes.update.read_only")}
              </Badge>
            )}

            {hasUpdate && runtimeId && isOnline && !status && (
              <Button
                variant="outline"
                size="sm"
                onPress={() => void handleUpdate()}
                disabled={updating}
              >
                <Ionicons
                  name="arrow-up-circle-outline"
                  size={14}
                  color="currentColor"
                />
                <Text>{t("runtimes.update.action")}</Text>
              </Button>
            )}
          </>
        )}

        {status ? (
          <View className="flex-row items-center gap-1.5">
            {isActive ? (
              <ActivityIndicator size={12} color="currentColor" />
            ) : (
              <Ionicons
                name={
                  status === "completed"
                    ? "checkmark-circle"
                    : "close-circle"
                }
                size={12}
                color="currentColor"
              />
            )}
            <Text className={cn("text-xs", STATUS_TONE[status])}>
              {t(`runtimes.update.status.${status}`)}
            </Text>
          </View>
        ) : null}
      </View>

      {status === "completed" && output ? (
        <View className="rounded-lg border border-success/30 bg-success/10 px-3 py-2">
          <Text className="text-xs text-success">{output}</Text>
        </View>
      ) : null}

      {(status === "failed" || status === "timeout") && error ? (
        <View className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 gap-1">
          <Text className="text-xs text-destructive">{error}</Text>
          {status === "failed" ? (
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              onPress={() => void handleUpdate()}
            >
              <Text className="text-xs">{t("runtimes.update.retry")}</Text>
            </Button>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Badge({
  children,
  tone,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  tone: string;
  accessibilityLabel?: string;
}) {
  return (
    <View
      className="px-1.5 py-px rounded-full bg-secondary flex-row items-center gap-1"
      accessibilityLabel={accessibilityLabel}
    >
      <Text className={cn("text-[10px] font-medium", tone)}>{children}</Text>
    </View>
  );
}