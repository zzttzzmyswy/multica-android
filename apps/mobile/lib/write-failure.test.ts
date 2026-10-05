import { describe, expect, it, vi } from "vitest";
import {
  WRITE_FAILURE_CONFLICT_KEY,
  WRITE_FAILURE_TITLE_KEY,
  isConflictError,
  reportWriteFailure,
  writeFailureConflictKey,
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

describe("a lost update race gets a line that says what to do", () => {
  // Web branches on `err.status === 409` in the saved-view dialog and swaps
  // its generic line for `save_view.toast_conflict` (save-view-dialog.tsx:
  // 625-633). The server's 409 body describes the concurrency race, not a
  // mistake the member can act on, so echoing it is strictly worse.
  const conflictMeta = {
    [WRITE_FAILURE_TITLE_KEY]: "issueViews.saveFailed",
    [WRITE_FAILURE_CONFLICT_KEY]: "issueViews.saveConflict",
  };

  function conflictError(message = "revision mismatch") {
    const err = new Error(message) as Error & { status: number };
    err.status = 409;
    return err;
  }

  it("reads the conflict id off hook-level meta", () => {
    expect(writeFailureConflictKey(mutationWithMeta(conflictMeta))).toBe(
      "issueViews.saveConflict",
    );
  });

  it("treats an absent, blank or non-string conflict id as no substitution", () => {
    expect(writeFailureConflictKey(mutationWithMeta({}))).toBeNull();
    expect(
      writeFailureConflictKey(mutationWithMeta({ [WRITE_FAILURE_CONFLICT_KEY]: "" })),
    ).toBeNull();
    expect(
      writeFailureConflictKey(mutationWithMeta({ [WRITE_FAILURE_CONFLICT_KEY]: 409 })),
    ).toBeNull();
    expect(writeFailureConflictKey(null)).toBeNull();
  });

  it("substitutes the conflict line for a 409 body", () => {
    expect(
      writeFailureDetail(conflictError(), mutationWithMeta(conflictMeta), translate),
    ).toBe("t:issueViews.saveConflict");
  });

  it("still passes the server's own message through on every other status", () => {
    const err = new Error("该视图已被删除") as Error & { status: number };
    err.status = 404;
    expect(
      writeFailureDetail(err, mutationWithMeta(conflictMeta), translate),
    ).toBe("该视图已被删除");
  });

  it("keeps the server message on a 409 when no conflict line is declared", () => {
    // The substitution is opt-in: a write whose 409 has no better phrasing
    // than the API's own must not lose the API's message.
    expect(
      writeFailureDetail(
        conflictError("已经存在同名视图"),
        mutationWithMeta({ [WRITE_FAILURE_TITLE_KEY]: "issueViews.saveFailed" }),
        translate,
      ),
    ).toBe("已经存在同名视图");
  });

  it("detects a conflict by status, without needing ApiError", () => {
    // Duck-typed on `status` so this module stays free of `@/data/api` (which
    // imports the transport) and can keep running in the Node vitest lane.
    expect(isConflictError(conflictError())).toBe(true);
    expect(isConflictError(new Error("nope"))).toBe(false);
    expect(isConflictError(null)).toBe(false);
    expect(isConflictError("409")).toBe(false);
    expect(isConflictError({ status: "409" })).toBe(false);
  });

  it("shows the conflict line, not the raw body, end to end", () => {
    const alert = vi.fn<WriteFailureAlerter>();
    reportWriteFailure(
      conflictError("version conflict: expected 7, got 5"),
      mutationWithMeta(conflictMeta),
      translate,
      alert,
    );

    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0]?.[0]).toBe("t:issueViews.saveFailed");
    expect(alert.mock.calls[0]?.[1]).toBe("t:issueViews.saveConflict");
  });

  it("stays silent on a 409 for a mutation with no title", () => {
    // Opting out of reporting wins over everything: this is the shape a write
    // whose failure the user never asked about would take.
    const alert = vi.fn<WriteFailureAlerter>();
    reportWriteFailure(
      conflictError(),
      mutationWithMeta({ [WRITE_FAILURE_CONFLICT_KEY]: "issueViews.saveConflict" }),
      translate,
      alert,
    );
    expect(alert).not.toHaveBeenCalled();
  });
});
