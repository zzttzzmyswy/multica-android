/**
 * Project-resource narrowing (MYS-1149). `resource_ref` is a union widened
 * with `Record<string, unknown>`, so the only safe read is behind the
 * `resource_type` discriminant — a local_directory resource carries
 * `local_path`/`daemon_id` and no url at all, and an unknown type added
 * server-side must not be mistaken for a repository.
 *
 * Iteration 135 adds the local_directory half of that narrowing
 * (`localDirectoryRef` / `localDirectoryPath` / `executionModeOf`), the row
 * subtitle both types share, and the two client-side validators that mirror
 * the server's own rules (`isAbsoluteLocalPath` / `isValidGitRepoUrl`).
 */
import { describe, expect, it } from "vitest";
import type { ProjectResource } from "@multica/core/types";
import {
  attachedDaemonIds,
  executionModeOf,
  githubResourceUrl,
  githubResourceUrls,
  isAbsoluteLocalPath,
  isValidGitRepoUrl,
  localDirectoryPath,
  localDirectoryRef,
  resourceSubtitle,
  worktreeUnsupportedInfo,
} from "./project-resources";

/** Stand-in for `data/api.ts`'s ApiError — the function under test matches on
 *  the shape, not the class, so this pins the contract without dragging React
 *  Native into the pure-TS lane. */
function apiError(status: number, body?: unknown, message = "boom"): Error {
  return Object.assign(new Error(message), { status, body });
}

