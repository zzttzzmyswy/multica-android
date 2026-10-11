/**
 * The search panel's route-address helper.
 *
 * `issueId` is the one fact the panel cannot recover on its own: web's palette
 * is a portal over the live route and parses `currentIssueId` out of
 * `pathname`, while mobile's panel is its own modal route whose pathname is
 * always `/search`. So the id travels as a query param, and this is the single
 * place that shape is written.
 */
import { describe, expect, it } from "vitest";
import { searchPath } from "./search-route";

describe("searchPath", () => {
  it("addresses the workspace's search route", () => {
    expect(searchPath("acme")).toBe("/acme/search");
  });

  it("omits the param entirely when no issue is open", () => {
    // Not `?issueId=` with an empty value: the panel gates on the param being
    // present, so an empty string would have to be special-cased there too.
    expect(searchPath("acme", null)).toBe("/acme/search");
    expect(searchPath("acme", undefined)).toBe("/acme/search");
    expect(searchPath("acme", "")).toBe("/acme/search");
  });

  it("carries the issue id when there is one", () => {
    expect(searchPath("acme", "01a12b0b-af30-77d6-961a-036445ec15e4")).toBe(
      "/acme/search?issueId=01a12b0b-af30-77d6-961a-036445ec15e4",
    );
  });

  it("encodes the id, so a value with reserved characters survives", () => {
    // The slug is interpolated raw, as it is by every other route push in the
    // app (`lib/entity-link.ts`, the More popover); the id is the one this
    // helper introduces, so it is the one that carries the encoding.
    expect(searchPath("acme", "a b&c=d")).toBe("/acme/search?issueId=a%20b%26c%3Dd");
  });
});
