/**
 * Project-resource helpers shared by the project detail section and the
 * add-resource sheet (MYS-1149, extended in iteration 135).
 *
 * `resource_ref` is a per-`resource_type` union widened with
 * `Record<string, unknown>` (see `packages/core/types/project.ts:100`), so a
 * `.url` read is only meaningful once the type is known — the same narrowing
 * web's `isGithubRef` performs. Unknown server-side types must be skipped
 * rather than guessed at.
 *
 * Iteration 135 adds the `local_directory` half: the ref narrowing, the
 * absent-means-in_place mode rule, and the two client-side validators. Both
 * validators are deliberate re-implementations of the server's own checks
 * rather than a looser phone-only approximation — a stricter client blocks a
 * write the server would accept (exactly the bug the old github.com-only
 * pattern had), and a looser one only buys a round trip.
 */
import type {
  GithubRepoResourceRef,
  LocalDirectoryExecutionMode,
  LocalDirectoryResourceRef,
  ProjectResource,
} from "@multica/core/types";

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

/**
 * The ref of a `local_directory` resource, or null when the type is wrong or
 * the shape is not usable. Both required fields are checked: a ref missing
 * `local_path` or `daemon_id` cannot be rendered as a directory row (and
 * cannot be edited), so it degrades to the generic unknown-type row instead
 * of a half-read one.
 */
export function localDirectoryRef(
  resource: ProjectResource,
): LocalDirectoryResourceRef | null {
  if (resource.resource_type !== "local_directory") return null;
  const ref = resource.resource_ref as Partial<LocalDirectoryResourceRef>;
  if (typeof ref?.local_path !== "string" || typeof ref?.daemon_id !== "string") {
    return null;
  }
  if (ref.local_path.length === 0 || ref.daemon_id.length === 0) return null;
  return ref as LocalDirectoryResourceRef;
}

/** The absolute path a `local_directory` resource pins, or null. */
export function localDirectoryPath(resource: ProjectResource): string | null {
  return localDirectoryRef(resource)?.local_path ?? null;
}

/**
 * The mode a ref runs under. An absent (or unrecognised) `execution_mode` is
 * `in_place`: that is the server's own zero-value rule
 * (`server/internal/handler/project_resource.go:217`), so a resource created
 * before worktree existed reports the behaviour it actually has rather than
 * an empty badge.
 */
export function executionModeOf(
  ref: LocalDirectoryResourceRef,
): LocalDirectoryExecutionMode {
  return ref.execution_mode === "worktree" ? "worktree" : "in_place";
}

/**
 * The daemon ids that already hold a local directory on this project. The
 * server allows only one per daemon (`project_resource.go:436`, 409), so the
 * runtime picker disables those rows instead of offering a write that can
 * only fail.
 */
export function attachedDaemonIds(
  resources: readonly ProjectResource[],
): string[] {
  const ids: string[] = [];
  for (const resource of resources) {
    const ref = localDirectoryRef(resource);
    if (ref) ids.push(ref.daemon_id);
  }
  return ids;
}

/**
 * The one-line description of a resource: its url for a repository, its path
 * for a local directory, and the raw `resource_type` for anything the phone
 * does not model. Never invents a value — an unknown type must read as the
 * type, not as some field that happened to be present.
 */
export function resourceSubtitle(resource: ProjectResource): string {
  return (
    githubResourceUrl(resource) ??
    localDirectoryPath(resource) ??
    resource.resource_type
  );
}

/**
 * Whether a path is absolute in any form the server accepts
 * (`project_resource.go:304` `isAbsoluteLocalPath`): a leading `/` (POSIX),
 * a UNC `\\host\share`, or a drive letter like `C:\` / `C:/`. The server
 * cannot know which OS the daemon runs on, so it accepts the union — the
 * phone has even less information and must mirror it exactly.
 *
 * This is a typo guard, not a filesystem check: the daemon verifies existence
 * when it dispatches a task.
 */
export function isAbsoluteLocalPath(path: string): boolean {
  if (path.length === 0) return false;
  if (path[0] === "/") return true;
  if (path.startsWith("\\\\")) return true;
  if (path.length >= 3 && isDriveLetter(path[0]) && path[1] === ":") {
    return path[2] === "\\" || path[2] === "/";
  }
  return false;
}

