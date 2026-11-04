import "../global.css";

import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import Constants from "expo-constants";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ThemeProvider } from "@react-navigation/native";
import { PortalHost } from "@rn-primitives/portal";
import { api } from "@/data/api";
import { queryClient } from "@/data/query-client";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { loadApiBaseUrl } from "@/data/server-config";
import { LightboxProvider, prewarmHighlighter } from "@/lib/markdown";
import { ActionSheetProvider } from "@/lib/action-sheet";
import { resolveAppVersion } from "@/lib/app-identity";
import { SessionActivityBoundary } from "@/components/auth/session-activity-boundary";
import { maybeRenewSession, renewSessionNow } from "@/lib/session-renewal";
import { NAV_THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import { markBootComplete, markBootStep } from "@/lib/boot-diagnostics";
import { FatalErrorBoundary } from "@/components/fatal-error-boundary";

// Boot breadcrumb: if the app dies during module evaluation, the next cold
// start can say WHERE (see lib/boot-diagnostics.ts). Written before anything
// else can throw, so a failure below is attributable rather than a silent
// close with nothing to report.
markBootStep("root-layout:module-eval");

// Kick off Shiki highlighter init at module load — fires once per process,
// finishes before the user navigates to any screen with a code block. If
// init fails (engine unavailable) the highlighter falls back to plain
// text; nothing here is allowed to throw.
//
// Guarded: `createHighlighterCore` can throw SYNCHRONOUSLY (bad theme/grammar
// payload, native engine refusing the call), which `.catch()` inside
// `initHighlighter` cannot intercept. At module top level an uncaught throw
// aborts the entry module — in a release build that is an instant close with
// no red box and no log, which is exactly the 0.6.122 report (MYS-2582). The
// prewarm is an optimisation, so it must never be able to take the app down.
markBootStep("root-layout:prewarm-highlighter");
try {
  prewarmHighlighter();
} catch (err) {
  console.warn("[boot] highlighter prewarm threw; continuing without it:", err);
}

function AuthInitializer({ children }: { children: React.ReactNode }) {
  const initialize = useAuthStore((s) => s.initialize);
  const qc = useQueryClient();
  // Idempotent guard: 401 on multiple in-flight requests would otherwise
  // logout/navigate repeatedly during the same session-expire moment.
  const signingOutRef = useRef(false);

  useEffect(() => {
    // Tell the server which client this is. Both values used to be hard-coded
    // (`ios` / `0.6.5`) on every request, so the server's platform breakdown and
    // version dimension were wrong for every Android install; resolve them from
    // the running app instead. Set synchronously before the first request —
    // `initialize()` below is what fires it. `Platform.OS` is a static value and
    // `Constants.expoConfig` is embedded in the bundle, so neither can throw.
    api.setOptions({
      identity: {
        os: Platform.OS,
        version: resolveAppVersion(Constants),
      },
    });
    // Wire 401 handling onto the shared ApiClient singleton. Must be set
    // before any request fires — initialize() below kicks off the first
    // getMe() call, so do this synchronously first.
    api.setOptions({
      onUnauthorized: () => {
        if (signingOutRef.current) return;
        signingOutRef.current = true;
        void (async () => {
          await useAuthStore.getState().logout();
          await useWorkspaceStore.getState().clear();
          qc.clear();
          router.replace("/login");
          // Reset on next tick so a fresh session can hit 401 again later
          // without being silently swallowed.
          setTimeout(() => {
            signingOutRef.current = false;
          }, 0);
        })();
      },
    });
    void (async () => {
      // Restore a user-configured custom server URL (set from the login
      // screen's Server item) into the cache BEFORE the first authenticated
      // request. Skipping this makes initialize() → getMe() hit the build-time
      // default host on a cold start, where the self-hosted token 401s, the
      // token gets cleared, and the user is force re-logged-in.
      await loadApiBaseUrl();
      await initialize();
      // Sliding session renewal (MYS-2538). AFTER initialize(): the token has
      // to be loaded and on the client before a refresh can carry it. Renewal
      // is not a session event — it swaps a credential in place, so it must not
      // race the getMe() that decides whether this session is valid at all.
      void renewSessionNow();
    })();
  }, [initialize, qc]);

  // Renewal follows USE, not a clock (see lib/session-renewal.ts): the two
  // transitions that mean "a person came back" are launch (above) and
  // foreground. Deliberately no interval — a phone in a pocket must not keep a
  // session alive for someone who stopped using the app months ago.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") maybeRenewSession();
    });
    return () => subscription.remove();
  }, []);

  return <>{children}</>;
}

export default function RootLayout() {
  const { colorScheme, isDarkColorScheme } = useColorScheme();
  // Reaching the first render means module eval + provider construction all
  // succeeded, so the marker can be cleared: the next cold start will not
  // report this boot as a failure.
  useEffect(() => {
    markBootComplete();
  }, []);
  return (
    <FatalErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <KeyboardProvider>
            <QueryClientProvider client={queryClient}>
              <ThemeProvider value={NAV_THEME[colorScheme]}>
                <AuthInitializer>
                  {/* Any touch anywhere counts as use, so a session cannot
                      expire under the hands of someone who has had the app open
                      in the foreground for longer than the renewal cadence. */}
                  <SessionActivityBoundary>
                  <LightboxProvider>
                    <StatusBar style={isDarkColorScheme ? "light" : "dark"} />
                    <ActionSheetProvider>
                      <Stack screenOptions={{ headerShown: false }}>
                        <Stack.Screen name="index" />
                        <Stack.Screen name="(auth)" />
                        <Stack.Screen name="(app)" />
                      </Stack>
                    </ActionSheetProvider>
                    <PortalHost />
                  </LightboxProvider>
                  </SessionActivityBoundary>
                </AuthInitializer>
              </ThemeProvider>
            </QueryClientProvider>
          </KeyboardProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </FatalErrorBoundary>
  );
}
