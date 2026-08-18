/**
 * Workspace Billing subscreen (iteration-67) — mirrors web
 * `packages/views/settings/components/billing-tab.tsx` semantics on the phone:
 *
 *   - Current plan card: plan + status badges, human-seat count, period end.
 *   - Upgrade to Pro (free workspaces only): month/year interval toggle,
 *     per-seat unit price × current seats estimate, Stripe Checkout confirm,
 *     then `Linking.openURL` to the hosted Checkout session.
 *   - Subscription management (existing subscription): Billing Portal session
 *     via idempotency-keyed POST, then open.
 *   - Usage & limits + Seats cards; seat reconcile for managers.
 *
 * Permission gate mirrors billing-tab.tsx:251-254 (`owner || admin` for
 * purchase/manage/reconcile affordances); the server is the authoritative
 * gate on every POST. Read-only members still see plan + limits.
 *
 * Divergence from web (intentional — phone, not a port):
 *   - No `?result=success` return-URL banner: mobile opens the Stripe session
 *     in the system browser, so the "payment done" signal is the user coming
 *     back — the entitlements query polls every 2s while `isSyncingCheckout`
 *     and refetches on AppState focus, so the plan flips to Pro shortly after
 *     return (billing-tab.tsx:285-296 uses the same refetchInterval trick).
 *   - Checkout confirm is a native `Alert.alert` (web uses an AlertDialog);
 *     Android has no single-dialog flow difference that matters here.
 */
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { Stack } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import type { WorkspaceSubscriptionInterval } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ApiError } from "@/data/api";
import {
  workspaceSubscriptionEntitlementsOptions,
  workspaceSubscriptionPricesOptions,
} from "@/data/queries/workspace-subscriptions";
import {
  useCreateWorkspaceSubscriptionCheckout,
  useCreateWorkspaceSubscriptionPortal,
  useReconcileWorkspaceSubscriptionSeats,
} from "@/data/mutations/workspace-subscriptions";
import { memberListOptions } from "@/data/queries/members";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import {
  formatStripeMinorAmount,
  planBadgeClass,
  statusBadgeClass,
} from "@/lib/billing-format";

const CHECKOUT_SYNC_TIMEOUT_MS = 30_000;

function formatDate(value: string | null, locale: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
      date,
    );
  } catch {
    return null;
  }
}

