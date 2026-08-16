/**
 * Members browse page (push screen reached from the More popover). Mirrors
 * web `packages/views/settings/components/members-tab.tsx` semantics:
 *   - owners/admins see an invite entry (modal: email + role + submit) and
 *     the pending-invitations block, each row with a revoke action;
 *   - everyone sees the member list — avatar, name + role badge, email,
 *     joined time — one row per workspace member.
 *
 * Sort order (matches web's owner-first convention): owner → admin → member;
 * within a tier by name, then joined time (stable). Rows push into the
 * member detail screen keyed by member id. The server remains the
 * authoritative permission gate — `canManage` only decides what the UI
 * shows, mirroring member detail's guard parity.
 */
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import { Stack, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Invitation, MemberRole, MemberWithUser } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { memberListOptions, invitationListOptions } from "@/data/queries/members";
import {
  useInviteMember,
  useRevokeInvitation,
} from "@/data/mutations/members";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { useTimeAgo } from "@/lib/time-ago";
import { formatDateTime } from "@/lib/autopilot-format";
import { isValidInviteEmail } from "@/lib/invite-validation";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

const ROLE_ORDER: Record<MemberRole, number> = { owner: 0, admin: 1, member: 2 };

const ROLE_BADGE: Record<MemberRole, string> = {
  owner: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  admin: "bg-brand/10 text-brand",
  member: "bg-muted text-muted-foreground",
};

