/**
 * Shared fullscreen shell for previews whose content the client already holds.
 *
 * Three surfaces want the same thing — a magnified view of a body that is
 * already loaded — and none of them should own a private copy: the ```html
 * fence block, the HTML attachment card, and the text-backed attachment card
 * (markdown / text). The Modal, the header row, the safe-area inset, and the
 * back handling are identical for all three; only the body differs.
 *
 * Web reaches the same place from a different direction. Every attachment card
 * there carries an Eye button (`packages/views/editor/attachment-card.tsx:59`)
 * that opens `AttachmentPreviewModal` at `fixed inset-0 z-50` — genuinely
 * fullscreen. On mobile the bodies were capped instead: 300px for the html
 * WebView, 320px for markdown / text. A long attachment could only be read
 * through that slit. This shell removes the cap on demand.
 *
 * Deliberately NOT web's modal framework — no zoom controls, no prev/next,
 * no download toolbar. It shows the same body the card already rendered, at
 * full height, and closes. The download button stays on the card because on a
 * phone that is where the user already reaches for it.
 *
 * Why the body is passed as children rather than a render prop: each caller
 * already builds its own body from state it owns, and `children` is only
 * evaluated when the modal is open, so a closed shell costs nothing.
 */
import type { ReactNode } from "react";
import { Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n/react";

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Header title — the attachment filename, or the fence block's kind label. */
  title: string;
  children: ReactNode;
}

export function FullscreenPreview({ visible, onClose, title, children }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  // `visible={false}` unmounts the modal's subtree on Android, so the caller's
  // body is built only while it is on screen. That matters for the html
  // caller: its body is a WebView, and leaving one alive behind a closed modal
  // would keep the renderer around for no reason.
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      // Android's hardware back closes the overlay instead of leaving the
      // screen — the same contract every other modal in the app honours.
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
        <View className="h-12 flex-row items-center border-b border-border bg-card px-2">
          <Text className="flex-1 pl-2 text-sm font-medium" numberOfLines={1}>
            {title}
          </Text>
          <Pressable
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t("a11y.close")}
            className="rounded-md border border-border px-2 py-1 active:opacity-80"
          >
            <Text className="text-xs text-foreground">
              {t("richContent.mermaid.close")}
            </Text>
          </Pressable>
        </View>
        <View className="flex-1">{children}</View>
      </View>
    </Modal>
  );
}
