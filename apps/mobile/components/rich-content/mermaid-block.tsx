/**
 * Mermaid diagram block for ```mermaid fences — the mobile twin of web's
 * `MermaidFenceBlock` (packages/views/rich-content/rich-code-block.tsx:184).
 *
 * Renders the chart in an inline WebView with a fixed skeleton height that
 * the document's `{type:"size"}` telemetry immediately corrects (right →
 * left: the WebView reports its real layout box, this component pins that
 * height so the feed doesn't jump). A render failure swaps to the error
 * card + the raw source as a code block, so content is never lost.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Text } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { CodeBlock } from "@/lib/markdown/code-block";
import {
  buildMermaidDocument,
  getDarkThemeVariables,
  MERMAID_ASSET_BASE_URL,
  MERMAID_SKELETON_HEIGHT_PX,
  parseMermaidMessage,
} from "@/lib/rich-content/mermaid-doc";
import { MermaidViewer } from "./mermaid-viewer";

interface Props {
  source: string;
  selectable?: boolean;
}

export function MermaidBlock({ source, selectable = true }: Props) {
  const { isDarkColorScheme } = useColorScheme();
  const { t } = useTranslation();
  const [height, setHeight] = useState(MERMAID_SKELETON_HEIGHT_PX);
  const [error, setError] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doc = useMemo(
    () =>
      buildMermaidDocument(source, {
        themeVariables: isDarkColorScheme ? getDarkThemeVariables() : undefined,
      }),
    // WebView mounts once per source; a theme flip rebuilds doc but must not
    // reload the 3.1MB mermaid script mid-scroll (key stays `source` below).
    // On the next mount the current theme's variables apply.
    [source, isDarkColorScheme],
  );

  const onMessage = (event: WebViewMessageEvent) => {
    const msg = parseMermaidMessage(event.nativeEvent.data);
    if (!msg) return;
    if (msg.type === "size") setHeight(msg.height);
    else if (msg.type === "error") setError(msg.message);
  };

  const copySource = async () => {
    try {
      await Clipboard.setStringAsync(source);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Silent — no recovery path beats a confusing toast.
    }
  };

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  if (error) {
    return (
      <View className="bg-code-surface border border-border rounded-lg px-3 py-2">
        <Text className="text-xs text-destructive mb-1">
          {t("richContent.mermaid.renderFailed")}
        </Text>
        {error !== "webview error" ? (
          <Text className="text-xs text-muted-foreground mb-2">
            {t("richContent.mermaid.renderFailedHint")}
          </Text>
        ) : null}
        <Text className="text-xs text-muted-foreground mb-2" selectable>
          {error}
        </Text>
        <CodeBlock code={source} lang="mermaid" selectable={selectable} />
      </View>
    );
  }

  return (
    <>
      <View className="bg-card border border-border rounded-lg overflow-hidden">
        <View className="flex-row items-center justify-between px-3 py-2">
          <Text className="text-xs text-muted-foreground">
            {t("richContent.mermaid.title")}
          </Text>
          <View className="flex-row gap-2">
            <HeaderButton
              label={
                copied
                  ? t("richContent.mermaid.sourceCopied")
                  : t("richContent.mermaid.copySource")
              }
              onPress={copySource}
            />
            <HeaderButton
              label={t("richContent.mermaid.openFullscreen")}
              onPress={() => setViewerOpen(true)}
            />
          </View>
        </View>
        <View style={{ height }}>
          <WebView
            key={source}
            source={{ html: doc, baseUrl: MERMAID_ASSET_BASE_URL }}
            style={{
              flex: 1,
              backgroundColor: isDarkColorScheme ? "#1f2937" : "#ffffff",
            }}
            onMessage={onMessage}
            onError={() => setError("webview error")}
            javaScriptEnabled
            domStorageEnabled
            setSupportMultipleWindows={false}
            originWhitelist={["*"]}
          />
        </View>
      </View>
      <MermaidViewer
        visible={viewerOpen}
        source={source}
        onClose={() => setViewerOpen(false)}
      />
    </>
  );
}

function HeaderButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      className="rounded px-2 py-0.5"
      accessibilityRole="button"
    >
      <Text className="text-xs text-foreground">{label}</Text>
    </Pressable>
  );
}