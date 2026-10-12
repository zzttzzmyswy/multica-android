import { describe, expect, it } from "vitest";
import { preprocessMobileMarkdown, stripHtml } from "./preprocess";

const UUID = "019f49e2-5b07-7970-beef-c0d537fb8c1d";
const ABS_URL = `https://multica-app.copilothub.ai/api/attachments/${UUID}/download`;
const REL_URL = `/api/attachments/${UUID}/download`;

describe("preprocessMobileMarkdown — !file file cards", () => {
  it("keeps channel images visible while hiding their provenance marker", () => {
    const image = `![](${REL_URL})`;
    const marker = `<!-- multica:channel-media:${UUID} -->`;

    // The comment marker survives the string-level pass (stripHtml moved to
    // the prose stage; see `stripHtml` describe below) but is removed when
    // the prose island reaches the HTML stripper — mirror of the old
    // whole-document behavior, now scoped.
    const processed = preprocessMobileMarkdown(`${image}\n\n${marker}`);
    expect(processed).toContain(image);
    expect(stripHtml(processed)).toBe(`${image}\n\n`);
  });

  it("matches the CLI's escaped-bracket label and keeps it markdown-safe", () => {
    // CLI emits `a]b.pdf` escaped as `a\]b.pdf` (cmd_attachment.go
    // escapeMarkdownLabel). The old regex stopped at the first `]` and left the
    // line literal; now it is captured whole and re-emitted as a tappable link
    // whose label stays escaped so the `]` doesn't truncate the link text.
    const out = preprocessMobileMarkdown(`!file[a\\]b.pdf](${ABS_URL})`);
    expect(out).toBe(`[📎 a\\]b.pdf](${ABS_URL})`);
  });

  it("unescapes non-breaking metacharacters (parens) in the displayed name", () => {
    // Parens are legal inside a markdown link label, so they are unescaped for
    // display and not re-escaped.
    const out = preprocessMobileMarkdown(`!file[report\\(1\\).pdf](${ABS_URL})`);
    expect(out).toBe(`[📎 report(1).pdf](${ABS_URL})`);
  });

  it("unescapes an escaped backslash in the label", () => {
    const out = preprocessMobileMarkdown(`!file[a\\\\b.pdf](${ABS_URL})`);
    expect(out).toBe(`[📎 a\\\\b.pdf](${ABS_URL})`);
  });

  it("renders a plain (unescaped) label", () => {
    const out = preprocessMobileMarkdown(`!file[notes.txt](${ABS_URL})`);
    expect(out).toBe(`[📎 notes.txt](${ABS_URL})`);
  });

  it("accepts the site-relative /api/attachments URL form (web parity)", () => {
    const out = preprocessMobileMarkdown(`!file[a.pdf](${REL_URL})`);
    expect(out).toBe(`[📎 a.pdf](${REL_URL})`);
  });

  it("leaves a disallowed-scheme URL as plain text (no out-of-band navigation)", () => {
    const line = `!file[x.pdf](javascript:alert(1))`;
    expect(preprocessMobileMarkdown(line)).toBe(line);
  });

  it("does not touch inline images (![...] is not a file card)", () => {
    const line = `![chart.png](${ABS_URL})`;
    expect(preprocessMobileMarkdown(line)).toBe(line);
  });

  it("only transforms the standalone file-card line, leaving surrounding text", () => {
    const input = `here is the file\n\n!file[a\\]b.pdf](${ABS_URL})\n\nlet me know`;
    const output = `here is the file\n\n[📎 a\\]b.pdf](${ABS_URL})\n\nlet me know`;
    expect(preprocessMobileMarkdown(input)).toBe(output);
  });
});

describe("stripHtml — prose-stage HTML stripping", () => {
  it("converts <br> to the CommonMark hard-break two-space newline", () => {
    expect(stripHtml("a<br>b")).toBe("a  \nb");
    expect(stripHtml("a<br/>b")).toBe("a  \nb");
    expect(stripHtml("a<br />b")).toBe("a  \nb");
  });

  it("removes HTML comments (channel-media provenance markers)", () => {
    expect(stripHtml(`x\n\n<!-- multica:channel-media:${UUID} -->`)).toBe(`x\n\n`);
  });

  it("strips tags but keeps their inner text", () => {
    expect(stripHtml("<sub>2</sub>")).toBe("2");
    expect(stripHtml("<p>hello <strong>world</strong></p>")).toBe("hello world");
  });

  it("leaves prose and markdown fences untouched — main deltas stay intact", () => {
    const prose = "A **bold** link [x](https://example.com) `code`";
    expect(stripHtml(prose)).toBe(prose);
  });
});

