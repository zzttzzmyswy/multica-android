import { describe, expect, it, vi } from "vitest";

// Data-layer tests must mock `@/data/api` (vitest.config.ts note) so the
// native fetch chain never loads — the query module only calls `api` inside
// the queryFn, which these tests never execute.
vi.mock("@/data/api", () => ({ api: {} }));

import { configKeys, featureFlagEnabled, serverConfigOptions } from "./config";

// Server-config / feature-flag queries (iteration-99). Web gates Plugins and
// other optional surfaces behind /api/config `feature_flags` via
// `@multica/core/config`; mobile previously never consumed the endpoint, so
// every flag-gated feature (Plugins, Composio, billing) was invisible no
// matter what the deployment enabled. These cases pin the query shape and the
// pure flag lookup the UI uses.
describe("configKeys + serverConfigOptions", () => {
  it("uses a stable global query key (config is workspace-independent)", () => {
    expect(configKeys.all()).toEqual(["server-config"]);
  });

  it("builds a query that always fires once the client is mounted", () => {
    const opts = serverConfigOptions();
    expect(opts.queryKey).toEqual(["server-config"]);
    expect(opts.enabled).not.toBe(false);
  });
});

describe("featureFlagEnabled — lookup with safe defaults", () => {
  it("returns the flag value when present", () => {
    expect(featureFlagEnabled({ plugins_v1: true }, "plugins_v1")).toBe(true);
    expect(featureFlagEnabled({ plugins_v1: false }, "plugins_v1")).toBe(false);
  });

  it("falls back to the default when the flag is absent", () => {
    expect(featureFlagEnabled({}, "plugins_v1")).toBe(false);
    expect(featureFlagEnabled({}, "plugins_v1", true)).toBe(true);
  });

  it("treats missing/undefined flags as the default (older server)", () => {
    expect(featureFlagEnabled(undefined, "plugins_v1")).toBe(false);
    expect(featureFlagEnabled(undefined, "plugins_v1", true)).toBe(true);
  });
});
