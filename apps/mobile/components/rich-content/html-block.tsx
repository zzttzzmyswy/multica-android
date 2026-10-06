/**
 * HTML block preview for ```html fences — the mobile twin of web's
 * `HtmlFenceBlock` / `HtmlBlockPreview` (packages/views/rich-content/
 * rich-code-block.tsx:216, packages/views/editor/html-block-preview.tsx).
 *
 * Default view is "preview": the user HTML renders in a WebView with JS
 * disabled (`javaScriptEnabled={false}` is the script sandbox — the document
 * itself carries no script and can't open one). The "source" tab shows the
 * raw snippet as a highlighted code block. Fullscreen re-mounts whichever view
 * is selected through the shared shell in
 * `lib/rich-content/fullscreen-preview`, so this block and the two attachment
 * cards cannot drift apart.
 *
 * The entry is unconditional here, unlike the attachment cards': the snippet is
 * already in the document, so there is no read that could fail and leave
 * nothing to magnify.
 */
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { WebView } from "react-native-webview";
import { Text } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { CodeBlock } from "@/lib/markdown/code-block";
import { FullscreenPreview } from "@/lib/rich-content/fullscreen-preview";
import { buildHtmlPreviewDocument } from "@/lib/rich-content/html-preview-doc";

const PREVIEW_HEIGHT_PX = 260;

interface Props {
  html: string;
  selectable?: boolean;
}

export function HtmlBlockPreview({ html, selectable = true }: Props) {
  const { isDarkColorScheme } = useColorScheme();
  const { t } = useTranslation();
  const [mode, setMode] = useState<"preview" | "source">("preview");
  const [fullscreen, setFullscreen] = useState(false);

  const doc = buildHtmlPreviewDocument(html);

  // Built once and mounted in whichever container is on screen. The WebView is
  // the expensive half of this component and its sandbox flags are the security
  // boundary, so a second hand-written copy for the fullscreen view is exactly
  // how the two would drift.
  const preview = (
    <WebView
      key={html}
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
  );

  return (
    <>
      <View className="bg-card border border-border rounded-lg overflow-hidden">
        <View className="flex-row items-center justify-between px-3 py-2">
          <Text className="text-xs text-muted-foreground">
            {t("richContent.html.title")}
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
          <View style={{ height: PREVIEW_HEIGHT_PX }}>{preview}</View>
        ) : (
          <View className="px-3 pb-2">
            <CodeBlock code={html} lang="html" selectable={selectable} />
          </View>
        )}
        <Pressable
          onPress={() => setFullscreen(true)}
          hitSlop={6}
          className="px-3 py-1.5 border-t border-border"
          accessibilityRole="button"
          accessibilityLabel={t("richContent.html.viewFullscreen")}
        >
          <Text className="text-xs text-foreground">
            {t("richContent.html.viewFullscreen")}
          </Text>
        </Pressable>
      </View>
      <FullscreenPreview
        visible={fullscreen}
        onClose={() => setFullscreen(false)}
        title={t("richContent.html.title")}
      >
        {/* Same split as the html attachment card: preview fills the shell and
            lets the WebView own its scrolling, source gets a vertical scroll so
            a long fence is not clipped behind `CodeBlock`'s horizontal-only
            scroll view. */}
        {mode === "preview" ? (
          preview
        ) : (
          <ScrollView contentContainerClassName="px-3 py-2 pb-6">
            <CodeBlock code={html} lang="html" selectable={false} />
          </ScrollView>
        )}
      </FullscreenPreview>
    </>
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
      className={`rounded px-2 py-0.5 ${
        active ? "bg-muted" : ""
      }`}
      accessibilityRole="button"
    >
      <Text className={`text-xs ${active ? "text-foreground" : "text-muted-foreground"}`}>
        {label}
      </Text>
    </Pressable>
  );
}
