import Ionicons from "@expo/vector-icons/Ionicons";
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n/react";

export function RuntimeRequiredBanner({ agentName }: { agentName?: string }) {
  const { t } = useTranslation();
  const name = agentName?.trim() || t("chat.thisAgent");
  return (
    <View className="mx-3 mb-1.5 flex-row items-center gap-1.5 rounded-md bg-warning/15 px-2.5 py-1.5">
      <Ionicons name="server-outline" size={14} className="text-warning" />
      <Text className="flex-1 text-xs text-warning">
        {t("chat.runtimeRequiredMessage", { name })}
      </Text>
    </View>
  );
}
