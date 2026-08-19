import { useRef, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { CardPressable } from "@/components/ui/card";
import { api } from "@/data/api";
import type { Invitation } from "@multica/core/types";
import { myInvitationsOptions } from "@/data/queries/invitations";
import { workspaceListOptions } from "@/data/queries/workspaces";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";

export default function SelectWorkspace() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const setCurrentWorkspace = useWorkspaceStore((s) => s.setCurrentWorkspace);
  const { data, isLoading, error, refetch } = useQuery(workspaceListOptions());
  const { data: invitations } = useQuery(myInvitationsOptions());
  const qc = useQueryClient();
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null);
  const busyInviteRef = useRef<string | null>(null);
  const { t } = useTranslation();

  const onSelect = async (id: string, slug: string) => {
    await setCurrentWorkspace(id, slug);
    router.replace(`/${slug}/inbox`);
  };

  const enterJoinedWorkspace = async (workspaceId: string) => {
    const list = await qc.fetchQuery({
      ...workspaceListOptions(),
      staleTime: 0,
    });
    const joined = list.find((w) => w.id === workspaceId);
    if (joined) {
      await setCurrentWorkspace(joined.id, joined.slug);
      router.replace(`/${joined.slug}/inbox`);
    }
  };

  const onAccept = async (inv: Invitation) => {
    if (busyInviteRef.current) return;
    busyInviteRef.current = inv.id;
    setBusyInviteId(inv.id);
    let accepted = false;
    try {
      await api.acceptInvitation(inv.id);
      accepted = true;
      qc.invalidateQueries({ queryKey: ["invitations"] });
    } catch {
      Alert.alert(t("invite.errorTitle"), t("invite.acceptFailed"));
      busyInviteRef.current = null;
      setBusyInviteId(null);
      return;
    }
    // Mirror web MUL-820: after accepting, navigate INTO the joined workspace
    // so the user isn't left staring at a stale list. Best-effort — a list
    // fetch failure here must not surface as "accept failed".
    busyInviteRef.current = null;
    setBusyInviteId(null);
    if (accepted) {
      try {
        await enterJoinedWorkspace(inv.workspace_id);
      } catch {
        // Already accepted; navigation is best-effort. Stale list is fine.
      }
    }
  };

  const onDecline = async (inv: Invitation) => {
    if (busyInviteRef.current) return;
    busyInviteRef.current = inv.id;
    setBusyInviteId(inv.id);
    try {
      await api.declineInvitation(inv.id);
      qc.invalidateQueries({ queryKey: ["invitations"] });
    } catch {
      Alert.alert(t("invite.errorTitle"), t("invite.declineFailed"));
    } finally {
      busyInviteRef.current = null;
      setBusyInviteId(null);
    }
  };

  const pending = (invitations ?? []).filter(
    (inv) => inv.status === "pending",
  );

  const notOnboarded = user != null && !user.onboarded_at;

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView contentContainerClassName="px-6 py-6 gap-6">
        <View className="gap-1">
          <Text className="text-xs uppercase tracking-wider text-muted-foreground">
            {t("workspace.signedInAs")}
          </Text>
          <Text className="text-base text-foreground">{user?.email}</Text>
        </View>

        {/* Onboarding entry — first-run setup. Shown until the user has
            finished onboarding (server-side `onboarded_at`). With an empty
            list this is the classic new-user welcome path; with an existing
            workspace it gently re-offers the guide. */}
        {notOnboarded && data !== undefined && (
          <View className="gap-3 rounded-lg border border-border p-4 bg-secondary/30">
            <View className="gap-1">
              <Text className="text-base font-semibold text-foreground">
                {t("onboarding.bannerTitle")}
              </Text>
              <Text className="text-sm text-muted-foreground">
                {t("onboarding.bannerLede")}
              </Text>
            </View>
            <Button onPress={() => router.push("/onboarding")}>
              <Text>{t("onboarding.bannerAction")}</Text>
            </Button>
          </View>
        )}

        {pending.length > 0 && (
          <View className="gap-2">
            <Text className="text-xs uppercase tracking-wider text-muted-foreground">
              {t("invite.pendingTitle")} · {pending.length}
            </Text>
            {pending.map((inv) => (
              <CardPressable
                key={inv.id}
                onPress={() => {
                  if (!busyInviteId) router.push(`/invite/${inv.id}`);
                }}
              >
                <View className="gap-1">
                  <Text className="text-base font-semibold text-foreground">
                    {inv.workspace_name ?? t("invite.fallbackWorkspaceName")}
                  </Text>
                  <Text className="text-xs text-muted-foreground">
                    {(inv.inviter_name || inv.inviter_email) +
                      (inv.role === "admin"
                        ? " " + t("invite.invitedRoleAdmin")
                        : " " + t("invite.invitedRoleMember"))}
                  </Text>
                  <View className="flex-row gap-2 mt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyInviteId === inv.id}
                      onPress={() => onDecline(inv)}
                    >
                      <Text>{t("invite.decline")}</Text>
                    </Button>
                    <Button
                      size="sm"
                      disabled={busyInviteId === inv.id}
                      onPress={() => onAccept(inv)}
                    >
                      <Text>
                        {busyInviteId === inv.id
                          ? t("invite.joining")
                          : t("invite.pendingJoin")}
                      </Text>
                    </Button>
                  </View>
                </View>
              </CardPressable>
            ))}
          </View>
        )}

        <View className="gap-3">
          <Text className="text-2xl font-semibold text-foreground">
            {t("workspace.selectTitle")}
          </Text>

          {isLoading ? (
            <View className="py-8 items-center">
              <ActivityIndicator />
            </View>
          ) : error ? (
            <View className="gap-3">
              <Text className="text-sm text-destructive">
                {t("workspace.loadError")}
                {error instanceof Error ? error.message : t("common.unknownError")}
              </Text>
              <Button variant="outline" onPress={() => refetch()}>
                <Text>{t("workspace.retry")}</Text>
              </Button>
            </View>
          ) : !data || data.length === 0 ? (
            <View className="gap-4 py-3">
              <Text className="text-sm text-muted-foreground">
                {t("workspace.empty")}
              </Text>
              <Text className="text-sm text-foreground">
                {t("workspace.emptyHint")}
              </Text>
              <Button
                onPress={() =>
                  router.push({
                    pathname: "/onboarding",
                    params: { mode: "new_workspace" },
                  })
                }
              >
                <Text>{t("workspace.createWorkspace")}</Text>
              </Button>
            </View>
          ) : (
            <View className="gap-3">
              {data.map((ws) => (
                <CardPressable
                  key={ws.id}
                  onPress={() => onSelect(ws.id, ws.slug)}
                >
                  <Text className="text-base font-semibold text-foreground">
                    {ws.name}
                  </Text>
                  <Text className="text-xs text-muted-foreground mt-1">
                    /{ws.slug}
                  </Text>
                  {ws.description ? (
                    <Text className="text-sm text-muted-foreground mt-2">
                      {ws.description}
                    </Text>
                  ) : null}
                </CardPressable>
              ))}
            </View>
          )}
        </View>

        <View className="pt-4 border-t border-border">
          <Button variant="outline" onPress={() => logout()}>
            <Text>{t("workspace.signOut")}</Text>
          </Button>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}