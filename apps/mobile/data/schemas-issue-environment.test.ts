/**
 * The environments payload is decoded the same way on both clients, and the
 * defaults are the whole safety story: a server older than this feature, a
 * daemon that reports a state this build predates, and one malformed row are
 * all things that happen in the field. Each case below pins the direction the
 * degradation goes, because "wrong" here means either a dead button or a
 * hidden service.
 */
import { describe, expect, it } from "vitest";
// Imported from core, not from `./schemas`: these schemas are SHARED with web
// (both clients decode the same payload), so they live in
// `@multica/core/api/schemas`. A mobile-local copy would be the exact drift this
// test exists to prevent.
import {
  EMPTY_ISSUE_ENVIRONMENTS_RESPONSE,
  IssueEnvironmentCommandSchema,
  IssueEnvironmentsResponseSchema,
} from "@multica/core/api/schemas";

const ROW = {
  id: "env-1",
  issue_id: "issue-1",
  task_id: "task-1",
  runtime_id: "runtime-1",
  agent_id: null,
  local_key: "key-1",
  source: "config",
  kind: "server",
  repo: "org/app",
  name: "web",
  label: "Web",
  url: "http://localhost:3000",
  port: 3000,
  state: "running",
  detail: "",
  excerpt: "",
  started_at: "2026-11-20T10:00:00Z",
  expires_at: null,
  last_seen_at: "2026-11-20T10:00:00Z",
  ended_at: null,
  controllable: true,
  can_control: true,
  pending_action: null,
  last_action: null,
  origin: null,
};

const parse = (payload: unknown) =>
  IssueEnvironmentsResponseSchema.parse(payload);

