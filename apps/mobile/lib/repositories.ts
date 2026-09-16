/**
 * Repository URL normalisation — mirrors web repositories-tab.tsx
 * `repositoryIdentity`. Used to de-duplicate manual entries against GitHub
 * imports, and to compare existing vs incoming repository urls. Returns the
 * canonical `host/path` identity, or null for unparseable / empty input.
 */
export interface WorkspaceRepoIdentity {
  host: string;
  path: string;
}

export function parseRepositoryURL(rawURL: string): WorkspaceRepoIdentity | null {
  const value = rawURL.trim();
  if (!value) return null;

  let host = "";
  let path = "";
  if (!value.includes("://")) {
    const scpLike = value.match(/^(?:[^@\s/]+@)?([^:\s/]+):(.+)$/);
    if (scpLike) {
      host = scpLike[1] ?? "";
      path = scpLike[2] ?? "";
    }
  }
  if (!host) {
    try {
      const parsed = new URL(value);
      host = parsed.hostname;
      path = parsed.pathname;
    } catch {
      return null;
    }
  }

  const normalizedPath = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
  if (!host || !normalizedPath) return null;
  return { host: host.toLowerCase(), path: normalizedPath };
}

/** Canonical `host/path` identity used to de-duplicate repository entries. */
export function repositoryIdentity(rawURL: string): string | null {
  const parsed = parseRepositoryURL(rawURL);
  return parsed ? `${parsed.host}/${parsed.path}` : null;
}

/**
 * Short display label for a repository row — `owner/repo` for a GitHub url,
 * the raw url otherwise. Mirrors web `packages/views/common/github-url.ts`
 * `githubShortLabel`, minus its `midTruncate` (the mobile row is a single
 * `numberOfLines={1}` Text, so the native ellipsizer does that job).
 */
export function repoShortLabel(rawURL: string): string {
  // scp shorthand — `new URL()` throws on these, so match before the try.
  const scp = rawURL.match(
    /^(?:[^@/]+@)?github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/,
  );
  if (scp) return `${scp[1]}/${scp[2]}`;
  try {
    const parsed = new URL(rawURL);
    if (parsed.hostname === "github.com" || parsed.hostname === "www.github.com") {
      const [owner, repo] = parsed.pathname.split("/").filter(Boolean);
      if (owner && repo) return `${owner}/${repo.replace(/\.git$/, "")}`;
    }
  } catch {
    // Not a parseable URL — fall through and show it as-is.
  }
  return rawURL;
}

/**
 * Is `repoURL` (a row of the workspace's configured repositories) already
 * mounted on the project as a resource?
 *
 * Web matches the resource url string exactly
 * (`project-resources-section.tsx:158,448`). Identity matching is used here
 * instead because mobile keeps the manual-URL fallback form: a user can
 * register the same repository with a different spelling (`.git` suffix, scp
 * form, trailing slash) and web's exact match would leave the workspace row
 * looking attachable, only to fail with a server-side duplicate 409. Equal
 * identities are exactly the case the server rejects, so nothing attachable
 * is hidden — and unparseable urls still match themselves, since
 * `repositoryIdentity` returns null for both and `null === null` would
 * otherwise report every junk url as attached.
 */
export function isRepoAttached(
  repoURL: string,
  attachedURLs: readonly string[],
): boolean {
  const identity = repositoryIdentity(repoURL);
  return attachedURLs.some((url) => {
    if (url === repoURL) return true;
    if (identity === null) return false;
    return repositoryIdentity(url) === identity;
  });
}

/**
 * Display source for a repository row. The server stores only `url` +
 * `description` on Workspace.repos, so "GitHub" is inferred from the host
 * (github.com clone urls) and everything else reads as manual.
 */
export function repositorySource(rawURL: string): "github" | "manual" {
  const parsed = parseRepositoryURL(rawURL);
  return parsed?.host === "github.com" ? "github" : "manual";
}