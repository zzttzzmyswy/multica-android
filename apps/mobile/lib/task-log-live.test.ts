import { describe, expect, it } from "vitest";
import {
  TASK_LOG_POLL_INTERVAL_MS,
  liveLogPollMs,
} from "./task-log-live";

describe("liveLogPollMs", () => {
  it("polls on a fixed interval while the log is live", () => {
    expect(liveLogPollMs(true)).toBe(TASK_LOG_POLL_INTERVAL_MS);
    expect(TASK_LOG_POLL_INTERVAL_MS).toBeGreaterThan(0);
  });

  it("returns false (no polling) when the log is not live", () => {
    expect(liveLogPollMs(false)).toBe(false);
  });
});