import { describe, expect, it } from "vitest";
import {
  entityRoutePath,
  isIssueIdentifier,
  parseUnfurlableEntityLink,
  parseWorkspaceEntityLink,
} from "@/lib/entity-link";

/**
 * In-app entity links (iteration 173, R1).
 *
 * The behaviour being ported from web (`packages/views/editor/utils/
 * link-handler.ts:197`, `rich-content.tsx:193`): a link to an issue or project
 * ON THIS DEPLOYMENT is the same destination as a mention chip, and must
 * navigate in-app instead of being handed to the system browser — where, on a
 * phone, there is no session and the user lands on a login wall.
 *
 * The load-bearing half is the NEGATIVE cases. A parser that is too eager
 * silently re-routes links that genuinely point somewhere else, which is worse
 * than not having the feature: the user's link stops working and nothing says
 * why.
 */
const ORIGIN = "https://mu.zztweb.top";
const SLUG = "acme";
const ISSUE_ID = "019f49e2-5b07-7970-beef-c0d537fb8c1d";
const PROJECT_ID = "019f49e2-5b07-7970-beef-c0d537fb8c1e";

const parse = (href: string) => parseWorkspaceEntityLink(href, ORIGIN);

describe("parseWorkspaceEntityLink — hits", () => {
  it("resolves an absolute URL on this deployment", () => {
    expect(parse(`${ORIGIN}/${SLUG}/issues/${ISSUE_ID}`)).toEqual({
      kind: "issue",
      id: ISSUE_ID,
      slug: SLUG,
    });
  });

  it("resolves a site-relative path", () => {
    expect(parse(`/${SLUG}/issues/${ISSUE_ID}`)).toEqual({
      kind: "issue",
      id: ISSUE_ID,
      slug: SLUG,
    });
  });

  it("resolves a slug-less legacy path as current-workspace", () => {
    expect(parse(`/issues/${ISSUE_ID}`)).toEqual({
      kind: "issue",
      id: ISSUE_ID,
      slug: null,
    });
  });

  it("resolves projects, singular and plural", () => {
    expect(parse(`${ORIGIN}/${SLUG}/projects/${PROJECT_ID}`)?.kind).toBe(
      "project",
    );
    expect(parse(`${ORIGIN}/${SLUG}/project/${PROJECT_ID}`)?.kind).toBe(
      "project",
    );
  });

  it("carries an identifier-form issue id through as a candidate", () => {
    expect(parse(`${ORIGIN}/${SLUG}/issues/MUL-123`)).toEqual({
      kind: "issue",
      id: "MUL-123",
      slug: SLUG,
    });
  });
});

describe("parseWorkspaceEntityLink — misses", () => {
  it("rejects a foreign origin", () => {
    expect(parse(`https://evil.example/${SLUG}/issues/${ISSUE_ID}`)).toBeNull();
  });

  it("rejects a protocol-relative host that LOOKS like a path", () => {
    // `//host/x` starts with a slash and names another host — the whole reason
    // this resolves through a URL parse instead of a prefix test.
    expect(parse(`//evil.example/${SLUG}/issues/${ISSUE_ID}`)).toBeNull();
  });

  it("rejects a backslash-obfuscated host", () => {
    expect(parse(`/\\evil.example/${SLUG}/issues/${ISSUE_ID}`)).toBeNull();
  });

  it("rejects non-http schemes", () => {
    expect(parse(`javascript:alert(1)`)).toBeNull();
    expect(parse(`data:text/html,<b>x</b>`)).toBeNull();
  });

  it("rejects a query string or fragment", () => {
    // `?view=` addresses a saved view and `#comment-3` a comment; collapsing
    // either to the issue page would drop what the author linked to.
    expect(parse(`${ORIGIN}/${SLUG}/issues/${ISSUE_ID}?view=v1`)).toBeNull();
    expect(parse(`${ORIGIN}/${SLUG}/issues/${ISSUE_ID}#comment-3`)).toBeNull();
  });

  it("rejects list and deeper routes", () => {
    expect(parse(`${ORIGIN}/${SLUG}/issues`)).toBeNull();
    expect(parse(`${ORIGIN}/${SLUG}/issues/${ISSUE_ID}/comments`)).toBeNull();
    expect(parse(`${ORIGIN}/${SLUG}`)).toBeNull();
  });

  it("rejects a reserved first segment used as a slug", () => {
    expect(parse(`${ORIGIN}/api/issues/${ISSUE_ID}`)).toBeNull();
  });

  it("rejects a non-entity id", () => {
    expect(parse(`${ORIGIN}/${SLUG}/issues/not-an-id`)).toBeNull();
    expect(parse(`${ORIGIN}/${SLUG}/projects/MUL-1`)).toBeNull();
  });

  it("rejects everything when the app origin is unknown", () => {
    // Failing closed: a link we cannot PROVE is ours keeps the external
    // behaviour it has always had.
    expect(parseWorkspaceEntityLink(`/${SLUG}/issues/${ISSUE_ID}`, null)).toBeNull();
    expect(parseWorkspaceEntityLink(`/${SLUG}/issues/${ISSUE_ID}`, "")).toBeNull();
  });
});

describe("parseUnfurlableEntityLink", () => {
  const href = `${ORIGIN}/${SLUG}/issues/${ISSUE_ID}`;

  it("unfurls a bare link whose label is the href", () => {
    expect(
      parseUnfurlableEntityLink({
        href,
        label: href,
        currentSlug: SLUG,
        appOrigin: ORIGIN,
      })?.id,
    ).toBe(ISSUE_ID);
  });

  it("keeps an authored label", () => {
    // `[see this issue](url)` is prose the author wrote; a chip would discard
    // the label they chose.
    expect(
      parseUnfurlableEntityLink({
        href,
        label: "see this issue",
        currentSlug: SLUG,
        appOrigin: ORIGIN,
      }),
    ).toBeNull();
  });

  it("refuses a link naming another workspace", () => {
    // A chip resolves its title against the CURRENT workspace, so a
    // cross-workspace link would become a permanently empty chip.
    expect(
      parseUnfurlableEntityLink({
        href,
        label: href,
        currentSlug: "other",
        appOrigin: ORIGIN,
      }),
    ).toBeNull();
  });

  it("accepts the slug-less form in any workspace", () => {
    expect(
      parseUnfurlableEntityLink({
        href: `/issues/${ISSUE_ID}`,
        label: `/issues/${ISSUE_ID}`,
        currentSlug: "other",
        appOrigin: ORIGIN,
      })?.slug,
    ).toBeNull();
  });
});

describe("entityRoutePath", () => {
  it("routes a UUID issue", () => {
    expect(
      entityRoutePath({ kind: "issue", id: ISSUE_ID, slug: SLUG }, SLUG),
    ).toBe(`/${SLUG}/issue/${ISSUE_ID}`);
  });

  it("routes a project", () => {
    expect(
      entityRoutePath({ kind: "project", id: PROJECT_ID, slug: SLUG }, SLUG),
    ).toBe(`/${SLUG}/project/${PROJECT_ID}`);
  });

  it("declines an identifier, which still needs a lookup", () => {
    expect(
      entityRoutePath({ kind: "issue", id: "MUL-123", slug: SLUG }, SLUG),
    ).toBeNull();
  });
});

describe("isIssueIdentifier", () => {
  it("matches the identifier shape and not a UUID", () => {
    expect(isIssueIdentifier("MUL-123")).toBe(true);
    expect(isIssueIdentifier(ISSUE_ID)).toBe(false);
    expect(isIssueIdentifier("mul-123")).toBe(false);
  });
});
