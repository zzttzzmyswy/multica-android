/**
 * Pure helpers for the Billing screen (iteration-67). Kept out of the screen
 * component so the Node vitest lane can cover them — mirrors web
 * `packages/views/settings/components/billing-tab.tsx:104-152`.
 */

const STRIPE_ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);
const STRIPE_TWO_DECIMAL_COMPAT_CURRENCIES = new Set(["ISK", "UGX"]);
const STRIPE_THREE_DECIMAL_CURRENCIES = new Set([
  "BHD",
  "JOD",
  "KWD",
  "OMR",
  "TND",
]);

/**
 * Stripe API amounts use its own minor-unit contract: two decimals by default,
 * an explicit zero-decimal list, five three-decimal currencies, and ISK/UGX in
 * a backwards-compatible two-decimal representation. Intl localizes the
 * already-converted major amount; it must not decide the divisor.
 */
export function formatStripeMinorAmount(
  amount: number,
  currency: string,
  locale: string,
): string | null {
  if (!Number.isSafeInteger(amount) || amount < 0) return null;
  const normalized = currency.trim().toUpperCase();
  if (!normalized) return null;
  try {
    const fractionDigits = STRIPE_TWO_DECIMAL_COMPAT_CURRENCIES.has(normalized)
      ? 2
      : STRIPE_ZERO_DECIMAL_CURRENCIES.has(normalized)
        ? 0
        : STRIPE_THREE_DECIMAL_CURRENCIES.has(normalized)
          ? 3
          : 2;
    const majorAmount = amount / 10 ** fractionDigits;
    const showFraction = !Number.isInteger(majorAmount);
    const formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: normalized,
      ...(showFraction
        ? {
            minimumFractionDigits: fractionDigits,
            maximumFractionDigits: fractionDigits,
          }
        : {}),
    });
    return formatter.format(majorAmount);
  } catch {
    return null;
  }
}

/** Plan badge tone — mirrors web planBadgeVariant. */
export function planBadgeClass(plan: string): string {
  if (plan === "pro") return "bg-primary";
  if (plan === "free") return "bg-secondary";
  return "bg-muted";
}

/** Status badge tone — mirrors web statusBadgeVariant. */
export function statusBadgeClass(status: string): string {
  switch (status) {
    case "active":
    case "trialing":
      return "bg-primary";
    case "past_due":
      return "bg-destructive";
    case "inactive":
    case "canceled":
      return "bg-secondary";
    default:
      return "bg-muted";
  }
}