export default function MembersPage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const user = useAuthStore((s) => s.user);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  const { data: rawMembers, isLoading, error, refetch, isRefetching } =
    useQuery(memberListOptions(wsId));
  const {
    data: invitations,
    isLoading: invitationsLoading,
    error: invitationsError,
  } = useQuery(invitationListOptions(wsId));
  const inviteMember = useInviteMember();
  const revokeInvitation = useRevokeInvitation();

  const sorted = useMemo(() => {
    const list = rawMembers ?? [];
    return [...list].sort((a, b) => {
      const ra = ROLE_ORDER[a.role] ?? 9;
      const rb = ROLE_ORDER[b.role] ?? 9;
      if (ra !== rb) return ra - rb;
      const byName = a.name.localeCompare(b.name);
      if (byName !== 0) return byName;
      return a.created_at.localeCompare(b.created_at);
    });
  }, [rawMembers]);

  const currentMember =
    (rawMembers ?? []).find((m) => m.user_id === user?.id) ?? null;
  const canManage =
    currentMember?.role === "owner" || currentMember?.role === "admin";

  const [inviteVisible, setInviteVisible] = useState(false);

  const showBlank =
    !isLoading && !error && (rawMembers ?? []).length === 0 && (invitations ?? []).length === 0;

  const onInvite = (email: string, role: MemberRole) => {
    inviteMember.mutate(
      { email, role },
      {
        onSuccess: () => {
          setInviteVisible(false);
          Alert.alert(t("members.inviteSuccess"));
        },
        onError: (err) =>
          Alert.alert(
            t("members.inviteFailed"),
            err instanceof Error ? err.message : t("common.unknownError"),
          ),
      },
    );
  };

  const onRevoke = (inv: Invitation) => {
    Alert.alert(
      t("members.revokeTitle"),
      t("members.revokeMessage", { email: inv.invitee_email }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("members.revokeAction"),
          style: "destructive",
          onPress: () => {
            revokeInvitation.mutate(inv.id, {
              onSuccess: () => Alert.alert(t("members.revoked")),
              onError: (err) =>
                Alert.alert(
                  t("members.revokeFailed"),
                  err instanceof Error ? err.message : t("common.unknownError"),
                ),
            });
          },
        },
      ],
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: t("screen.members") }} />
      <ScrollView
        className="flex-1 bg-background"
        contentContainerClassName="pb-8"
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={theme.mutedForeground}
          />
        }
      >
        {/* Invite entry — owner/admin only */}
        {canManage && (
          <InviteEntry onPress={() => setInviteVisible(true)} />
        )}

        {/* Pending invitations */}
        {(invitations ?? []).length > 0 && (
          <View>
            <SectionTitle>
              {t("members.pendingTitle", { count: (invitations ?? []).length })}
            </SectionTitle>
            <View className="mx-4 rounded-xl border border-border bg-background overflow-hidden">
              {(invitations ?? []).map((inv, idx) => (
                <View key={inv.id} className={cn(idx > 0 && "border-t border-border")}>
                  <InvitationRow
                    invitation={inv}
                    canManage={canManage}
                    busy={
                      revokeInvitation.isPending &&
                      revokeInvitation.variables === inv.id
                    }
                    revokeDisabled={revokeInvitation.isPending}
                    onRevoke={() => onRevoke(inv)}
                  />
                </View>
              ))}
            </View>
          </View>
        )}
        {invitationsError && !invitationsLoading ? (
          <View className="px-4 pt-3">
            <Text className="text-xs text-destructive">
              {t("members.loadError")}
              {invitationsError instanceof Error
                ? invitationsError.message
                : t("common.unknownError")}
            </Text>
          </View>
        ) : null}

        {/* Member list */}
        {isLoading ? (
          <View className="flex-1 items-center justify-center pt-24">
            <ActivityIndicator />
          </View>
        ) : error ? (
          <View className="px-4 gap-3 pt-4">
            <Text className="text-sm text-destructive">
              {t("members.loadError")}
              {error instanceof Error ? error.message : t("common.unknownError")}
            </Text>
            <Button variant="outline" onPress={() => refetch()}>
              <Text>{t("workspace.retry")}</Text>
            </Button>
          </View>
        ) : showBlank ? (
          <View className="pt-16 items-center justify-center px-6 gap-1">
            <Ionicons name="people-outline" size={32} color={theme.mutedForeground} />
            <Text className="text-sm text-muted-foreground text-center mt-2">
              {t("members.emptyTitle")}
            </Text>
            <Text className="text-xs text-muted-foreground/70 text-center">
              {t("members.emptyDescription")}
            </Text>
          </View>
        ) : (
          <View>
            <SectionTitle>
              {t("members.sectionTitle", { count: sorted.length })}
            </SectionTitle>
            <View className="mx-4 rounded-xl border border-border bg-background overflow-hidden">
              {sorted.map((member, idx) => (
                <View key={member.id} className={cn(idx > 0 && "border-t border-border")}>
                  <MemberRow
                    member={member}
                    onPress={() => {
                      if (wsSlug) router.push(`/${wsSlug}/more/members/${member.id}`);
                    }}
                  />
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      <InviteMemberModal
        visible={inviteVisible}
        saving={inviteMember.isPending}
        onInvite={onInvite}
        onClose={() => setInviteVisible(false)}
      />
    </>
  );
}

function InviteEntry({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <Pressable
      onPress={onPress}
      className="mx-4 mt-4 flex-row items-center gap-2 rounded-xl border border-border bg-background px-3 py-3 active:bg-secondary"
    >
      <Ionicons name="person-add-outline" size={17} color={theme.brand} />
      <Text className="flex-1 text-sm font-medium text-foreground">
        {t("members.inviteTitle")}
      </Text>
      <Ionicons
        name="chevron-forward"
        size={14}
        color={theme.mutedForeground}
      />
    </Pressable>
  );
}

function MemberRow({
  member,
  onPress,
}: {
  member: MemberWithUser;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const timeAgo = useTimeAgo();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const joined = member.created_at ? timeAgo(member.created_at) : null;

  return (
    <Pressable onPress={onPress} className="px-4 py-3 active:bg-secondary">
      <View className="flex-row items-center gap-3">
        <ActorAvatar type="member" id={member.user_id} size={40} />
        <View className="flex-1 min-w-0 gap-0.5">
          <View className="flex-row items-center gap-2">
            <Text
              className="flex-1 text-sm font-medium text-foreground"
              numberOfLines={1}
            >
              {member.name}
            </Text>
            <RoleBadge role={member.role} />
          </View>
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {member.email}
          </Text>
          {joined ? (
            <Text className="text-xs text-muted-foreground/70">
              {t("members.joinedAt", { time: joined })}
            </Text>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={14} color={muted} />
      </View>
    </Pressable>
  );
}

function InvitationRow({
  invitation,
  canManage,
  busy,
  revokeDisabled,
  onRevoke,
}: {
  invitation: Invitation;
  canManage: boolean;
  busy: boolean;
  revokeDisabled: boolean;
  onRevoke: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const expiresMs = invitation.expires_at
    ? new Date(invitation.expires_at).getTime()
    : null;
  const isExpired =
    invitation.status === "expired" ||
    (invitation.status === "pending" &&
      expiresMs != null &&
      !Number.isNaN(expiresMs) &&
      expiresMs <= Date.now());

  const statusLabel = (() => {
    if (invitation.status === "pending") {
      if (isExpired) return t("members.pendingExpired");
      if (expiresMs != null && !Number.isNaN(expiresMs)) {
        return t("members.pendingExpiresAt", {
          time: formatDateTime(invitation.expires_at),
        });
      }
      return t("members.pending");
    }
    if (invitation.status === "expired") return t("members.pendingExpired");
    return invitation.status;
  })();

  return (
    <View className="px-4 py-3 flex-row items-center gap-3">
      <View className="h-9 w-9 items-center justify-center rounded-full bg-muted">
        <Ionicons name="mail-outline" size={16} color={theme.mutedForeground} />
      </View>
      <View className="flex-1 min-w-0 gap-0.5">
        <Text
          className="text-sm font-medium text-foreground"
          numberOfLines={1}
        >
          {invitation.invitee_email}
        </Text>
        <Text
          className={cn(
            "text-xs",
            isExpired ? "text-destructive" : "text-muted-foreground",
          )}
          numberOfLines={1}
        >
          {statusLabel}
        </Text>
      </View>
      <RoleBadge role={invitation.role} />
      {canManage ? (
        <Pressable
          onPress={onRevoke}
          disabled={revokeDisabled}
          accessibilityRole="button"
          accessibilityLabel={t("members.revokeTooltip")}
          className="h-9 w-9 items-center justify-center rounded-full active:bg-secondary"
        >
          {busy ? (
            <ActivityIndicator size="small" color={theme.destructive} />
          ) : (
            <Ionicons name="close" size={18} color={theme.destructive} />
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

function InviteMemberModal({
  visible,
  saving,
  onInvite,
  onClose,
}: {
  visible: boolean;
  saving: boolean;
  onInvite: (email: string, role: MemberRole) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("member");
  const [emailError, setEmailError] = useState<string | null>(null);

  const reset = () => {
    setEmail("");
    setRole("member");
    setEmailError(null);
  };

  const submit = () => {
    if (!isValidInviteEmail(email)) {
      setEmailError(t("members.inviteEmailInvalid"));
      return;
    }
    setEmailError(null);
    onInvite(email.trim(), role);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={saving ? undefined : onClose}>
      <Pressable
        className="flex-1 bg-black/40"
        onPress={saving ? undefined : () => { reset(); onClose(); }}
      >
        <View className="flex-1 items-center justify-center px-6">
          <Pressable onPress={() => {}} className="w-full max-w-sm">
            <View className="bg-popover rounded-2xl p-4 gap-3">
              <Text className="text-base font-semibold text-foreground">
                {t("members.inviteTitle")}
              </Text>
              <TextField
                value={email}
                onChangeText={(v) => {
                  setEmail(v);
                  if (emailError) setEmailError(null);
                }}
                placeholder={t("members.inviteEmailPlaceholder")}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                editable={!saving}
                invalid={!!emailError}
                autoFocus
              />
              {emailError ? (
                <Text className="text-xs text-destructive">{emailError}</Text>
              ) : null}
              <RolePicker
                value={role}
                disabled={saving}
                onChange={setRole}
              />
              <View className="flex-row justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onPress={() => { reset(); onClose(); }}
                  disabled={saving}
                >
                  <Text>{t("common.cancel")}</Text>
                </Button>
                <Button size="sm" onPress={submit} disabled={saving}>
                  <Text>{saving ? t("members.inviting") : t("members.inviteButton")}</Text>
                </Button>
              </View>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

function RolePicker({
  value,
  disabled,
  onChange,
}: {
  value: MemberRole;
  disabled: boolean;
  onChange: (role: MemberRole) => void;
}) {
  const { t } = useTranslation();
  return (
    <View className="flex-row items-center gap-2">
      <Text className="text-xs text-muted-foreground">{t("members.inviteRole")}</Text>
      <View className="flex-1 flex-row gap-2">
        {(["member", "admin"] as const).map((role) => {
          const selected = value === role;
          return (
            <Pressable
              key={role}
              onPress={() => onChange(role)}
              disabled={disabled}
              className={cn(
                "flex-1 items-center rounded-md border px-3 py-2",
                selected
                  ? "border-brand bg-brand/10"
                  : "border-border bg-secondary/50",
                disabled && "opacity-50",
              )}
            >
              <Text
                className={cn(
                  "text-sm font-medium",
                  selected ? "text-brand" : "text-foreground",
                )}
              >
                {t(`members.role.${role}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Text className="px-4 pt-5 pb-2 text-xs uppercase tracking-wider text-muted-foreground font-medium">
      {children}
    </Text>
  );
}

function RoleBadge({ role }: { role: MemberRole }) {
  const { t } = useTranslation();
  return (
    <View
      className={cn(
        "px-2 py-0.5 rounded-full border border-border",
        ROLE_BADGE[role],
      )}
    >
      <Text className="text-[11px] font-medium">
        {t(`members.role.${role}`)}
      </Text>
    </View>
  );
}