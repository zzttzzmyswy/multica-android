// @vitest-environment node
/**
 * The access mutation's WIRE contract (MUL-8472, MYS-2915).
 *
 * `lib/project-access.test.ts` pins the permission predicates; these pin what
 * actually leaves the phone, because the two failures that matter here are not
 * visible in a predicate:
 *
 *   - folding add/remove into the PUT writes a stale member list over whatever
 *     another client added between the read and the write (a lost update that
 *     looks like nothing happened);
 *   - invalidating only the project caches leaves issue lists claiming rows the
 *     new visibility has taken away.
 *
 * The hook itself has no renderer in this lane (Node-only, `vitest.config.ts`),
 * so the endpoint choice is asserted through the pure dispatcher the hook
 * delegates to — that is the part a later edit can silently shrink.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/data/api", () => ({ api: {} }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

import { projectKeys } from "@/data/queries/projects";
import { issueKeys } from "@/data/queries/issues";
import type { Project, ListProjectMembersResponse } from "@multica/core/types";
import {
  projectAccessInvalidationKeys,
  sendProjectAccessChange,
  type ProjectAccessChange,
} from "./project-access";

const PROJECT_ID = "proj-1";

/**
 * The stub is typed as the dispatcher's own parameter, so a change to that
 * signature fails HERE rather than letting the test keep passing against an
 * API the production code no longer uses.
 */
type AccessClient = Parameters<typeof sendProjectAccessChange>[0];

function recorder() {
  const calls: { method: string; args: unknown[] }[] = [];
  const client = {
    // The return values are never inspected by the dispatcher; they exist only
    // to satisfy the ApiClient signature it borrows.
    updateProject: vi.fn(async (...args: unknown[]) => {
      calls.push({ method: "updateProject", args });
      return {} as Project;
    }),
    addProjectMembers: vi.fn(async (...args: unknown[]) => {
      calls.push({ method: "addProjectMembers", args });
      return { members: [], total: 0 } satisfies ListProjectMembersResponse;
    }),
    removeProjectMember: vi.fn(async (...args: unknown[]) => {
      calls.push({ method: "removeProjectMember", args });
      return undefined;
    }),
  } satisfies AccessClient;
  return { calls, client };
}

describe("sendProjectAccessChange picks exactly one endpoint", () => {
  it("sends a visibility switch as one PUT carrying the COMPLETE member list", async () => {
    const { calls, client } = recorder();
    await sendProjectAccessChange(client, PROJECT_ID, {
      type: "visibility",
      visibility: "private",
      memberIds: ["u1", "u2"],
    });
    expect(calls.map((c) => c.method)).toEqual(["updateProject"]);
    expect(calls[0].args).toEqual([
      PROJECT_ID,
      { visibility: "private", member_ids: ["u1", "u2"] },
    ]);
  });

  it("sends the workspace direction as a PUT too", async () => {
    const { calls, client } = recorder();
    await sendProjectAccessChange(client, PROJECT_ID, {
      type: "visibility",
      visibility: "workspace",
      memberIds: [],
    });
    expect(calls[0].args[1]).toEqual({ visibility: "workspace", member_ids: [] });
  });

  it("adds a member through POST /members, never through the PUT", async () => {
    // The PUT would have to carry the whole list; sending only the new id there
    // would REMOVE everyone else.
    const { calls, client } = recorder();
    await sendProjectAccessChange(client, PROJECT_ID, {
      type: "add",
      userId: "u3",
    });
    expect(calls.map((c) => c.method)).toEqual(["addProjectMembers"]);
    expect(calls[0].args).toEqual([PROJECT_ID, ["u3"]]);
    expect(client.updateProject).not.toHaveBeenCalled();
  });

  it("removes a member through DELETE /members/{id}, never through the PUT", async () => {
    const { calls, client } = recorder();
    await sendProjectAccessChange(client, PROJECT_ID, {
      type: "remove",
      userId: "u4",
    });
    expect(calls.map((c) => c.method)).toEqual(["removeProjectMember"]);
    expect(calls[0].args).toEqual([PROJECT_ID, "u4"]);
    expect(client.updateProject).not.toHaveBeenCalled();
  });
});

describe("projectAccessInvalidationKeys covers both cache families", () => {
  const wsId = "ws-1";

  it("invalidates projects AND issues", () => {
    const keys = projectAccessInvalidationKeys(wsId);
    expect(keys).toContainEqual(projectKeys.all(wsId));
    // The issue half is not decoration: an issue's visibility is its project's,
    // so a project turning private changes which issues the viewer's own lists
    // may contain.
    expect(keys).toContainEqual(issueKeys.all(wsId));
  });

  it("covers the project's member rows through the project prefix", () => {
    // `projectKeys.members` lives under `detail/{id}/members`, so the `all`
    // prefix reaches it; an explicit members key here would be redundant and
    // would drift if the key shape moved.
    const keys = projectAccessInvalidationKeys(wsId);
    const projectAll = keys[0] as readonly unknown[];
    const memberKey = projectKeys.members(wsId, PROJECT_ID);
    expect(memberKey.slice(0, projectAll.length)).toEqual([...projectAll]);
  });
});
