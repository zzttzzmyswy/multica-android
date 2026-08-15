import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n/react";

export default function AgentsPage() {
  const { t } = useTranslation();
  return (
    <View className="flex-1 items-center justify-center bg-background px-6">
      <Text className="text-sm text-muted-foreground text-center">
        {t("agents.comingSoon")}
      </Text>
    </View>
  );
}
