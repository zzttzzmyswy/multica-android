import { describe, expect, it } from "vitest";
import {
  ConnectVCSResponseSchema,
  EMPTY_LIST_VCS_CONNECTIONS_RESPONSE,
  ListVCSConnectionsResponseSchema,
  VCSConnectionSchema,
} from "./schemas";

const CONNECTION_ROW = {
  id: "vcs-1",
  workspace_id: "ws-1",
  provider: "forgejo",
  instance_url: "https://forgejo.example.com",
  account_login: "octocat",
  webhook_url: "https://api.example.com/api/webhooks/vcs/vcs-1",
  webhook_path: "/api/webhooks/vcs/vcs-1",
  created_at: "2026-08-18T00:00:00Z",
};

describe("VCSConnectionSchema", () => {
  it("parses a stored connection identity", () => {
    const parsed = VCSConnectionSchema.parse(CONNECTION_ROW);
    expect(parsed.id).toBe("vcs-1");
    expect(parsed.provider).toBe("forgejo");
    expect(parsed.instance_url).toBe("https://forgejo.example.com");
    expect(parsed.account_login).toBe("octocat");
    expect(parsed.webhook_path).toBe("/api/webhooks/vcs/vcs-1");
  });

  it("parses a gitea/gitlab provider value verbatim (enum drift tolerance)", () => {
    for (const provider of ["gitea", "gitlab", "gogs"]) {
      expect(VCSConnectionSchema.parse({ ...CONNECTION_ROW, provider }).provider).toBe(
        provider,
      );
    }
  });

  it("defaults missing fields rather than failing", () => {
    const parsed = VCSConnectionSchema.parse({});
    expect(parsed.id).toBe("");
    expect(parsed.instance_url).toBe("");
    expect(parsed.webhook_url).toBe("");
  });

  it("keeps unknown server fields through loose()", () => {
    const parsed = VCSConnectionSchema.parse({ ...CONNECTION_ROW, future_field: 1 });
    expect((parsed as unknown as { future_field: number }).future_field).toBe(1);
  });
});

describe("ListVCSConnectionsResponseSchema", () => {
  it("parses a connections array and passes through the flags", () => {
    const parsed = ListVCSConnectionsResponseSchema.parse({
      connections: [CONNECTION_ROW],
      available: true,
      configured: true,
      can_manage: true,
    });
    expect(parsed.connections).toHaveLength(1);
    expect(parsed.connections[0].provider).toBe("forgejo");
    expect(parsed.available).toBe(true);
    expect(parsed.configured).toBe(true);
    expect(parsed.can_manage).toBe(true);
  });

  it("defaults a missing connections array to [] and flags to undefined", () => {
    // Older backends omit the flags entirely — undefined means "fall back to
    // the caller's default", never a crash.
    const parsed = ListVCSConnectionsResponseSchema.parse({});
    expect(parsed.connections).toEqual([]);
    expect(parsed.available).toBeUndefined();
    expect(parsed.configured).toBeUndefined();
    expect(parsed.can_manage).toBeUndefined();
  });

  it("falls back to the empty response constant when the shape drifts", () => {
    expect(EMPTY_LIST_VCS_CONNECTIONS_RESPONSE.connections).toEqual([]);
    expect(EMPTY_LIST_VCS_CONNECTIONS_RESPONSE.available).toBe(true);
    expect(EMPTY_LIST_VCS_CONNECTIONS_RESPONSE.configured).toBe(false);
    expect(EMPTY_LIST_VCS_CONNECTIONS_RESPONSE.can_manage).toBe(false);
  });
});

describe("ConnectVCSResponseSchema", () => {
  it("parses the one-time webhook secret from a connect/rotate response", () => {
    const parsed = ConnectVCSResponseSchema.safeParse({
      ...CONNECTION_ROW,
      webhook_secret: "plaintext-secret-123",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.webhook_secret).toBe("plaintext-secret-123");
  });

  it("defaults a missing webhook_secret to empty (never crashes)", () => {
    const parsed = ConnectVCSResponseSchema.parse(CONNECTION_ROW);
    expect(parsed.webhook_secret).toBe("");
  });
});