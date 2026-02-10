/**
 * Lane-based command queue for subagent concurrency control.
 *
 * Each lane maintains an independent queue with a configurable max-concurrency
 * limit.  Tasks beyond the limit are queued and executed FIFO as slots free up.
 *
 * Adapted from OpenClaw's process/command-queue.ts.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type QueueEntry = {
  task: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  enqueuedAt: number;
  warnAfterMs: number;
  onWait?: (waitMs: number, queuedAhead: number) => void;
};

type LaneState = {
  lane: string;
  queue: QueueEntry[];
  active: number;
  maxConcurrent: number;
  draining: boolean;
};

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

const lanes = new Map<string, LaneState>();

function getLaneState(lane: string): LaneState {
  const existing = lanes.get(lane);
  if (existing) return existing;

  const created: LaneState = {
    lane,
    queue: [],
    active: 0,
    maxConcurrent: 1,
    draining: false,
  };
  lanes.set(lane, created);
  return created;
}

// ---------------------------------------------------------------------------
// Drain / pump
// ---------------------------------------------------------------------------

function drainLane(lane: string): void {
  const state = getLaneState(lane);
  if (state.draining) return;
  state.draining = true;

  const pump = () => {
    while (state.active < state.maxConcurrent && state.queue.length > 0) {
      const entry = state.queue.shift() as QueueEntry;
      const waitedMs = Date.now() - entry.enqueuedAt;

      if (waitedMs >= entry.warnAfterMs) {
        entry.onWait?.(waitedMs, state.queue.length);
        console.warn(
          `[CommandQueue] lane wait exceeded: lane=${lane} waitedMs=${waitedMs} queueAhead=${state.queue.length}`,
        );
      }

      state.active += 1;

      void (async () => {
        try {
          const result = await entry.task();
          state.active -= 1;
          pump();
          entry.resolve(result);
        } catch (err) {
          state.active -= 1;
          pump();
          entry.reject(err);
        }
      })();
    }
    state.draining = false;
  };

  pump();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Set (or update) the max concurrency for a lane.  Triggers a drain. */
export function setLaneConcurrency(lane: string, maxConcurrent: number): void {
  const state = getLaneState(lane);
  state.maxConcurrent = Math.max(1, Math.floor(maxConcurrent));
  drainLane(lane);
}

/** Enqueue a task in a specific lane.  Returns a promise that resolves with the task's return value. */
export function enqueueInLane<T>(
  lane: string,
  task: () => Promise<T>,
  opts?: {
    warnAfterMs?: number;
    onWait?: (waitMs: number, queuedAhead: number) => void;
  },
): Promise<T> {
  const warnAfterMs = opts?.warnAfterMs ?? 5_000;
  const state = getLaneState(lane);

  return new Promise<T>((resolve, reject) => {
    state.queue.push({
      task: () => task(),
      resolve: (value) => resolve(value as T),
      reject,
      enqueuedAt: Date.now(),
      warnAfterMs,
      onWait: opts?.onWait,
    });
    drainLane(lane);
  });
}

/** Number of active + queued tasks in a lane. */
export function getLaneSize(lane: string): number {
  const state = lanes.get(lane);
  if (!state) return 0;
  return state.queue.length + state.active;
}

/** Remove all pending (not yet active) tasks from a lane. Returns how many were removed. */
export function clearLane(lane: string): number {
  const state = lanes.get(lane);
  if (!state) return 0;
  const removed = state.queue.length;
  // Reject pending tasks so callers aren't left hanging
  for (const entry of state.queue) {
    entry.reject(new Error("Lane cleared"));
  }
  state.queue.length = 0;
  return removed;
}

/** Reset all lanes (for testing). */
export function resetLanesForTests(): void {
  for (const state of lanes.values()) {
    for (const entry of state.queue) {
      entry.reject(new Error("Reset"));
    }
  }
  lanes.clear();
}
