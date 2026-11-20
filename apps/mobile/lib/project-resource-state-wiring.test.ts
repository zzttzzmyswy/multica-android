import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.resolve(__dirname, "../components/project/project-resources-section.tsx"), "utf8");

describe("project resource retry wiring", () => {
  it("uses query error/data state instead of folding failed reads into empty", () => {
    expect(source).toContain("projectResourceState({ resources, isError })");
    expect(source).toContain('state === "empty"');
    expect(source).not.toContain("!resources || resources.length === 0");
    expect(source).toContain("resources?.map((resource)");
  });
  it("provides a local accessible retry with pending feedback for both error states", () => {
    expect(source).toContain('state === "error" || state === "stale"');
    expect(source).toContain("onPress={() => void refetch()}");
    expect(source).toContain('accessibilityLabel={t("common.retry")}');
    expect(source).toContain("disabled={isFetching}");
    expect(source).toContain("busy: isFetching");
    expect(source).toContain('accessibilityRole="alert"');
  });
  it("preserves existing resource actions and stable resource identity", () => {
    expect(source).toContain("key={resource.id}");
    expect(source).toContain("onPress={() => onOpen(resource)}");
    expect(source).toContain("onLongPress={() => onLongPress(resource)}");
    expect(source).toContain("onPress={onAdd}");
  });
});

const properties = readFileSync(path.resolve(__dirname, "../components/project/project-properties-section.tsx"), "utf8");
describe("project property presentation", () => {
  it("labels the section and leaves room for long property values", () => {
    expect(properties).toContain('t("project.propertiesTitle")');
    expect(properties).toContain('accessibilityRole="header"');
    expect(properties).toContain('<View className="min-w-0 flex-1">{right}</View>');
    expect(properties).toContain("accessibilityLabel={label}");
  });
  it("keeps the established workflow/access authorization hooks", () => {
    expect(properties).toContain("useProjectWorkflowPermissions(project)");
    expect(properties).toContain("useProjectAccessPermissions(project)");
    expect(properties).toContain("!!onPress && canManageProject && !pending && !failed");
  });
});
