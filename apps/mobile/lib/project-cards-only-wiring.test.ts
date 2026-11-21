import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const src = (file: string) => readFileSync(path.join(root, file), "utf8");

describe("mobile projects catalog is card-only", () => {
  const screen = src("components/project/projects-screen.tsx");

  it("uses the same card catalog from both existing entry points", () => {
    for (const route of [
      "app/(app)/[workspace]/(tabs)/projects.tsx",
      "app/(app)/[workspace]/more/projects.tsx",
    ]) {
      expect(src(route), route).toContain("<ProjectsScreen");
    }
    expect(screen.match(/<FlatList\b/g)).toHaveLength(1);
    expect(screen).toContain("<ProjectRow");
    expect(screen).toContain("data={visible}");
  });

  it("cannot switch back to a table even if an old table preference exists", () => {
    expect(screen).not.toMatch(/ProjectTable|tableColumns|columnMenuOpen|setViewMode|viewMode|SegmentedControl/);
    expect(existsSync(path.join(root, "components/project/project-table-view.tsx"))).toBe(false);
    expect(existsSync(path.join(root, "data/stores/project-table-columns.ts"))).toBe(false);
  });
});
