import { describe, expect, it } from "vitest";
import {
  CloudRuntimeNodeSchema,
  RuntimeProfileSchema,
  RuntimeSchema,
} from "./schemas";

describe("RuntimeSchema runtime-management fields (iteration-51)", () => {
  it("parses custom_name and profile_id when the backend sends them", () => {
    const parsed = RuntimeSchema.parse({
      id: "r1",
      workspace_id: "ws1",
      name: "claude-code@host",
      runtime_mode: "local",
      provider: "claude",
      custom_name: "我的机器",
      profile_id: "prof-1",
      owner_id: "u-1",
      visibility: "public",
      status: "online",
      last_seen_at: null,
      device_info: "host · 2.1.121",
      metadata: {},
      created_at: "2026-08-01T00:00:00Z",
      updated_at: "2026-08-01T00:00:00Z",
    });
    expect(parsed.custom_name).toBe("我的机器");
    expect(parsed.profile_id).toBe("prof-1");
    expect(parsed.owner_id).toBe("u-1");
  });

  it("defaults missing custom_name/profile_id to null (older backend, built-in semantics)", () => {
    const parsed = RuntimeSchema.parse({ id: "r1" });
    expect(parsed.custom_name).toBeNull();
    expect(parsed.profile_id).toBeNull();
  });

  it("parses a nullable custom_name of null without treating it as a change", () => {
    const parsed = RuntimeSchema.parse({
      id: "r1",
      custom_name: null,
      profile_id: null,
    });
    expect(parsed.custom_name).toBeNull();
    expect(parsed.profile_id).toBeNull();
  });

  it("treats an empty custom_name string as a set value (declared clear, MUL-4217)", () => {
    const parsed = RuntimeSchema.parse({ id: "r1", custom_name: "" });
    expect(parsed.custom_name).toBe("");
  });
});

describe("CloudRuntimeNodeSchema (iteration-82)", () => {
  it("parses a fleet node row", () => {
    const parsed = CloudRuntimeNodeSchema.parse({
      id: "node-1",
      owner_id: "u-1",
      instance_id: "i-1",
      region: "ap-east-1",
      instance_type: "t4g.medium",
      image_id: "ami-1",
      subnet_id: "subnet-1",
      name: "cloud-dev-01",
      status: "launching",
      tags: { role: "dev" },
      metadata: {},
      created_at: "2026-08-20T10:00:00Z",
      updated_at: "2026-08-20T10:00:00Z",
    });
    expect(parsed).toMatchObject({
      id: "node-1",
      instance_type: "t4g.medium",
      status: "launching",
      tags: { role: "dev" },
    });
  });

  it("defaults a lean row so the dialog renders an unknown-status node", () => {
    const parsed = CloudRuntimeNodeSchema.parse({});
    expect(parsed.id).toBe("");
    expect(parsed.status).toBe("unknown");
    expect(parsed.tags).toEqual({});
    expect(parsed.region).toBe("");
  });
});

describe("RuntimeProfileSchema (iteration-82)", () => {
  it("parses a custom profile row", () => {
    const parsed = RuntimeProfileSchema.parse({
      id: "prof-1",
      workspace_id: "ws-1",
      display_name: "Team Codex",
      protocol_family: "codex",
      command_name: "codex",
      description: "runs codex",
      fixed_args: ["--model", "composer-2.5"],
      visibility: "workspace",
      created_by: "u-1",
      enabled: true,
      created_at: "2026-08-01T00:00:00Z",
      updated_at: "2026-08-01T00:00:00Z",
    });
    expect(parsed).toMatchObject({
      id: "prof-1",
      display_name: "Team Codex",
      protocol_family: "codex",
      fixed_args: ["--model", "composer-2.5"],
      enabled: true,
    });
  });

  it("defaults missing optional fields for an older backend", () => {
    const parsed = RuntimeProfileSchema.parse({ id: "prof-1" });
    expect(parsed.description).toBeNull();
    expect(parsed.visibility).toBe("workspace");
    expect(parsed.enabled).toBe(true);
    expect(parsed.fixed_args).toEqual([]);
  });

  it("accepts a future protocol family without dropping the row", () => {
    const parsed = RuntimeProfileSchema.parse({
      id: "prof-1",
      protocol_family: "future-family",
      display_name: "X",
    });
    expect(parsed.protocol_family).toBe("future-family");
  });
});