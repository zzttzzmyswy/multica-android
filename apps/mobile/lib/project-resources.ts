/**
 * Project-resource helpers shared by the project detail section and the
 * add-resource sheet (MYS-1149).
 *
 * `resource_ref` is a per-`resource_type` union widened with
 * `Record<string, unknown>` (see `packages/core/types/project.ts:100`), so a
 * `.url` read is only meaningful once the type is known — the same narrowing
 * web's `isGithubRef` performs. Unknown server-side types must be skipped
 * rather than guessed at.
 */
import type { GithubRepoResourceRef, ProjectResource } from "@multica/core/types";

/** The url of a `github_repo` resource, or null for every other type. */
export function githubResourceUrl(resource: ProjectResource): string | null {
  if (resource.resource_type !== "github_repo") return null;
  const ref = resource.resource_ref as GithubRepoResourceRef | undefined;
  return typeof ref?.url === "string" ? ref.url : null;
}

/**
 * Every repository url already mounted on a project. Drives the "already
 * attached, cannot attach again" state in the add-resource sheet — the
 * server rejects a second resource for the same repo, so these rows must not
 * look actionable.
 */
export function githubResourceUrls(
  resources: readonly ProjectResource[],
): string[] {
  const urls: string[] = [];
  for (const resource of resources) {
    const url = githubResourceUrl(resource);
    if (url !== null) urls.push(url);
  }
  return urls;
}
