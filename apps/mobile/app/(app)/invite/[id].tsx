/**
 * Invitation landing page — "accept invitation" flow aligned with web
 * packages/views/invite/invite-page.tsx.
 *
 * Reached from the workspace selector's "pending invitations" feed (or a
 * future deep link). Auth-required but workspace-less, so it lives under
 * (app) next to select-workspace. Accepting navigates INTO the newly-joined
 * workspace (web MUL-820 behaviour); declining returns to the selector.
 */
import { useRef, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { api } from "@/data/api";
import { workspaceListOptions } from "@/data/queries/workspaces";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";

export default function InviteRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const logout = useAuthStore((s) => s.logout);
  const setCurrentWorkspace = useWorkspaceStore((s) => s.setCurrentWorkspace);
  const qc = useQueryClient();

  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [done, setDone] = useState<"accepted" | "declined" | null>(null);
  const busyRef = useRef(false);

  const { data: invitation, isLoading, error: fetchError } = useQuery({
    queryKey: ["invitation", id],
    queryFn: () => api.getInvitation(id!),
    enabled: !!id,
  });

  const goHome = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/select-workspace");
    }
  };

  const handleAccept = async () => {
    if (!id || busyRef.current) return;
    busyRef.current = true;
    setBusy("accept");
    let accepted = false;
    try {
      await api.acceptInvitation(id);
      accepted = true;
      setDone("accepted");
      qc.invalidateQueries({ queryKey: ["invitations"] });
    } catch {
      Alert.alert(t("invite.errorTitle"), t("invite.acceptFailed"));
      setDone(null);
      setBusy(null);
      busyRef.current = false;
      return;
    }
    // Accept succeeded — navigation is best-effort: a workspace-list fetch
    // failure must not surface as "accept failed" (the invite is already
    // accepted; retrying would 400). Fall back to the selector instead.
    setBusy(null);
    busyRef.current = false;
    try {
      const list = await qc.fetchQuery({
        ...workspaceListOptions(),
        staleTime: 0,
      });
      const joined = accepted
        ? list.find((w) => w.id === invitation?.workspace_id)
        : undefined;
      if (joined) {
        await setCurrentWorkspace(joined.id, joined.slug);
        router.replace(`/${joined.slug}/inbox`);
      } else {
        router.replace("/select-workspace");
      }
    } catch {
      router.replace("/select-workspace");
    }
  };

  const handleDecline = async () => {
    if (!id || busyRef.current) return;
    busyRef.current = true;
    setBusy("decline");
    try {
      await api.declineInvitation(id);
      setDone("declined");
      qc.invalidateQueries({ queryKey: ["invitations"] });
    } catch {
      Alert.alert(t("invite.errorTitle"), t("invite.declineFailed"));
    } finally {
      setBusy(null);
      busyRef.current = false;
    }
  };

  const wsName = invitation?.workspace_name ?? t("invite.fallbackWorkspaceName");
  const inviter = invitation?.inviter_name || invitation?.inviter_email;
  const isExpired = invitation && invitation.status !== "pending";
  const isAlreadyHandled =
    invitation?.status === "accepted" || invitation?.status === "declined";

  return (
    <SafeAreaView className="flex-1 bg-background">
      {/* Top bar: Back (when there is somewhere to go) + Log out */}
      <View className="flex-row items-center justify-between px-2 py-1">
        <IconButton
          name="arrow-back"
          onPress={goHome}
          disabled={!router.canGoBack()}
          className={router.canGoBack() ? "" : "opacity-0"}
          accessibilityLabel={t("invite.back")}
        />
        <IconButton
          name="log-out-outline"
          onPress={() => logout()}
          accessibilityLabel={t("invite.signOut")}
        />
      </View>

      <ScrollView
        contentContainerClassName="flex-1 justify-center px-6 py-10"
        keyboardShouldPersistTaps="handled"
      >
        <Card className="w-full items-center gap-4 py-10">
          {isLoading ? (
            <View className="items-center gap-4 py-4">
              <ActivityIndicator />
            </View>
          ) : fetchError || !invitation ? (
            <>
              <Ionicons name="close-circle-outline" size={40} className="text-destructive" />
              <Text className="text-lg font-semibold text-foreground text-center">
                {t("invite.notFoundTitle")}
              </Text>
              <Text className="text-sm text-muted-foreground text-center">
                {t("invite.notFoundDesc")}
              </Text>
              <Button variant="outline" onPress={goHome}>
                <Text>{t("invite.back")}</Text>
              </Button>
            </>
          ) : done === "accepted" ? (
            <>
              <Ionicons name="checkmark-circle" size={40} className="text-primary" />
              <Text className="text-lg font-semibold text-foreground text-center">
                {t("invite.acceptedTitle", { workspace_name: wsName })}
              </Text>
              <Text className="text-sm text-muted-foreground text-center">
                {t("invite.redirecting")}
              </Text>
            </>
          ) : done === "declined" ? (
            <>
              <Ionicons name="close-circle-outline" size={40} className="text-muted-foreground" />
              <Text className="text-lg font-semibold text-foreground text-center">
                {t("invite.declinedTitle")}
              </Text>
              <Text className="text-sm text-muted-foreground text-center">
                {t("invite.declinedDesc")}
              </Text>
              <Button variant="outline" onPress={goHome}>
                <Text>{t("invite.back")}</Text>
              </Button>
            </>
          ) : (
            <>
              <View className="h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <Ionicons name="people" size={26} className="text-primary" />
              </View>
              <View className="items-center gap-1">
                <Text className="text-xl font-semibold text-foreground text-center">
                  {t("invite.joinTitle", { workspace_name: wsName })}
                </Text>
                <Text className="text-sm text-muted-foreground text-center">
                  {inviter}{" "}
                  {invitation.role === "admin"
                    ? t("invite.invitedRoleAdmin")
                    : t("invite.invitedRoleMember")}
                </Text>
              </View>

              {isAlreadyHandled ? (
                <Text className="text-sm text-muted-foreground text-center">
                  {invitation.status === "accepted"
                    ? t("invite.alreadyHandledAccepted")
                    : t("invite.alreadyHandledDeclined")}
                </Text>
              ) : isExpired ? (
                <Text className="text-sm text-muted-foreground text-center">
                  {t("invite.expired")}
                </Text>
              ) : (
                <View className="w-full flex-row gap-3">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onPress={handleDecline}
                    disabled={busy !== null}
                  >
                    <Text>
                      {busy === "decline" ? t("invite.declining") : t("invite.decline")}
                    </Text>
                  </Button>
                  <Button
                    className="flex-1"
                    onPress={handleAccept}
                    disabled={busy !== null}
                  >
                    <Text>
                      {busy === "accept" ? t("invite.joining") : t("invite.accept")}
                    </Text>
                  </Button>
                </View>
              )}
            </>
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}