function isDriveLetter(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z");
}

/**
 * Whether a string is a git repository url the server will accept
 * (`project_resource.go:330` `isValidGitRepoURL`). Three forms, which is what
 * GitHub's "Code" menu hands out: `http(s)://`, an explicit `ssh://` / `git://`
 * scheme, and the scp-like `[user@]host:path` shorthand. Intentionally lax
 * about the rest — the clone happens daemon-side and git's own error is
 * clearer than ours.
 *
 * The host is NOT constrained to github.com: the workspace's own repository
 * list is the common path, but a self-hosted or GitLab/Codeberg remote is a
 * legitimate custom entry, and the old github.com-only client check rejected
 * it before the request ever left the phone.
 */
export function isValidGitRepoUrl(url: string): boolean {
  const value = url.trim();
  if (value.length === 0) return false;
  // Deliberately not `new URL()`: Hermes' URL shim does not throw on the
  // malformed inputs this is meant to catch, so the parse would have to be
  // re-checked by hand anyway. A scheme + host test is what the server's
  // url.Parse branch actually decides on, and it behaves identically here.
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(value);
  if (scheme) {
    if (!GIT_URL_SCHEMES.has(scheme[1].toLowerCase())) return false;
    return value.slice(scheme[0].length).split(/[/?#]/)[0].length > 0;
  }
  if (value.includes(" ") || value.includes("://")) return false;
  const colon = value.indexOf(":");
  if (colon <= 0 || colon === value.length - 1) return false;
  // In `[user@]host:path`, `@` is only the user separator before the first
  // `:`. Anything at or after it is malformed — reject rather than guess.
  const at = value.indexOf("@");
  if (at >= colon) return false;
  const hostStart = at >= 0 ? at + 1 : 0;
  const host = value.slice(hostStart, colon);
  const path = value.slice(colon + 1);
  return host.length > 0 && path.length > 0;
}

const GIT_URL_SCHEMES = new Set(["http", "https", "ssh", "git"]);

/** The server's refusal to save `execution_mode: worktree` on a daemon that
 *  predates the capability (422 `daemon_version_unsupported`,
 *  `server/internal/handler/project_resource.go:186`). */
export interface WorktreeUnsupportedInfo {
  /** The server's own sentence — already authored for the user, and the only
   *  text that names the offending path. */
  message: string;
  currentVersion: string;
  minVersion: string;
}

/**
 * The daemon-version refusal behind an error, or null for every other failure.
 *
 * This is the one local-directory failure the phone can neither predict nor
 * prevent: the capability belongs to the daemon, and the phone cannot ask it.
 * The server answers with a machine-readable code precisely so the client can
 * keep the sheet open and say which machine needs upgrading, rather than
 * closing on a bare toast (web's `modeError` does the same,
 * `project-resources-section.tsx:304-311`).
 *
 * Matched STRUCTURALLY rather than with `instanceof ApiError`: this module is
 * imported by the pure-TS vitest lane, and `data/api.ts` drags React Native in
 * with it. The shape read here (`status` + a JSON `body`) is exactly what
 * `ApiError` exposes, and anything else simply fails the check.
 */
export function worktreeUnsupportedInfo(
  err: unknown,
): WorktreeUnsupportedInfo | null {
  if (typeof err !== "object" || err === null) return null;
  const { status, body } = err as { status?: unknown; body?: unknown };
  if (status !== 422) return null;
  if (typeof body !== "object" || body === null) return null;
  const payload = body as {
    code?: unknown;
    error?: unknown;
    current_version?: unknown;
    min_version?: unknown;
  };
  if (payload.code !== "daemon_version_unsupported") return null;
  return {
    message:
      typeof payload.error === "string"
        ? payload.error
        : err instanceof Error
          ? err.message
          : String(err),
    currentVersion:
      typeof payload.current_version === "string" ? payload.current_version : "",
    minVersion:
      typeof payload.min_version === "string" ? payload.min_version : "",
  };
}
