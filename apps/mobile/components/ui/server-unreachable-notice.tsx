import { useState } from "react";
import { View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import {
  getDefaultApiBaseUrl,
  resetApiBaseUrl,
} from "@/data/server-config";
import { useTranslation } from "@/lib/i18n/react";

/**
 * Pre-auth recovery affordance for an unreachable custom server.
 *
 * A device that once pointed the app at a self-hosted host keeps that
 * override in SecureStore forever. If that host is later retired (or the
 * build-time default moves on), the stale override keeps shadowing the
 * working default and every request fails with a bare "can't connect" —
 * with the only fix buried inside the collapsed "Server" section.
 *
 * This notice appears next to the connection error itself the moment a
 * request fails while an override is active, and offers the one action that
 * unblocks the user. It deliberately does NOT rewrite the persisted value on
 * its own: a self-hosted server having a bad minute must never look like the
 * app silently switching the user to somebody else's server.
 */
export function ServerUnreachableNotice({
  failedBaseUrl,
  onSwitched,
}: {
  /** Server the failed request actually targeted, captured at failure time so
   *  the copy still names it after a reset moves the app back to the default. */
  failedBaseUrl: string;
  /** Called once the override is cleared, so the host screen can dismiss the
   *  stale error it rendered alongside this notice. */
  onSwitched?: () => void;
}) {
  const { t } = useTranslation();
  const [resetting, setResetting] = useState(false);
  const defaultUrl = resetTarget(failedBaseUrl);

  const onReset = async () => {
    if (resetting) return;
    setResetting(true);
    try {
      await resetApiBaseUrl();
      onSwitched?.();
    } finally {
      setResetting(false);
    }
  };

  return (
    <View className="gap-1.5 rounded-md border border-border bg-muted/40 p-2.5">
      <Text className="text-xs text-muted-foreground">
        {t("login.offlineCustomServer", { url: failedBaseUrl })}
      </Text>
      <View className="flex-row items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={resetting}
          onPress={onReset}
        >
          <Ionicons name="refresh" size={14} color="#71717a" />
          <Text>
            {resetting
              ? t("login.switchingServer")
              : t("login.useDefaultServer")}
          </Text>
        </Button>
        {defaultUrl ? (
          <Text
            className="flex-1 text-xs text-muted-foreground"
            numberOfLines={1}
          >
            {defaultUrl}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** The base the app will fall back to once the override is cleared, or "" if
 *  there is nothing to fall back to (a build with no baked default). */
function resetTarget(failedBaseUrl: string): string {
  const fallback = getDefaultApiBaseUrl();
  return fallback && fallback !== failedBaseUrl ? fallback : "";
}
