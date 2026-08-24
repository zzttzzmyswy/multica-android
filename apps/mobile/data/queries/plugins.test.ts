import { describe, expect, it, vi } from "vitest";

// Data-layer tests must mock `@/data/api` (vitest.config.ts note) so the
// native fetch chain never loads — the query module only calls `api` inside
// the queryFn, which these tests never execute.
vi.mock("@/data/api", () => ({ api: {} }));

import {
  groupCatalogReleases,
  pluginCatalogOptions,
  pluginInstallationsOptions,
  pluginInstallationState,
  pluginKeys,
} from "./plugins";
import type {
  PluginCatalogRelease,
  PluginInstallation,
} from "@multica/core/types";

function makeInstallation(overrides: Partial<PluginInstallation>): PluginInstallation {
  return {
    id: "inst-1",
    plugin_key: "acme",
    display_name: "Acme",
    desired_version: "1.0.0",
    enabled: true,
    desired_generation: 1,
    active_generation: 1,
    lifecycle_status: "healthy",
    publisher: "acme",
    publisher_type: "vendor",
    trust_tier: "trusted",
    source_kind: "bundled",
    source_ref: "catalog",
    manifest_digest: "",
    archive_digest: "",
    artifact_digest: "",
    signature_verified: true,
    requested_capabilities: [],
    available_versions: [],
    contributions: [],
    contribution_details: [],
    bindings: [],
    ...overrides,
  };
}

describe("pluginKeys + query options", () => {
  it("scopes keys and queries under the workspace id", () => {
    expect(pluginKeys.all("ws-1")).toEqual(["plugins", "ws-1"]);
    expect(pluginKeys.catalog("ws-1")).toEqual(["plugins", "ws-1", "catalog"]);
    expect(pluginKeys.installed("ws-1")).toEqual(["plugins", "ws-1", "installed"]);

    expect(pluginCatalogOptions("ws-1").queryKey).toEqual([
      "plugins",
      "ws-1",
      "catalog",
    ]);
    expect(pluginCatalogOptions("ws-1").enabled).toBe(true);
    expect(pluginInstallationsOptions("ws-1").queryKey).toEqual([
      "plugins",
      "ws-1",
      "installed",
    ]);
  });

  it("disables both queries when no workspace is selected", () => {
    expect(pluginCatalogOptions(null).enabled).toBe(false);
    expect(pluginInstallationsOptions(null).enabled).toBe(false);
  });
});

describe("pluginInstallationState — web plugins-tab state mapping", () => {
  it("reports disabled when the installation is not enabled", () => {
    expect(
      pluginInstallationState(makeInstallation({ enabled: false })),
    ).toBe("disabled");
  });

  it("reports activating while the lifecycle is activating", () => {
    expect(
      pluginInstallationState(
        makeInstallation({ lifecycle_status: "activating" }),
      ),
    ).toBe("activating");
  });

  it("reports failed when health or lifecycle is in error", () => {
    expect(
      pluginInstallationState(
        makeInstallation({ health_state: "error" }),
      ),
    ).toBe("failed");
    expect(
      pluginInstallationState(
        makeInstallation({ lifecycle_status: "error" }),
      ),
    ).toBe("failed");
  });

  it("reports degraded when health or lifecycle is degraded", () => {
    expect(
      pluginInstallationState(
        makeInstallation({ health_state: "degraded" }),
      ),
    ).toBe("degraded");
  });

  it("reports healthy otherwise", () => {
    expect(
      pluginInstallationState(makeInstallation({})),
    ).toBe("healthy");
  });
});

describe("groupCatalogReleases", () => {
  function makeRelease(pluginKey: string, version: string): PluginCatalogRelease {
    return {
      plugin_key: pluginKey,
      name: pluginKey,
      description: "",
      version,
      publisher: "acme",
      publisher_type: "vendor",
      trust_tier: "trusted",
      source_kind: "bundled",
      source_ref: "catalog",
      requested_capabilities: [],
      host_api: "v1",
      required_daemon_features: [],
      signature_key_id: "",
      signature_verified: true,
      manifest_digest: "",
      archive_digest: "",
      artifact_digest: "",
      compatible: true,
      contributions: [],
    };
  }

  it("groups releases by plugin_key and sorts versions newest-first", () => {
    const grouped = groupCatalogReleases([
      makeRelease("alpha", "1.0.0"),
      makeRelease("beta", "0.9.0"),
      makeRelease("alpha", "1.2.0"),
      makeRelease("alpha", "1.1.0"),
    ]);
    expect([...grouped.keys()]).toEqual(["alpha", "beta"]);
    expect(grouped.get("alpha")?.map((r) => r.version)).toEqual([
      "1.2.0",
      "1.1.0",
      "1.0.0",
    ]);
    expect(grouped.get("beta")?.map((r) => r.version)).toEqual(["0.9.0"]);
  });

  it("returns an empty map for no releases", () => {
    expect(groupCatalogReleases([]).size).toBe(0);
  });
});