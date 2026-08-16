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
 *
 * Serializing: React Query flushes isPending in a microtask, so two taps in
 * the same tick can both hit an enabled control. The mutations' optimistic
 * snapshot cannot survive overlapping toggles, so we gate on a ref
 * (web MUL-5714 use-issue-subscribers.ts).
 */
import { useRef } from "react";
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
import { ActionSheet } from "@/lib/action-sheet";
import { deriveSubscription } from "@/lib/subscription";

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
        presentUnsubscribeSheet(
          t,
          (kind) => {
            run((release) => {
              if (kind === "this") {
                toggleSubscribe.mutate(true, {
                  onSettled: release,
                  onError: () =>
                    Alert.alert(
                      t("subscription.updateFailedTitle"),
                      t("subscription.updateFailed"),
                    ),
                });
              } else if (kind === "subtree") {
                unsubscribeSubtree.mutate(undefined, {
                  onSettled: release,
                  onError: () =>
                    Alert.alert(
                      t("subscription.unsubscribeSubtreeFailedTitle"),
                      t("subscription.unsubscribeSubtreeFailed"),
                    ),
                });
              }
            });
          },
        );
      } else {
        run((release) =>
          toggleSubscribe.mutate(true, {
            onSettled: release,
            onError: () =>
              Alert.alert(
                t("subscription.updateFailedTitle"),
                t("subscription.updateFailed"),
              ),
          }),
        );
      }
    } else {
      run((release) =>
        toggleSubscribe.mutate(false, {
          onSettled: release,
          onError: () =>
            Alert.alert(
              t("subscription.updateFailedTitle"),
              t("subscription.updateFailed"),
            ),
        }),
      );
    }
  };

  const busy =
    toggleSubscribe.isPending || unsubscribeSubtree.isPending;

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
      {others.length > 0 && (
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
      )}
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