import { describe, expect, it } from "vitest";
import { projectResourceState } from "./project-resource-state";

describe("project resource loading states", () => {
  it("never reports an unanswered or failed first read as empty", () => {
    expect(projectResourceState({ resources: undefined, isError: false })).toBe("loading");
    expect(projectResourceState({ resources: undefined, isError: true })).toBe("error");
  });
  it("reports empty only after a successful read", () => {
    expect(projectResourceState({ resources: [], isError: false })).toBe("empty");
  });
  it("keeps cached rows and distinguishes background failures, including cached empty lists", () => {
    const resources = [{ id: "resource-1" }];
    expect(projectResourceState({ resources, isError: false })).toBe("ready");
    expect(projectResourceState({ resources, isError: true })).toBe("stale");
    expect(resources).toEqual([{ id: "resource-1" }]);
    expect(projectResourceState({ resources: [], isError: true })).toBe("stale");
  });
});