function resource(
  resource_type: string,
  resource_ref: Record<string, unknown>,
  over: Partial<ProjectResource> = {},
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
    ...over,
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

describe("localDirectoryRef (iteration 135)", () => {
  it("narrows a well-formed local_directory ref", () => {
    const r = resource("local_directory", {
      local_path: "/srv/repo",
      daemon_id: "d1",
      label: "后端",
      execution_mode: "worktree",
    });
    expect(localDirectoryRef(r)).toEqual({
      local_path: "/srv/repo",
      daemon_id: "d1",
      label: "后端",
      execution_mode: "worktree",
    });
    expect(localDirectoryPath(r)).toBe("/srv/repo");
  });

  it("yields null for the wrong type, and for a shapeless ref", () => {
    expect(
      localDirectoryRef(resource("github_repo", { url: "https://github.com/o/r" })),
    ).toBeNull();
    // Type-right but missing the two required fields — a half-read ref must
    // not reach the UI as a path-less row.
    expect(localDirectoryRef(resource("local_directory", { foo: 1 }))).toBeNull();
    expect(
      localDirectoryRef(resource("local_directory", { local_path: "/srv/app" })),
    ).toBeNull();
    expect(
      localDirectoryRef(resource("local_directory", { daemon_id: "d1" })),
    ).toBeNull();
  });
});

describe("executionModeOf", () => {
  it("treats an absent mode as in_place", () => {
    // Server contract: the zero value means in_place, so resources created
    // before worktree existed keep their original behaviour
    // (server/internal/handler/project_resource.go:217).
    expect(executionModeOf({ local_path: "/x", daemon_id: "d" })).toBe("in_place");
  });

  it("passes through the two real modes", () => {
    expect(
      executionModeOf({ local_path: "/x", daemon_id: "d", execution_mode: "in_place" }),
    ).toBe("in_place");
    expect(
      executionModeOf({ local_path: "/x", daemon_id: "d", execution_mode: "worktree" }),
    ).toBe("worktree");
  });

  it("degrades an unrecognised mode to in_place rather than echoing it", () => {
    expect(
      executionModeOf({
        local_path: "/x",
        daemon_id: "d",
        execution_mode: "nonsense" as never,
      }),
    ).toBe("in_place");
  });
});

describe("resourceSubtitle", () => {
  it("reads the url or the path per type", () => {
    expect(
      resourceSubtitle(resource("github_repo", { url: "https://github.com/o/r" })),
    ).toBe("https://github.com/o/r");
    expect(
      resourceSubtitle(resource("local_directory", { local_path: "/srv/repo", daemon_id: "d1" })),
    ).toBe("/srv/repo");
  });

  it("falls back to the raw type for an unknown server-side resource", () => {
    // Never invent a url for a type we do not understand.
    expect(resourceSubtitle(resource("future_thing", { url: "https://x/y" }))).toBe(
      "future_thing",
    );
  });
});

describe("attachedDaemonIds", () => {
  it("lists the daemons already holding a local directory on the project", () => {
    // The server refuses a second local_directory on the same daemon (409,
    // project_resource.go:436), so the runtime picker must disable those rows
    // instead of offering a write that can only fail.
    expect(
      attachedDaemonIds([
        resource("local_directory", { local_path: "/a", daemon_id: "d1" }),
        resource("local_directory", { local_path: "/b", daemon_id: "d2" }),
        resource("github_repo", { url: "https://github.com/o/r" }),
      ]),
    ).toEqual(["d1", "d2"]);
  });

  it("is empty when nothing is attached", () => {
    expect(attachedDaemonIds([])).toEqual([]);
  });
});

// Mirrors server/internal/handler/project_resource.go:304 isAbsoluteLocalPath —
// the union of POSIX, Windows drive-letter and UNC forms, because the server
// cannot know which OS the daemon runs on. The phone must accept the same set
// or it would block a path the server would happily store.
describe("isAbsoluteLocalPath", () => {
  it("accepts every absolute form the server accepts", () => {
    expect(isAbsoluteLocalPath("/srv/repo")).toBe(true);
    expect(isAbsoluteLocalPath("C:\\repos\\x")).toBe(true);
    expect(isAbsoluteLocalPath("C:/repos/x")).toBe(true);
    expect(isAbsoluteLocalPath("\\\\host\\share")).toBe(true);
  });

  it("rejects relative, empty and near-miss forms", () => {
    expect(isAbsoluteLocalPath("")).toBe(false);
    expect(isAbsoluteLocalPath("srv/repo")).toBe(false);
    expect(isAbsoluteLocalPath("./repo")).toBe(false);
    expect(isAbsoluteLocalPath("C:repo")).toBe(false);
    expect(isAbsoluteLocalPath("1:\\repo")).toBe(false);
  });
});

// The sheet used to hard-require ^https://github\.com/…, which silently
// rejected the ssh and self-hosted forms the server accepts
// (project_resource.go:330 isValidGitRepoURL) — the "custom repo URL" gap.
describe("isValidGitRepoUrl", () => {
  it("accepts the three forms GitHub's Code menu offers", () => {
    expect(isValidGitRepoUrl("https://github.com/owner/repo")).toBe(true);
    expect(isValidGitRepoUrl("https://github.com/owner/repo.git")).toBe(true);
    expect(isValidGitRepoUrl("git@github.com:owner/repo.git")).toBe(true);
    expect(isValidGitRepoUrl("ssh://git@github.com/owner/repo.git")).toBe(true);
    expect(isValidGitRepoUrl("git://example.com/owner/repo.git")).toBe(true);
  });

  it("accepts a self-hosted host, not just github.com", () => {
    expect(isValidGitRepoUrl("https://git.example.com/team/repo")).toBe(true);
    expect(isValidGitRepoUrl("git@gitlab.example.com:team/repo.git")).toBe(true);
  });

  it("rejects pasted garbage", () => {
    expect(isValidGitRepoUrl("")).toBe(false);
    expect(isValidGitRepoUrl("not-a-url")).toBe(false);
    expect(isValidGitRepoUrl("owner/repo")).toBe(false);
    expect(isValidGitRepoUrl("ftp://example.com/x")).toBe(false);
    // scp-like with a space, or with '@' at/after the colon, is malformed.
    expect(isValidGitRepoUrl("git@host:path with space")).toBe(false);
    expect(isValidGitRepoUrl("host:pa@th")).toBe(false);
    expect(isValidGitRepoUrl("host:")).toBe(false);
    expect(isValidGitRepoUrl(":path")).toBe(false);
  });
});

// The only local-directory failure the phone can neither predict nor prevent
// is the server's daemon-version gate: the capability lives on the daemon, and
// the phone cannot ask it. The server answers 422 with a machine-readable code
// (project_resource.go:186) precisely so the client can keep the sheet open
// and say which machine to upgrade, instead of a bare toast.
describe("worktreeUnsupportedInfo", () => {
  it("reads the 422 daemon_version_unsupported body", () => {
    const err = apiError(422, {
      code: "daemon_version_unsupported",
      error: "local_directory: \"/srv/x\" is set to parallel (worktree) mode…",
      current_version: "0.4.1",
      min_version: "0.5.0",
    });
    expect(worktreeUnsupportedInfo(err)).toEqual({
      message: "local_directory: \"/srv/x\" is set to parallel (worktree) mode…",
      currentVersion: "0.4.1",
      minVersion: "0.5.0",
    });
  });

  it("ignores a 422 for a different reason, and other statuses", () => {
    expect(
      worktreeUnsupportedInfo(apiError(422, { code: "something_else" })),
    ).toBeNull();
    expect(
      worktreeUnsupportedInfo(
        apiError(409, { code: "daemon_version_unsupported" }),
      ),
    ).toBeNull();
  });

  it("tolerates a missing version pair and a non-ApiError", () => {
    const partial = worktreeUnsupportedInfo(
      apiError(422, { code: "daemon_version_unsupported" }),
    );
    expect(partial).toEqual({ message: "boom", currentVersion: "", minVersion: "" });
    expect(worktreeUnsupportedInfo(new Error("plain"))).toBeNull();
    expect(worktreeUnsupportedInfo(undefined)).toBeNull();
  });
});
