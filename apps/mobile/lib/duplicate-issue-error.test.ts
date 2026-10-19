import { describe, expect, it } from "vitest";
import {
  classifyCreateFailure,
  duplicateIssueLine,
  duplicateIssueRoute,
} from "./duplicate-issue-error";
import { duplicateCreatePrompt } from "./create-failure-prompts";

const ISSUE = {
  id: "iss-9",
  identifier: "MYS-2243",
  title: "Inbox rows do not refresh",
};

/** The body the server sends on a duplicate refusal. */
const BODY = {
  code: "active_duplicate_issue",
  error: "an active issue with this title already exists",
  issue: ISSUE,
};

describe("classifyCreateFailure", () => {
  it("recognises the documented 409 body", () => {
    expect(classifyCreateFailure({ status: 409, body: BODY })).toEqual({
      kind: "duplicate",
      issue: ISSUE,
    });
  });

  it("does not treat a non-409 as a duplicate even with the same body", () => {
    // A 400 carrying a `code` field must not open a duplicate prompt.
    expect(classifyCreateFailure({ status: 400, body: BODY })).toEqual({
      kind: "other",
    });
  });

  it("does not treat a 409 with no body as a duplicate", () => {
    expect(classifyCreateFailure({ status: 409, body: undefined })).toEqual({
      kind: "other",
    });
  });

  it("falls back when the server renames the code", () => {
    // The literal is the drift alarm: a renamed code must degrade to the
    // ordinary failure path, never to a prompt with nothing to open.
    expect(
      classifyCreateFailure({
        status: 409,
        body: { ...BODY, code: "duplicate_issue" },
      }),
    ).toEqual({ kind: "other" });
  });

  it("falls back when the embedded issue is missing", () => {
    expect(
      classifyCreateFailure({
        status: 409,
        body: { code: "active_duplicate_issue", error: "nope" },
      }),
    ).toEqual({ kind: "other" });
  });

  it("falls back when the embedded issue is not an object", () => {
    expect(
      classifyCreateFailure({
        status: 409,
        body: { code: "active_duplicate_issue", issue: "MYS-1" },
      }),
    ).toEqual({ kind: "other" });
  });

  it("rejects an EMPTY issue id — a jump target must not be a dead end", () => {
    expect(
      classifyCreateFailure({
        status: 409,
        body: { ...BODY, issue: { ...ISSUE, id: "" } },
      }),
    ).toEqual({ kind: "other" });
  });

  it("rejects an issue with no identifier — the prompt would print nothing", () => {
    expect(
      classifyCreateFailure({
        status: 409,
        body: { ...BODY, issue: { id: "iss-9", title: "x" } },
      }),
    ).toEqual({ kind: "other" });
  });

  it("ignores a null / undefined failure", () => {
    expect(classifyCreateFailure(null)).toEqual({ kind: "other" });
    expect(classifyCreateFailure(undefined)).toEqual({ kind: "other" });
  });

  it("tolerates extra fields the server may add later", () => {
    // `.loose()` in the shared schema: additive server changes must not break
    // the branch (API Response Compatibility rule).
    expect(
      classifyCreateFailure({
        status: 409,
        body: { ...BODY, request_id: "r-1", issue: { ...ISSUE, status: "todo" } },
      }).kind,
    ).toBe("duplicate");
  });

  it("does not throw on a body that is a string or an array", () => {
    expect(classifyCreateFailure({ status: 409, body: "conflict" })).toEqual({
      kind: "other",
    });
    expect(classifyCreateFailure({ status: 409, body: [BODY] })).toEqual({
      kind: "other",
    });
  });
});

describe("duplicateIssueRoute", () => {
  it("builds the workspace-scoped detail path", () => {
    expect(duplicateIssueRoute("acme", "iss-9")).toBe("/acme/issue/iss-9");
  });

  it("returns null without a slug — the routes are /[workspace]/…", () => {
    expect(duplicateIssueRoute(null, "iss-9")).toBeNull();
    expect(duplicateIssueRoute(undefined, "iss-9")).toBeNull();
    expect(duplicateIssueRoute("", "iss-9")).toBeNull();
  });

  it("returns null without an id", () => {
    expect(duplicateIssueRoute("acme", "")).toBeNull();
  });
});

describe("duplicateIssueLine", () => {
  it("matches web's `identifier – title` shape", () => {
    expect(duplicateIssueLine(ISSUE)).toBe(
      "MYS-2243 – Inbox rows do not refresh",
    );
  });

  it("prints the identifier alone when the title is blank", () => {
    expect(duplicateIssueLine({ identifier: "MYS-1", title: "   " })).toBe(
      "MYS-1",
    );
    expect(duplicateIssueLine({ identifier: "MYS-1", title: null })).toBe(
      "MYS-1",
    );
    expect(duplicateIssueLine({ identifier: "MYS-1" })).toBe("MYS-1");
  });
});

describe("duplicateCreatePrompt", () => {
  const t = (key: string) => `t:${key}`;
  const paths: string[] = [];
  const deps = {
    t,
    wsSlug: "acme",
    navigate: (p: string) => paths.push(p),
  };

  it("offers a cancel and a view action", () => {
    const prompt = duplicateCreatePrompt(ISSUE, deps);
    expect(prompt.title).toBe("t:newIssue.duplicateTitle");
    expect(prompt.message).toBe("MYS-2243 – Inbox rows do not refresh");
    expect(prompt.buttons.map((b) => b.text)).toEqual([
      "t:common.cancel",
      "t:newIssue.duplicateView",
    ]);
  });

  it("navigates to the blocking issue when the view button is pressed", () => {
    paths.length = 0;
    const prompt = duplicateCreatePrompt(ISSUE, deps);
    prompt.buttons.find((b) => b.style !== "cancel")?.onPress?.();
    expect(paths).toEqual(["/acme/issue/iss-9"]);
  });

  it("drops the view button when there is no slug to build a path from", () => {
    // A button that cannot navigate is worse than no button: it would either
    // crash or silently do nothing.
    const prompt = duplicateCreatePrompt(ISSUE, { ...deps, wsSlug: null });
    expect(prompt.buttons).toHaveLength(1);
    expect(prompt.buttons[0].text).toBe("t:common.ok");
    expect(prompt.buttons[0].onPress).toBeUndefined();
  });

  it("keeps the message identical in both branches — the fact does not change", () => {
    const withSlug = duplicateCreatePrompt(ISSUE, deps);
    const withoutSlug = duplicateCreatePrompt(ISSUE, { ...deps, wsSlug: null });
    expect(withSlug.message).toBe(withoutSlug.message);
  });
});
