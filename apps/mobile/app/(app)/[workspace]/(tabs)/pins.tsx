/**
 * "Pinned" bottom tab. The tab bar hides the native Stack header, so this
 * host draws its own `<Header>` and reuses the shared `<PinnedScreen>` body
 * — same view as the `more/pins` push screen, no duplicated list logic.
 */
import { View } from "react-native";
import { Header } from "@/components/ui/header";
import { PinnedScreen } from "@/components/pin/pinned-screen";
import { useTranslation } from "@/lib/i18n/react";

export default function PinnedTab() {
  const { t } = useTranslation();

  return (
    <View className="flex-1 bg-background">
      <Header title={t("nav.pinned")} />
      <PinnedScreen />
    </View>
  );
}