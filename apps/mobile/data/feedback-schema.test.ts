import { describe, expect, it } from "vitest";
import {
  CreateFeedbackInputSchema,
  CreateFeedbackResponseSchema,
  FEEDBACK_KINDS,
  FeedbackKindSchema,
} from "./schemas";

describe("FeedbackKindSchema (iteration-100)", () => {
  it("exposes the same four kinds as web core/feedback types", () => {
    expect(FEEDBACK_KINDS).toEqual(["bug", "feature", "general", "praise"]);
  });

  it("parses every allowed kind", () => {
    for (const kind of FEEDBACK_KINDS) {
      expect(FeedbackKindSchema.parse(kind)).toBe(kind);
    }
  });

  it("rejects an unknown kind (server collapses to 'other' but clients send only the allow-list)", () => {
    expect(FeedbackKindSchema.safeParse("spam").success).toBe(false);
  });
});

describe("CreateFeedbackInputSchema (iteration-100)", () => {
  it("accepts the minimal body — message only", () => {
    const parsed = CreateFeedbackInputSchema.parse({
      message: "  按按钮没反应  ",
    });
    expect(parsed.message).toBe("  按按钮没反应  ");
  });

  it("passes through url/workspace_id/kind/context", () => {
    const parsed = CreateFeedbackInputSchema.parse({
      message: "dark mode 下对比度不足",
      url: "https://mu.zztweb.top/x/inbox",
      workspace_id: "ws-1",
      kind: "feature",
      context: { kind: "desktop_route_error", trigger: "/x", error: {} },
    });
    expect(parsed.workspace_id).toBe("ws-1");
    expect(parsed.kind).toBe("feature");
    expect(parsed.context).toEqual({
      kind: "desktop_route_error",
      trigger: "/x",
      error: {},
    });
  });

  it("omits optional fields when absent (serialization wins — no undefined keys)", () => {
    const parsed = CreateFeedbackInputSchema.parse({ message: "hi" });
    expect(parsed.url).toBeUndefined();
    expect(parsed.kind).toBeUndefined();
  });

  it("is loose — tolerates a server drift field", () => {
    const parsed = CreateFeedbackInputSchema.parse({
      message: "hi",
      unexpected: 42,
    });
    expect(parsed.message).toBe("hi");
  });

  it("rejects a missing message", () => {
    expect(CreateFeedbackInputSchema.safeParse({ kind: "bug" }).success).toBe(
      false,
    );
  });
});

describe("CreateFeedbackResponseSchema (iteration-100)", () => {
  it("parses a 201 created response", () => {
    const parsed = CreateFeedbackResponseSchema.parse({
      id: "fb-1",
      created_at: "2026-08-24T12:00:00Z",
    });
    expect(parsed).toEqual({ id: "fb-1", created_at: "2026-08-24T12:00:00Z" });
  });

  it("defaults a drift/missing body to empty strings instead of crashing", () => {
    const parsed = CreateFeedbackResponseSchema.parse({});
    expect(parsed).toEqual({ id: "", created_at: "" });
  });
});