import Ionicons from "@expo/vector-icons/Ionicons";
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n/react";

export function RuntimeRequiredBanner({ agentName }: { agentName?: string }) {
  const { t } = useTranslation();
  const name = agentName?.trim() || t("chat.thisAgent");
  return (
    <View className="mx-3 mb-1.5 flex-row items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2">
      <Ionicons name="server-outline" size={16} className="text-warning" />
      <Text className="min-w-0 flex-1 text-body text-foreground">
        {t("chat.runtimeRequiredMessage", { name })}
      </Text>
    </View>
  );
}
