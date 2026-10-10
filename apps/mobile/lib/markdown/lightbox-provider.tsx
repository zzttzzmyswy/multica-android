/**
 * App-level lightbox provider for tap-to-zoom image viewing.
 *
 * Single instance mounted at the root layout. `useLightbox().open(uri)`
 * displays the image fullscreen with pinch-to-zoom, double-tap, and
 * swipe-down-to-dismiss — all handled by `react-native-image-viewing`.
 *
 * `open(uri, sequence)` opens the same viewer positioned inside a whole
 * screen's images (MUL-5752), so a horizontal swipe walks to the next one
 * and a "3 / 7" counter says where the reader is. `ImageSequenceProvider`
 * builds that array; screens that don't mount one keep passing a single URI
 * and get the previous single-image behaviour.
 *
 * Parity with web/desktop, all from the same product brief:
 *   - images only, never mixed with other attachment kinds;
 *   - the sequence is frozen when the viewer opens, so an arriving comment
 *     cannot shift the index under the reader;
 *   - boundaries stop rather than wrap. `react-native-image-viewing` pages a
 *     fixed array and does not loop, so this comes for free.
 *
 * The header is ours, not the library's default. Web's preview modal header
 * (`packages/views/editor/attachment-preview-modal.tsx:557-625`) carries the
 * filename and a Download button for every previewable kind; the library's
 * `ImageDefaultHeader` carries a close button and nothing else, which left
 * `image` as the one attachment kind a user could look at and never save.
 * `LightboxHeader` below adds both, and keeps the close button the library
 * had.
 *
 * The gesture is the platform's own horizontal paging rather than the
 * desktop chevrons — same semantics, phone-native interaction.
 */
import { createContext, use, useCallback, useMemo, useState, type ReactNode } from "react";
import { Alert, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ImageView from "react-native-image-viewing";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { downloadAttachmentAndOpen } from "@/lib/download-attachment";
import { useTranslation } from "@/lib/i18n/react";
import {
  imageHeaderTitle,
  indexOfImageByUri,
  type LightboxImage,
} from "./lightbox-image";

interface LightboxApi {
  /**
   * Show `uri` fullscreen. When `sequence` contains it, the viewer opens at
   * its real position and the reader can swipe through the rest; otherwise
   * the viewer shows that one image, with no filename and no download — a
   * URI the attachment list never resolved has nothing to name or fetch.
   */
  open: (uri: string, sequence?: readonly LightboxImage[]) => void;
}

const LightboxContext = createContext<LightboxApi>({
  open: () => {
    // No-op fallback when used outside provider — markdown rendering
    // shouldn't crash if a screen forgets to mount the provider.
  },
});

export function useLightbox(): LightboxApi {
  return use(LightboxContext);
}

interface Viewing {
  images: LightboxImage[];
  index: number;
}

/** Header row: filename on the left, Download and Close on the right.
 *
 *  Modeled on the library's own `ImageDefaultHeader` so the close affordance
 *  does not move or change size, with the Download button to its left — the
 *  order web uses (download, then close).
 *
 *  Download is offered only for an image backed by an attachment record
 *  (`canDownload`); the button is absent rather than disabled, because for an
 *  external inline image there is no fetch that could ever succeed. */
function LightboxHeader({
  image,
  onClose,
  onDownload,
  closingLabel,
  downloadLabel,
  titleFallback,
}: {
  image: LightboxImage | undefined;
  onClose: () => void;
  onDownload: () => void;
  closingLabel: string;
  downloadLabel: string;
  titleFallback: string;
}) {
  const insets = useSafeAreaInsets();
  const title = imageHeaderTitle(image, titleFallback);
  return (
    <View
      className="flex-row items-center px-2"
      style={{ paddingTop: insets.top + 8 }}
    >
      <Text
        className="flex-1 pl-2 text-body font-medium text-white"
        numberOfLines={1}
      >
        {title}
      </Text>
      {image?.canDownload ? (
        <Pressable
          onPress={onDownload}
          hitSlop={16}
          accessibilityRole="button"
          accessibilityLabel={downloadLabel}
          className="h-11 w-11 items-center justify-center rounded-full bg-black/45 active:opacity-80"
        >
          <Ionicons name="download-outline" size={22} color="#FFFFFF" />
        </Pressable>
      ) : null}
      <Pressable
        onPress={onClose}
        hitSlop={16}
        accessibilityRole="button"
        accessibilityLabel={closingLabel}
        className="ml-2 h-11 w-11 items-center justify-center rounded-full bg-black/45 active:opacity-80"
      >
        <Text className="text-title text-white">✕</Text>
      </Pressable>
    </View>
  );
}

export function LightboxProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [viewing, setViewing] = useState<Viewing | null>(null);
  // Tracked separately from `viewing.index` so the counter follows a swipe;
  // `viewing` itself is the frozen snapshot taken when the viewer opened.
  const [currentIndex, setCurrentIndex] = useState(0);

  const api = useMemo<LightboxApi>(
    () => ({
      open: (uri, sequence) => {
        // A URI the sequence doesn't know still opens, on its own — same
        // fallback web takes when `openAt` reports the key is unknown. It has
        // no record, so it is not downloadable.
        const found = sequence ? indexOfImageByUri(sequence, uri) : -1;
        const images: LightboxImage[] =
          sequence && found >= 0
            ? [...sequence]
            : [{ uri, filename: "", canDownload: false, source: { kind: "other" } }];
        setCurrentIndex(found >= 0 ? found : 0);
        setViewing({ images, index: found >= 0 ? found : 0 });
      },
    }),
    [],
  );

  const close = useCallback(() => setViewing(null), []);

  const current = viewing?.images[currentIndex];

  const onDownload = useCallback(() => {
    if (!current?.canDownload) return;
    // Never rejects: the failure surfaces in the downloads history, where it
    // can be retried. The alert is for the same reason the file-card path
    // has one — a tap that appears to do nothing reads as a broken button.
    void downloadAttachmentAndOpen(
      current.uri,
      current.filename,
      current.mimeType,
      current.source,
    ).catch(() => {
      Alert.alert(t("download.failedTitle"), t("download.failedMessage"));
    });
  }, [current, t]);

  const total = viewing?.images.length ?? 0;
  // Only a sequence gets a counter — a lone image has nothing to count.
  const Footer = useMemo(
    () =>
      total > 1
        ? function LightboxCounter() {
            return (
              <View className="items-center pb-10">
                <Text className="text-body text-white">
                  {currentIndex + 1} / {total}
                </Text>
              </View>
            );
          }
        : undefined,
    [currentIndex, total],
  );

  const Header = useCallback(
    () => (
      <LightboxHeader
        image={current}
        onClose={close}
        onDownload={onDownload}
        closingLabel={t("a11y.close")}
        downloadLabel={t("a11y.downloadFile", {
          filename: current?.filename || t("lightbox.imageFallbackTitle"),
        })}
        titleFallback={t("lightbox.imageFallbackTitle")}
      />
    ),
    [current, close, onDownload, t],
  );

  return (
    <LightboxContext.Provider value={api}>
      {children}
      <ImageView
        images={viewing?.images.map((image) => ({ uri: image.uri })) ?? []}
        imageIndex={viewing?.index ?? 0}
        visible={!!viewing}
        onRequestClose={close}
        onImageIndexChange={setCurrentIndex}
        HeaderComponent={Header}
        FooterComponent={Footer}
      />
    </LightboxContext.Provider>
  );
}
