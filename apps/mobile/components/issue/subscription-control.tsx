/**
 * Issue subscription control — sits in the issue-detail Activity header,
 * mirroring web's subscribe UI (packages/views/issues/components/
 * issue-detail.tsx:2888):
 *
 *   - Nothing renders until the subscribers query RESOLVES. An unresolved
 *     list reads as "nobody is subscribed", which would flash "Subscribe" at
 *     someone already subscribed — and a click in that window would send an
 *     unsubscribe the other way (MUL-5714).
 *   - A delegated subscription (reason === "delegated", an agent created this
 *     on the member's behalf) gets a quiet explanation badge (MUL-5483).
 *   - Unsubscribing shows the subtree option only when there ARE (or may be)
 *     children; with none, a single direct unsubscribe. While the child count
 *     is unknown we keep the menu — it never picks a scope for the user.
 *   - The avatar group is the subscriber PICKER's trigger: web hangs a
 *     `Popover` off this same element (issue-detail.tsx:2952-2985), and with
 *     no other subscriber it renders a dashed "Users" placeholder instead of
 *     an empty group. Tapping opens `SubscriberPickerSheet`, where any
 *     workspace member or agent can be subscribed or unsubscribed — before
 *     this, mobile could only ever toggle the signed-in member's own row.
 *
 * Serializing: React Query flushes isPending in a microtask, so two taps in
 * the same tick can both hit an enabled control. The mutations' optimistic
 * snapshot cannot survive overlapping toggles, so we gate on a ref
 * (web MUL-5714 use-issue-subscribers.ts). The picker's rows go through the
 * SAME ref — a toggle from the sheet and one from the button would otherwise
 * roll each other back.
 */
import { useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { issueSubscribersOptions } from "@/data/queries/issues";
import {
  useToggleIssueSubscribe,
  useUnsubscribeIssueSubtree,
} from "@/data/mutations/issues";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { ActionSheet } from "@/lib/action-sheet";
import { deriveSubscription } from "@/lib/subscription";
import { SubscriberPickerSheet } from "./subscriber-picker-sheet";

const AVATAR_OVERFLOW = 4;

interface Props {
  issueId: string;
  /** Known child count decides whether the unsubscribe menu needs the
   *  subtree entry. `null`/`undefined` = unknown → keep the menu so we never
   *  pick the scope for the user (web MUL-5714). */
  childCount: number | null | undefined;
}

export function SubscriptionControl({ issueId, childCount }: Props) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const [pickerOpen, setPickerOpen] = useState(false);

  const subscribersQuery = useQuery(issueSubscribersOptions(wsId, issueId));
  const toggleSubscribe = useToggleIssueSubscribe(issueId);
  const unsubscribeSubtree = useUnsubscribeIssueSubtree(issueId);

  // Serialize direct toggles — see file header.
  const actionInFlight = useRef(false);
  // Guards the ref from being leaked true by an in-flight mutation: React
  // Query flushes isPending in a microtask, so two taps in the same tick both
  // see a still-useful control; the ref blocks the second until the first
  // settles and releases it.
  const run = (fn: (release: () => void) => void) => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    fn(() => {
      actionInFlight.current = false;
    });
  };

  /** One target toggle, serialized — shared by the button and the picker. */
  const toggleTarget = (
    targetId: string,
    userType: "member" | "agent",
    subscribed: boolean,
  ) => {
    run((release) =>
      toggleSubscribe.mutate(
        { userId: targetId, userType, subscribed },
        {
          onSettled: release,
          onError: () =>
            Alert.alert(
              t("subscription.updateFailedTitle"),
              t("subscription.updateFailed"),
            ),
        },
      ),
    );
  };

  // Nothing until the query resolves — an unresolved list must not render
  // a control at all, not even a disabled one (MUL-5714).
  if (!subscribersQuery.isSuccess) return null;

  const { isSubscribed, isDelegated, others } = deriveSubscription(
    subscribersQuery.data,
    userId,
  );
  const knownChildren = typeof childCount === "number";

  const handlePress = () => {
    if (isSubscribed) {
      // With zero (or unknown) children a single direct unsubscribe is safe;
      // with any children the user chooses between issue-only and subtree.
      if (!knownChildren || childCount! > 0) {
        presentUnsubscribeSheet(t, (kind) => {
          if (kind === "this") {
            if (userId) toggleTarget(userId, "member", true);
          } else if (kind === "subtree") {
            run((release) =>
              unsubscribeSubtree.mutate(undefined, {
                onSettled: release,
                onError: () =>
                  Alert.alert(
                    t("subscription.unsubscribeSubtreeFailedTitle"),
                    t("subscription.unsubscribeSubtreeFailed"),
                  ),
              }),
            );
          }
        });
      } else if (userId) {
        toggleTarget(userId, "member", true);
      }
    } else if (userId) {
      toggleTarget(userId, "member", false);
    }
  };

  const busy = toggleSubscribe.isPending || unsubscribeSubtree.isPending;

  return (
    <View className="flex-row items-center gap-1.5">
      {isDelegated && (
        <Pressable
          onPress={() =>
            Alert.alert(
              t("subscription.delegatedHintTitle"),
              t("subscription.delegatedHint"),
            )
          }
          accessibilityRole="button"
          accessibilityLabel={t("subscription.delegatedBadge")}
          className="flex-row items-center gap-1 rounded-full bg-muted px-2 py-0.5 active:opacity-80"
        >
          <Ionicons name="sparkles-outline" size={11} color="#71717a" />
          <Text className="text-caption text-muted-foreground">
            {t("subscription.delegatedBadge")}
          </Text>
        </Pressable>
      )}
      <Pressable
        onPress={() => setPickerOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={t("subscription.picker.openAria")}
        hitSlop={6}
        className="active:opacity-70"
      >
        {others.length > 0 ? (
          <View className="flex-row items-center -space-x-1">
            {others.slice(0, AVATAR_OVERFLOW).map((s) => (
              <ActorAvatar
                key={`${s.user_type}-${s.user_id}`}
                type={s.user_type === "member" ? "member" : "agent"}
                id={s.user_id}
                size={22}
              />
            ))}
            {others.length > AVATAR_OVERFLOW && (
              <View className="ml-1">
                <Text className="text-caption text-muted-foreground">
                  +{others.length - AVATAR_OVERFLOW}
                </Text>
              </View>
            )}
          </View>
        ) : (
          <View
            className="h-6 w-6 items-center justify-center rounded-full border border-dashed"
            style={{ borderColor: theme.mutedForeground }}
          >
            <Ionicons
              name="people-outline"
              size={12}
              color={theme.mutedForeground}
            />
          </View>
        )}
      </Pressable>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        className="h-7 px-2.5"
        onPress={handlePress}
        accessibilityLabel={
          isSubscribed
            ? t("subscription.unsubscribe")
            : t("subscription.subscribe")
        }
      >
        {busy ? (
          <Text className="text-muted-foreground">…</Text>
        ) : (
          <Text className="text-xs font-medium">
            {isSubscribed
              ? t("subscription.unsubscribe")
              : t("subscription.subscribe")}
          </Text>
        )}
      </Button>
      <SubscriberPickerSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        subscribers={subscribersQuery.data}
        disabled={busy || !userId}
        onToggle={toggleTarget}
      />
    </View>
  );
}

function presentUnsubscribeSheet(
  t: (key: string) => string,
  onPick: (kind: "this" | "subtree") => void,
) {
  const options = [
    t("subscription.unsubscribeThis"),
    t("subscription.unsubscribeSubtree"),
    t("common.cancel"),
  ];
  ActionSheet.showActionSheetWithOptions(
    { options, cancelButtonIndex: 2 },
    (i) => {
      if (i === 0) onPick("this");
      else if (i === 1) onPick("subtree");
    },
  );
}
