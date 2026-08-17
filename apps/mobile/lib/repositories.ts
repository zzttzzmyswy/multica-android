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
 * Display source for a repository row. The server stores only `url` +
 * `description` on Workspace.repos, so "GitHub" is inferred from the host
 * (github.com clone urls) and everything else reads as manual.
 */
export function repositorySource(rawURL: string): "github" | "manual" {
  const parsed = parseRepositoryURL(rawURL);
  return parsed?.host === "github.com" ? "github" : "manual";
}