/**
 * Leaderboard row windowing and caption counts (iteration 171).
 *
 * Web caps the ranked list at ten rows and collapses the tail behind a toggle
 * (packages/views/dashboard/components/leaderboard.tsx:34,80-82,108-130). A
 * workspace with dozens of agents rendered every one of them, which pushed the
 * rest of the page a full screen down.
 *
 * The caption counts *named* agents only. Up to two of the rows are synthetic
 * buckets — the deleted-agents bucket and the server's merged "other agents"
 * bucket — and neither is an agent the reader can go and look at, so counting
 * them would overstate the roster. Web filters on `isSyntheticAgentRow` rather
 * than subtracting a fixed offset, because both buckets can be present at once.
 *
 * Pure and React-free so the Node-only vitest lane can pin it.
 */
import { isSyntheticAgentRow } from "./usage-format";

/** How many agents the leaderboard ranks before collapsing the tail. Web's
 *  LEADERBOARD_LIMIT, mirrored so the two surfaces collapse at the same point. */
export const LEADERBOARD_LIMIT = 10;

export interface LeaderboardRowLike {
  agentId: string;
}

export interface LeaderboardView<T> {
  /** The rows to render, in the order given. */
  rows: T[];
  /** How many rows the toggle is hiding. Zero when nothing is collapsed. */
  hidden: number;
  /** Rows that name a real agent (synthetic buckets excluded). */
  namedCount: number;
  /** How many distinct deleted agents the bucket stands for. */
  deletedCount: number;
  /** Whether the tail is long enough to be worth a toggle. */
  collapsible: boolean;
}

/**
 * Slice `rows` for display and derive the caption counts.
 *
 * `deletedAgentCount` is the number of distinct agents folded into the deleted
 * bucket, not the bucket's own row count — the bucket is one row standing for
 * N agents, and the caption has to say N.
 */
export function leaderboardView<T extends LeaderboardRowLike>(
  rows: T[],
  showAll: boolean,
  deletedAgentCount: number,
): LeaderboardView<T> {
  const collapsible = rows.length > LEADERBOARD_LIMIT;
  const visible = collapsible && !showAll ? rows.slice(0, LEADERBOARD_LIMIT) : rows;

  return {
    rows: visible,
    hidden: rows.length - visible.length,
    namedCount: rows.filter((r) => !isSyntheticAgentRow(r.agentId)).length,
    deletedCount: Math.max(0, deletedAgentCount),
    collapsible,
  };
}

/** Whether a leaderboard row's agent can be opened. Synthetic buckets have no
 *  agent behind them, so they never link anywhere. */
export function isOpenableLeaderboardRow(agentId: string): boolean {
  return !isSyntheticAgentRow(agentId);
}
