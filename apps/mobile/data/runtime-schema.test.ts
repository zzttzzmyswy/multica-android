import { describe, expect, it } from "vitest";
import { RuntimeSchema } from "./schemas";

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