describe("preprocessMobileMarkdown — in-app entity links (R1)", () => {
  const ORIGIN = "https://mu.zztweb.top";
  const SLUG = "acme";
  const ISSUE_ID = "019f49e2-5b07-7970-beef-c0d537fb8c1d";
  const ISSUE_URL = `${ORIGIN}/${SLUG}/issues/${ISSUE_ID}`;
  const opts = { appOrigin: ORIGIN, currentSlug: SLUG };

  it("rewrites a bare same-deployment issue link into the mention transport", () => {
    // The tap handler already routes mention:// in-app; the browser tab it
    // used to open has no session, so the link landed on a login wall.
    expect(preprocessMobileMarkdown(`[${ISSUE_URL}](${ISSUE_URL})`, opts)).toBe(
      `[${ISSUE_URL}](mention://issue/${ISSUE_ID})`,
    );
  });

  it("rewrites a project link", () => {
    const pid = "019f49e2-5b07-7970-beef-c0d537fb8c1e";
    const url = `${ORIGIN}/${SLUG}/projects/${pid}`;
    expect(preprocessMobileMarkdown(`[${url}](${url})`, opts)).toBe(
      `[${url}](mention://project/${pid})`,
    );
  });

  it("leaves a foreign-origin link alone", () => {
    const url = `https://github.com/o/r/issues/${ISSUE_ID}`;
    expect(preprocessMobileMarkdown(`[${url}](${url})`, opts)).toBe(
      `[${url}](${url})`,
    );
  });

  it("leaves an authored label alone", () => {
    const md = `[the bug](${ISSUE_URL})`;
    expect(preprocessMobileMarkdown(md, opts)).toBe(md);
  });

  it("leaves a cross-workspace link alone", () => {
    const md = `[${ISSUE_URL}](${ISSUE_URL})`;
    expect(
      preprocessMobileMarkdown(md, { appOrigin: ORIGIN, currentSlug: "other" }),
    ).toBe(md);
  });

  it("leaves an identifier link alone — it cannot be routed without a lookup", () => {
    const url = `${ORIGIN}/${SLUG}/issues/MUL-123`;
    expect(preprocessMobileMarkdown(`[${url}](${url})`, opts)).toBe(
      `[${url}](${url})`,
    );
  });

  it("is a no-op when no app origin is configured", () => {
    const md = `[${ISSUE_URL}](${ISSUE_URL})`;
    expect(preprocessMobileMarkdown(md)).toBe(md);
    expect(preprocessMobileMarkdown(md, { appOrigin: "" })).toBe(md);
  });

  it("leaves an image alone", () => {
    const md = `![${ISSUE_URL}](${ISSUE_URL})`;
    expect(preprocessMobileMarkdown(md, opts)).toBe(md);
  });
});

describe("preprocessMobileMarkdown — bare entity URLs (R1, the common case)", () => {
  const ORIGIN = "https://mu.zztweb.top";
  const SLUG = "acme";
  const ISSUE_ID = "019f49e2-5b07-7970-beef-c0d537fb8c1d";
  const ISSUE_URL = `${ORIGIN}/${SLUG}/issues/${ISSUE_ID}`;
  const opts = { appOrigin: ORIGIN, currentSlug: SLUG };

  it("rewrites a pasted bare link — the shape 'Copy link' produces", () => {
    // A bare URL carries no markdown link syntax, so the `[label](url)` pass
    // never sees it. This is what people actually paste, and matching only the
    // bracketed form left it opening the system browser.
    expect(preprocessMobileMarkdown(`see ${ISSUE_URL} for details`, opts)).toBe(
      `see [${ISSUE_URL}](mention://issue/${ISSUE_ID}) for details`,
    );
  });

  it("rewrites a bare link at the end of a line", () => {
    expect(preprocessMobileMarkdown(`details: ${ISSUE_URL}`, opts)).toBe(
      `details: [${ISSUE_URL}](mention://issue/${ISSUE_ID})`,
    );
  });

  it("keeps a trailing full stop out of the link", () => {
    expect(preprocessMobileMarkdown(`see ${ISSUE_URL}.`, opts)).toBe(
      `see [${ISSUE_URL}](mention://issue/${ISSUE_ID}).`,
    );
  });

  it("leaves a bare foreign URL alone", () => {
    const md = "see https://github.com/multica-ai/multica for details";
    expect(preprocessMobileMarkdown(md, opts)).toBe(md);
  });

  it("does not touch the href inside a bracketed link twice", () => {
    // The markdown pass consumes the whole construct; if the bare pass could
    // also see inside it, the result would be a nested/duplicated link.
    expect(preprocessMobileMarkdown(`[x](${ISSUE_URL})`, opts)).toBe(
      `[x](${ISSUE_URL})`,
    );
  });

  it("leaves a bare identifier link alone", () => {
    const url = `${ORIGIN}/${SLUG}/issues/MUL-123`;
    expect(preprocessMobileMarkdown(`see ${url}`, opts)).toBe(`see ${url}`);
  });
});

