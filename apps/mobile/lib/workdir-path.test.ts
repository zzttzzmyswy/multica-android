import { describe, expect, it } from "vitest";
import type { AgentTask } from "@multica/core/types";
import { pickLatestWorkDir } from "./workdir-path";

function task(created_at: string, work_dir?: string): AgentTask {
  return { id: `t-${created_at}`, created_at, work_dir } as AgentTask;
}

describe("pickLatestWorkDir", () => {
  it("returns undefined for an empty or missing list", () => {
    expect(pickLatestWorkDir(undefined)).toBeUndefined();
    expect(pickLatestWorkDir([])).toBeUndefined();
  });

  it("returns undefined when no task carries a work_dir", () => {
    expect(pickLatestWorkDir([task("2026-09-17T10:00:00Z")])).toBeUndefined();
    expect(
      pickLatestWorkDir([task("2026-09-17T10:00:00Z"), task("2026-09-17T11:00:00Z")]),
    ).toBeUndefined();
  });

  it("skips tasks without a work_dir when picking the newest", () => {
    // The newest task has not reported a directory yet — the newest task that
    // HAS one is the one worth copying, not the head of the list.
    const tasks = [
      task("2026-09-17T11:00:00Z"),
      task("2026-09-17T10:00:00Z", "/mnt/sda1/zzt/repo"),
    ];
    expect(pickLatestWorkDir(tasks)).toBe("/mnt/sda1/zzt/repo");
  });

  it("compares created_at regardless of the order the server returned", () => {
    const ascending = [
      task("2026-09-17T10:00:00Z", "/old"),
      task("2026-09-17T12:00:00Z", "/new"),
      task("2026-09-17T11:00:00Z", "/mid"),
    ];
    expect(pickLatestWorkDir(ascending)).toBe("/new");
    expect(pickLatestWorkDir([...ascending].reverse())).toBe("/new");
  });

  it("prefers the later task when created_at is empty or equal", () => {
    // An unparseable/empty created_at must not beat a real one, and a tie
    // resolves to the first-encountered task so the pick stays deterministic.
    const tasks = [task("", "/no-timestamp"), task("2026-09-17T10:00:00Z", "/real")];
    expect(pickLatestWorkDir(tasks)).toBe("/real");
    expect(
      pickLatestWorkDir([
        task("2026-09-17T10:00:00Z", "/first"),
        task("2026-09-17T10:00:00Z", "/second"),
      ]),
    ).toBe("/first");
  });

  it("ignores an empty-string work_dir", () => {
    // The daemon reports "" before a directory is pinned; copying that would
    // silently put nothing on the clipboard.
    expect(pickLatestWorkDir([task("2026-09-17T10:00:00Z", "")])).toBeUndefined();
  });
});
