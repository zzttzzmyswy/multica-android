/**
 * Fullscreen Mermaid diagram viewer (Modal).
 *
 * Renders the diagram at NATURAL size inside its own WebView; the viewer
 * document owns panning as content scroll (`#stage` overflow auto). Toolbar:
 * diagram/source toggle, copy source, share SVG / PNG / MMD, close.
 *
 * Export runs inside the WebView through viewer-bridge.ts's injected hooks:
 *   - SVG: serialize the live diagram → postMessage → write cache file → share.
 *   - PNG: SVG → canvas → dataURL inside the WebView (react-native carries no
 *     rasterizer) → write base64 file → share.
 *   - MMD: the raw mermaid source → write text file → share.
 *
 * Each open mounts a fresh document, so zoom/pan never leak between openings.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Modal, ScrollView, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import * as Clipboard from "expo-clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { IconButton } from "@/components/ui/icon-button";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import { useTranslation } from "@/lib/i18n/react";
import {
  buildMermaidDocument,
  getDarkThemeVariables,
  MERMAID_ASSET_BASE_URL,
} from "@/lib/rich-content/mermaid-doc";
import {
  buildExportBridgeJs,
  parseMermaidViewerMessage,
  type MermaidViewerMessage,
} from "@/lib/rich-content/viewer-bridge";
import {
  shareExportDataUrl,
  shareExportText,
} from "@/lib/rich-content/export-file";
import { CodeBlock } from "@/lib/markdown/code-block";

/** Slug used for exported files: first meaningful line → kebab → 40 chars. */
function diagramFilenameStem(chart: string): string {
  const firstLine = chart
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("%%"));
  const slug = (firstLine ?? "diagram")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "diagram";
}

interface Props {
  visible: boolean;
  onClose: () => void;
  source: string;
}

export function MermaidViewer({ visible, onClose, source }: Props) {
  const { t } = useTranslation();
  const { isDarkColorScheme } = useColorScheme();
  const theme = isDarkColorScheme ? THEME.dark : THEME.light;
  const insets = useSafeAreaInsets();
  const webviewRef = useRef<WebView>(null);

  const [showSource, setShowSource] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const exportBackground = isDarkColorScheme ? "rgb(38, 38, 40)" : "rgb(255, 255, 255)";

  const doc = useMemo(
    () =>
      buildMermaidDocument(source, {
        viewer: true,
        themeVariables: isDarkColorScheme ? getDarkThemeVariables() : undefined,
      }),
    [source, isDarkColorScheme],
  );

  const handleExportPayload = useCallback(
    async (msg: Extract<MermaidViewerMessage, { type: "export-png" | "export-svg" }>) => {
      try {
        const stem = diagramFilenameStem(source);
        if (msg.type === "export-png") {
          await shareExportDataUrl(`${stem}.png`, msg.dataUrl, "image/png");
        } else {
          await shareExportText(`${stem}.svg`, msg.svg, "image/svg+xml");
        }
        setExported(true);
      } catch {
        setError(t("richContent.mermaid.exportFailed"));
      } finally {
        setExportBusy(false);
      }
    },
    [source, t],
  );

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    const msg = parseMermaidViewerMessage(event.nativeEvent.data);
    if (!msg) return;
    if (msg.type === "error" || msg.type === "export-error") {
      setError(msg.message);
    } else if (msg.type === "export-png" || msg.type === "export-svg") {
      void handleExportPayload(msg);
    }
    // size / svg render messages are consumed by the viewer document itself.
  }, [handleExportPayload]);

  const requestSvgExport = useCallback(() => {
    setError(null);
    setExportBusy(true);
    webviewRef.current?.injectJavaScript(
      "window.__multicaExportSvg && window.__multicaExportSvg(); true;",
    );
  }, []);

  const requestPngExport = useCallback(() => {
    setError(null);
    setExportBusy(true);
    webviewRef.current?.injectJavaScript(
      "window.__multicaExportPng && window.__multicaExportPng(); true;",
    );
  }, []);

  const shareMmd = useCallback(async () => {
    setError(null);
    setExportBusy(true);
    try {
      await shareExportText(
        `${diagramFilenameStem(source)}.mmd`,
        source,
        "text/vnd.mermaid",
      );
      setExported(true);
    } catch {
      setError(t("richContent.mermaid.exportFailed"));
    } finally {
      setExportBusy(false);
    }
  }, [source, t]);

  const onCopy = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(source);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // silent
    }
  }, [source]);

  const close = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    onClose();
  }, [onClose]);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={close}
    >
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
        <View className="h-12 flex-row items-center gap-1 border-b border-border px-2">
          <Text className="flex-1 pl-1 text-sm font-medium">
            {t("richContent.mermaid.title")}
          </Text>
          <IconButton
            name={showSource ? "image-outline" : "code-outline"}
            iconSize={18}
            accessibilityLabel={
              showSource
                ? t("richContent.html.preview")
                : t("richContent.html.source")
            }
            onPress={() => setShowSource((v) => !v)}
          />
          <IconButton
            name={copied ? "checkmark" : "copy-outline"}
            iconSize={18}
            accessibilityLabel={t("richContent.mermaid.copySource")}
            onPress={onCopy}
          />
          <IconButton
            name="image-outline"
            iconSize={18}
            accessibilityLabel={t("richContent.mermaid.exportSvg")}
            disabled={exportBusy}
            onPress={requestSvgExport}
          />
          <IconButton
            name="albums-outline"
            iconSize={18}
            accessibilityLabel={t("richContent.mermaid.exportPng")}
            disabled={exportBusy}
            onPress={requestPngExport}
          />
          <IconButton
            name="document-text-outline"
            iconSize={18}
            accessibilityLabel={t("richContent.mermaid.exportMmd")}
            disabled={exportBusy}
            onPress={shareMmd}
          />
          <IconButton
            name="close"
            iconSize={20}
            accessibilityLabel={t("richContent.mermaid.close")}
            onPress={close}
          />
        </View>

        {exported ? (
          <View className="items-center py-2">
            <Text className="text-xs text-success">{t("richContent.mermaid.exported")}</Text>
          </View>
        ) : null}
        {exportBusy ? (
          <View className="items-center py-2">
            <ActivityIndicator size="small" color={theme.mutedForeground} />
          </View>
        ) : null}

        {showSource ? (
          <ScrollView className="flex-1 px-3 py-3">
            <CodeBlock code={source} lang="mermaid" />
          </ScrollView>
        ) : (
          <View className="flex-1">
            {error ? (
              <View className="px-4 py-3">
                <Text className="text-sm text-warning">{error}</Text>
              </View>
            ) : null}
            <WebView
              ref={webviewRef}
              key={doc}
              source={{ html: doc, baseUrl: MERMAID_ASSET_BASE_URL }}
              originWhitelist={["*"]}
              javaScriptEnabled
              injectedJavaScript={buildExportBridgeJs(exportBackground)}
              onMessage={handleMessage}
              style={{ backgroundColor: "transparent", flex: 1 }}
              overScrollMode="never"
              setSupportMultipleWindows={false}
            />
          </View>
        )}
      </View>
    </Modal>
  );
}