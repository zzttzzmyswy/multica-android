/**
 * KaTeX math block — the mobile twin of web's math rendering
 * (rehype-katex in packages/views/rich-content/rich-content.tsx:476 +
 * BlockMathView in packages/views/editor/extensions/math.tsx).
 *
 * Renders ```math fences and standalone $$…$$ blocks via the WebView
 * document from lib/rich-content/katex-doc.ts (local katex.min.js asset,
 * no network). Height adapts to the rendered equation through the
 * postMessage size payload; a render failure falls back to the source
 * expression as plain code.
 */
import { useState } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";
import type { WebViewMessageEvent } from "react-native-webview";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/lib/use-color-scheme";
import { useTranslation } from "@/lib/i18n/react";
import { CodeBlock } from "@/lib/markdown/code-block";
import {
  buildKatexDocument,
  parseKatexMessage,
} from "@/lib/rich-content/katex-doc";

const MIN_HEIGHT = 48;

interface Props {
  expression: string;
  displayMode?: boolean;
}

export function MathBlock({ expression, displayMode = true }: Props) {
  const { isDarkColorScheme } = useColorScheme();
  const { t } = useTranslation();
  const [height, setHeight] = useState(MIN_HEIGHT);
  const [failed, setFailed] = useState(false);

  const doc = buildKatexDocument(expression, { displayMode });

  const onMessage = (event: WebViewMessageEvent) => {
    const msg = parseKatexMessage(event.nativeEvent.data);
    if (!msg) return;
    if (msg.type === "size" && msg.height) {
      setHeight(Math.max(MIN_HEIGHT, msg.height));
    } else if (msg.type === "error") {
      setFailed(true);
    }
  };

  if (failed || expression.trim() === "") {
    return <CodeBlock code={expression} lang="math" />;
  }

  return (
    <View className="bg-card border border-border rounded-lg overflow-hidden">
      <View style={{ height }} testID="math-block-webview">
        <WebView
          key={expression}
          source={{ html: doc, baseUrl: "file:///android_asset/" }}
          style={{
            flex: 1,
            backgroundColor: isDarkColorScheme ? "#1f2937" : "#ffffff",
          }}
          javaScriptEnabled
          domStorageEnabled={false}
          setSupportMultipleWindows={false}
          originWhitelist={["*"]}
          scrollEnabled={false}
          overScrollMode="never"
          onMessage={onMessage}
          onError={() => setFailed(true)}
          accessibilityLabel={t("richContent.math.title")}
        />
      </View>
      <View className="px-3 py-1 border-t border-border">
        <Text className="text-xs text-muted-foreground">
          {t("richContent.math.title")}
        </Text>
      </View>
    </View>
  );
}