/**
 * The bare-identifier pass, exercised where it is wired (inside
 * `preprocessMobileMarkdown`) rather than only as a pure function — the ORDER
 * against the entity-link and file-card passes is part of the contract.
 */
describe("preprocessMobileMarkdown — bare issue identifiers", () => {
  const ID = "01a12e65-9ed5-7e40-a2f1-363fdea817bc";
  const resolved = new Map([["MYS-2109", ID]]);
  const opts = { resolvedIdentifiers: resolved };

  it("rewrites a confirmed identifier into a mention link", () => {
    expect(preprocessMobileMarkdown("fixed in MYS-2109 today", opts)).toBe(
      `fixed in [MYS-2109](mention://issue/${ID}) today`,
    );
  });

  it("leaves an unconfirmed identifier exactly as the author typed it", () => {
    // The server 404s an identifier that names no issue, so an unconfirmed
    // rewrite would turn innocuous text into a link to an error page.
    const md = "see MYS-99999 for details";
    expect(preprocessMobileMarkdown(md, opts)).toBe(md);
  });

  it("is OFF unless the caller supplies the resolved set (the editable stance)", () => {
    // Editable paths must never rewrite: the stored markdown would gain an
    // identifier-shaped mention id. Web keeps the same pass off for Tiptap.
    const md = "fixed in MYS-2109 today";
    expect(preprocessMobileMarkdown(md)).toBe(md);
    expect(preprocessMobileMarkdown(md, { resolvedIdentifiers: null })).toBe(md);
    expect(
      preprocessMobileMarkdown(md, { resolvedIdentifiers: new Map() }),
    ).toBe(md);
  });

  it("does not rewrite inside a code fence", () => {
    const md = "```\nMYS-2109\n```";
    expect(preprocessMobileMarkdown(md, opts)).toBe(md);
  });

  it("does not rewrite inside inline code", () => {
    const md = "run `MYS-2109` now";
    expect(preprocessMobileMarkdown(md, opts)).toBe(md);
  });

  it("rewrites identifiers even without an appOrigin (no link pass needed)", () => {
    // The identifier pass is independent of `appOrigin`: it produces a
    // `mention://` link directly, so it works before any server config lands.
    expect(preprocessMobileMarkdown("see MYS-2109", opts)).toBe(
      `see [MYS-2109](mention://issue/${ID})`,
    );
  });

  it("keeps an identifier inside a same-deployment URL unlinked", () => {
    // The URL pass may or may not unfurl this link; either way the identifier
    // inside it must not be rewritten into a nested link.
    const md = "see https://mu.zztweb.top/acme/issues/MUL-123 now";
    const out = preprocessMobileMarkdown(md, opts);
    expect(out).not.toContain("mention://issue/MUL-123");
  });

  it("does not double-rewrite an identifier that is already a mention link", () => {
    const md = `see [MYS-2109](mention://issue/${ID})`;
    expect(preprocessMobileMarkdown(md, opts)).toBe(md);
  });

  it("runs before the file-card pass, so a card line is untouched", () => {
    const md = `!file[a.pdf](/api/attachments/${ID}/download)`;
    const out = preprocessMobileMarkdown(md, opts);
    expect(out).toContain("[📎 a.pdf]");
  });
});
