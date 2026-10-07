/**
 * Iteration 207 — wiring ratchet for `actor` / `multi_actor` custom properties.
 *
 * The mobile vitest lane is Node-only: it has no RN renderer, so a green pure
 * function proves nothing about whether a screen actually calls it. The actor
 * types are exactly where that gap hides a defect — `formatPropertyValue` can
 * be perfect while `custom-property-row.tsx` still has no `actors` branch and
 * falls through to a raw-string chip.
 *
 * Each assertion below corresponds to one surface web renders actor values on.
 * Dropping any one of them puts that screen back to showing `member:<uuid>`,
 * "Unknown", or a dead property editor.
 *
 * Comments are stripped before matching so a comment that merely describes a
 * branch cannot satisfy an assertion.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..");

/** Source with comments removed — an assertion must match real code. */
function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("the issue-detail chip row renders actor values", () => {
  const row = code("components/issue/custom-property-row.tsx");

  it("has an actors branch", () => {
    expect(row).toContain('case "actors"');
  });

  it("has an unknownActors branch instead of silently rendering nothing", () => {
    expect(row).toContain('case "unknownActors"');
  });

  it("names the referenced member rather than printing the reference", () => {
    expect(row).toMatch(/getName\(\s*["']member["']|getName\(ref\.kind/);
  });
});

describe("the issue-table cell renders actor values", () => {
  const table = code("components/issue/table-view.tsx");

  it("has an actors branch", () => {
    expect(table).toContain('case "actors"');
  });
});

describe("the property-value editor can edit actor values", () => {
  const editor = code("components/issue/pickers/property-value-editor.tsx");

  it("offers both actor types as commit types", () => {
    // Without them the editor marks the property read-only and the value can
    // never be set from the phone at all. The assertion is anchored inside the
    // COMMIT_TYPES literal itself: a loose "actor appears somewhere in the
    // file" match still passes when the entry is deleted but a comment or a
    // string mentions it elsewhere.
    const literal = editor.match(/const COMMIT_TYPES = new Set\(\[([\s\S]*?)\]\)/);
    expect(literal, "COMMIT_TYPES literal must exist").not.toBeNull();
    expect(literal![1]).toMatch(/"actor"/);
    expect(literal![1]).toMatch(/"multi_actor"/);
  });

  it("withholds the editor when a single actor value is unreadable", () => {
    // Dropping this guard turns an unparseable `actor` value into an empty,
    // editable field: the user fills it in and silently overwrites a value
    // they were never shown. Needs BOTH halves: the helper feeding the flag,
    // and the flag feeding the readOnly decision. A loose
    // `readOnly = ... hasUnknownActorRef(value)` match would also accept a
    // commented-out or dead assignment anywhere earlier in the file.
    expect(editor).toMatch(
      /const unknownActorRef =\s*\n?\s*property\.type === "actor" \u0026\u0026 hasUnknownActorRef\(value\)/,
    );
    expect(editor).toMatch(/const readOnly =[\s\S]{0,120}unknownActorRef/);
  });

  it("reads the workspace member directory", () => {
    expect(editor).toContain("memberListOptions");
  });

  it("names actor refs on the read-only path too", () => {
    // An archived definition (or an unreadable single `actor`) still renders
    // the value — through the same resolver as the editable list. Printing
    // `ref.id` there would put the raw uuid back on screen through the one
    // path this iteration did not otherwise touch.
    const roster = editor.match(/const \{ getName \} = useActorLookup\(\)/);
    expect(roster, "editor must resolve actor names").not.toBeNull();
    expect(editor).not.toMatch(/refs\.map\(\(ref\) => ref\.id\)/);
  });

  it("round-trips unknown refs through the raw list, not the parsed one", () => {
    // `actorRefsFromValue` drops kinds this build cannot parse; using it as
    // the toggle's `current` would delete them on the first tick.
    expect(editor).toContain("actorRefValuesFromValue");
    expect(editor).toContain("toggleActorRefValue");
  });
});

describe("the filter menu offers actor properties", () => {
  const filter = code("app/(app)/[workspace]/issues-filter.tsx");

  it("includes both actor types in its filterable set", () => {
    expect(filter).toMatch(/filterableProperties[\s\S]*?isActorPropertyType/);
  });

  it("lists members as the filter's candidate values", () => {
    const bodies = code("components/issue/pickers/filter-picker-bodies.tsx");
    // The member directory must be READ BY THE ACTOR BRANCH — a bare
    // `memberListOptions` mention already exists for the assignee/creator
    // section, so presence alone would not notice the actor branch going
    // dead. The candidate set itself is built by `propertyFilterOptions`,
    // which `issue-properties-actor.test.ts` exercises behaviourally; here we
    // only pin that this component is wired to it and still reads the
    // directory under the actor guard.
    expect(bodies).toMatch(
      /memberListOptions\(wsId\),\s*enabled:\s*actorProperty/,
    );
    expect(bodies).toMatch(/propertyFilterOptions\(\{/);
    expect(bodies).toMatch(/members:\s*membersRead\.items/);
  });
});

describe("the property management form offers both actor types", () => {
  it("shows them in the type picker", () => {
    // The form maps ISSUE_PROPERTY_TYPES, so widening the core union is what
    // surfaces them; this pins that the union is the source and stays widened.
    const form = code("components/property/property-form.tsx");
    expect(form).toContain("ISSUE_PROPERTY_TYPES");
  });
});
