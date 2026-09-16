/**
 * Project-resource narrowing (MYS-1149). `resource_ref` is a union widened
 * with `Record<string, unknown>`, so the only safe read is behind the
 * `resource_type` discriminant — a local_directory resource carries
 * `local_path`/`daemon_id` and no url at all, and an unknown type added
 * server-side must not be mistaken for a repository.
 */
import { describe, expect, it } from "vitest";
import type { ProjectResource } from "@multica/core/types";
import { githubResourceUrl, githubResourceUrls } from "./project-resources";

function resource(
  resource_type: string,
  resource_ref: Record<string, unknown>,
): ProjectResource {
  return {
    id: `${resource_type}-${JSON.stringify(resource_ref)}`,
    project_id: "p1",
    workspace_id: "ws",
    resource_type,
    resource_ref,
    label: null,
    position: 0,
    created_at: "",
    created_by: null,
  } as unknown as ProjectResource;
}

describe("githubResourceUrl", () => {
  it("reads the url of a github_repo resource", () => {
    expect(
      githubResourceUrl(resource("github_repo", { url: "https://github.com/o/r" })),
    ).toBe("https://github.com/o/r");
  });

  it("ignores local_directory resources, which have no url", () => {
    expect(
      githubResourceUrl(resource("local_directory", { local_path: "/srv/app" })),
    ).toBeNull();
  });

  it("ignores an unknown resource type that happens to carry a url", () => {
    expect(
      githubResourceUrl(resource("gitlab_repo", { url: "https://gitlab.com/o/r" })),
    ).toBeNull();
  });

  it("rejects a non-string url", () => {
    expect(githubResourceUrl(resource("github_repo", { url: 42 }))).toBeNull();
    expect(githubResourceUrl(resource("github_repo", {}))).toBeNull();
  });
});

describe("githubResourceUrls", () => {
  it("collects only the repository urls, in order", () => {
    expect(
      githubResourceUrls([
        resource("github_repo", { url: "https://github.com/o/a" }),
        resource("local_directory", { local_path: "/srv/app" }),
        resource("github_repo", { url: "https://github.com/o/b" }),
      ]),
    ).toEqual(["https://github.com/o/a", "https://github.com/o/b"]);
  });

  it("returns an empty list for no resources", () => {
    expect(githubResourceUrls([])).toEqual([]);
  });
});
