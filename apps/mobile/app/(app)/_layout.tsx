import { ActivityIndicator, View } from "react-native";
import { Stack, Redirect } from "expo-router";
import { useAuthStore } from "@/data/auth-store";
import { resolveAppGate } from "@/lib/auth-gate";

/**
 * Auth-required layout. Holds a splash while auth initializes, then redirects
 * to /login when no user is loaded.
 *
 * The `isLoading` branch is load-bearing, not cosmetic: a deep link mounts this
 * tree as the *initial* route, so `app/index.tsx` — the other place that waits
 * on `isLoading` — never runs. Gating on `user` alone stranded logged-in users
 * on /login. See `lib/auth-gate.ts`.
 *
 * Workspace membership is enforced one level deeper at [workspace]/_layout —
 * not here — because select-workspace.tsx itself is auth-required but
 * workspace-less.
 */
export default function AppLayout() {
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);

  const gate = resolveAppGate({ user, isLoading });
  if (gate === "loading") {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }
  if (gate === "login") return <Redirect href="/login" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
