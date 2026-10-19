import { describe, expect, it, vi } from "vitest";
import {
  propertyWriteFailureMessage,
  writeCreatePropertyValues,
} from "./create-property-writes";

/** A stand-in for `api.setIssueProperty` that records calls and can be told to
 *  reject specific properties. */
function fakeApi(failing: string[] = []) {
  const calls: Array<{ issueId: string; propertyId: string; value: unknown }> = [];
  return {
    calls,
    setIssueProperty: async (
      issueId: string,
      propertyId: string,
      value: unknown,
    ) => {
      calls.push({ issueId, propertyId, value });
      if (failing.includes(propertyId)) throw new Error(`rejected ${propertyId}`);
      return { properties: {} };
    },
  };
}

describe("writeCreatePropertyValues", () => {
  it("writes one PUT per property, onto the created issue", async () => {
    const api = fakeApi();
    const outcome = await writeCreatePropertyValues(api, "iss-1", {
      "p-sev": "high",
      "p-due": "2026-11-01",
    });
    expect(api.calls).toEqual([
      { issueId: "iss-1", propertyId: "p-sev", value: "high" },
      { issueId: "iss-1", propertyId: "p-due", value: "2026-11-01" },
    ]);
    expect(outcome.written).toEqual(["p-sev", "p-due"]);
    expect(outcome.failed).toEqual([]);
    expect(outcome.firstError).toBeUndefined();
  });

  it("does not call the API at all for an empty map", async () => {
    // An issue created with no properties must not take a round trip.
    const api = fakeApi();
    const outcome = await writeCreatePropertyValues(api, "iss-1", {});
    expect(api.calls).toEqual([]);
    expect(outcome).toEqual({ written: [], failed: [], firstError: undefined });
  });

  it("treats a null / undefined map as empty", async () => {
    const api = fakeApi();
    expect((await writeCreatePropertyValues(api, "iss-1", null)).written).toEqual([]);
    expect((await writeCreatePropertyValues(api, "iss-1", undefined)).written).toEqual([]);
    expect(api.calls).toEqual([]);
  });

  it("does not call the API without an issue id", async () => {
    const api = fakeApi();
    const outcome = await writeCreatePropertyValues(api, "", { "p-a": 1 });
    expect(api.calls).toEqual([]);
    expect(outcome.failed).toEqual([]);
  });

  it("keeps going after a rejection — every property is independent", async () => {
    // Aborting at the first failure would silently drop the values queued
    // behind it, which the user did choose.
    const api = fakeApi(["p-b"]);
    const outcome = await writeCreatePropertyValues(api, "iss-1", {
      "p-a": "x",
      "p-b": "y",
      "p-c": "z",
    });
    expect(api.calls.map((c) => c.propertyId)).toEqual(["p-a", "p-b", "p-c"]);
    expect(outcome.written).toEqual(["p-a", "p-c"]);
    expect(outcome.failed).toEqual(["p-b"]);
  });

  it("reports only the FIRST error, not one per failure", async () => {
    const api = fakeApi(["p-a", "p-b"]);
    const outcome = await writeCreatePropertyValues(api, "iss-1", {
      "p-a": 1,
      "p-b": 2,
    });
    expect(outcome.failed).toEqual(["p-a", "p-b"]);
    expect((outcome.firstError as Error).message).toBe("rejected p-a");
  });

  it("preserves the caller's insertion order in both lists", async () => {
    const api = fakeApi(["p-2"]);
    const outcome = await writeCreatePropertyValues(api, "iss-1", {
      "p-1": "a",
      "p-2": "b",
      "p-3": "c",
    });
    expect(outcome.written).toEqual(["p-1", "p-3"]);
    expect(outcome.failed).toEqual(["p-2"]);
    // Written and failed are each in attempt order, not interleaved by outcome.
    expect(api.calls.map((c) => c.propertyId)).toEqual(["p-1", "p-2", "p-3"]);
  });

  it("never rejects — the issue already exists, so the caller must not unwind", async () => {
    const api = fakeApi(["p-a", "p-b"]);
    await expect(
      writeCreatePropertyValues(api, "iss-1", { "p-a": 1, "p-b": 2 }),
    ).resolves.toBeDefined();
  });

  it("accepts falsy values as real values, not as absence", async () => {
    // `false` / `0` / `""` are values a user can pick (a checkbox "No", a
    // number zero). Dropping them would make those choices unsettable.
    const api = fakeApi();
    await writeCreatePropertyValues(api, "iss-1", {
      "p-check": false,
      "p-num": 0,
    });
    expect(api.calls).toEqual([
      { issueId: "iss-1", propertyId: "p-check", value: false },
      { issueId: "iss-1", propertyId: "p-num", value: 0 },
    ]);
  });

  it("accepts an array value (multi_select / multi_actor)", async () => {
    const api = fakeApi();
    await writeCreatePropertyValues(api, "iss-1", {
      "p-multi": ["o-1", "o-2"],
    });
    expect(api.calls[0].value).toEqual(["o-1", "o-2"]);
  });
});

describe("propertyWriteFailureMessage", () => {
  const t = vi.fn((key: string, params?: Record<string, string | number>) =>
    `${key}:${params?.count}`,
  );

  it("says nothing when every write landed", () => {
    expect(
      propertyWriteFailureMessage(
        { written: ["a"], failed: [], firstError: undefined },
        t,
      ),
    ).toBeNull();
  });

  it("never says '0 failed'", () => {
    // The guard exists so a caller cannot raise an empty failure notice.
    expect(
      propertyWriteFailureMessage(
        { written: [], failed: [], firstError: undefined },
        t,
      ),
    ).toBeNull();
  });

  it("counts the failures", () => {
    expect(
      propertyWriteFailureMessage(
        { written: ["a"], failed: ["b", "c"], firstError: new Error("x") },
        t,
      ),
    ).toBe("newIssue.propertiesFailed:2");
  });
});
