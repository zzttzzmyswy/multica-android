/**
 * Machine-detail runtime row facts (iteration 167) — the per-row content web's
 * `RuntimeList` prints in its Owner / Agents / Cost / CLI columns, derived
 * headlessly so the Node-only vitest lane pins the decisions the phone row
 * makes. Web counterpart:
 * `packages/views/runtimes/components/runtime-list.tsx`.
 *
 * Kept free of RN / Query imports: the screen composes these with the
 * workspace-wide caches it already holds (members, agents, task snapshot) so
 * the row adds no requests except the per-runtime usage the cost cell needs.
 */
import type { AgentRuntime, MemberWithUser, RuntimeUsage } from "@multica/core/types";
import type { RuntimeHealth } from "@multica/core/runtimes";
import type { RuntimeWorkloadSummary } from "./runtime-machines";
import { computeCostInWindow, pctChange } from "./runtime-usage";

/**
 * Whether the Owner fact earns its place on a row. Web's rule
 * (`runtime-list.tsx:showOwner`): only when the rows actually have more than
 * one owner — otherwise it is a column of identical names. A machine's
 * runtimes normally belong to one member, so this is usually false; it turns
 * on exactly when the owner is the thing that tells two rows apart.
 */
export function showRuntimeOwnerColumn(
  runtimes: readonly Pick<AgentRuntime, "owner_id">[],
): boolean {
  const owners = new Set<string>();
  for (const runtime of runtimes) {
    if (runtime.owner_id) owners.add(runtime.owner_id);
  }
  return owners.size > 1;
}

/** The owner's display name, or null when the runtime is unowned or its owner
 *  has left the workspace (both render as the em-dash placeholder). */
export function runtimeOwnerName(
  runtime: Pick<AgentRuntime, "owner_id">,
  members: readonly MemberWithUser[],
): string | null {
  if (!runtime.owner_id) return null;
  return members.find((m) => m.user_id === runtime.owner_id)?.name ?? null;
}

/**
 * The CLI version a row reports: `metadata.version`, the agent's own
 * underlying CLI tool version (e.g. "2.1.5 (Claude Code)", "codex-cli
 * 0.118.0"). Deliberately NOT `metadata.cli_version` — that is the shared
 * multica daemon CLI, identical for every runtime on one machine, and
 * surfacing it per row made every agent show the same number (MUL-3838). The
 * daemon version lives in the machine header instead.
 */
export function runtimeCliVersion(
  runtime: Pick<AgentRuntime, "metadata">,
): string | null {
  const value = runtime.metadata?.version;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/** Running + queued work on one runtime; a runtime with no workload entry has
 *  no bound agents and is idle. */
export function runtimeActiveTaskCount(
  workload: RuntimeWorkloadSummary | undefined,
): number {
  return (workload?.runningCount ?? 0) + (workload?.queuedCount ?? 0);
}

/**
 * Whether the health line carries a "· N tasks" suffix. Web HealthCell:
 * offline-ish rows skip it (health already says it all) and idle rows skip it
 * (idle is the unremarkable default) — the suffix exists to flag work in
 * flight or stuck in the queue.
 */
export function showRuntimeLoadSuffix(
  health: RuntimeHealth,
  activeCount: number,
): boolean {
  if (health === "offline" || health === "about_to_gc") return false;
  return activeCount > 0;
}

/** Trailing window the row totals — "Cost · 7d" (web's COST_CELL_DAYS). */
export const RUNTIME_COST_WINDOW_DAYS = 7;
/**
 * Days fetched to produce the total AND its delta against the prior window,
 * in one request. Web used to fetch 180 days to share the cache key with the
 * runtime-detail page, which turned the list into N × 180d aggregations
 * against `task_usage`; 14 is the minimum that answers both questions.
 */
export const RUNTIME_COST_FETCH_DAYS = 14;

export type RuntimeCostTone = "muted" | "warning" | "success";

/**
 * `none` renders the em-dash placeholder: the runtime reported no usage in
 * the fetched window at all, which is different from "spent nothing this
 * week" and must not be flattened into "$0.00".
 */
export type RuntimeCostCell =
  | { kind: "none" }
  | {
      kind: "cost";
      amount: number;
      /** Pre-formatted dollars — cents are dropped past $100, as web does. */
      label: string;
      /** Percent change vs the prior 7d, or null when there is no baseline. */
      delta: number | null;
      tone: RuntimeCostTone;
    };

/**
 * The row's 7d cost cell. `usage` is the raw `runtimeUsageOptions` payload for
 * RUNTIME_COST_FETCH_DAYS days; `tz` is the viewer's zone, so the calendar-day
 * boundary matches the server's bucketing.
 */
export function runtimeCostCell(
  usage: readonly RuntimeUsage[],
  tz: string,
): RuntimeCostCell {
  if (usage.length === 0) return { kind: "none" };

  const amount = computeCostInWindow(usage, RUNTIME_COST_WINDOW_DAYS, tz);
  const previous = computeCostInWindow(
    usage,
    RUNTIME_COST_WINDOW_DAYS,
    tz,
    RUNTIME_COST_WINDOW_DAYS,
  );
  const delta = pctChange(amount, previous);

  return {
    kind: "cost",
    amount,
    label: amount >= 100 ? `$${amount.toFixed(0)}` : `$${amount.toFixed(2)}`,
    delta,
    tone: delta == null || delta === 0 ? "muted" : delta > 0 ? "warning" : "success",
  };
}
