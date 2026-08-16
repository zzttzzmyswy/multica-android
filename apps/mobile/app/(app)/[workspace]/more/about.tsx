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
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useLatestRelease } from "@/lib/use-latest-release";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n/react";
import {
  GITHUB_REPO,
  matchAssetForAbi,
  isNewer,
} from "@/lib/release-check";
import {
  UpdateInstallError,
  downloadUpdateApk,
  installApkFile,
  openUnknownAppSourcesSettings,
  resolveDeviceAbi,
} from "@/lib/install-update";
import { cn } from "@/lib/utils";

type CheckPhase =
  | "idle"
  | "checking"
  | "network-error"
  | "no-asset"
  | "downloading";

const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;

export default function AboutPage() {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const muted = theme.mutedForeground;

  const appVersion =
    (Constants.expoConfig?.version as string | undefined) ?? "0.0.0";
  const buildNumber = Constants.platform?.android?.versionCode;

  const query = useLatestRelease(true);
  const [phase, setPhase] = useState<CheckPhase>("idle");

  const release = query.data;
  const hasUpdate = release ? isNewer(release.tag_name, appVersion) : false;

  const onCheck = async () => {
    setPhase("checking");
    try {
      await query.refetch();
      setPhase("idle");
    } catch {
      setPhase("network-error");
    }
  };

  const onDownloadInstall = async () => {
    if (!release) return;
    const abi = resolveDeviceAbi();
    const asset = abi ? matchAssetForAbi(release.assets, abi) : null;
    if (!asset || !abi) {
      setPhase("no-asset");
      return;
    }
    setPhase("downloading");
    try {
      const { file } = await downloadUpdateApk(release, abi);
      await installApkFile(file);
      // The system installer screen is now on top; the user presses
      // "Install" there. Leave the page in a neutral idle state.
      setPhase("idle");
    } catch (err) {
      if (err instanceof UpdateInstallError && err.reason === "download") {
        Alert.alert(t("screen.about"), t("update.error.downloadFailed", { message: err.message }), [
          { text: t("common.ok") },
        ]);
      } else {
        Alert.alert(t("screen.about"), t("update.error.installFailed"), [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("update.openSettings"),
            onPress: () => void openUnknownAppSourcesSettings(),
          },
        ]);
      }
      setPhase("idle");
    }
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
        <Text className="text-2xl font-semibold text-foreground">Multica</Text>
        <Text className="text-sm text-muted-foreground">
          {t("about.subtitle")}
        </Text>
      </View>

      <View className="mt-8 rounded-xl border border-border bg-card p-4">
        <InfoRow
          label={t("about.versionLabel")}
          value={`v${appVersion}`}
        />
        <Separator className="my-3" />
        <InfoRow
          label={t("about.buildLabel")}
          value={buildNumber != null ? `${buildNumber}` : "—"}
        />
        <Separator className="my-3" />
        <InfoRow label={t("about.intro")} value="" last />
      </View>

      <View className="mt-6 gap-4">
        <UpdateCard
          phase={phase}
          hasUpdate={hasUpdate}
          latestTag={release?.tag_name}
          onCheck={onCheck}
          onDownload={onDownloadInstall}
        />

        <Button variant="outline" onPress={() => void Linking.openURL(GITHUB_URL)}>
          <Ionicons name="logo-github" size={18} color={theme.foreground} />
          <Text>{t("about.sourceCode")}</Text>
        </Button>

        <Text className="text-center text-xs text-muted-foreground/70" style={{ color: muted }}>
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
      <Text className="text-sm text-muted-foreground">{label}</Text>
      <Text className="text-sm font-medium text-foreground">{value}</Text>
    </View>
  );
}

function UpdateCard({
  phase,
  hasUpdate,
  latestTag,
  onCheck,
  onDownload,
}: {
  phase: CheckPhase;
  hasUpdate: boolean;
  latestTag?: string;
  onCheck: () => void;
  onDownload: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  const busy = phase === "checking" || phase === "downloading";

  let status: string;
  let tone: string | undefined;
  if (phase === "network-error") {
    status = t("update.error.network");
    tone = "text-destructive";
  } else if (phase === "no-asset") {
    status = t("update.error.noAsset");
    tone = "text-destructive";
  } else if (phase === "downloading") {
    status = t("about.downloading");
  } else if (phase === "checking") {
    status = t("about.checking");
  } else if (hasUpdate && latestTag) {
    status = t("about.updateAvailable", { version: latestTag.replace(/^v/i, "") });
    tone = "text-success";
  } else if (latestTag) {
    status = t("about.upToDate");
  } else {
    status = t("about.idle");
  }

  const showDownload = !busy && hasUpdate && phase !== "no-asset";

  return (
    <View className="rounded-xl border border-border bg-card p-4 gap-3">
      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-1 gap-1">
          <Text
            className={cn("text-sm", tone ?? "text-muted-foreground")}
            numberOfLines={2}
          >
            {status}
          </Text>
          {latestTag && !hasUpdate && phase !== "checking" && (
            <Text className="text-xs text-muted-foreground/70">
              {t("about.latestVersion", {
                version: latestTag.replace(/^v/i, ""),
              })}
            </Text>
          )}
        </View>
        {busy && <ActivityIndicator size="small" color={theme.brand} />}
      </View>

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
    </View>
  );
}