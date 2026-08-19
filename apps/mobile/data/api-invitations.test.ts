import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ApiClient pulls in native modules at module scope; the Node vitest lane
// stubs them so the import chain resolves. Same stub chain as
// api-failures.test.ts. `api` is brought in via dynamic import (below)
// because static ESM imports are hoisted.
process.env.EXPO_PUBLIC_API_URL = "https://api.test";

vi.mock("expo-file-system", () => ({
  File: class {
    uri = "file:///mock";
    exists = false;
  },
  Paths: { document: { uri: "file:///doc" } },
}));

vi.mock("expo-file-system/legacy", () => ({
  createDownloadResumable: vi.fn(),
}));

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

type ApiClient = typeof import("./api").api;
let api: ApiClient;

const fetchSpy = () =>
  vi.spyOn(api as unknown as { fetch: () => Promise<unknown> }, "fetch");

beforeAll(async () => {
  ({ api } = await import("./api"));
});

beforeEach(() => {
  vi.restoreAllMocks();
});

const INVITATION_ROW = {
  id: "inv-1",
  workspace_id: "ws-1",
  inviter_id: "user-1",
  invitee_email: "invitee@example.com",
  invitee_user_id: null,
  role: "admin",
  status: "pending",
  created_at: "2026-08-17T00:00:00Z",
  updated_at: "2026-08-17T00:00:00Z",
  expires_at: "2026-08-24T00:00:00Z",
  inviter_name: "Ada",
  workspace_name: "Acme",
};

const MEMBER_ROW = {
  id: "mem-1",
  workspace_id: "ws-1",
  user_id: "user-1",
  role: "admin",
  created_at: "2026-08-17T00:00:00Z",
  name: "Ada",
  email: "ada@example.com",
  avatar_url: null,
};

describe("invitation api methods (invitee side)", () => {
  it("listMyInvitations GETs /api/invitations and parses the list", async () => {
    const spy = fetchSpy().mockResolvedValue([INVITATION_ROW]);
    const res = await api.listMyInvitations();
    expect(spy).toHaveBeenCalledWith(
      "/api/invitations",
      expect.objectContaining({ signal: undefined }),
    );
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({
      id: "inv-1",
      workspace_name: "Acme",
      role: "admin",
    });
  });

  it("listMyInvitations honours the abort signal", async () => {
    const spy = fetchSpy().mockResolvedValue([]);
    await api.listMyInvitations({ signal: undefined });
    expect(spy).toHaveBeenCalledWith(
      "/api/invitations",
      expect.objectContaining({ signal: undefined }),
    );
  });

  it("listMyInvitations degrades a drift response to []", async () => {
    fetchSpy().mockResolvedValue({ not: "a list" });
    const res = await api.listMyInvitations();
    expect(res).toEqual([]);
  });

  it("getInvitation GETs /api/invitations/:id and parses the invitation", async () => {
    const spy = fetchSpy().mockResolvedValue(INVITATION_ROW);
    const res = await api.getInvitation("inv-1");
    expect(spy).toHaveBeenCalledWith(
      "/api/invitations/inv-1",
      expect.objectContaining({ signal: undefined }),
    );
    expect(res).toMatchObject({
      id: "inv-1",
      workspace_name: "Acme",
      status: "pending",
    });
  });

  it("getInvitation degrades a drift response to the empty fallback", async () => {
    fetchSpy().mockResolvedValue(null);
    const res = await api.getInvitation("inv-1");
    expect(res).toMatchObject({ id: "", status: "pending" });
  });

  it("acceptInvitation POSTs /api/invitations/:id/accept and returns the member", async () => {
    const spy = fetchSpy().mockResolvedValue(MEMBER_ROW);
    const res = await api.acceptInvitation("inv-1");
    expect(spy).toHaveBeenCalledWith(
      "/api/invitations/inv-1/accept",
      expect.objectContaining({ method: "POST" }),
    );
    expect(res).toMatchObject({ id: "mem-1", workspace_id: "ws-1", role: "admin" });
  });

  it("declineInvitation POSTs /api/invitations/:id/decline", async () => {
    const spy = fetchSpy().mockResolvedValue(undefined);
    await api.declineInvitation("inv-1");
    expect(spy).toHaveBeenCalledWith(
      "/api/invitations/inv-1/decline",
      expect.objectContaining({ method: "POST" }),
    );
  });
});