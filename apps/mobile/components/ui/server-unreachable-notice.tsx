import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n/react";

export function ServerUnreachableNotice({
  failedBaseUrl,
  defaultUrl,
  switching,
  disabled,
  onSwitch,
  onEdit,
}: {
  failedBaseUrl: string;
  defaultUrl: string | null;
  switching: boolean;
  disabled?: boolean;
  onSwitch: () => void;
  onEdit?: () => void;
}) {
  const { t } = useTranslation();

  return (
    <View className="self-stretch gap-2 rounded-xl border border-border bg-secondary/40 p-3">
      <Text className="text-body text-foreground">
        {t("login.offlineCustomServer", { url: failedBaseUrl })}
      </Text>
      {defaultUrl ? (
        <>
          <Text className="text-caption text-muted-foreground">
            {t("login.serverSwitchTarget", { url: defaultUrl })}
          </Text>
          <Button
            variant="outline"
            className="min-h-12 h-auto py-2"
            disabled={disabled || switching}
            onPress={onSwitch}
            accessibilityState={{ busy: switching, disabled: disabled || switching }}
          >
            <Text className="text-center">
              {switching ? t("login.switchingServer") : t("login.useDefaultServer")}
            </Text>
          </Button>
        </>
      ) : null}
      {onEdit ? (
        <Button
          variant="ghost"
          className="min-h-12 h-auto py-2"
          disabled={disabled || switching}
          onPress={onEdit}
        >
          <Text className="text-center">{t("login.editServer")}</Text>
        </Button>
      ) : null}
    </View>
  );
}
