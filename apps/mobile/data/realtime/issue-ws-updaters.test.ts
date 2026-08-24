import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { Issue } from "@multica/core/types";

import { issueKeys } from "@/data/queries/issue-keys";
import {
  invalidateIssueAfterReconnect,
  patchActorIssuesList,
  removeFromActorIssuesList,
} from "./issue-ws-updaters";

/** Seed a cached actor list (member, assigned scope) with two rows. */
function seedActorList(qc: QueryClient, wsId: string) {
  const key = issueKeys.actorList(wsId, "member", "u_1", "assigned");
  qc.setQueryData<Issue[]>(
    key,
    [
      { id: "iss_a", identifier: "MYS-1", status: "todo" },
      { id: "iss_b", identifier: "MYS-2", status: "todo" },
    ] as unknown as Issue[],
  );
  return key;
}

describe("actor issues list updaters", () => {
  it("patchActorIssuesList updates a row already in any cached actor list", () => {
    const qc = new QueryClient();
    const wsId = "ws-1";
    const key = seedActorList(qc, wsId);
    patchActorIssuesList(qc, wsId, { id: "iss_a", status: "done" });
    expect(qc.getQueryData<Issue[]>(key)?.find((i) => i.id === "iss_a")?.status).toBe("done");
  });

  it("patchActorIssuesList leaves non-matching rows untouched and keeps the list length", () => {
    const qc = new QueryClient();
    const wsId = "ws-1";
    const key = seedActorList(qc, wsId);
    patchActorIssuesList(qc, wsId, { id: "iss_b", status: "in_progress" });
    const rows = qc.getQueryData<Issue[]>(key) ?? [];
    expect(rows).toHaveLength(2);
    expect(rows.find((i) => i.id === "iss_a")?.status).toBe("todo");
  });

  it("removeFromActorIssuesList strips the issue from every cached actor list", () => {
    const qc = new QueryClient();
    const wsId = "ws-1";
    const key = seedActorList(qc, wsId);
    removeFromActorIssuesList(qc, wsId, "iss_a");
    expect(qc.getQueryData<Issue[]>(key)?.map((i) => i.id)).toEqual(["iss_b"]);
  });
});

describe("invalidateIssueAfterReconnect", () => {
  it("invalidates attachments together with the issue and task caches", () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const wsId = "workspace-1";
    const issueId = "issue-1";

    invalidateIssueAfterReconnect(qc, wsId, issueId);

    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      issueKeys.detail(wsId, issueId),
      issueKeys.timeline(wsId, issueId),
      issueKeys.attachments(wsId, issueId),
      issueKeys.activeTasks(wsId, issueId),
      issueKeys.tasks(wsId, issueId),
    ]);
  });
});
