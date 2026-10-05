import { describe, expect, it, vi } from "vitest";
import {
  WRITE_FAILURE_TITLE_KEY,
  reportWriteFailure,
  writeFailureDetail,
  writeFailureTitleKey,
  type WriteFailureAlerter,
} from "./write-failure";

const translate = (id: string) => `t:${id}`;

function mutationWithMeta(meta: Record<string, unknown> | null | undefined) {
  return { options: { meta } };
}

function mutationWithoutOptions() {
  return {};
}

describe("writeFailureTitleKey", () => {
  it("reads the title id off hook-level meta", () => {
    const m = mutationWithMeta({
      [WRITE_FAILURE_TITLE_KEY]: "issueRelation.updateFailed",
    });
    expect(writeFailureTitleKey(m)).toBe("issueRelation.updateFailed");
  });

  it("returns null when the mutation opted out of reporting", () => {
    // Background bookkeeping writes (marking a chat session or an inbox item
    // read) carry no meta on purpose: the user never asked for them and cannot
    // act on a failure, so an alert would be pure noise.
    expect(writeFailureTitleKey(mutationWithMeta({}))).toBeNull();
    expect(writeFailureTitleKey(mutationWithMeta(null))).toBeNull();
    expect(writeFailureTitleKey(mutationWithMeta(undefined))).toBeNull();
  });

  it("returns null for a mutation with no options at all", () => {
    expect(writeFailureTitleKey(mutationWithoutOptions())).toBeNull();
    expect(writeFailureTitleKey(null)).toBeNull();
    expect(writeFailureTitleKey(undefined)).toBeNull();
  });

  it("ignores a non-string or blank title", () => {
    // `String(undefined)` would put the literal "undefined" on screen, so a
    // wrongly-typed meta must read as absent rather than be coerced.
    expect(writeFailureTitleKey(mutationWithMeta({ [WRITE_FAILURE_TITLE_KEY]: 42 })))
      .toBeNull();
    expect(writeFailureTitleKey(mutationWithMeta({ [WRITE_FAILURE_TITLE_KEY]: "" })))
      .toBeNull();
    expect(writeFailureTitleKey(mutationWithMeta({ [WRITE_FAILURE_TITLE_KEY]: "   " })))
      .toBeNull();
    expect(writeFailureTitleKey(mutationWithMeta({ [WRITE_FAILURE_TITLE_KEY]: null })))
      .toBeNull();
  });

  it("trims a padded title", () => {
    const m = mutationWithMeta({ [WRITE_FAILURE_TITLE_KEY]: "  labels.attachFailed  " });
    expect(writeFailureTitleKey(m)).toBe("labels.attachFailed");
  });
});

describe("writeFailureDetail", () => {
  it("prefers the server's own message", () => {
    // The API writes these for users, so they beat any static line.
    expect(writeFailureDetail(new Error("权限不足"))).toBe("权限不足");
  });

  it("returns undefined when the rejection carried no message", () => {
    // `Alert.alert(title, "")` renders a blank line; `undefined` renders the
    // title alone.
    expect(writeFailureDetail(new Error(""))).toBeUndefined();
    expect(writeFailureDetail(new Error("   "))).toBeUndefined();
  });

  it("returns undefined for a non-Error rejection", () => {
    expect(writeFailureDetail("boom")).toBeUndefined();
    expect(writeFailureDetail(undefined)).toBeUndefined();
    expect(writeFailureDetail({ message: "looks like an error" })).toBeUndefined();
  });

  it("trims a padded message", () => {
    expect(writeFailureDetail(new Error("  boom  "))).toBe("boom");
  });
});

describe("reportWriteFailure", () => {
  it("stays silent for a mutation with no title meta", () => {
    // The opt-out must reach the alerter, not just the key lookup.
    const alert = vi.fn<WriteFailureAlerter>();
    reportWriteFailure(new Error("boom"), mutationWithMeta({}), translate, alert);
    expect(alert).not.toHaveBeenCalled();
  });

  it("raises the translated title with the server's message as the body", () => {
    const alert = vi.fn<WriteFailureAlerter>();
    const m = mutationWithMeta({ [WRITE_FAILURE_TITLE_KEY]: "projects.updateFailed" });
    reportWriteFailure(new Error("权限不足"), m, translate, alert);

    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0]?.[0]).toBe("t:projects.updateFailed");
    expect(alert.mock.calls[0]?.[1]).toBe("权限不足");
  });

  it("falls back to no body rather than an empty one", () => {
    const alert = vi.fn<WriteFailureAlerter>();
    const m = mutationWithMeta({ [WRITE_FAILURE_TITLE_KEY]: "common.changeFailed" });
    reportWriteFailure(new Error(""), m, translate, alert);

    expect(alert.mock.calls[0]?.[0]).toBe("t:common.changeFailed");
    expect(alert.mock.calls[0]?.[1]).toBeUndefined();
  });

  it("never raises an empty title", () => {
    const alert = vi.fn<WriteFailureAlerter>();
    const m = mutationWithMeta({ [WRITE_FAILURE_TITLE_KEY]: "labels.attachFailed" });
    reportWriteFailure(undefined, m, translate, alert);

    const [title] = alert.mock.calls[0] ?? [];
    expect(title).toBe("t:labels.attachFailed");
    expect(String(title).length).toBeGreaterThan(0);
  });
});
