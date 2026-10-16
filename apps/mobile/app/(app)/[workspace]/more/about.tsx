/**
 * About page — app identity (icon / name / version / build), GitHub source
 * link, and the manual "check for updates" UI that drives the GitHub-Release
 * install flow (`lib/install-update.ts`).
 *
 * State model (local to this screen):
 *   - The react-query probe (`useLatestRelease`) runs on mount; the same
 *     query powers the More-popover About-row dot via the update store.
 *   - "Check for updates" refetches that query: up-to-date / newer-version
 *     / no-ABI / network-error all render inline.
 *   - "Download & install" resolves the device ABI (`resolveDeviceAbi`),
 *     matches the APK asset (`matchAssetForAbi`), downloads it to cache and
 *     hands it to the OS installer via a `content://` URI. Blocked installs
 *     route to the per-app "install unknown apps" settings through a dialog.
 */
import { useState } from "react";
import { ActivityIndicator, Alert, Image, Linking, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import Constants from "expo-constants";
import { File } from "expo-file-system";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useLatestRelease } from "@/lib/use-latest-release";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n/react";
import {
  GITHUB_REPO,
  checkForUpdate,
  displayVersion,
  matchAssetForAbi,
  type UpdateCheck,
} from "@/lib/release-check";
import { UPDATE_STATE_KEYS, resolveUpdateState } from "@/lib/about-update-state";
import {
  APK_MIME_TYPE,
  apkCacheFilename,
  installApkFile,
  openUnknownAppSourcesSettings,
  resolveDeviceAbi,
} from "@/lib/install-update";
import { useDownloadsStore } from "@/data/downloads-store";
import { resolveAppVersion, resolveBuildNumber } from "@/lib/app-identity";
import { checkUpdateInstallTarget } from "@/lib/release-identity";
import { cn } from "@/lib/utils";

type CheckPhase =
  | "idle"
  | "checking"
  | "network-error"
  | "no-asset"
  | "foreign-package"
  | "downloading";

const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;

export default function AboutPage() {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const muted = theme.mutedForeground;

  const appVersion = resolveAppVersion(Constants);
  const buildNumber = resolveBuildNumber(Constants);

  const query = useLatestRelease(true);
  const [phase, setPhase] = useState<CheckPhase>("idle");

  const release = query.data;
  // Three outcomes, not two: an unreadable tag must not be reported as
  // "up to date". See `checkForUpdate`.
  const updateCheck = release
    ? checkForUpdate(release.tag_name, appVersion)
    : "up-to-date";
  const hasUpdate = updateCheck === "update-available";
  const latestVersion = release ? displayVersion(release.tag_name) : undefined;

  // Live progress of the in-flight update download — the row lives in the
  // download manager store (MYS-361), so the About page and the Downloads
  // screen render the very same task.
  const updateTask = useDownloadsStore((s) =>
    s.tasks.find(
      (task) => task.source?.kind === "update" && task.status === "downloading",
    ),
  );
  const downloadProgress = updateTask?.progress ?? null;

  const onCheck = async () => {
    setPhase("checking");
    // refetch() resolves with the query result instead of rejecting on
    // failure (TanStack swallows the error unless throwOnError is set), so
    // detect the error via the result shape.
    const result = await query.refetch().catch(() => null);
    setPhase(result?.isError ? "network-error" : "idle");
  };

  const onDownloadInstall = async () => {
    if (!release) return;
    // Refuse before downloading when this install is not the channel's package.
    // Android would treat the downloaded APK as a different app and install it
    // *beside* this one — leaving the old app and data in place and reporting
    // Success. Cheaper and clearer to say so up front than to hand it over.
    const target = checkUpdateInstallTarget(Constants);
    if (!target.ok) {
      setPhase("foreign-package");
      return;
    }
    const abi = resolveDeviceAbi();
    const asset = abi ? matchAssetForAbi(release.assets, abi) : null;
    if (!asset || !abi) {
      setPhase("no-asset");
      return;
    }
    setPhase("downloading");
    try {
      const { done } = await useDownloadsStore.getState().downloadManaged({
        url: asset.browser_download_url,
        filename: apkCacheFilename(release.tag_name, abi),
        mimeType: APK_MIME_TYPE,
        source: { kind: "update", name: release.tag_name },
        authenticated: false,
        onCompleted: async (local) => {
          await installApkFile(new File(local.uri));
        },
      });
      const outcome = await done;
      if (outcome.status === "failed") {
        Alert.alert(
          t("screen.about"),
          t("update.error.downloadFailed", { message: outcome.error ?? "" }),
          [{ text: t("common.ok") }],
        );
      }
      // completed → the system installer is now on top; cancelled → the
      // user aborted from the download manager. Both settle to idle.
    } catch {
      // The APK finished downloading but the install handoff failed.
      Alert.alert(t("screen.about"), t("update.error.installFailed"), [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("update.openSettings"),
          onPress: () => void openUnknownAppSourcesSettings(),
        },
      ]);
    }
    setPhase("idle");
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="px-6 py-10"
    >
      <View className="items-center gap-3">
        <Image
          source={require("@/assets/icon.png")}
          className="h-20 w-20 rounded-2xl"
          resizeMode="contain"
        />
        <Text className="text-display-sm font-semibold text-foreground">Multica</Text>
        <Text className="text-body text-muted-foreground">
          {t("about.subtitle")}
        </Text>
      </View>

      <View className="mt-8 rounded-xl border border-border bg-card p-4">
        <InfoRow
          label={t("about.versionLabel")}
          value={`v${appVersion}`}
        />
        <Separator className="my-3" />
        <InfoRow label={t("about.buildLabel")} value={buildNumber} />
        <Separator className="my-3" />
        <InfoRow label={t("about.intro")} value="" last />
      </View>

      <View className="mt-6 gap-4">
        <UpdateCard
          phase={phase}
          hasUpdate={hasUpdate}
          check={release ? updateCheck : null}
          latestVersion={latestVersion}
          progress={downloadProgress}
          onCheck={onCheck}
          onDownload={onDownloadInstall}
        />

        <Button variant="outline" onPress={() => void Linking.openURL(GITHUB_URL)}>
          <Ionicons name="logo-github" size={18} color={theme.foreground} />
          <Text>{t("about.sourceCode")}</Text>
        </Button>

        <Text className="text-center text-caption text-muted-foreground/70" style={{ color: muted }}>
          {t("update.installUnknownSourcesHint")}
        </Text>
      </View>
    </ScrollView>
  );
}

