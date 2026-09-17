/**
 * Which actions an agents-LIST row offers — the mobile port of web's
 * `AgentRowActions` gating (packages/views/agents/components/agent-row-actions.tsx
 * :90-103).
 *
 * Web's menu also carries "Open in new tab", which is a desktop-tab concept
 * the phone has no equivalent for — tapping the row already opens the agent —
 * so mobile's list is the four lifecycle/ownership actions below. Web's
 * "open in new tab" is also the reason its kebab is always rendered; without
 * it a row can legitimately have nothing to offer (an archived agent you
 * don't manage), and `agentRowActions` returning an empty list is the signal
 * to hide the trigger rather than open an empty sheet.
 */
import type { Agent } from "@multica/core/types";

export type AgentRowAction = "cancel-tasks" | "duplicate" | "restore" | "archive";
export interface AgentRowActionContext {
  /**
   * Workspace admin/owner, or the agent's own owner — web's
   * `canManage: isWorkspaceAdmin || isOwner` (agents-page.tsx:890).
   */
  canManage: boolean;
  /** The agent has running or queued tasks right now. */
  hasActiveWork: boolean;
}

/**
 * The actions to render, in menu order. Empty means "no menu".
 *
 * Multica's built-in agents cannot be archived — the server refuses it, and
 * the workspace's entry point runs through one — so the action is hidden
 * rather than left to fail (web agent-row-actions.tsx:96-99).
 */
export function agentRowActions(
  agent: Pick<Agent, "archived_at" | "system_key">,
  { canManage, hasActiveWork }: AgentRowActionContext,
): AgentRowAction[] {
  const archived = !!agent.archived_at;
  const actions: AgentRowAction[] = [];
  if (canManage && !archived && hasActiveWork) actions.push("cancel-tasks");
  // Duplicating is open to any workspace member — the copy is created against
  // the caller's own account.
  if (!archived) actions.push("duplicate");
  if (canManage && archived) actions.push("restore");
  if (canManage && !archived && !agent.system_key) actions.push("archive");
  return actions;
}

/** Minimal translator shape — the `t` both callers already hold. */
type Translate = (
  key: string,
  params?: Record<string, string | number>,
) => string;

/**
 * Confirmation body for "cancel all tasks", shared by the list row menu and
 * the detail header menu (web parity: `describeCancelImpact`,
 * agent-row-actions.tsx): "This will cancel 2 running + 1 queued tasks." The
 * running note appears only when tasks are actually running — a queued-only
 * cancel is instant.
 */
export function describeCancelImpact(
  running: number,
  queued: number,
  t: Translate,
): string {
  if (running === 0 && queued === 0) return t("agents.detail.cancelNoTasks");
  const parts: string[] = [];
  if (running > 0) {
    parts.push(t("agents.detail.cancelRunningCount", { count: running }));
  }
  if (queued > 0) {
    parts.push(t("agents.detail.cancelQueuedCount", { count: queued }));
  }
  const summary = parts.join(" + ");
  const total = running + queued;
  const impact =
    total === 1
      ? t("agents.detail.cancelImpactOne", { summary })
      : t("agents.detail.cancelImpactOther", { summary });
  const note = running > 0 ? t("agents.detail.cancelRunningNote") : "";
  return [impact, note, t("agents.detail.cancelIrreversible")].join("\n\n");
}
