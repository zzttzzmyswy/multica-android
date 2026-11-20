import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";

function component(path: string) {
  return readFileSync(new URL(`../components/${path}.tsx`, import.meta.url), "utf8");
}

describe("phone issue workbench affordances", () => {
  it("keeps the completed toggle available when the Gantt canvas is empty", () => {
    const source = component("issue/gantt-view");
    const toggler = source.indexOf('accessibilityState={{ checked: showCompleted }}');
    const empty = source.indexOf("{!hasScheduled ? (");
    expect(toggler).toBeGreaterThan(0);
    expect(empty).toBeGreaterThan(toggler);
    expect(source).not.toMatch(/if\s*\(scheduled\.length\s*===\s*0\)/);
    expect(source).toContain('filteredToEmpty ? t("issues.filterEmpty") : emptyLabel');
  });

  it("keeps both Gantt headers pinned and shares row height across panes", () => {
    const source = component("issue/gantt-view");
    const leftHeader = source.indexOf('t("issues.gantt.headerIssue")');
    expect(leftHeader).toBeGreaterThan(0);
    expect(leftHeader).toBeLessThan(source.indexOf("ref={leftScrollRef}"));
    expect(source.indexOf("{/* Header */}")).toBeLessThan(source.indexOf("ref={bodyScrollRef}"));
    expect(source.match(/rowHeight=\{rowHeight\}/g)).toHaveLength(2);
  });

  it("keeps board create and hide controls separate from the full-title card row", () => {
    const board = component("issue/board-view");
    expect(board).toMatch(/onCreateIssue\(column\)[\s\S]*?className="size-12\b/);
    expect(board).toMatch(/disabled=\{statusFixedByView\}[\s\S]*?size-12\b/);
    const card = component("issue/board-card");
    const id = card.indexOf("{issue.identifier}");
    const title = card.indexOf("{issue.title}");
    expect(id).toBeGreaterThan(0);
    expect(card.slice(id, title)).toMatch(/<\/View>\s*<Text numberOfLines=\{3\}/);
    expect(card).toContain("onLongPress={onLongPress}");
  });
});
