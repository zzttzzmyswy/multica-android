import { describe, expect, it } from "vitest";
import {
  COMMENT_PREVIEW_LENGTH,
  commentPreview,
  isCommentCollapsed,
  normalizeCollapsedComments,
  toggleCollapsedComment,
} from "./comment-collapse";

describe("toggleCollapsedComment", () => {
  it("adds an id that is not folded, preserving order", () => {
    expect(toggleCollapsedComment(["a"], "b")).toEqual(["a", "b"]);
  });

  it("removes an id that is already folded", () => {
    expect(toggleCollapsedComment(["a", "b"], "a")).toEqual(["b"]);
  });

  it("folds an id into an empty list", () => {
    expect(toggleCollapsedComment([], "c1")).toEqual(["c1"]);
  });

  it("never mutates the input list", () => {
    const list = ["a"];
    toggleCollapsedComment(list, "b");
    expect(list).toEqual(["a"]);
  });
});

describe("isCommentCollapsed", () => {
  it("reads an absent list as nothing folded", () => {
    expect(isCommentCollapsed(undefined, "c1")).toBe(false);
  });

  it("finds a folded id and ignores the others", () => {
    expect(isCommentCollapsed(["c1"], "c1")).toBe(true);
    expect(isCommentCollapsed(["c1"], "c2")).toBe(false);
  });
});

describe("normalizeCollapsedComments", () => {
  it("reads non-object input as nothing folded", () => {
    expect(normalizeCollapsedComments(null)).toEqual({});
    expect(normalizeCollapsedComments("nope")).toEqual({});
    expect(normalizeCollapsedComments(["c1"])).toEqual({});
  });

  it("drops non-string and empty ids, dedupes, keeps order", () => {
    expect(
      normalizeCollapsedComments({ "issue-1": ["c2", "c1", "c2", 7, "", null] }),
    ).toEqual({ "issue-1": ["c2", "c1"] });
  });

  it("drops an issue whose list normalizes to nothing", () => {
    expect(normalizeCollapsedComments({ "issue-1": [], "issue-2": "x" })).toEqual(
      {},
    );
  });

  it("keeps several issues apart", () => {
    expect(
      normalizeCollapsedComments({ "issue-1": ["c1"], "issue-2": ["c9"] }),
    ).toEqual({ "issue-1": ["c1"], "issue-2": ["c9"] });
  });
});

describe("commentPreview", () => {
  it("flattens newlines and runs of whitespace to single spaces", () => {
    expect(commentPreview("line one\n\nline two")).toBe("line one line two");
  });

  it("trims the ends", () => {
    expect(commentPreview("  padded  ")).toBe("padded");
  });

  it("clips to the limit without an ellipsis", () => {
    const long = "x".repeat(COMMENT_PREVIEW_LENGTH + 20);
    expect(commentPreview(long)).toHaveLength(COMMENT_PREVIEW_LENGTH);
  });

  it("keeps a body shorter than the limit intact", () => {
    expect(commentPreview("short")).toBe("short");
  });

  it("reads null/undefined as an empty preview", () => {
    expect(commentPreview(null)).toBe("");
    expect(commentPreview(undefined)).toBe("");
  });

  it("honours an explicit limit", () => {
    expect(commentPreview("abcdef", 3)).toBe("abc");
  });
});