function createIdempotencyKey(prefix: string, wsId: string | null): string {
  const suffix =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${wsId ?? "ws"}-${suffix}`.slice(0, 255);
}

const planLabel = (plan: string, t: (k: string) => string): string => {
  switch (plan) {
    case "free":
      return t("billing.planFree");
    case "pro":
      return t("billing.planPro");
    default:
      return t("billing.planUnknown");
  }
};

const statusLabel = (status: string, t: (k: string) => string): string => {
  switch (status) {
    case "inactive":
      return t("billing.statusInactive");
    case "active":
      return t("billing.statusActive");
    case "trialing":
      return t("billing.statusTrialing");
    case "past_due":
      return t("billing.statusPastDue");
    case "canceled":
      return t("billing.statusCanceled");
    default:
      return t("billing.statusUnknown");
  }
};

type SyncState = "idle" | "syncing" | "timedOut";

export default function BillingScreen() {
  const { t, locale } = useTranslation();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const user = useAuthStore((s) => s.user);
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  const { data: members = [], isFetched: membersFetched } = useQuery(
    memberListOptions(wsId),
  );
  const currentMember = members.find((m) => m.user_id === user?.id) ?? null;
  const canManage =
    currentMember?.role === "owner" || currentMember?.role === "admin";

  const [interval, setInterval] =
    useState<WorkspaceSubscriptionInterval>("month");
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [actionError, setActionError] = useState<string | null>(null);
  const [portalUnavailable, setPortalUnavailable] = useState(false);
  const [reconcileMessage, setReconcileMessage] = useState<string | null>(null);
  const checkoutIntentRef = useRef<{
    wsId: string | null;
    interval: WorkspaceSubscriptionInterval;
    key: string;
  } | null>(null);
  const portalIntentKeyRef = useRef<string | null>(null);
  const checkoutMutation = useCreateWorkspaceSubscriptionCheckout();
  const portalMutation = useCreateWorkspaceSubscriptionPortal();
  const reconcileMutation = useReconcileWorkspaceSubscriptionSeats();

  // Reset per-workspace transient state — mirrors billing-tab.tsx:265-273.
  useEffect(() => {
    checkoutIntentRef.current = null;
    portalIntentKeyRef.current = null;
    setPortalUnavailable(false);
    setActionError(null);
    setReconcileMessage(null);
    setSyncState("idle");
  }, [wsId]);

  const isSyncingCheckout = syncState === "syncing";

  const entitlementQuery = useQuery({
    ...workspaceSubscriptionEntitlementsOptions(wsId),
    refetchInterval: isSyncingCheckout ? 2_000 : false,
  });
  const entitlements = entitlementQuery.data;

  const canUpgrade =
    entitlements?.plan === "free" &&
    entitlements.status !== "active" &&
    entitlements.status !== "trialing" &&
    entitlements.status !== "past_due";
  const pricesQuery = useQuery({
    ...workspaceSubscriptionPricesOptions(wsId),
    enabled: !!wsId && canUpgrade,
  });

  // Stop polling on success — mirrors billing-tab.tsx:308-313.
  useEffect(() => {
    if (isSyncingCheckout && entitlements?.plan === "pro") {
      setSyncState("idle");
    }
  }, [entitlements?.plan, isSyncingCheckout]);

  // After 30s of no Pro, keep the page usable; the query's focus refetch
  // still picks up the change when the user returns from the browser.
  useEffect(() => {
    if (!isSyncingCheckout) return;
    const timeout = setTimeout(() => setSyncState("timedOut"), CHECKOUT_SYNC_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [isSyncingCheckout]);

  const reportActionError = (error: unknown, fallback: string) => {
    if (error instanceof ApiError && error.status === 503) {
      setActionError(t("billing.errorTemporarilyUnavailable"));
      return;
    }
    if (error instanceof ApiError && error.status === 403) {
      setActionError(t("billing.errorPermissionChanged"));
      return;
    }
    setActionError(fallback);
  };

  const handleCheckout = async () => {
    setActionError(null);
    const existing = checkoutIntentRef.current;
    const intent =
      existing?.wsId === wsId && existing.interval === interval
        ? existing
        : { wsId, interval, key: createIdempotencyKey("workspace-checkout", wsId) };
    checkoutIntentRef.current = intent;
    try {
      const response = await checkoutMutation.mutateAsync({
        interval,
        idempotencyKey: intent.key,
      });
      if (!response?.url) {
        setActionError(t("billing.errorCheckoutResponse"));
        return;
      }
      checkoutIntentRef.current = null;
      await Linking.openURL(response.url).catch(() => {
        setActionError(t("billing.errorCheckoutFailed"));
      });
      // No `?result=success` return param on mobile (system browser): start
      // the 2s entitlements poll now; it stops when plan flips to pro.
      if (entitlements?.plan !== "pro") {
        setSyncState("syncing");
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        checkoutIntentRef.current = null;
        setActionError(t("billing.errorAlreadySubscribed"));
        await entitlementQuery.refetch();
        return;
      }
      if (
        !(error instanceof Error) ||
        !error.message.includes("timed out")
      ) {
        reportActionError(error, t("billing.errorCheckoutFailed"));
      }
    }
  };

  const handlePortal = async () => {
    setActionError(null);
    const key =
      portalIntentKeyRef.current ??
      createIdempotencyKey("workspace-portal", wsId);
    portalIntentKeyRef.current = key;
    try {
      const response = await portalMutation.mutateAsync(key);
      if (!response?.url) {
        setActionError(t("billing.errorPortalResponse"));
        return;
      }
      // A Portal URL is single-use; a later click is a new intent, while a
      // network failure above deliberately retains the key for safe retry.
      portalIntentKeyRef.current = null;
      await Linking.openURL(response.url).catch(() =>
        setActionError(t("billing.errorPortalFailed")),
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        portalIntentKeyRef.current = null;
        setPortalUnavailable(true);
        setActionError(t("billing.errorPortalUnavailable"));
        await entitlementQuery.refetch();
        return;
      }
      reportActionError(error, t("billing.errorPortalFailed"));
    }
  };

  const handleReconcile = async () => {
    setActionError(null);
    setReconcileMessage(null);
    try {
      const response = await reconcileMutation.mutateAsync();
      if (!response) {
        setActionError(t("billing.errorReconcileResponse"));
        return;
      }
      setReconcileMessage(
        t("billing.seatsReconciled", {
          actual: response.actualSeats,
          billed: response.billedSeats,
        }),
      );
    } catch (error) {
      reportActionError(error, t("billing.errorReconcileFailed"));
    }
  };

  const startCheckoutConfirm = () => {
    Alert.alert(t("billing.confirmTitle"), t("billing.confirmDescription", {
      interval:
        interval === "month"
          ? t("billing.upgradeMonthly")
          : t("billing.upgradeYearly"),
      count: entitlements?.seats ?? 0,
    }), [
      { text: t("billing.actionCancel"), style: "cancel" },
      {
        text: t("billing.actionContinueToStripe"),
        onPress: () => void handleCheckout(),
      },
    ]);
  };

  if (entitlementQuery.isPending) {
    return (
      <ScrollView className="flex-1 bg-background">
        <Stack.Screen options={{ title: t("screen.billing") }} />
        <View className="px-4 py-6 gap-4">
          <View className="rounded-xl border border-border bg-card p-4 gap-3">
            <View className="h-5 w-40 rounded bg-muted" />
            <View className="h-4 w-full rounded bg-muted" />
            <View className="h-4 w-2/3 rounded bg-muted" />
          </View>
        </View>
      </ScrollView>
    );
  }

  if (entitlementQuery.isError || !entitlements) {
    return (
      <ScrollView className="flex-1 bg-background">
        <Stack.Screen options={{ title: t("screen.billing") }} />
        <View className="px-4 pt-4 gap-3">
          <View className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 gap-2">
            <Text className="text-sm font-semibold text-destructive">
              {t("billing.loadFailedTitle")}
            </Text>
            <Text className="text-xs text-muted-foreground">
              {t("billing.loadFailedDescription")}
            </Text>
            <View className="pt-1">
              <Button variant="outline" onPress={() => entitlementQuery.refetch()}>
                <Ionicons name="refresh" size={15} color={theme.mutedForeground} />
                <Text>{t("billing.actionRetry")}</Text>
              </Button>
            </View>
          </View>
        </View>
      </ScrollView>
    );
  }

  const periodEnd = formatDate(entitlements.currentPeriodEnd, locale);
  const isPro = entitlements.plan === "pro";
  const hasManagedSubscription =
    isPro ||
    entitlements.status === "active" ||
    entitlements.status === "trialing" ||
    entitlements.status === "past_due";
  const isMutating =
    checkoutMutation.isPending ||
    portalMutation.isPending ||
    reconcileMutation.isPending;
  const selectedPrice = pricesQuery.data?.[interval] ?? null;
  const formattedUnitPrice = selectedPrice
    ? formatStripeMinorAmount(selectedPrice.unitAmount, selectedPrice.currency, locale)
    : null;
  const formattedEstimatedTotal =
    selectedPrice && entitlements.seats > 0
      ? formatStripeMinorAmount(
          selectedPrice.unitAmount * entitlements.seats,
          selectedPrice.currency,
          locale,
        )
      : null;
  const canRetryPrice = !pricesQuery.isLoading && selectedPrice === null;

  return (
    <ScrollView className="flex-1 bg-background">
      <Stack.Screen options={{ title: t("screen.billing") }} />
      <View className="px-4 py-4 gap-5">
        <Text className="text-xs text-muted-foreground leading-4">
          {t("billing.description")}
        </Text>

        {syncState === "syncing" ? (
          <View className="rounded-xl border border-border bg-card px-4 py-3 gap-1 flex-row items-center gap-2">
            <ActivityIndicator size="small" />
            <View className="flex-1 gap-0.5">
              <Text className="text-sm font-semibold text-foreground">
                {t("billing.returnSyncingTitle")}
              </Text>
              <Text className="text-xs text-muted-foreground">
                {t("billing.returnSyncingDescription")}
              </Text>
            </View>
          </View>
        ) : syncState === "timedOut" ? (
          <View className="rounded-xl border border-border bg-card px-4 py-3 gap-1">
            <Text className="text-sm font-semibold text-foreground">
              {t("billing.returnSyncingTitle")}
            </Text>
            <Text className="text-xs text-muted-foreground">
              {t("billing.returnTimeoutDescription")}
            </Text>
          </View>
        ) : null}

        {entitlements.status === "past_due" ? (
          <View className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 gap-1">
            <Text className="text-sm font-semibold text-destructive">
              {t("billing.pastDueTitle")}
            </Text>
            <Text className="text-xs text-muted-foreground">
              {t("billing.pastDueDescription")}
            </Text>
          </View>
        ) : null}

        {!canManage && membersFetched ? (
          <View className="rounded-xl border border-border bg-card px-4 py-3 gap-1">
            <Text className="text-sm font-semibold text-foreground">
              {t("billing.readOnlyTitle")}
            </Text>
            <Text className="text-xs text-muted-foreground">
              {t("billing.readOnlyDescription")}
            </Text>
          </View>
        ) : null}

        {actionError ? (
          <View className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 gap-1">
            <Text className="text-sm font-semibold text-destructive">
              {t("billing.errorTitle")}
            </Text>
            <Text className="text-xs text-muted-foreground">{actionError}</Text>
          </View>
        ) : null}

        {/* Current plan */}
        <Section
          title={t("billing.currentTitle")}
        >
          <View className="rounded-xl border border-border bg-card p-4 gap-3">
            <InfoRow
              label={t("billing.currentPlan")}
              description={t("billing.currentPlanDescription")}
              value={
                <View className="flex-row flex-wrap items-center gap-1.5">
                  <Badge className={planBadgeClass(entitlements.plan)}>
                    {planLabel(entitlements.plan, t)}
                  </Badge>
                  <Badge className={statusBadgeClass(entitlements.status)}>
                    {statusLabel(entitlements.status, t)}
                  </Badge>
                </View>
              }
            />
            <Separator />
            <InfoRow
              label={t("billing.currentMembers")}
              description={t("billing.currentMembersDescription")}
              value={
                <Text className="text-sm font-medium text-foreground tabular-nums">
                  {t("billing.currentMemberCount", { count: entitlements.seats })}
                </Text>
              }
            />
            {periodEnd ? (
              <>
                <Separator />
                <InfoRow
                  label={t("billing.currentPeriodEnd")}
                  description={t("billing.currentPeriodEndDescription")}
                  value={
                    <Text className="text-sm font-medium text-foreground tabular-nums">
                      {periodEnd}
                    </Text>
                  }
                />
              </>
            ) : null}
          </View>
        </Section>

        {/* Upgrade to Pro */}
        {canUpgrade ? (
          <Section
            title={t("billing.upgradeTitle")}
            description={t("billing.upgradeDescription")}
          >
            <View className="rounded-xl border border-border bg-card px-4 py-4 gap-3">
              <View className="flex-row gap-1 rounded-lg border border-border bg-background p-1">
                {(["month", "year"] as const).map((value) => (
                  <Pressable
                    key={value}
                    onPress={() => {
                      setInterval(value);
                      checkoutIntentRef.current = null;
                    }}
                    className={cn(
                      "flex-1 items-center rounded-md px-3 py-2",
                      interval === value ? "bg-foreground" : "bg-transparent",
                    )}
                  >
                    <Text
                      className={cn(
                        "text-sm font-medium",
                        interval === value
                          ? "text-background"
                          : "text-muted-foreground",
                      )}
                    >
                      {value === "month"
                        ? t("billing.upgradeMonthly")
                        : t("billing.upgradeYearly")}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text className="text-sm font-medium text-foreground">
                {t("billing.upgradeProForTeam", { count: entitlements.seats })}
              </Text>

              {pricesQuery.isLoading ? (
                <View className="gap-2">
                  <View className="h-5 w-48 rounded bg-muted" />
                  <View className="h-4 w-64 rounded bg-muted" />
                </View>
              ) : formattedUnitPrice ? (
                <View className="gap-0.5">
                  <Text className="text-sm font-semibold text-foreground tabular-nums">
                    {t("billing.upgradeUnitPrice", { price: formattedUnitPrice })}
                  </Text>
                  {formattedEstimatedTotal ? (
                    <Text className="text-xs text-muted-foreground tabular-nums">
                      {t(
                        interval === "month"
                          ? "billing.upgradeEstimatedMonthlyTotal"
                          : "billing.upgradeEstimatedYearlyTotal",
                        { price: formattedEstimatedTotal },
                      )}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              <Text className="text-xs text-muted-foreground">
                {t("billing.upgradePriceAtCheckout")}
              </Text>

              {canRetryPrice ? (
                <View className="flex-row items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pricesQuery.isFetching}
                    onPress={() => pricesQuery.refetch()}
                  >
                    <Ionicons name="refresh" size={14} color={theme.mutedForeground} />
                    <Text>{t("billing.actionRetry")}</Text>
                  </Button>
                  {pricesQuery.isFetching ? (
                    <ActivityIndicator size="small" />
                  ) : null}
                </View>
              ) : null}

              {canManage ? (
                <Button
                  className="mt-1"
                  disabled={isMutating}
                  onPress={startCheckoutConfirm}
                >
                  <Ionicons name="card-outline" size={16} color={theme.primaryForeground} />
                  <Text>{t("billing.actionUpgrade")}</Text>
                </Button>
              ) : null}
            </View>
          </Section>
        ) : null}

        {/* Subscription management */}
        {hasManagedSubscription && canManage ? (
          <Section
            title={t("billing.managementTitle")}
            description={t("billing.managementDescription")}
          >
            <View className="rounded-xl border border-border bg-card p-4 gap-2">
              {!portalUnavailable ? (
                <Button
                  disabled={isMutating}
                  variant="outline"
                  onPress={() => void handlePortal()}
                >
                  {portalMutation.isPending ? (
                    <ActivityIndicator size="small" />
                  ) : (
                    <Ionicons name="open-outline" size={15} color={theme.mutedForeground} />
                  )}
                  <Text>{t("billing.actionManage")}</Text>
                </Button>
              ) : (
                <Text className="text-xs text-muted-foreground">
                  {t("billing.managementPortalUnavailable")}
                </Text>
              )}
            </View>
          </Section>
        ) : null}

        {/* Usage and limits */}
        <Section
          title={t("billing.limitsTitle")}
          description={t("billing.limitsDescription")}
        >
          <View className="rounded-xl border border-border bg-card p-4 gap-3">
            <InfoRow
              label={t("billing.limitsIssues")}
              description={t("billing.limitsIssuesDescription")}
              value={
                <Text className="text-sm font-medium text-foreground tabular-nums">
                  {entitlements.issueWindow === null
                    ? t("billing.limitsUnlimited")
                    : new Intl.NumberFormat(locale).format(entitlements.issueWindow)}
                </Text>
              }
            />
            <Separator />
            <InfoRow
              label={t("billing.limitsAutopilots")}
              description={t("billing.limitsAutopilotsDescription")}
              value={
                <Text className="text-sm font-medium text-foreground tabular-nums">
                  {entitlements.autopilotRuns === null
                    ? t("billing.limitsUnlimited")
                    : t("billing.limitsPerMonth", {
                        count: entitlements.autopilotRuns,
                      })}
                </Text>
              }
            />
          </View>
        </Section>

        {/* Seats */}
        <Section
          title={t("billing.seatsTitle")}
          description={t("billing.seatsDescription")}
        >
          <View className="rounded-xl border border-border bg-card p-4 gap-3">
            {reconcileMessage ? (
              <View className="rounded-lg border border-border bg-secondary/40 px-3 py-2">
                <Text className="text-xs text-foreground">
                  {t("billing.seatsUpdated")} — {reconcileMessage}
                </Text>
              </View>
            ) : null}
            <InfoRow
              label={t("billing.seatsHumanMembers")}
              description={t("billing.seatsHumanMembersDescription")}
              value={
                <View className="gap-2 items-end">
                  <Text className="text-sm font-medium text-foreground tabular-nums">
                    {t("billing.currentMemberCount", { count: entitlements.seats })}
                  </Text>
                  {canManage && hasManagedSubscription ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isMutating}
                      onPress={() => void handleReconcile()}
                    >
                      {reconcileMutation.isPending ? (
                        <ActivityIndicator size="small" />
                      ) : (
                        <Ionicons name="refresh" size={14} color={theme.mutedForeground} />
                      )}
                      <Text>{t("billing.actionRefreshSeats")}</Text>
                    </Button>
                  ) : null}
                </View>
              }
            />
          </View>
        </Section>
      </View>
    </ScrollView>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <View className="gap-2">
      <View className="px-0.5 gap-0.5">
        <Text className="text-sm font-semibold text-foreground">{title}</Text>
        {description ? (
          <Text className="text-xs text-muted-foreground">{description}</Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function Badge({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <View className={cn("rounded-full px-2 py-0.5", className ?? "bg-muted")}>
      <Text className="text-[11px] font-medium text-background">{children}</Text>
    </View>
  );
}

function InfoRow({
  label,
  description,
  value,
}: {
  label: string;
  description?: string;
  value: React.ReactNode;
}) {
  return (
    <View className="flex-row items-start justify-between gap-3">
      <View className="flex-1 gap-0.5">
        <Text className="text-sm font-medium text-foreground">{label}</Text>
        {description ? (
          <Text className="text-xs text-muted-foreground leading-4">
            {description}
          </Text>
        ) : null}
      </View>
      {value}
    </View>
  );
}