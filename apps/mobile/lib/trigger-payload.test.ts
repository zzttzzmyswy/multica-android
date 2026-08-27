import { describe, expect, it } from "vitest";
import {
  parseTriggerPayload,
  TRIGGER_PAYLOAD_TRUNCATE_AT,
} from "./trigger-payload";

// Iteration-111 web alignment: WebhookPayloadPreview (web
// packages/views/autopilots/components/webhook-payload-preview.tsx) extracts
// a WebhookEnvelope's event/eventPayload/request.receivedAt/request.contentType
// and falls back to showing the whole payload when it doesn't match the
// envelope shape. The mobile parseTriggerPayload mirrors that contract so the
// RN preview renders identically.
const envelope = (
  event: string,
  eventPayload: unknown,
  extras: Record<string, unknown> = {},
) => ({
  event,
  eventPayload,
  request: {
    receivedAt: "2026-05-13T12:34:56Z",
    contentType: "application/json",
    ...extras,
  },
});

describe("parseTriggerPayload", () => {
  it("extracts envelope fields from a well-formed WebhookEnvelope", () => {
    const view = parseTriggerPayload(
      envelope("github.pull_request.opened", { number: 1 }),
    );
    expect(view.event).toBe("github.pull_request.opened");
    expect(view.receivedAt).toBe("2026-05-13T12:34:56Z");
    expect(view.contentType).toBe("application/json");
    expect(view.fullJSON).toBe(
      JSON.stringify({ number: 1 }, null, 2),
    );
    expect(view.isTruncated).toBe(false);
    expect(view.displayJSON).toBe(view.fullJSON);
  });

  it("falls back to the whole payload when it is not an envelope", () => {
    const view = parseTriggerPayload({ hello: "world" });
    expect(view.event).toBeNull();
    expect(view.fullJSON).toBe(JSON.stringify({ hello: "world" }, null, 2));
    expect(view.isTruncated).toBe(false);
  });

  it("falls back when the envelope has a null eventPayload", () => {
    const view = parseTriggerPayload(envelope("demo.null", null));
    // eventPayload === null → the whole envelope becomes the payload so
    // nothing is hidden (mirrors web).
    expect(view.event).toBe("demo.null");
    expect(view.fullJSON).toContain('"eventPayload": null');
  });

  it("treats arrays and scalars as a raw payload", () => {
    const list = parseTriggerPayload(["a", "b"]);
    expect(list.event).toBeNull();
    expect(list.fullJSON).toBe(JSON.stringify(["a", "b"], null, 2));
    expect(list.isTruncated).toBe(false);

    const scalar = parseTriggerPayload("plain string");
    expect(scalar.fullJSON).toBe(JSON.stringify("plain string"));
  });

  it("renders null payload as the literal JSON null", () => {
    const view = parseTriggerPayload(null);
    expect(view.event).toBeNull();
    expect(view.fullJSON).toBe("null");
    expect(view.isTruncated).toBe(false);
  });

  it("renders undefined payload as the literal JSON null (web behavior)", () => {
    const view = parseTriggerPayload(undefined);
    expect(view.event).toBeNull();
    // Web keeps the local eventPayload at its null sentinel for a missing
    // payload, so stringify yields "null".
    expect(view.fullJSON).toBe("null");
    expect(view.isTruncated).toBe(false);
  });

  it("renders an envelope eventPayload of undefined as an empty string", () => {
    // `"eventPayload" in obj` matches but the value is undefined; JSON.stringify
    // returns undefined, which the view model defensively normalizes to "".
    const view = parseTriggerPayload({ event: "demo.hole", eventPayload: undefined });
    expect(view.event).toBe("demo.hole");
    expect(view.fullJSON).toBe("");
    expect(view.isTruncated).toBe(false);
  });

  it("drops non-string event and non-object request fields", () => {
    const view = parseTriggerPayload({
      event: 42,
      eventPayload: { ok: true },
      request: "nope",
    });
    expect(view.event).toBeNull();
    expect(view.receivedAt).toBeNull();
    expect(view.contentType).toBeNull();
    expect(view.fullJSON).toBe(JSON.stringify({ ok: true }, null, 2));
  });

  it("truncates the display when payload exceeds 4 KiB but keeps full text", () => {
    const big = envelope("demo.big", { blob: "x".repeat(5 * 1024) });
    const view = parseTriggerPayload(big);
    expect(view.isTruncated).toBe(true);
    expect(view.displayJSON.length).toBeLessThanOrEqual(
      TRIGGER_PAYLOAD_TRUNCATE_AT,
    );
    expect(view.displayJSON.length).toBeLessThan(5 * 1024);
    expect(view.fullJSON.length).toBeGreaterThan(5 * 1024);
    expect(view.fullJSON).toContain("xxxxx");
  });
});
