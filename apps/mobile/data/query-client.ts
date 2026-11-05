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
  workflowRefusalCopy,
} from "@/lib/write-failure";
import { alertStatusLabel } from "@/lib/status-label-alert";
import { issueStatusKeys } from "@/data/queries/issue-statuses";
import { useWorkspaceStore } from "@/data/workspace-store";
import type { IssueStatusEntry } from "@multica/core/types";

/**
 * Resolves a status key for the alert channel, which runs outside React.
 *
 * Reads the catalog from THIS client's cache rather than importing a helper
 * that owns one: the client is defined in this module, so a helper reaching
 * back for it would close an import cycle through every mutation's error path.
 * A cold cache is fine — built-in keys still resolve through i18n.
 */
function alertStatusLabelFromCache(statusKey: string): string {
  const wsId = useWorkspaceStore.getState().currentWorkspaceId;
  const catalog = wsId
    ? queryClient.getQueryData<IssueStatusEntry[]>(issueStatusKeys.list(wsId))
    : undefined;
  return alertStatusLabel(statusKey, catalog);
}

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
        // Project-workflow refusals (MUL-7420) get their own sentence and take
        // the failure off the generic path: the server's body for these is
        // written for a caller ("status X is not in workflow Y"), and the
        // member's real question is which column they SHOULD pick. Rendered
        // here — the one place every mutation's failures pass — so no write
        // path can forget it.
        () =>
          workflowRefusalCopy(
            error,
            (id, vars) => translate(id, vars as Record<string, string | number> | undefined),
            alertStatusLabelFromCache,
          ),
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
