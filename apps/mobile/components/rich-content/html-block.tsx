/**
 * HTML block preview for ```html fences — the mobile twin of web's
 * `HtmlFenceBlock` / `HtmlBlockPreview` (packages/views/rich-content/
 * rich-code-block.tsx:216, packages/views/editor/html-block-preview.tsx).
 *
 * Default view is "preview": the user HTML renders in a WebView with JS
 * disabled (`javaScriptEnabled={false}` is the script sandbox — the document
 * itself carries no script and can't open one). The "source" tab shows the
 * raw snippet as a highlighted code block. Fullscreen re-mounts the preview
 * in a modal.
 */
import { useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { WebView } from "react-native-webview";
import { Text } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { CodeBlock } from "@/lib/markdown/code-block";
import { buildHtmlPreviewDocument } from "@/lib/rich-content/html-preview-doc";
import { THEME } from "@/lib/theme";

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
          <View style={{ height: PREVIEW_HEIGHT_PX }}>
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
          </View>
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
        >
          <Text className="text-xs text-foreground">
            {t("richContent.html.viewFullscreen")}
          </Text>
        </Pressable>
      </View>
      <Modal
        visible={fullscreen}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setFullscreen(false)}
      >
        <View
          style={{ flex: 1, backgroundColor: isDarkColorScheme ? THEME.dark.background : THEME.light.background }}
        >
          <View className="flex-row items-center justify-between px-4 py-3 border-b border-border bg-card">
            <Text className="text-base font-semibold text-foreground">
              {t("richContent.html.title")}
            </Text>
            <Pressable
              onPress={() => setFullscreen(false)}
              hitSlop={8}
              className="rounded-md px-2 py-1 border border-border"
              accessibilityRole="button"
            >
              <Text className="text-xs text-foreground">
                {t("richContent.mermaid.close")}
              </Text>
            </Pressable>
          </View>
          <WebView
            key={doc}
            source={{ html: doc }}
            style={{ flex: 1, backgroundColor: "transparent" }}
            javaScriptEnabled={false}
            domStorageEnabled={false}
            setSupportMultipleWindows={false}
            originWhitelist={["*"]}
          />
        </View>
      </Modal>
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