import { describe, expect, it } from "vitest";
import {
  WorkspaceMcpServerListSchema,
  WorkspaceMcpServerSchema,
} from "./schemas";

describe("WorkspaceMcpServerSchema", () => {
  it("parses a library entry with identity + transport, no enabled", () => {
    const parsed = WorkspaceMcpServerSchema.parse({
      id: "mcp-1",
      workspace_id: "ws-1",
      name: "docs",
      transport: "http",
      created_at: "2026-08-16T00:00:00Z",
      updated_at: "2026-08-16T00:00:00Z",
    });
    expect(parsed.id).toBe("mcp-1");
    expect(parsed.name).toBe("docs");
    expect(parsed.transport).toBe("http");
    // library listing has no per-binding toggle
    expect(parsed.enabled).toBeUndefined();
  });

  it("parses an agent-assignment entry carrying the enabled toggle", () => {
    const parsed = WorkspaceMcpServerSchema.parse({
      id: "mcp-1",
      workspace_id: "ws-1",
      name: "docs",
      transport: "stdio",
      enabled: false,
      created_at: "2026-08-16T00:00:00Z",
      updated_at: "2026-08-16T00:00:00Z",
    });
    expect(parsed.enabled).toBe(false);
  });

  it("keeps an unknown transport string verbatim (drift tolerance)", () => {
    const parsed = WorkspaceMcpServerSchema.parse({
      id: "mcp-2",
      workspace_id: "ws-1",
      name: "older",
      transport: "sse",
      created_at: "",
      updated_at: "",
    });
    expect(parsed.transport).toBe("sse");
  });

  it("defaults missing timestamps rather than failing", () => {
    const parsed = WorkspaceMcpServerSchema.parse({ id: "mcp-1", name: "docs" });
    expect(parsed.transport).toBe("unknown");
    expect(parsed.created_at).toBe("");
  });
});

describe("WorkspaceMcpServerListSchema", () => {
  it("parses a server array and defaults a missing one to []", () => {
    const parsed = WorkspaceMcpServerListSchema.parse([
      { id: "a", name: "one", transport: "stdio", created_at: "", updated_at: "" },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("one");
    expect(WorkspaceMcpServerListSchema.parse(undefined)).toEqual([]);
  });
});