function InfoRow({
  label,
  value,
  last,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <View className={cn("flex-row items-center justify-between", !last && "mb-3")}>
      <Text className="text-body text-muted-foreground">{label}</Text>
      <Text className="text-body font-medium text-foreground">{value}</Text>
    </View>
  );
}

function UpdateCard({
  phase,
  hasUpdate,
  check,
  latestVersion,
  progress,
  onCheck,
  onDownload,
}: {
  phase: CheckPhase;
  hasUpdate: boolean;
  check: UpdateCheck | null;
  /** Bare version of the published release (`0.6.83`), undefined when unknown. */
  latestVersion?: string;
  /** 0..1 fraction of the in-flight update download, null when unknown. */
  progress: number | null;
  onCheck: () => void;
  onDownload: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  const busy = phase === "checking" || phase === "downloading";
  // The message is chosen by a pure resolver so the branch that says "you're
  // on the latest version" is reachable by a behavioural test rather than by
  // matching this file's source text. See `lib/about-update-state.ts`.
  const state = resolveUpdateState(phase, check);
  // `unreadable` is the one state whose copy is a failure even though the
  // transport worked, so it is the only "inconclusive" tone.
  const tone =
    state === "network-error" ||
    state === "no-asset" ||
    state === "foreign-package" ||
    state === "unreadable"
      ? "text-destructive"
      : state === "update-available"
        ? "text-success"
        : undefined;

  // Each state has its own params: the download copy interpolates a percent,
  // the version-bearing states interpolate the release version, and the rest
  // take none (an unused param is harmless, a missing one renders blank).
  const status =
    state === "downloading"
      ? progress != null
        ? t("about.downloadingWithPct", { pct: Math.round(progress * 100) })
        : t("about.downloading")
      : state === "update-available"
        ? t(UPDATE_STATE_KEYS[state], { version: latestVersion ?? "" })
        : t(UPDATE_STATE_KEYS[state]);

  const showDownload =
    !busy && hasUpdate && phase !== "no-asset" && phase !== "foreign-package";

  return (
    <View className="rounded-xl border border-border bg-card p-4 gap-3">
      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-1 gap-1">
          <Text
            className={cn("text-body", tone ?? "text-muted-foreground")}
            numberOfLines={2}
          >
            {status}
          </Text>
          {latestVersion && !hasUpdate && state === "up-to-date" && (
            <Text className="text-caption text-muted-foreground/70">
              {t("about.latestVersion", {
                version: latestVersion,
              })}
            </Text>
          )}
        </View>
        {busy && <ActivityIndicator size="small" color={theme.brand} />}
      </View>

      {phase === "downloading" && progress != null ? (
        <View className="h-1.5 overflow-hidden rounded-full bg-muted">
          <View
            className="h-full rounded-full bg-primary"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </View>
      ) : null}

      {busy ? null : showDownload ? (
        <Button onPress={onDownload}>
          <Ionicons name="cloud-download-outline" size={18} color="#fff" />
          <Text>{t("about.downloadAndInstall")}</Text>
        </Button>
      ) : (
        <Button variant="outline" onPress={onCheck}>
          <Text>{t("about.checkForUpdates")}</Text>
        </Button>
      )}

      {phase === "no-asset" && (
        <Button variant="link" onPress={onCheck}>
          <Text>{t("about.checkForUpdates")}</Text>
        </Button>
      )}

      {phase === "foreign-package" && (
        // The refusal names uninstalling and reinstalling as the way out, so
        // give that path a tap target rather than leaving it as prose.
        <Button
          variant="outline"
          onPress={() => void Linking.openURL(`${GITHUB_URL}/releases`)}
        >
          <Ionicons name="open-outline" size={18} color={theme.foreground} />
          <Text>{t("update.openReleases")}</Text>
        </Button>
      )}
    </View>
  );
}