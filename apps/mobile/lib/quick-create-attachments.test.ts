import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  addUploadedAttachmentId,
  attachmentIdsPayload,
  canSubmitQuickCreate,
} from "./quick-create-attachments";

/**
 * Attachment support for the agent-mode quick-create panel (iteration 245).
 *
 * Before this iteration mobile's agent tab — the SAME modal as the manual tab,
 * one segmented control apart — had no way to hand a file to the agent, while
 * the manual tab could. The endpoint has always accepted `attachment_ids`
 * (`QuickCreateIssueRequest`) and the daemon receives them on the task, so the
 * gap was pure client-side wiring. These tests pin the three decisions whose
 * regression silently loses the user's file.
 */

/**
 * Source with comments removed, so an assertion can never be satisfied by a
 * comment that merely DESCRIBES the wiring.
 *
 * A scanner rather than the two-regex strip the other wiring tests use: those
 * substitute block comments first, and `new-issue.tsx` contains
 * `new-issue-picker/* formSheet` inside a `//` comment — a stray `/*` that
 * makes the naive pattern swallow 9 KB of real code, after which every
 * assertion on this file would pass or fail for the wrong reason. Quotes are
 * skipped too, so a `//` in a URL is not mistaken for a comment.
 */
function code(rel: string): string {
  const src = readFileSync(path.resolve(__dirname, "..", rel), "utf8");
  let out = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '"' || ch === "'" || ch === "`") {
      out += ch;
      i++;
      while (i < src.length && src[i] !== ch) {
        if (src[i] === "\\") {
          out += src[i];
          i++;
        }
        if (i < src.length) out += src[i];
        i++;
      }
      if (i < src.length) {
        out += src[i];
        i++;
      }
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

const PANEL = "components/issue/quick-create-panel.tsx";
const NEW_ISSUE = "app/(app)/[workspace]/new-issue.tsx";

describe("addUploadedAttachmentId", () => {
  it("appends a new id in upload order", () => {
    expect(addUploadedAttachmentId([], "a")).toEqual(["a"]);
    expect(addUploadedAttachmentId(["a"], "b")).toEqual(["a", "b"]);
  });

  it("ignores an id it already holds", () => {
    // A second callback for ONE upload must not put the same id in the payload
    // twice — the server parses this list as UUIDs and would validate it twice.
    const ids = ["a", "b"];
    expect(addUploadedAttachmentId(ids, "a")).toBe(ids);
  });

  it("keeps a genuinely re-uploaded file (different id)", () => {
    expect(addUploadedAttachmentId(["a"], "a2")).toEqual(["a", "a2"]);
  });
});

describe("attachmentIdsPayload", () => {
  it("omits the field entirely when nothing was uploaded", () => {
    // Not `{ attachment_ids: [] }`: the no-attachment request must stay
    // byte-identical to the one this path sent before attachments existed.
    expect(attachmentIdsPayload([])).toEqual({});
    expect("attachment_ids" in attachmentIdsPayload([])).toBe(false);
  });

  it("carries every collected id when there are some", () => {
    expect(attachmentIdsPayload(["a", "b"])).toEqual({
      attachment_ids: ["a", "b"],
    });
  });
});

describe("canSubmitQuickCreate", () => {
  const base = {
    prompt: "按这张截图改一下空状态",
    hasActor: true,
    submitting: false,
    uploadsPending: false,
  };

  it("allows a ready submit", () => {
    expect(canSubmitQuickCreate(base)).toBe(true);
  });

  it("holds submit while an attachment is still uploading", () => {
    // The file was picked but has no server id yet; submitting now drops it.
    expect(canSubmitQuickCreate({ ...base, uploadsPending: true })).toBe(false);
  });

  it("holds submit without an actor, blank prompt, or during a submit", () => {
    expect(canSubmitQuickCreate({ ...base, hasActor: false })).toBe(false);
    expect(canSubmitQuickCreate({ ...base, prompt: "   " })).toBe(false);
    expect(canSubmitQuickCreate({ ...base, submitting: true })).toBe(false);
  });
});

/**
 * Wiring. Mobile's vitest lane is Node-only (`vitest.config.ts`), so these are
 * asserted against source — the convention this repo already uses for wiring
 * (`run-confirm-wiring.test.ts`, `picker-name-search-wiring.test.ts`).
 * Comments are stripped first, so a comment describing the wiring cannot
 * satisfy an assertion.
 */
describe("agent mode is wired to carry attachments", () => {
  const panel = code(PANEL);
  const screen = code(NEW_ISSUE);

  it("the agent prompt is a rich field with an upload toolbar, not a bare input", () => {
    expect(panel).toContain("<DescriptionField");
    // The bare TextInput is what made the panel attachment-less.
    expect(panel).not.toContain("<TextInput");
  });

  it("the panel reports uploads and the in-flight flag to the screen", () => {
    expect(panel).toContain("onAttachmentUploaded");
    expect(panel).toContain("onUploadingChange");
  });

  it("the panel's @ button and suggestion bar are live, not a decorative toolbar", () => {
    // `DescriptionField` renders the toolbar's `@` button unconditionally, so a
    // panel that mounts the field but never surfaces the bar ships a button
    // that silently does nothing. The bar is rendered by the SCREEN — it has to
    // float above the keyboard, outside the scroll view — for whichever body is
    // active, so agent mode must be one of the two branches.
    expect(panel).toContain("<DescriptionField");
    expect(screen).toMatch(
      /mode === "manual"[\s\S]{0,200}description\.suggestionBar[\s\S]{0,100}promptInput\.suggestionBar/,
    );
  });

  it("the screen collects uploads from BOTH modes into one id list", () => {
    // Two call sites, one collector: web keeps a single shared upload pool
    // across its two create panels for the same reason — a file picked in this
    // modal must survive a mode switch.
    const callSites = screen.match(/onAttachmentUploaded=/g) ?? [];
    expect(callSites.length).toBe(2);
    expect(screen.match(/onUploadingChange=/g)?.length).toBe(2);
    expect(screen).toContain("addUploadedAttachmentId(prev, id)");
    expect(screen.match(/onAttachmentUploaded=\{collectAttachment\}/g)?.length).toBe(2);
  });

  it("the panel hands the rich field its upload callbacks", () => {
    // The panel is the only place that knows about `DescriptionField`; the
    // screen just passes the collector in. Asserted on the JSX element, not on
    // the file, because the prop names also appear in the panel's own `Props`
    // type — a `toContain` on the bare name would pass on a panel that declared
    // the props and never forwarded them.
    expect(panel).toMatch(
      /<DescriptionField[\s\S]{0,300}onAttachmentUploaded=\{onAttachmentUploaded\}[\s\S]{0,200}onUploadingChange=\{onUploadingChange\}/,
    );
  });

  it("submitAgentMode sends attachment_ids", () => {
    const start = screen.indexOf("const submitAgentMode");
    const body = screen.slice(start, screen.indexOf("const submitManualMode"));
    expect(body).toContain("attachmentIdsPayload(uploadedAttachmentIds)");
    expect(body).toContain("uploadedAttachmentIds,");
  });

  it("submitAgentMode submits the serialized prompt, not the raw editor text", () => {
    // The prompt is a real editor now, so its in-editor form can carry mention
    // sentinels. Sending that raw would hand the agent invisible control
    // characters where a `[@name](mention://…)` link belongs.
    const start = screen.indexOf("const submitAgentMode");
    const body = screen.slice(start, screen.indexOf("const submitManualMode"));
    expect(body).toContain("promptInput.serialize().trim()");
    expect(body).not.toContain("promptInput.text.trim()");
  });

  it("the agent-mode submit button holds while an upload is in flight", () => {
    const at = screen.indexOf("canSubmitQuickCreate({");
    expect(at).toBeGreaterThan(-1);
    const gate = screen.slice(at, screen.indexOf("});", at));
    // Shorthand property, i.e. fed from the `uploadsPending` state. A constant
    // (`uploadsPending: false`) would silently disable the gate, so assert the
    // absence of any explicit value too.
    expect(gate).toMatch(/^\s*uploadsPending,\s*$/m);
    expect(gate).not.toMatch(/uploadsPending\s*:/);
  });

  it("the manual mode's own attachment behaviour is untouched", () => {
    // Regression guard: manual mode is the reference implementation, not the
    // object of this iteration. It still holds submit on the upload gate, and
    // still carries the ids into its own payload field.
    const gate = screen.slice(
      screen.indexOf("const canSubmit ="),
      screen.indexOf("const submitAgentMode"),
    );
    expect(gate).toMatch(/mode === "manual"[\s\S]*?!uploadsPending/);
    const start = screen.indexOf("const submitManualMode");
    const body = screen.slice(start, screen.indexOf("const onSubmit"));
    expect(body).toContain("uploadedAttachmentIds.length > 0");
    expect(body).toContain("attachment_ids: uploadedAttachmentIds");
  });
});
