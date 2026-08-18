import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Iteration-67 workspace Billing i18n. Same contract as the other
// *-keys.test.ts files: every key resolves in BOTH locales and the
// zh value is actually translated (Free/Pro stay brand terms).
describe("workspace billing i18n", () => {
  let mod: Awaited<ReturnType<typeof loadI18n>>;

  async function loadI18n() {
    return await import("./index");
  }

  beforeEach(async () => {
    mod = await loadI18n();
    mod.resetI18nForTests();
    mod.setLocale("en");
  });

  const EN_ZH: Record<string, [string, string]> = {
    "billing.title": ["Billing", "账单与套餐"],
    "billing.description": ["Manage this workspace's plan, limits, human seats, and Stripe billing.", "管理这个工作区的套餐、限额、成员席位和 Stripe 账单。"],
    "billing.loading": ["Loading workspace billing", "正在加载工作区账单"],
    "billing.planFree": ["Free", "Free"],
    "billing.planPro": ["Pro", "Pro"],
    "billing.planUnknown": ["Unknown plan", "未知套餐"],
    "billing.statusInactive": ["Inactive", "未启用"],
    "billing.statusActive": ["Active", "活跃"],
    "billing.statusTrialing": ["Trialing", "试用中"],
    "billing.statusPastDue": ["Past due", "付款逾期"],
    "billing.statusCanceled": ["Canceled", "已取消"],
    "billing.statusUnknown": ["Unknown status", "未知状态"],
    "billing.loadFailedTitle": ["Billing is temporarily unavailable", "账单服务暂时不可用"],
    "billing.loadFailedDescription": ["We couldn't read a trustworthy subscription snapshot. Your plan has not been changed.", "暂时无法读取可信的订阅快照。你的套餐没有发生变化。"],
    "billing.actionRetry": ["Retry", "重试"],
    "billing.actionUpgrade": ["Upgrade to Pro", "升级到 Pro"],
    "billing.actionManage": ["Manage billing", "管理账单"],
    "billing.actionRefreshSeats": ["Refresh seats", "刷新席位"],
    "billing.actionCancel": ["Cancel", "取消"],
    "billing.actionContinueToStripe": ["Continue to Stripe", "前往 Stripe"],
    "billing.errorTitle": ["Billing action failed", "账单操作失败"],
    "billing.errorTemporarilyUnavailable": ["Billing is temporarily unavailable. Retry in a moment.", "账单服务暂时不可用，请稍后重试。"],
    "billing.errorPermissionChanged": ["Your workspace role no longer allows this action. Refresh to see your current access.", "你的工作区角色已不允许执行此操作。刷新页面可查看当前权限。"],
    "billing.errorCheckoutResponse": ["Checkout could not open because the server response was unreadable. Retry without changing your selected interval.", "服务端响应无法读取，无法打开 Checkout。请保留当前周期并重试。"],
    "billing.errorAlreadySubscribed": ["This workspace already has a subscription. The current plan has been refreshed.", "这个工作区已经有订阅，当前套餐已刷新。"],
    "billing.errorCheckoutFailed": ["Checkout could not be created. Retry in a moment.", "无法创建 Checkout，请稍后重试。"],
    "billing.errorPortalResponse": ["The Billing Portal could not open because the server response was unreadable.", "服务端响应无法读取，无法打开 Billing Portal。"],
    "billing.errorPortalUnavailable": ["The Billing Portal is not available for this workspace. The current plan has been refreshed.", "这个工作区暂时无法使用 Billing Portal，当前套餐已刷新。"],
    "billing.errorPortalFailed": ["The Billing Portal could not be opened. Retry in a moment.", "无法打开 Billing Portal，请稍后重试。"],
    "billing.errorReconcileResponse": ["Seats were refreshed, but the result could not be read. Reload to confirm the current count.", "席位已刷新，但无法读取结果。请重新加载页面确认当前数量。"],
    "billing.errorReconcileFailed": ["Seats could not be refreshed. Member changes are still saved and periodic reconciliation will retry.", "无法刷新席位。成员变更已保存，定期对账仍会继续重试。"],
    "billing.pastDueTitle": ["Payment needs attention", "付款信息需要处理"],
    "billing.pastDueDescription": ["Open the Billing Portal to update your payment method and keep Pro access.", "打开 Billing Portal 更新付款方式，以继续使用 Pro。"],
    "billing.readOnlyTitle": ["Read-only billing access", "账单只读权限"],
    "billing.readOnlyDescription": ["You can view the workspace plan and limits. Only owners and admins can purchase or manage a subscription.", "你可以查看工作区套餐和限额。只有 owner 和 admin 可以购买或管理订阅。"],
    "billing.currentTitle": ["Current plan", "当前套餐"],
    "billing.currentPlan": ["Workspace plan", "工作区套餐"],
    "billing.currentPlanDescription": ["The entitlement currently enforced for this workspace.", "这个工作区当前生效的 entitlement。"],
    "billing.currentMembers": ["Human members", "成员席位"],
    "billing.currentMembersDescription": ["Agents and pending invitations are not counted as seats.", "智能体和待接受的邀请不计入席位。"],
    "billing.currentMemberCount": ["{{count}} members", "{{count}} 位成员"],
    "billing.currentPeriodEnd": ["Current period ends", "当前周期结束时间"],
    "billing.currentPeriodEndDescription": ["The date reported by the current subscription snapshot.", "当前订阅快照报告的日期。"],
    "billing.upgradeTitle": ["Upgrade to Pro", "升级到 Pro"],
    "billing.upgradeDescription": ["Choose a billing interval, then confirm the current seats and final amount in Stripe Checkout.", "选择付款周期，然后在 Stripe Checkout 确认当前席位和最终金额。"],
    "billing.upgradeIntervalLabel": ["Billing interval", "付款周期"],
    "billing.upgradeMonthly": ["Monthly", "月付"],
    "billing.upgradeYearly": ["Yearly", "年付"],
    "billing.upgradeProForTeam": ["Pro for {{count}} human seats", "为 {{count}} 个成员席位升级 Pro"],
    "billing.upgradePriceLoading": ["Loading subscription prices", "正在加载订阅价格"],
    "billing.upgradeUnitPrice": ["{{price}} per human seat", "每个成员席位 {{price}}"],
    "billing.upgradeEstimatedMonthlyTotal": ["Estimated monthly total: {{price}}", "预计月付总额：{{price}}"],
    "billing.upgradeEstimatedYearlyTotal": ["Estimated yearly total: {{price}}", "预计年付总额：{{price}}"],
    "billing.upgradePriceAtCheckout": ["The server re-counts human members before purchase. Stripe Checkout shows the authoritative per-seat price and total before you pay.", "购买前，服务端会重新统计成员。付款前，Stripe Checkout 会显示权威的单席位价格和总额。"],
    "billing.managementTitle": ["Subscription management", "订阅管理"],
    "billing.managementDescription": ["Stripe securely manages payment methods, invoices, and cancellation.", "Stripe 会安全地管理付款方式、发票和取消订阅。"],
    "billing.managementPortal": ["Stripe Billing Portal", "Stripe Billing Portal"],
    "billing.managementPortalDescription": ["Open Stripe to manage this workspace's subscription.", "前往 Stripe 管理这个工作区的订阅。"],
    "billing.managementPortalUnavailable": ["No Stripe Billing Portal is available for this workspace.", "这个工作区暂时没有可用的 Stripe Billing Portal。"],
    "billing.limitsTitle": ["Usage and limits", "用量与限额"],
    "billing.limitsDescription": ["Current limits are shown without inventing usage totals the server does not provide yet.", "这里仅显示当前套餐限额，不会把服务端尚未提供的已用量伪装成 0。"],
    "billing.limitsIssues": ["Recent tasks", "最近活跃的任务"],
    "billing.limitsIssuesDescription": ["Free keeps the most recently active tasks available. Pro has no window limit.", "Free 可访问最近活跃的任务；Pro 没有窗口限制。"],
    "billing.limitsAutopilots": ["Successful automations", "成功的自动化执行"],
    "billing.limitsAutopilotsDescription": ["The Free allowance resets each UTC calendar month. Pro is unlimited.", "Free 限额按 UTC 自然月重置；Pro 不限次数。"],
    "billing.limitsUnlimited": ["Unlimited", "不限"],
    "billing.limitsPerMonth": ["{{count}} / month", "每月 {{count}} 次"],
    "billing.seatsTitle": ["Seats", "席位"],
    "billing.seatsDescription": ["Every current human member counts as a Pro seat. Agents and pending invitations do not.", "每位当前成员都会计为一个 Pro 席位，智能体和待接受的邀请不计。"],
    "billing.seatsHumanMembers": ["Current human members", "当前成员"],
    "billing.seatsHumanMembersDescription": ["Refresh after membership changes to ask cloud billing to reconcile Stripe quantity.", "成员变化后刷新，通知 Cloud Billing 对账 Stripe quantity。"],
    "billing.seatsUpdated": ["Seats refreshed", "席位已刷新"],
    "billing.seatsReconciled": ["Current members: {{actual}} · billed seats: {{billed}}", "当前成员：{{actual}} · 计费席位：{{billed}}"],
    "billing.confirmTitle": ["Continue to Stripe Checkout?", "前往 Stripe Checkout？"],
    "billing.confirmDescription": ["Billing interval: {{interval}}. Current human members: {{count}}. Stripe will re-count seats and show the final amount before payment.", "付款周期：{{interval}}。当前成员：{{count}}。Stripe 会重新统计席位，并在付款前显示最终金额。"],
    "billing.returnCancelTitle": ["Checkout canceled", "已取消 Checkout"],
    "billing.returnCancelDescription": ["No plan change was made.", "套餐没有发生变化。"],
    "billing.returnSyncingTitle": ["Activating your subscription", "正在启用订阅"],
    "billing.returnSyncingDescription": ["Payment is complete. We're waiting for Stripe to confirm the plan change.", "付款已完成，正在等待 Stripe 确认套餐变化。"],
    "billing.returnTimeoutDescription": ["Payment was received, but the subscription is still syncing. Refresh this page in a moment.", "付款已收到，但订阅仍在同步。请稍后刷新页面。"],
    "billing.returnActiveTitle": ["Pro is active", "Pro 已启用"],
    "billing.returnActiveDescription": ["This workspace now has Pro access.", "这个工作区现在可以使用 Pro。"],
    "screen.billing": ["Billing", "账单与套餐"],
  };

  it('resolves every billing key in both locales with a real zh translation', () => {
    for (const [key, [enValue, zhValue]] of Object.entries(EN_ZH)) {
      expect(enValue).not.toBe(key);
      expect(enValue.length).toBeGreaterThan(0);
      expect(mod.translate(key)).toBe(enValue);
      mod.setLocale("zh");
      expect(mod.translate(key)).toBe(zhValue);
      mod.setLocale("en");
    }
  });
});
