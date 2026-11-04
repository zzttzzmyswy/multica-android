/**
 * Renders a captured fatal JS error instead of letting the app vanish
 * (MYS-2582 companion to lib/global-error-capture.ts).
 *
 * The 0.6.122 report was "installs, then closes, no log". A release build
 * cannot show RN's dev red box, so the only surfaces left were a silent close
 * and a user with nothing to send. This screen replaces the silent close with
 * a readable report the user CAN screenshot.
 *
 * Deliberately dependency-free: plain RN primitives, no theme provider, no
 * i18n, no navigation. It may be mounted when the tree above it is already
 * broken, so anything that could itself throw (context lookups, native
 * modules, translations) is avoided. Copy is English on purpose — it is a
 * diagnostic surface for a bug report, and the user reading it is reporting
 * to a developer.
 */
import { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  installGlobalErrorCapture,
  setCapturedErrorListener,
  type CapturedError,
} from "@/lib/global-error-capture";

export function FatalErrorScreen({ error }: { error: CapturedError }) {
  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Multica hit an unexpected error</Text>
        <Text style={styles.hint}>
          Please screenshot this screen and send it to the developer. It says
          exactly where the app stopped, which is what makes the bug fixable
          without a log file.
        </Text>

        {error.bootStep ? (
          <>
            <Text style={styles.label}>Stopped at</Text>
            <Text style={styles.value} selectable>
              {error.bootStep}
            </Text>
          </>
        ) : null}

        <Text style={styles.label}>What happened</Text>
        <Text style={styles.value} selectable>
          {error.message}
        </Text>

        {error.stack ? (
          <>
            <Text style={styles.label}>Stack</Text>
            <Text style={styles.stack} selectable>
              {error.stack}
            </Text>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

/**
 * Wraps the app and swaps in `FatalErrorScreen` once a fatal error is captured.
 *
 * Must be the outermost element in the root layout: it has to stay mounted to
 * catch errors thrown by everything inside it.
 */
export function FatalErrorBoundary({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const [fatal, setFatal] = useState<CapturedError | null>(null);

  useEffect(() => {
    installGlobalErrorCapture();
    const unsubscribe = setCapturedErrorListener((captured) => {
      // Non-fatal errors (recoverable, logged by RN itself) must not replace a
      // working UI — only a fatal one means the tree is gone.
      if (captured.isFatal) setFatal(captured);
    });
    return unsubscribe;
  }, []);

  const dismiss = useCallback(() => setFatal(null), []);

  if (fatal) {
    return (
      <View style={[{ flex: 1 }, style]}>
        <FatalErrorScreen error={fatal} />
        <Pressable onPress={dismiss} style={styles.dismiss} accessibilityRole="button">
          <Text style={styles.dismissText}>Try to continue</Text>
        </Pressable>
      </View>
    );
  }

  return <View style={[{ flex: 1 }, style]}>{children}</View>;
}

// Static colors, not theme tokens: the theme provider may be exactly what
// failed, and a diagnostic screen rendered in the wrong palette is still
// infinitely better than no screen at all.
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0b0b0c" },
  content: { padding: 20, paddingTop: 56, paddingBottom: 96 },
  title: { color: "#ffffff", fontSize: 20, fontWeight: "600", marginBottom: 8 },
  hint: { color: "#a1a1aa", fontSize: 13, lineHeight: 19, marginBottom: 20 },
  label: {
    color: "#a1a1aa",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginTop: 16,
    marginBottom: 4,
  },
  value: { color: "#f4f4f5", fontSize: 13, lineHeight: 20 },
  stack: { color: "#d4d4d8", fontSize: 11, lineHeight: 16 },
  dismiss: {
    position: "absolute",
    left: 20,
    right: 20,
    bottom: 28,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#3f3f46",
    alignItems: "center",
  },
  dismissText: { color: "#f4f4f5", fontSize: 14, fontWeight: "500" },
});