describe("IssueEnvironmentsResponseSchema", () => {
  it("reads a full row", () => {
    const parsed = parse({
      environments: [ROW],
      configs: [],
      pending_starts: [],
      failed_starts: [],
    });
    expect(parsed.environments).toHaveLength(1);
    expect(parsed.environments[0]).toMatchObject({
      id: "env-1",
      source: "config",
      state: "running",
      can_control: true,
    });
  });

  it("reads an empty payload from a server that predates the feature", () => {
    expect(parse({})).toEqual(EMPTY_ISSUE_ENVIRONMENTS_RESPONSE);
  });

  it("drops one malformed row instead of taking the section with it", () => {
    const parsed = parse({
      environments: [ROW, { id: "broken" }, { ...ROW, id: "env-2" }],
    });
    expect(parsed.environments.map((e) => e.id)).toEqual(["env-1", "env-2"]);
  });

  it("reads an unknown state as unreachable, which offers no Open action", () => {
    // A newer server's state must not silently read as `running`: the row would
    // then offer to open a URL nobody confirmed is answering.
    const parsed = parse({
      environments: [{ ...ROW, state: "hibernating" }],
    });
    expect(parsed.environments[0]!.state).toBe("unreachable");
  });

  it("reads an unknown kind as a server", () => {
    const parsed = parse({ environments: [{ ...ROW, kind: "window" }] });
    expect(parsed.environments[0]!.kind).toBe("server");
  });

  it("reads an unknown source as detected, which offers no control", () => {
    const parsed = parse({ environments: [{ ...ROW, source: "mystery" }] });
    expect(parsed.environments[0]!.source).toBe("detected");
  });

  it("withholds control from a server that never sent the flags", () => {
    // The safe direction: a row nobody may act on, not a button that 403s.
    const { controllable: _c, can_control: _cc, ...bare } = ROW;
    const parsed = parse({ environments: [bare] });
    expect(parsed.environments[0]!.controllable).toBe(false);
    expect(parsed.environments[0]!.can_control).toBe(false);
  });

  it("defaults every optional field a legacy row omits", () => {
    const parsed = parse({
      environments: [
        {
          id: "env-1",
          issue_id: "issue-1",
          task_id: "task-1",
          name: "web",
          started_at: "2026-11-20T10:00:00Z",
          last_seen_at: "2026-11-20T10:00:00Z",
        },
      ],
    });
    expect(parsed.environments[0]).toMatchObject({
      runtime_id: null,
      agent_id: null,
      repo: "",
      label: "",
      url: "",
      port: null,
      detail: "",
      excerpt: "",
      expires_at: null,
      ended_at: null,
      pending_action: null,
      last_action: null,
      origin: null,
    });
  });

  it("reads a malformed local_key as empty rather than dropping the row", () => {
    // The key is only used by Desktop to raise an app window; a phone renders
    // the row fine without it, so losing the whole row would be the worse trade.
    const parsed = parse({ environments: [{ ...ROW, local_key: null }] });
    expect(parsed.environments[0]!.local_key).toBe("");
  });

  it("reads an unknown action status as failed, which offers a retry", () => {
    const parsed = parse({
      environments: [
        {
          ...ROW,
          last_action: {
            id: "act-1",
            action: "stop",
            status: "quantum",
            created_at: "2026-11-20T10:00:00Z",
          },
        },
      ],
    });
    expect(parsed.environments[0]!.last_action?.status).toBe("failed");
  });

  it("drops an action record with an action this client cannot name", () => {
    // Nothing may be offered for a command the client cannot describe.
    const parsed = parse({
      environments: [
        {
          ...ROW,
          pending_action: {
            id: "act-1",
            action: "teleport",
            status: "pending",
            created_at: "2026-11-20T10:00:00Z",
          },
        },
      ],
    });
    expect(parsed.environments[0]!.pending_action).toBeNull();
  });

  it("keeps the declared environments a machine offers to start", () => {
    const parsed = parse({
      configs: [
        {
          runtime_id: "runtime-1",
          task_id: "task-1",
          reported_at: "2026-11-20T10:00:00Z",
          can_control: true,
          environments: [
            { repo: "org/app", name: "web", label: "Web", start: "pnpm dev" },
          ],
        },
      ],
    });
    expect(parsed.configs[0]!.environments[0]).toEqual({
      repo: "org/app",
      name: "web",
      label: "Web",
      start: "pnpm dev",
    });
  });

  it("drops a config whose environments are malformed rather than failing", () => {
    const parsed = parse({
      configs: [{ runtime_id: "runtime-1", task_id: "" }],
    });
    expect(parsed.configs).toEqual([]);
  });

  it("keeps unknown extra fields, so a newer server does not break the read", () => {
    const parsed = parse({
      environments: [{ ...ROW, future_field: "x" }],
      future_top_level: true,
    });
    expect(parsed.environments).toHaveLength(1);
  });
});

describe("IssueEnvironmentCommandSchema", () => {
  it("reads a log answer with its output", () => {
    const parsed = IssueEnvironmentCommandSchema.parse({
      id: "act-1",
      action: "logs",
      status: "succeeded",
      runtime_id: "runtime-1",
      created_at: "2026-11-20T10:00:00Z",
      output: "listening on :3000\n",
    });
    expect(parsed.output).toBe("listening on :3000\n");
    expect(parsed.status).toBe("succeeded");
  });

  it("reads a missing output as null, not as an empty log", () => {
    const parsed = IssueEnvironmentCommandSchema.parse({
      id: "act-1",
      action: "logs",
      status: "pending",
      runtime_id: "runtime-1",
      created_at: "2026-11-20T10:00:00Z",
    });
    expect(parsed.output).toBeNull();
  });

  it("reads an unknown status as failed, so the caller's poll stops", () => {
    const parsed = IssueEnvironmentCommandSchema.parse({
      id: "act-1",
      action: "logs",
      status: "unknown-to-this-build",
      runtime_id: "runtime-1",
      created_at: "2026-11-20T10:00:00Z",
    });
    expect(parsed.status).toBe("failed");
  });
});
