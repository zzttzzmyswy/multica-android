/**
 * A deliverable's face in a grid or overview tile: the image itself for
 * images, otherwise its type glyph over a muted plate.
 *
 * Web's `DeliverableThumbnail` (`deliverable-thumbnail.tsx`) makes the same
 * two-way split, for a reason recorded there: there is no thumbnail endpoint,
 * so an image tile loads the ORIGINAL. That is affordable only because the
 * callers keep the count small (the sidebar grid shows three) or lazy (the
 * overview's grid). Both callers here honour the same bound.
 *
 * The image is resolved through `resolveAttachmentUrl`, the same pass
 * `MarkdownImage` and the lightbox sequence use, because the backend returns
 * a server-relative `/api/attachments/{id}/download` when it has no CDN signer
 * (MUL-2976) and RN has no document origin to resolve that against.
 *
 * A failed or still-loading image falls back to the glyph plate rather than an
 * empty box, so a tile whose bytes never arrive still says what kind of file
 * it is — the same degradation web performs when `useResignedInlineMedia` is
 * pending.
 */
import { useState } from "react";
import { View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Image as ExpoImage } from "expo-image";
import type { Attachment } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { resolveAttachmentUrl } from "@/lib/attachment-url";
import { deliverableCategory, deliverableIconName, deliverableTypeLabel } from "@/lib/deliverables";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

interface Props {
  attachment: Attachment;
  /** The extension under the glyph. Off where the tile is too small for it. */
  showTypeLabel?: boolean;
  className?: string;
}

export function DeliverableThumbnail({
  attachment,
  showTypeLabel = true,
  className,
}: Props) {
  const [failed, setFailed] = useState(false);

  // The URL to paint, chosen in the order `collectImageSequence` picks so the
  // tile and the lightbox open the same bytes (see lib/markdown/markdown-image).
  const picked =
    attachment.download_url || attachment.markdown_url || attachment.url;
  const uri = resolveAttachmentUrl(picked) ?? picked;

  const isImage =
    deliverableCategory(attachment.content_type, attachment.filename) === "image";

  if (!isImage || !uri || failed) {
    return (
      <FileFace
        attachment={attachment}
        showTypeLabel={showTypeLabel}
        className={className}
      />
    );
  }

  return (
    <ExpoImage
      source={{ uri }}
      // FlashList cell reuse would otherwise flash the previous tile's image
      // while this one decodes (expo-image docs: "highly recommended when used
      // in a list").
      recyclingKey={uri}
      style={{ width: "100%", height: "100%" }}
      contentFit="cover"
      transition={120}
      onError={() => setFailed(true)}
      className={cn("bg-muted", className)}
    />
  );
}

function FileFace({
  attachment,
  showTypeLabel,
  className,
}: {
  attachment: Attachment;
  showTypeLabel: boolean;
  className?: string;
}) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const label = deliverableTypeLabel(attachment.filename);
  return (
    <View
      className={cn(
        "items-center justify-center gap-1 bg-muted",
        className,
      )}
    >
      <Ionicons
        name={deliverableIconName(attachment.content_type, attachment.filename)}
        size={20}
        color={theme.mutedForeground}
      />
      {showTypeLabel && label ? (
        <Text className="text-micro font-medium tracking-wide text-muted-foreground">
          {label}
        </Text>
      ) : null}
    </View>
  );
}
