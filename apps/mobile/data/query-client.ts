/**
 * Mobile-owned QueryClient.
 *
 * Bridges TanStack Query's two cross-cutting managers to native signals:
 *   - focusManager ← AppState ('active' = focused)
 *   - onlineManager ← NetInfo (isConnected)
 *
 * After this wiring is in place, queries with `refetchOnWindowFocus: true`
 * (the default) refetch on foreground, and queries are automatically paused
 * while offline + replayed when the network returns. The realtime
 * WebSocket layer (data/realtime/) reads the same signals to drive socket
 * connect/disconnect, so the two stay in sync.
 *
 * Web/desktop use a different QueryClient (packages/core/query-client.ts).
 * Mobile maintains its own to keep React Native deps out of shared code.
 */
import {
  focusManager,
  MutationCache,
  onlineManager,
  QueryClient,
} from "@tanstack/react-query";
import { Alert, AppState, type AppStateStatus } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { translate } from "@/lib/i18n";
import {
  reportWriteFailure,
  writeFailureDetail,
} from "@/lib/write-failure";

export const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      reportWriteFailure(error, mutation, translate, (title) =>
        // The SAME three arguments `reportWriteFailure` uses to decide WHAT to
        // say. Passing the error alone — as this call did — silently disabled
        // every substitution the message rules define: `writeFailureDetail`
        // reads the mutation's `meta` to find the conflict and permission keys
        // and calls `translate` to render them, so with neither it fell through
        // to the server's own body on every failure. The visible damage was a
        // lost-update 409 showing `revision mismatch` instead of the sentence
        // that tells the member which version to keep (MYS-2132), and a
        // source-context 409 showing `source context changed` instead of
        // 「请刷新后重试」 (MYS-2137). The classifier tests all passed
        // throughout, because they exercise `writeFailureDetail` directly.
        Alert.alert(title, writeFailureDetail(error, mutation, translate)),
      );
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // 1 minute
      gcTime: 10 * 60 * 1000, // 10 minutes
      retry: 1,
      refetchOnWindowFocus: true, // honored via focusManager bridge below
    },
    mutations: {
      retry: false,
    },
  },
});

// ── focusManager ← AppState ──────────────────────────────────────────
// Foregrounding the app counts as "focus" → triggers refetchOnWindowFocus
// for any stale queries the user is currently looking at.
focusManager.setEventListener((handleFocus) => {
  const sub = AppState.addEventListener("change", (status: AppStateStatus) => {
    handleFocus(status === "active");
  });
  return () => sub.remove();
});

// ── onlineManager ← NetInfo ──────────────────────────────────────────
// While offline, TanStack Query pauses queries; when isConnected flips
// back to true it replays paused fetches. RealtimeProvider also listens
// to NetInfo to force-reconnect the WS — both flows are driven by the
// same signal so client state and server state catch up together.
onlineManager.setEventListener((setOnline) => {
  return NetInfo.addEventListener((state) => {
    setOnline(state.isConnected === true);
  });
});
