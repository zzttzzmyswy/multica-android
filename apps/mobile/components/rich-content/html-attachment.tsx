/**
 * HTML attachment inline preview (comment cards / issue attachment lists) —
 * the mobile twin of web's `HtmlAttachmentPreview`
 * (packages/views/editor/html-attachment-preview.tsx).
 *
 * The body loads through `GET /api/attachments/{id}/content` (server-side
 * text/HTML proxy, 2 MB cap + content-type whitelist — 413/415 are hard
 * failures, never retried). Rendering uses the same sandbox document as the
 * ```html fence block (buildHtmlPreviewDocument) with `javaScriptEnabled
 * ={false}` — strictly more restrictive than web's sandbox="allow-scripts"
 * iframe. Preview / source tabs mirror the fence block's interaction.
 */
import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { WebView } from "react-native-webview";
import { Text } from "@/components/ui/text";
import {
  api,
  PreviewTooLargeError,
  PreviewUnsupportedError,
} from "@/data/api";
import { useColorScheme } from "@/lib/use-color-scheme";
import { useTranslation } from "@/lib/i18n/react";
import { CodeBlock } from "@/lib/markdown/code-block";
import { buildHtmlPreviewDocument } from "@/lib/rich-content/html-preview-doc";
import { THEME } from "@/lib/theme";

const PREVIEW_HEIGHT_PX = 300;
const ERROR_HEIGHT_PX = 80;

interface Props {
  attachmentId: string;
  filename: string;
  contentType: string;
}

export function HtmlAttachmentPreview({
  attachmentId,
  filename,
  contentType,
}: Props) {
  const { isDarkColorScheme } = useColorScheme();
  const { t } = useTranslation();
  const [mode, setMode] = useState<"preview" | "source">("preview");
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState<null | "tooLarge" | "unsupported" | "failed">(null);

  const load = useCallback(async () => {
    setFailed(null);
    try {
      const res = await api.getAttachmentTextContent(attachmentId);
      setText(res.text);
    } catch (err) {
      if (err instanceof PreviewTooLargeError) setFailed("tooLarge");
      else if (err instanceof PreviewUnsupportedError) setFailed("unsupported");
      else setFailed("failed");
    }
  }, [attachmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed || text === null) {
    // Error placeholder — the collapsed card keeps the surface stable and the
    // filename visible; the caller's download affordance remains the escape
    // hatch (mirrors web's pinned-toolbar failure mode). 413/415 get their
    // specific message; anything else the generic one.
    const messageKey =
      failed === "tooLarge"
        ? "richContent.html.tooLarge"
        : failed === "unsupported"
          ? "richContent.html.unsupported"
          : "richContent.htmlAttachment.previewUnavailable";
    return (
      <View
        className="bg-card border border-border rounded-lg justify-center px-3"
        style={{ height: ERROR_HEIGHT_PX }}
      >
        <Text className="text-sm text-muted-foreground" numberOfLines={2}>
          {filename}
        </Text>
        <Text className="text-xs text-muted-foreground">
          {t(messageKey)}
        </Text>
      </View>
    );
  }

  const doc = buildHtmlPreviewDocument(text);

  return (
    <View className="bg-card border border-border rounded-lg overflow-hidden">
      <View className="flex-row items-center justify-between px-3 py-2">
        <Text className="text-xs text-muted-foreground" numberOfLines={1}>
          {filename}
        </Text>
        <View className="flex-row gap-1">
          <TabButton
            label={t("richContent.html.preview")}
            active={mode === "preview"}
            onPress={() => setMode("preview")}
          />
          <TabButton
            label={t("richContent.html.source")}
            active={mode === "source"}
            onPress={() => setMode("source")}
          />
        </View>
      </View>
      {mode === "preview" ? (
        <View style={{ height: PREVIEW_HEIGHT_PX }}>
          <WebView
            key={text}
            source={{ html: doc }}
            style={{
              flex: 1,
              backgroundColor: isDarkColorScheme ? "#1f2937" : "#ffffff",
            }}
            javaScriptEnabled={false}
            domStorageEnabled={false}
            setSupportMultipleWindows={false}
            originWhitelist={["*"]}
            overScrollMode="never"
          />
        </View>
      ) : (
        <View className="px-3 pb-2">
          <CodeBlock code={text} lang="html" />
        </View>
      )}
    </View>
  );
}

function TabButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      className={`rounded px-2 py-0.5 ${active ? "bg-muted" : ""}`}
      accessibilityRole="button"
    >
      <Text
        className={`text-xs ${active ? "text-foreground" : "text-muted-foreground"}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}
